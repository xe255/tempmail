/* ===========================
   האימיילים של דוד המלך — app.js
   Real backend + new design
   =========================== */

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  accounts: [],
  summary: null,
  selectedMailbox: null,  // email string
  messages: [],
  selectedMessageId: null,
  messageSearch: "",
  liveStatus: "idle",
  soundEnabled: localStorage.getItem("dm-sound") !== "off",
  labels: {},   // email → label string
  notes: {},    // email → note string
  labelEditing: false,
  notesSaveTimer: null,
  notesOpen: localStorage.getItem("dm-notes-open") === "1",
  pickerOpen: false,
};

// ─── Element refs ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const el = {
  livePill:       $("livePill"),
  liveText:       $("liveText"),
  emailDisplay:   $("emailDisplay"),
  mailboxCounter: $("mailboxCounter"),
  labelChip:      $("labelChip"),
  labelInput:     $("labelInput"),
  copyEmailBtn:   $("copyEmailBtn"),
  copyEmailLabel: $("copyEmailLabel"),
  refreshBtn:     $("refreshBtn"),
  syncAllBtn:     $("syncAllBtn"),
  notesSection:   $("notesSection"),
  notesToggle:    $("notesToggle"),
  notesBody:      $("notesBody"),
  notesTextarea:  $("notesTextarea"),
  pickerToggle:   $("pickerToggle"),
  pickerBody:     $("pickerBody"),
  pickerSearch:   $("pickerSearch"),
  pickerCount:    $("pickerCount"),
  pickerList:     $("pickerList"),
  codeBanner:     $("codeBanner"),
  codeDigits:     $("codeDigits"),
  copyCodeBtn:    $("copyCodeBtn"),
  inboxSearch:    $("inboxSearch"),
  inboxList:      $("inboxList"),
  messageCount:   $("messageCount"),
  emailViewer:    $("emailViewer"),
  viewerEmpty:    $("viewerEmpty"),
  emailContent:   $("emailContent"),
  soundToggle:    $("soundToggle"),
  soundOnIcon:    $("soundOnIcon"),
  soundOffIcon:   $("soundOffIcon"),
  themeToggle:    $("themeToggle"),
  toastStack:     $("toastStack"),
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d) / 1000;
  if (diff < 10)   return "just now";
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  el.toastStack.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(-100%)";
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function sortedAccounts() {
  return [...state.accounts].sort((a, b) => {
    const at = a.latestReceivedAt ? new Date(a.latestReceivedAt).getTime() : 0;
    const bt = b.latestReceivedAt ? new Date(b.latestReceivedAt).getTime() : 0;
    return bt - at || a.index - b.index;
  });
}

function filteredMessages() {
  const q = state.messageSearch.trim().toLowerCase();
  if (!q) return state.messages;
  return state.messages.filter((m) =>
    [m.subject, m.sender, m.senderName, m.preview, m.text]
      .filter(Boolean).some((v) => v.toLowerCase().includes(q))
  );
}

// ─── Verification Code Detection ──────────────────────────────────────────────

function extractCode(msg) {
  if (!msg) return null;
  const text = [msg.text, msg.preview, stripTags(msg.html || "")].filter(Boolean).join(" ");

  // Only extract when a keyword signals this is a verification code.
  // Without a keyword, any 4-8 digit number (zip codes, order IDs, etc.)
  // would produce false positives.
  const kw = /(?:code|otp|pin|verification|verify|token|one[- ]time|passcode)[^\d]{0,30}(\d{4,8})\b/gi;
  const km = kw.exec(text);
  return km ? km[1] : null;
}

function stripTags(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ").trim();
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme() {
  const dark = localStorage.getItem("dm-theme") === "dark";
  document.body.classList.toggle("dark", dark);
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("dm-theme", isDark ? "dark" : "light");
}

// ─── Sound ────────────────────────────────────────────────────────────────────

function applySoundUI() {
  el.soundOnIcon?.classList.toggle("hidden", !state.soundEnabled);
  el.soundOffIcon?.classList.toggle("hidden", state.soundEnabled);
  el.soundToggle?.classList.toggle("is-active", state.soundEnabled);
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem("dm-sound", state.soundEnabled ? "on" : "off");
  applySoundUI();
  if (state.soundEnabled) playSound();
}

function playSound() {
  if (!state.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0, 0.35], [1108, 0.2, 0.45]].forEach(([freq, start, dur]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    });
  } catch {}
}

// ─── Live Status ──────────────────────────────────────────────────────────────

function setLiveStatus(status) {
  state.liveStatus = status;
  const pill = el.livePill;
  const text = el.liveText;
  if (!pill || !text) return;

  pill.className = "status-pill";
  if (status === "live") {
    text.textContent = "LIVE";
  } else if (status === "connecting") {
    pill.classList.add("connecting");
    text.textContent = "CONNECTING";
  } else if (status === "error") {
    pill.classList.add("error");
    text.textContent = "RECONNECTING";
  } else {
    pill.classList.add("connecting");
    text.textContent = "IDLE";
  }
}

// ─── Address display ──────────────────────────────────────────────────────────

function setDisplayEmail(email) {
  if (!el.emailDisplay) return;
  el.emailDisplay.style.opacity = "0";
  el.emailDisplay.textContent = email || "—";
  requestAnimationFrame(() => {
    el.emailDisplay.style.transition = "opacity 0.3s ease";
    el.emailDisplay.style.opacity = "1";
  });
}

// ─── Labels & Notes (localStorage) ───────────────────────────────────────────

async function loadLabels() {
  try { state.labels = JSON.parse(localStorage.getItem("dm-labels") || "{}"); }
  catch { state.labels = {}; }
}

async function loadNotes() {
  try { state.notes = JSON.parse(localStorage.getItem("dm-notes") || "{}"); }
  catch { state.notes = {}; }
}

async function saveLabel(email, label) {
  if (label) state.labels[email] = label;
  else delete state.labels[email];
  localStorage.setItem("dm-labels", JSON.stringify(state.labels));
}

async function saveNote(email, note) {
  if (note) state.notes[email] = note;
  else delete state.notes[email];
  localStorage.setItem("dm-notes", JSON.stringify(state.notes));
}

function renderLabelChip() {
  const email = state.selectedMailbox;
  if (!email || !el.labelChip) return;
  const label = state.labels[email] || "";
  if (label) {
    el.labelChip.textContent = label;
    el.labelChip.className = "label-chip";
    el.labelChip.title = "Click to edit label";
  } else {
    el.labelChip.textContent = "+ ADD LABEL";
    el.labelChip.className = "label-chip empty";
    el.labelChip.title = "Click to add label";
  }
}

function startLabelEdit() {
  if (!state.selectedMailbox || !el.labelInput) return;
  state.labelEditing = true;
  el.labelInput.value = state.labels[state.selectedMailbox] || "";
  el.labelChip.classList.add("hidden");
  el.labelInput.classList.remove("hidden");
  el.labelInput.focus();
  el.labelInput.select();
}

async function commitLabel() {
  if (!state.labelEditing || !state.selectedMailbox) return;
  state.labelEditing = false;
  const newLabel = el.labelInput.value.trim();
  const email = state.selectedMailbox;
  state.labels[email] = newLabel;
  el.labelInput.classList.add("hidden");
  el.labelChip.classList.remove("hidden");
  renderLabelChip();
  renderPickerList(el.pickerSearch?.value || "");
  await saveLabel(email, newLabel);
}

function cancelLabel() {
  state.labelEditing = false;
  el.labelInput?.classList.add("hidden");
  el.labelChip?.classList.remove("hidden");
  renderLabelChip();
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function toggleNotes() {
  state.notesOpen = !state.notesOpen;
  localStorage.setItem("dm-notes-open", state.notesOpen ? "1" : "0");
  applyNotesState();
}

function applyNotesState() {
  const toggle = el.notesToggle;
  const body = el.notesBody;
  if (!toggle || !body) return;
  toggle.classList.toggle("notes-toggle--open", state.notesOpen);
  body.classList.toggle("notes-body--open", state.notesOpen);
}

function loadNoteIntoTextarea() {
  const email = state.selectedMailbox;
  if (!el.notesTextarea) return;
  el.notesTextarea.dataset.mailbox = email || "";
  el.notesTextarea.value = email ? (state.notes[email] || "") : "";
}

function scheduleNoteSave() {
  const email = state.selectedMailbox;
  if (!email) return;
  clearTimeout(state.notesSaveTimer);
  state.notesSaveTimer = setTimeout(() => {
    const note = el.notesTextarea?.value || "";
    state.notes[email] = note;
    saveNote(email, note);
  }, 800);
}

// ─── Picker ───────────────────────────────────────────────────────────────────

function togglePicker() {
  state.pickerOpen = !state.pickerOpen;
  el.pickerBody?.classList.toggle("picker-body--open", state.pickerOpen);
  el.pickerToggle?.classList.toggle("picker-toggle--open", state.pickerOpen);
  if (state.pickerOpen) {
    el.pickerSearch?.focus();
  } else {
    if (el.pickerSearch) el.pickerSearch.value = "";
    renderPickerList("");
  }
}

function renderPickerList(query) {
  const q = (query || "").toLowerCase().trim();
  const accounts = sortedAccounts();
  const filtered = q
    ? accounts.filter((a) => {
        const label = state.labels[a.email] || "";
        return [a.email, a.domain, label].some((v) => v.toLowerCase().includes(q));
      })
    : accounts;

  if (el.pickerCount) el.pickerCount.textContent = filtered.length;
  if (!el.pickerList) return;

  if (filtered.length === 0) {
    el.pickerList.innerHTML = '<div class="picker-empty">No matches</div>';
    return;
  }

  el.pickerList.innerHTML = filtered.map((account) => {
    const label = state.labels[account.email] || "";
    const isActive = account.email === state.selectedMailbox;
    const emailHtml = q
      ? account.email.replace(new RegExp(`(${escRegex(q)})`, "gi"), "<mark>$1</mark>")
      : esc(account.email);
    return `
      <div class="picker-item${isActive ? " picker-item--active" : ""}"
           data-email="${esc(account.email)}"
           title="${esc(account.email)}">
        <span class="picker-item-email">${emailHtml}</span>
        ${label ? `<span class="picker-item-label">${esc(label)}</span>` : ""}
        <span class="picker-item-meta">${account.totalMessages || 0}</span>
      </div>`;
  }).join("");

  el.pickerList.querySelectorAll(".picker-item").forEach((item) => {
    item.addEventListener("click", () => selectMailbox(item.dataset.email));
  });
}

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Mailbox Selection ────────────────────────────────────────────────────────

async function selectMailbox(email) {
  if (state.selectedMailbox === email) {
    closePicker();
    return;
  }

  state.selectedMailbox = email;
  state.messages = [];
  state.selectedMessageId = null;
  state.messageSearch = "";
  _inboxFingerprint = "";
  _viewerMsgId = null;
  if (el.inboxSearch) el.inboxSearch.value = "";

  // Update display
  setDisplayEmail(email);
  renderLabelChip();
  loadNoteIntoTextarea();
  renderPickerList(el.pickerSearch?.value || "");
  renderInboxList();
  renderViewer();
  hideCodBanner();
  closePicker();

  // Load messages + connect stream
  connectStream();
  await loadMessages({ refresh: true });
}

function closePicker() {
  state.pickerOpen = false;
  el.pickerBody?.classList.remove("picker-body--open");
  el.pickerToggle?.classList.remove("picker-toggle--open");
  if (el.pickerSearch) el.pickerSearch.value = "";
  renderPickerList("");
}

// ─── Inbox Rendering ──────────────────────────────────────────────────────────

let _inboxFingerprint = "";

function renderInboxList({ force = false } = {}) {
  const messages = filteredMessages();
  if (!el.inboxList) return;

  if (el.messageCount) el.messageCount.textContent = messages.length;

  // Skip full DOM rebuild if list content hasn't changed
  const fingerprint = messages.map((m) => `${m.id}:${m.id === state.selectedMessageId}`).join("|");
  if (!force && fingerprint === _inboxFingerprint) return;
  _inboxFingerprint = fingerprint;

  if (messages.length === 0) {
    el.inboxList.innerHTML = `
      <div class="inbox-empty">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        <p>${state.selectedMailbox ? "No messages yet" : "Select a mailbox"}</p>
      </div>`;
    return;
  }

  el.inboxList.innerHTML = messages.map((msg) => {
    const isActive = msg.id === state.selectedMessageId;
    const code = extractCode(msg);
    return `
      <div class="inbox-item${isActive ? " active" : ""}${code ? " has-code" : ""}"
           data-id="${esc(msg.id)}">
        <div class="inbox-from">${esc(msg.senderName || msg.sender)}</div>
        <div class="inbox-subject">${esc(msg.subject)}</div>
        <div class="inbox-time">${esc(fmtDate(msg.receivedAt))}</div>
      </div>`;
  }).join("");

  el.inboxList.querySelectorAll(".inbox-item").forEach((item) => {
    item.addEventListener("click", () => openMessage(item.dataset.id));
  });
}

// ─── Message Viewer ───────────────────────────────────────────────────────────

let _viewerMsgId = null;

function openMessage(id) {
  if (state.selectedMessageId === id) return;
  state.selectedMessageId = id;
  renderInboxList();
  renderViewer();
}

function renderViewer() {
  if (!el.viewerEmpty || !el.emailContent) return;

  const msg = filteredMessages().find((m) => m.id === state.selectedMessageId);

  if (!msg) {
    if (_viewerMsgId !== null) {
      _viewerMsgId = null;
      el.viewerEmpty.style.display = "flex";
      el.emailContent.style.display = "none";
      el.emailContent.innerHTML = "";
      hideCodBanner();
    }
    return;
  }

  // Skip full re-render if the same message is already displayed (preserves text selection)
  if (msg.id === _viewerMsgId) return;
  _viewerMsgId = msg.id;

  el.viewerEmpty.style.display = "none";
  el.emailContent.style.display = "flex";

  // Code detection
  const code = extractCode(msg);
  if (code) {
    showCodeBanner(code);
  } else {
    hideCodBanner();
  }

  const html = msg.html?.trim()
    ? msg.html
    : `<pre style="white-space:pre-wrap;font:13px/1.6 monospace;padding:20px;color:#333;">${esc(msg.text || "No content.")}</pre>`;

  el.emailContent.innerHTML = `
    <div class="email-meta">
      <div class="email-meta-row">
        <span class="meta-label">FROM</span>
        <span class="meta-value">${esc(msg.senderName || msg.sender)}${msg.senderName ? ` &lt;${esc(msg.sender)}&gt;` : ""}</span>
      </div>
      <div class="email-meta-row">
        <span class="meta-label">DATE</span>
        <span class="meta-value">${msg.receivedAt ? new Date(msg.receivedAt).toLocaleString() : "—"}</span>
      </div>
    </div>
    <div class="email-subject-display">${esc(msg.subject)}</div>
    <div class="email-body" id="emailBodyWrap">
      <iframe class="email-body-iframe" id="emailFrame" sandbox="allow-same-origin allow-popups" title="Email body"></iframe>
      <div class="email-text-view" id="emailTextView">${esc(msg.text || "")}</div>
    </div>
    <div class="email-toolbar">
      <div class="view-toggle-wrap">
        <button class="view-tab active" id="tabHtml" onclick="setViewMode('html')">HTML</button>
        <button class="view-tab" id="tabText" onclick="setViewMode('text')">Text</button>
      </div>
    </div>`;

  // Load iframe
  const frame = document.getElementById("emailFrame");
  if (frame) {
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><base target="_blank"><style>body{margin:0;padding:16px;font-family:-apple-system,sans-serif;font-size:13px;line-height:1.6;color:#333;background:#fff;}img{max-width:100%;}a{color:#a86800;}</style></head><body>${html}</body></html>`);
    doc.close();
    const resize = () => {
      try { frame.style.height = (frame.contentDocument.body.scrollHeight + 24) + "px"; } catch {}
    };
    frame.onload = resize;
    setTimeout(resize, 150);
  }

  // Animate
  el.emailContent.style.animation = "none";
  void el.emailContent.offsetWidth;
  el.emailContent.style.animation = "fade-in 0.2s ease";
}

function setViewMode(mode) {
  const frame = document.getElementById("emailFrame");
  const textView = document.getElementById("emailTextView");
  const tabHtml = document.getElementById("tabHtml");
  const tabText = document.getElementById("tabText");

  const isHtml = mode === "html";
  if (frame) frame.style.display = isHtml ? "block" : "none";
  if (textView) textView.style.display = isHtml ? "none" : "block";
  tabHtml?.classList.toggle("active", isHtml);
  tabText?.classList.toggle("active", !isHtml);
}

// ─── Code Banner ──────────────────────────────────────────────────────────────

function showCodeBanner(code) {
  if (!el.codeBanner || !el.codeDigits) return;
  el.codeDigits.textContent = code;
  el.codeBanner.dataset.code = code;
  el.codeBanner.classList.add("visible");
}

function hideCodBanner() {
  if (!el.codeBanner) return;
  el.codeBanner.classList.remove("visible");
  el.codeBanner.dataset.code = "";
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadAccounts() {
  const data = await apiFetch("/api/accounts");
  const prevTotal = state.accounts.reduce((s, a) => s + (a.newMessageCount || 0), 0);
  const nextTotal = data.accounts.reduce((s, a) => s + (a.newMessageCount || 0), 0);

  state.accounts = data.accounts;
  state.summary = data.summary;

  if (el.mailboxCounter) {
    el.mailboxCounter.textContent = `${data.accounts.length} mailbox${data.accounts.length !== 1 ? "es" : ""}`;
  }

  // Auto-select a random mailbox on every page load, different from the last one
  if (!state.selectedMailbox && data.accounts.length > 0) {
    const lastEmail = localStorage.getItem("dm-last-mailbox");
    const others = data.accounts.filter((a) => a.email !== lastEmail);
    const pool = others.length > 0 ? others : data.accounts;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    state.selectedMailbox = pick.email;
    localStorage.setItem("dm-last-mailbox", pick.email);
    setDisplayEmail(pick.email);
    renderLabelChip();
    loadNoteIntoTextarea();
  }

  if (prevTotal > 0 && nextTotal > prevTotal) {
    showToast("New mail arrived.");
    updateDocTitle();
  }

  renderPickerList(el.pickerSearch?.value || "");
}

async function loadMessages({ refresh = false } = {}) {
  const mailbox = state.selectedMailbox;
  if (!mailbox) return;

  try {
    const data = await apiFetch(
      `/api/messages?mailbox=${encodeURIComponent(mailbox)}${refresh ? "&refresh=1" : ""}`
    );

    if (state.selectedMailbox !== mailbox) return;

    const prevIds = new Set(state.messages.map((m) => m.id));
    state.messages = data.messages;

    if (!state.messages.some((m) => m.id === state.selectedMessageId)) {
      state.selectedMessageId = state.messages[0]?.id || null;
    }

    const newMsgs = state.messages.filter((m) => !prevIds.has(m.id));
    if (prevIds.size > 0 && newMsgs.length > 0) {
      playSound();
      showToast(`${newMsgs.length} new message${newMsgs.length !== 1 ? "s" : ""} arrived.`);
      updateDocTitle();
    }

    if (data.mailbox) {
      state.accounts = state.accounts.map((a) =>
        a.email === data.mailbox.email ? data.mailbox : a
      );
    }

    renderInboxList();
    renderViewer();
    renderPickerList(el.pickerSearch?.value || "");
  } catch (e) {
    showToast("Failed to load messages.");
  }
}

function updateDocTitle() {
  const orig = "האימיילים של דוד המלך";
  document.title = "(★) New message — האימיילים של דוד המלך";
  setTimeout(() => { document.title = orig; }, 5000);

  const badge = el.messageCount;
  if (badge) {
    badge.style.background = "rgba(192,120,8,0.35)";
    badge.style.borderColor = "rgba(192,120,8,0.7)";
    setTimeout(() => { badge.style.background = ""; badge.style.borderColor = ""; }, 1200);
  }
}

// ─── Polling (replaces SSE for serverless compatibility) ──────────────────────

function connectStream() {
  if (!state.selectedMailbox) {
    setLiveStatus("idle");
    return;
  }
  setLiveStatus("live");
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function copyEmail() {
  const account = state.accounts.find((a) => a.email === state.selectedMailbox);
  if (!account) { showToast("Select a mailbox first."); return; }
  try {
    await navigator.clipboard.writeText(account.email);
    const label = el.copyEmailLabel;
    const btn = el.copyEmailBtn;
    const addr = el.emailDisplay;
    if (btn) btn.classList.add("copied");
    if (label) label.textContent = "COPIED!";
    if (addr) addr.classList.add("flash");
    setTimeout(() => {
      btn?.classList.remove("copied");
      if (label) label.textContent = "COPY EMAIL";
      addr?.classList.remove("flash");
    }, 2000);
  } catch { showToast("Copy failed."); }
}

function randomMailbox() {
  const others = state.accounts.filter((a) => a.email !== state.selectedMailbox);
  if (others.length === 0) { showToast("No other mailboxes available."); return; }
  const pick = others[Math.floor(Math.random() * others.length)];
  selectMailbox(pick.email);
}

async function syncAll() {
  try {
    await apiFetch("/api/scan", { method: "POST" });
    showToast("Sync started for all mailboxes.");
    await loadAccounts();
  } catch { showToast("Sync failed."); }
}

// ─── Wire Events ──────────────────────────────────────────────────────────────

function wireEvents() {
  el.themeToggle?.addEventListener("click", toggleTheme);
  el.soundToggle?.addEventListener("click", toggleSound);

  el.copyEmailBtn?.addEventListener("click", () => copyEmail().catch(() => {}));
  el.refreshBtn?.addEventListener("click", () => randomMailbox());
  el.syncAllBtn?.addEventListener("click", () => syncAll().catch(() => {}));

  el.emailDisplay?.addEventListener("click", () => copyEmail().catch(() => {}));

  // Label editing
  el.labelChip?.addEventListener("click", startLabelEdit);
  el.labelInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitLabel().catch(() => {});
    if (e.key === "Escape") cancelLabel();
  });
  el.labelInput?.addEventListener("blur", () => {
    setTimeout(() => { if (state.labelEditing) commitLabel().catch(() => {}); }, 150);
  });

  // Notes
  el.notesTextarea?.addEventListener("input", scheduleNoteSave);

  // Picker search
  el.pickerSearch?.addEventListener("input", (e) => {
    renderPickerList(e.target.value);
  });

  // Code copy
  el.copyCodeBtn?.addEventListener("click", () => {
    const code = el.codeBanner?.dataset.code;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      showToast(`Code ${code} copied!`);
      el.copyCodeBtn.textContent = "COPIED!";
      el.copyCodeBtn.classList.add("copied");
      setTimeout(() => {
        el.copyCodeBtn.textContent = "COPY CODE";
        el.copyCodeBtn.classList.remove("copied");
      }, 2000);
    }).catch(() => showToast("Copy failed."));
  });

  // Message search
  el.inboxSearch?.addEventListener("input", (e) => {
    state.messageSearch = e.target.value;
    renderInboxList();
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  applyTheme();
  applySoundUI();
  applyNotesState();
  wireEvents();

  setLiveStatus("connecting");

  try {
    await Promise.all([loadLabels(), loadNotes(), loadAccounts()]);
    renderPickerList("");

    if (state.selectedMailbox) {
      renderLabelChip();
      loadNoteIntoTextarea();
      connectStream();
      await loadMessages({ refresh: true });
    } else {
      setLiveStatus("idle");
    }
  } catch (e) {
    setLiveStatus("error");
    showToast(e.message || "Failed to connect.");
  }

  // Poll active mailbox for new messages every 8s
  setInterval(() => {
    if (state.selectedMailbox) loadMessages({ refresh: true }).catch(() => {});
  }, 8000);

  // Poll accounts every 15s
  setInterval(() => {
    loadAccounts().catch(() => {});
  }, 15000);

  // Refresh time labels in inbox every 30s (force bypasses fingerprint)
  setInterval(() => {
    if (state.messages.length > 0) renderInboxList({ force: true });
  }, 30000);
}

boot();
