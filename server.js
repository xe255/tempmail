const express = require("express");
const dotenv = require("dotenv");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_BASE_URL = "https://api.notletters.com/v1";
const MAILBOX_FILE = path.join(process.cwd(), "emailpass.txt");
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const LABELS_FILE = path.join(DATA_DIR, "labels.json");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");
const VISITORS_FILE = path.join(DATA_DIR, "visitors.json");

const REQUEST_SPACING_MS = 160;
const REQUEST_TIMEOUT_MS = 20000;
const SUMMARY_SCAN_INTERVAL_MS = 90000;
const STREAM_REFRESH_MS = 3000;
const HEARTBEAT_MS = 15000;
const DATA_SAVE_INTERVAL_MS = 60000;
const MAX_ACTIVITY_LOG = 100;

const ADMIN_USERNAME = "darko";
const ADMIN_PASSWORD = "1234";

const serverStartedAt = new Date().toISOString();

const defaultHeaders = {
  Accept: "application/json",
  Origin: "https://notletters.com",
  Referer: "https://notletters.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
};

const state = {
  me: null,
  meError: null,
  mailboxes: [],
  mailboxMap: new Map(),
  cache: new Map(),
  summary: {
    isRunning: false,
    processed: 0,
    total: 0,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastError: null,
  },
};

// ─── Persistent data stores ───────────────────────────────────────────────────
const persistedData = {
  labels: {},   // email → label string
  notes: {},    // email → note string
  visitors: {}, // ip → visitor object
};

// Admin sessions (in-memory, lost on restart — by design)
const adminSessions = new Set();

let nextRequestAt = 0;
let pendingSummaryScan = false;
let summaryTimer = null;
let totalApiCalls = 0;

// ─── Cookie parsing middleware ────────────────────────────────────────────────
app.use((req, _res, next) => {
  req.cookies = {};
  const header = req.headers.cookie || "";
  header.split(";").forEach((part) => {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) return;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    try { req.cookies[key] = decodeURIComponent(val); } catch { req.cookies[key] = val; }
  });
  next();
});

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ─── Visitor tracking middleware ──────────────────────────────────────────────
function getClientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.connection?.remoteAddress ||
    req.ip ||
    "unknown"
  );
}

app.use((req, _res, next) => {
  totalApiCalls++;

  // Only track real user interactions, not admin API calls
  if (req.path.startsWith("/admin/api")) { next(); return; }

  const ip = getClientIp(req);
  const ua = req.headers["user-agent"] || "";
  const now = new Date().toISOString();

  if (!persistedData.visitors[ip]) {
    persistedData.visitors[ip] = {
      ip,
      userAgent: ua,
      firstSeen: now,
      lastSeen: now,
      sessions: 0,
      apiCalls: 0,
      mailboxesAccessed: {},
      recentActivity: [],
    };
  }

  const visitor = persistedData.visitors[ip];
  visitor.lastSeen = now;
  visitor.userAgent = ua;

  if (req.path === "/" || req.path === "/index.html") {
    visitor.sessions++;
  }

  if (req.path.startsWith("/api/")) {
    visitor.apiCalls++;

    const mailbox = req.query.mailbox;
    if (mailbox) {
      if (!visitor.mailboxesAccessed[mailbox]) {
        visitor.mailboxesAccessed[mailbox] = {
          accessCount: 0,
          firstAccessed: now,
          lastAccessed: now,
          messagesSeen: 0,
          subjects: [],
        };
      }
      const mb = visitor.mailboxesAccessed[mailbox];
      mb.accessCount++;
      mb.lastAccessed = now;

      // Log activity
      const activity = { time: now, path: req.path, mailbox };
      visitor.recentActivity.unshift(activity);
      if (visitor.recentActivity.length > MAX_ACTIVITY_LOG) {
        visitor.recentActivity.length = MAX_ACTIVITY_LOG;
      }
    }
  }

  next();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleRequestSlot() {
  const now = Date.now();
  const waitMs = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(nextRequestAt, now) + REQUEST_SPACING_MS;
  return waitMs ? wait(waitMs) : Promise.resolve();
}

function ensureConfigured() {
  if (!process.env.NOTLETTERS_API_TOKEN) {
    const error = new Error("Missing NOTLETTERS_API_TOKEN in .env");
    error.statusCode = 500;
    throw error;
  }
}

function getMailbox(email) {
  return state.mailboxMap.get(email) || null;
}

function maskPassword(password) {
  if (!password) return "";
  if (password.length <= 4) return "*".repeat(password.length);
  return `${password.slice(0, 2)}${"*".repeat(Math.max(2, password.length - 4))}${password.slice(-2)}`;
}

function stripHtml(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function previewText(letter) {
  const source = letter?.letter?.text?.trim() || stripHtml(letter?.letter?.html || "");
  if (!source) return "No preview available yet.";
  return source.length > 140 ? `${source.slice(0, 137)}...` : source;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value);
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const numeric = Number(value);
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  return new Date(value);
}

function normalizeLetter(letter) {
  const date = normalizeDate(letter?.date);
  return {
    id: String(letter?.id || ""),
    sender: letter?.sender || "Unknown sender",
    senderName: letter?.sender_name || "",
    subject: letter?.subject || "(no subject)",
    starred: Boolean(letter?.star),
    receivedAt: date ? date.toISOString() : null,
    preview: previewText(letter),
    text: letter?.letter?.text || "",
    html: letter?.letter?.html || "",
  };
}

function getCache(email) {
  return (
    state.cache.get(email) || {
      messages: [],
      status: "pending",
      lastSyncedAt: null,
      latestReceivedAt: null,
      latestSubject: null,
      latestPreview: null,
      newMessageCount: 0,
      error: null,
    }
  );
}

function serializeMailbox(account) {
  const cache = getCache(account.email);
  return {
    index: account.index,
    email: account.email,
    password: account.password,
    maskedPassword: maskPassword(account.password),
    domain: account.email.split("@")[1] || "",
    totalMessages: cache.messages.length,
    latestSubject: cache.latestSubject,
    latestPreview: cache.latestPreview,
    latestReceivedAt: cache.latestReceivedAt,
    newMessageCount: cache.newMessageCount,
    status: cache.status,
    error: cache.error,
    lastSyncedAt: cache.lastSyncedAt,
    label: persistedData.labels[account.email] || "",
    note: persistedData.notes[account.email] || "",
  };
}

function buildHeaders(contentType) {
  const headers = {
    ...defaultHeaders,
    Authorization: `Bearer ${process.env.NOTLETTERS_API_TOKEN}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

async function callNotLetters(endpoint, { method = "GET", body } = {}) {
  ensureConfigured();
  await scheduleRequestSlot();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers: buildHeaders(body ? "application/json" : undefined),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
    }

    if (!response.ok) {
      const apiMessage =
        parsed?.error?.message || parsed?.error || parsed?.message || `Request failed with status ${response.status}`;
      const error = new Error(apiMessage);
      error.statusCode = response.status;
      error.details = parsed;
      throw error;
    }

    return parsed?.data ?? parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function readMailboxesFile() {
  const raw = await fsp.readFile(MAILBOX_FILE, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        throw new Error(`Invalid mailbox line ${index + 1}. Expected email:password format.`);
      }
      return {
        index,
        email: line.slice(0, separatorIndex).trim(),
        password: line.slice(separatorIndex + 1).trim(),
      };
    });
}

async function loadMailboxes() {
  const mailboxes = await readMailboxesFile();
  const mailboxMap = new Map(mailboxes.map((mailbox) => [mailbox.email, mailbox]));
  const nextCache = new Map();

  for (const mailbox of mailboxes) {
    if (state.cache.has(mailbox.email)) {
      nextCache.set(mailbox.email, state.cache.get(mailbox.email));
    }
  }

  state.mailboxes = mailboxes;
  state.mailboxMap = mailboxMap;
  state.cache = nextCache;
}

async function fetchMe() {
  try {
    state.me = await callNotLetters("/me");
    state.meError = null;
  } catch (error) {
    state.meError = error.message;
  }
}

async function fetchMailboxMessages(account) {
  const previous = getCache(account.email);

  try {
    const data = await callNotLetters("/letters", {
      method: "POST",
      body: { email: account.email, password: account.password },
    });

    const messages = Array.isArray(data?.letters) ? data.letters.map(normalizeLetter) : [];
    messages.sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());

    const previousIds = new Set(previous.messages.map((message) => message.id));
    const newMessageCount = messages.filter((message) => !previousIds.has(message.id)).length;
    const latest = messages[0] || null;

    state.cache.set(account.email, {
      messages,
      status: "ready",
      lastSyncedAt: new Date().toISOString(),
      latestReceivedAt: latest?.receivedAt || null,
      latestSubject: latest?.subject || null,
      latestPreview: latest?.preview || null,
      newMessageCount,
      error: null,
    });

    return messages;
  } catch (error) {
    state.cache.set(account.email, {
      ...previous,
      status: "error",
      lastSyncedAt: new Date().toISOString(),
      error: error.message,
    });
    throw error;
  }
}

async function runSummaryScan() {
  if (state.summary.isRunning) {
    pendingSummaryScan = true;
    return;
  }

  state.summary = {
    ...state.summary,
    isRunning: true,
    processed: 0,
    total: state.mailboxes.length,
    lastStartedAt: new Date().toISOString(),
    lastError: null,
  };

  try {
    for (let index = 0; index < state.mailboxes.length; index += 1) {
      const account = state.mailboxes[index];
      try {
        await fetchMailboxMessages(account);
      } catch {
        // Per-mailbox errors are persisted in cache and surfaced in the UI.
      }
      state.summary.processed = index + 1;
    }
    state.summary.lastCompletedAt = new Date().toISOString();
  } catch (error) {
    state.summary.lastError = error.message;
  } finally {
    state.summary.isRunning = false;
  }

  if (pendingSummaryScan) {
    pendingSummaryScan = false;
    setTimeout(() => { runSummaryScan().catch(() => {}); }, 250);
  }
}

function queueSummaryScan() {
  runSummaryScan().catch((error) => {
    state.summary.isRunning = false;
    state.summary.lastError = error.message;
  });
}

function sendSseEvent(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ─── Data persistence ─────────────────────────────────────────────────────────

async function loadData() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    try {
      persistedData.labels = JSON.parse(await fsp.readFile(LABELS_FILE, "utf8"));
    } catch { persistedData.labels = {}; }
    try {
      persistedData.notes = JSON.parse(await fsp.readFile(NOTES_FILE, "utf8"));
    } catch { persistedData.notes = {}; }
    try {
      persistedData.visitors = JSON.parse(await fsp.readFile(VISITORS_FILE, "utf8"));
    } catch { persistedData.visitors = {}; }
  } catch (error) {
    console.error("Failed to load data:", error.message);
  }
}

async function saveData() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await Promise.all([
      fsp.writeFile(LABELS_FILE, JSON.stringify(persistedData.labels, null, 2)),
      fsp.writeFile(NOTES_FILE, JSON.stringify(persistedData.notes, null, 2)),
      fsp.writeFile(VISITORS_FILE, JSON.stringify(persistedData.visitors, null, 2)),
    ]);
  } catch (error) {
    console.error("Failed to save data:", error.message);
  }
}

// ─── Admin auth helpers ───────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_session;
  if (!token || !adminSessions.has(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ─── Main API Routes ──────────────────────────────────────────────────────────

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    configured: Boolean(process.env.NOTLETTERS_API_TOKEN),
    mailboxCount: state.mailboxes.length,
    summary: state.summary,
    me: state.me,
    meError: state.meError,
  });
});

app.get("/api/me", async (_request, response) => {
  if (!state.me && !state.meError) await fetchMe();
  response.json({ me: state.me, error: state.meError });
});

app.get("/api/accounts", (_request, response) => {
  const accounts = state.mailboxes.map(serializeMailbox);
  response.json({ accounts, summary: state.summary });
});

function recordVisitorMailboxAccess(req, mailboxEmail) {
  const ip = getClientIp(req);
  const visitor = persistedData.visitors[ip];
  if (!visitor) return;
  const now = new Date().toISOString();
  if (!visitor.mailboxesAccessed[mailboxEmail]) {
    visitor.mailboxesAccessed[mailboxEmail] = {
      accessCount: 0,
      firstAccessed: now,
      lastAccessed: now,
      messagesSeen: 0,
      subjects: [],
    };
  }
  const mb = visitor.mailboxesAccessed[mailboxEmail];
  mb.accessCount++;
  mb.lastAccessed = now;
  const activity = { time: now, path: "/api/bootstrap", mailbox: mailboxEmail };
  visitor.recentActivity.unshift(activity);
  if (visitor.recentActivity.length > MAX_ACTIVITY_LOG) {
    visitor.recentActivity.length = MAX_ACTIVITY_LOG;
  }
}

/** One round-trip for cold starts: account list + initial mailbox messages (matches client random-pick UX). */
app.get("/api/bootstrap", async (request, response) => {
  const refresh = request.query.refresh === "1";
  const lastMailbox = String(request.query.lastMailbox || "").trim();

  const accounts = state.mailboxes.map(serializeMailbox);
  const payload = {
    accounts,
    summary: state.summary,
    selectedMailbox: null,
    mailbox: null,
    messages: [],
  };

  if (state.mailboxes.length === 0) {
    response.json(payload);
    return;
  }

  const others = lastMailbox
    ? state.mailboxes.filter((m) => m.email !== lastMailbox)
    : state.mailboxes;
  const pool = others.length > 0 ? others : state.mailboxes;
  const account = pool[Math.floor(Math.random() * pool.length)];
  payload.selectedMailbox = account.email;

  try {
    if (refresh || getCache(account.email).status === "pending") {
      await fetchMailboxMessages(account);
    }

    recordVisitorMailboxAccess(request, account.email);
    const visitor = persistedData.visitors[getClientIp(request)];
    if (visitor?.mailboxesAccessed[account.email]) {
      const cache = getCache(account.email);
      const mb = visitor.mailboxesAccessed[account.email];
      mb.messagesSeen = cache.messages.length;
      if (cache.latestSubject) {
        const subjects = mb.subjects || [];
        if (!subjects.includes(cache.latestSubject)) {
          subjects.unshift(cache.latestSubject);
          if (subjects.length > 10) subjects.length = 10;
        }
        mb.subjects = subjects;
      }
    }

    payload.mailbox = serializeMailbox(account);
    payload.messages = getCache(account.email).messages;
    response.json(payload);
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message,
      ...payload,
      mailbox: serializeMailbox(account),
      messages: getCache(account.email).messages,
    });
  }
});

app.post("/api/scan", (_request, response) => {
  queueSummaryScan();
  response.json({ started: true, summary: state.summary });
});

app.get("/api/messages", async (request, response) => {
  const mailboxEmail = String(request.query.mailbox || "");
  const refresh = request.query.refresh === "1";
  const account = getMailbox(mailboxEmail);

  if (!account) {
    response.status(404).json({ error: "Mailbox not found." });
    return;
  }

  try {
    if (refresh || getCache(account.email).status === "pending") {
      await fetchMailboxMessages(account);
    }

    // Update visitor message tracking
    const ip = getClientIp(request);
    const visitor = persistedData.visitors[ip];
    if (visitor && visitor.mailboxesAccessed[mailboxEmail]) {
      const cache = getCache(account.email);
      const mb = visitor.mailboxesAccessed[mailboxEmail];
      mb.messagesSeen = cache.messages.length;
      if (cache.latestSubject) {
        const subjects = mb.subjects || [];
        if (!subjects.includes(cache.latestSubject)) {
          subjects.unshift(cache.latestSubject);
          if (subjects.length > 10) subjects.length = 10;
        }
        mb.subjects = subjects;
      }
    }

    response.json({
      mailbox: serializeMailbox(account),
      messages: getCache(account.email).messages,
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message,
      mailbox: serializeMailbox(account),
      messages: getCache(account.email).messages,
    });
  }
});

app.get("/api/stream", async (request, response) => {
  const mailboxEmail = String(request.query.mailbox || "");
  const account = getMailbox(mailboxEmail);

  if (!account) {
    response.status(404).json({ error: "Mailbox not found." });
    return;
  }

  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  let closed = false;
  let inFlight = false;
  let lastSnapshot = "";

  const pushSnapshot = async (force = false) => {
    if (closed || inFlight) return;
    inFlight = true;

    try {
      await fetchMailboxMessages(account);
      if (closed) return;

      const payload = {
        mailbox: serializeMailbox(account),
        messages: getCache(account.email).messages,
      };
      const serialized = JSON.stringify(payload);

      if (force || serialized !== lastSnapshot) {
        lastSnapshot = serialized;
        sendSseEvent(response, "messages", payload);
      }

      sendSseEvent(response, "status", {
        live: true,
        at: new Date().toISOString(),
        mailbox: account.email,
      });
    } catch (error) {
      sendSseEvent(response, "error", {
        message: error.message,
        at: new Date().toISOString(),
      });
    } finally {
      inFlight = false;
    }
  };

  sendSseEvent(response, "connected", {
    mailbox: account.email,
    at: new Date().toISOString(),
  });

  await pushSnapshot(true);

  const refreshInterval = setInterval(() => { pushSnapshot(false).catch(() => {}); }, STREAM_REFRESH_MS);
  const heartbeatInterval = setInterval(() => {
    sendSseEvent(response, "heartbeat", { at: new Date().toISOString() });
  }, HEARTBEAT_MS);

  request.on("close", () => {
    closed = true;
    clearInterval(refreshInterval);
    clearInterval(heartbeatInterval);
    response.end();
  });
});

// ─── Labels & Notes API ───────────────────────────────────────────────────────

app.get("/api/labels", (_req, res) => {
  res.json({ labels: persistedData.labels });
});

app.post("/api/labels", (req, res) => {
  const { email, label } = req.body || {};
  if (!email) { res.status(400).json({ error: "email required" }); return; }
  if (label === null || label === undefined || label === "") {
    delete persistedData.labels[email];
  } else {
    persistedData.labels[email] = String(label).slice(0, 80);
  }
  saveData().catch(() => {});
  res.json({ ok: true, labels: persistedData.labels });
});

app.get("/api/notes", (_req, res) => {
  res.json({ notes: persistedData.notes });
});

app.post("/api/notes", (req, res) => {
  const { email, note } = req.body || {};
  if (!email) { res.status(400).json({ error: "email required" }); return; }
  if (note === null || note === undefined || note === "") {
    delete persistedData.notes[email];
  } else {
    persistedData.notes[email] = String(note).slice(0, 500);
  }
  saveData().catch(() => {});
  res.json({ ok: true, notes: persistedData.notes });
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.add(token);
  res.setHeader(
    "Set-Cookie",
    `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`
  );
  res.json({ ok: true });
});

app.post("/admin/logout", (req, res) => {
  const token = req.cookies?.admin_session;
  if (token) adminSessions.delete(token);
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/admin/api/stats", requireAdmin, (_req, res) => {
  const uptimeMs = Date.now() - new Date(serverStartedAt).getTime();
  const mailboxStats = state.mailboxes.map((mb) => {
    const cache = getCache(mb.email);
    return {
      email: mb.email,
      domain: mb.email.split("@")[1] || "",
      totalMessages: cache.messages.length,
      status: cache.status,
      lastSyncedAt: cache.lastSyncedAt,
      latestSubject: cache.latestSubject,
      latestReceivedAt: cache.latestReceivedAt,
      error: cache.error,
      label: persistedData.labels[mb.email] || "",
    };
  });

  const visitorList = Object.values(persistedData.visitors);
  const totalMessages = state.mailboxes.reduce((s, mb) => s + getCache(mb.email).messages.length, 0);
  const errored = mailboxStats.filter((m) => m.status === "error").length;
  const ready = mailboxStats.filter((m) => m.status === "ready").length;

  res.json({
    serverStartedAt,
    uptimeMs,
    totalApiCalls,
    uniqueVisitors: visitorList.length,
    totalSessions: visitorList.reduce((s, v) => s + (v.sessions || 0), 0),
    mailboxCount: state.mailboxes.length,
    totalMessages,
    mailboxesReady: ready,
    mailboxesErrored: errored,
    summary: state.summary,
    me: state.me,
    mailboxes: mailboxStats,
  });
});

app.get("/admin/api/visitors", requireAdmin, (_req, res) => {
  const visitors = Object.values(persistedData.visitors)
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
    .map((v) => ({
      ...v,
      mailboxCount: Object.keys(v.mailboxesAccessed || {}).length,
    }));
  res.json({ visitors });
});

app.get("/admin/api/activity", requireAdmin, (_req, res) => {
  // Aggregate recent activity across all visitors
  const allActivity = [];
  for (const visitor of Object.values(persistedData.visitors)) {
    for (const act of visitor.recentActivity || []) {
      allActivity.push({ ...act, ip: visitor.ip });
    }
  }
  allActivity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  res.json({ activity: allActivity.slice(0, 200) });
});

app.delete("/admin/api/visitors/:ip", requireAdmin, (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  delete persistedData.visitors[ip];
  saveData().catch(() => {});
  res.json({ ok: true });
});

app.post("/admin/api/scan", requireAdmin, (_req, res) => {
  queueSummaryScan();
  res.json({ started: true, summary: state.summary });
});

// ─── Export app + init helpers for serverless ─────────────────────────────────

module.exports = app;
module.exports.init = async function () {
  try { await loadData(); } catch {}
  try { await loadMailboxes(); } catch (e) { console.error("loadMailboxes:", e.message); }
  try { await fetchMe(); } catch {}
};

// ─── Local dev only: file watcher + server startup ────────────────────────────

if (require.main === module) {
  fs.watchFile(MAILBOX_FILE, { interval: 3000 }, async (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs) return;
    try {
      await loadMailboxes();
      queueSummaryScan();
    } catch (error) {
      state.summary.lastError = `Mailbox reload failed: ${error.message}`;
    }
  });

  async function start() {
    await loadData();
    await loadMailboxes();
    await fetchMe();
    queueSummaryScan();

    summaryTimer = setInterval(() => { queueSummaryScan(); }, SUMMARY_SCAN_INTERVAL_MS);
    setInterval(() => { saveData().catch(() => {}); }, DATA_SAVE_INTERVAL_MS);

    app.listen(PORT, () => {
      console.log(`האימיילים של דוד המלך is live at http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
    });
  }

  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });

  process.on("SIGINT", async () => {
    if (summaryTimer) clearInterval(summaryTimer);
    fs.unwatchFile(MAILBOX_FILE);
    await saveData();
    process.exit(0);
  });
}
