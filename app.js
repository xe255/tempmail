/* ===========================
   האימיילים של דוד המלך
   app.js
   =========================== */

// ============================================================
//  100 MAILBOXES DATABASE
// ============================================================
const MAILBOXES = (() => {
    const w1 = [
        'swift','dark','cold','lost','wild','iron','grey','void',
        'null','bare','deep','pale','still','lone','thin','bright',
        'crisp','silent','hollow','raw'
    ];
    const w2 = [
        'fox','wolf','hawk','raven','storm','river','shadow','ghost',
        'flame','tide','stone','rain','dust','wind','mist','ash',
        'pine','lake','peak','vale'
    ];
    const dom = [
        'voidmail.io','nullbox.net','tempshell.com','deadletter.io','phantom.email'
    ];

    const list = [];
    let seed = 0;
    outer:
    for (let i = 0; i < w1.length; i++) {
        for (let j = 0; j < w2.length; j++) {
            const num    = 1000 + ((seed * 137 + 42) % 8999);
            const domain = dom[seed % dom.length];
            list.push(`${w1[i]}.${w2[j]}.${num}@${domain}`);
            seed++;
            if (list.length === 100) break outer;
        }
    }
    return list;
})();

// ============================================================
//  STATE
// ============================================================
let currentEmail = MAILBOXES[0];
let emails       = [];
let selectedId   = null;
let nextId       = 1;
let demoTimers   = [];

// ============================================================
//  THEME
// ============================================================
function toggleTheme() {
    const dark = document.body.classList.toggle('dark');
    localStorage.setItem('vm-theme', dark ? 'dark' : 'light');
}

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('vm-theme') === 'dark') {
        document.body.classList.add('dark');
    }

    // Pick a random mailbox on every load
    currentEmail = MAILBOXES[Math.floor(Math.random() * MAILBOXES.length)];

    setDisplayEmail(currentEmail);
    renderPickerList('');
    renderInboxList();
    scheduleDemoEmails();
});

// ============================================================
//  DISPLAY & COPY
// ============================================================
function setDisplayEmail(addr) {
    currentEmail = addr;
    localStorage.setItem('vm-mailbox', addr);

    const el = document.getElementById('emailDisplay');
    el.style.opacity = '0';
    el.textContent   = addr;
    requestAnimationFrame(() => {
        el.style.transition = 'opacity 0.3s ease';
        el.style.opacity    = '1';
    });
}

function copyEmail() {
    if (!currentEmail) return;

    const btn   = document.getElementById('copyBtn');
    const label = document.getElementById('copyLabel');
    const addrEl = document.getElementById('emailDisplay');

    const succeed = () => {
        btn.classList.add('copied');
        label.textContent = 'COPIED!';
        addrEl.classList.add('flash');
        setTimeout(() => {
            btn.classList.remove('copied');
            label.textContent = 'COPY';
            addrEl.classList.remove('flash');
        }, 2000);
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(currentEmail).then(succeed).catch(() => { fallbackCopy(); succeed(); });
    } else {
        fallbackCopy();
        succeed();
    }
}

function fallbackCopy() {
    const ta = document.createElement('textarea');
    ta.value = currentEmail;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
}

// ============================================================
//  MAILBOX PICKER
// ============================================================
function togglePicker() {
    const body    = document.getElementById('pickerBody');
    const toggle  = document.getElementById('pickerToggle');
    const open    = body.classList.toggle('picker-body--open');
    toggle.classList.toggle('picker-toggle--open', open);
    if (open) {
        document.getElementById('pickerSearch').focus();
    } else {
        // Reset search when closing
        const search = document.getElementById('pickerSearch');
        search.value = '';
        renderPickerList('');
    }
}

function selectMailbox(addr) {
    if (addr === currentEmail) return;

    // Switch mailbox — clear inbox
    emails     = [];
    selectedId = null;
    demoTimers.forEach(clearTimeout);
    demoTimers = [];
    nextId     = 1;

    setDisplayEmail(addr);

    // Close picker
    const body   = document.getElementById('pickerBody');
    const toggle = document.getElementById('pickerToggle');
    const search = document.getElementById('pickerSearch');
    body.classList.remove('picker-body--open');
    toggle.classList.remove('picker-toggle--open');
    search.value = '';

    renderPickerList('');
    renderInboxList();
    renderViewer();
    scheduleDemoEmails();
}

function filterMailboxes(query) {
    renderPickerList(query);
}

function renderPickerList(query) {
    const list    = document.getElementById('pickerList');
    const countEl = document.getElementById('pickerCount');
    const q       = (query || '').toLowerCase().trim();

    const filtered = q ? MAILBOXES.filter(m => m.includes(q)) : MAILBOXES;

    countEl.textContent = filtered.length;

    list.innerHTML = '';
    filtered.forEach(addr => {
        const item = document.createElement('div');
        item.className = 'picker-item' + (addr === currentEmail ? ' picker-item--active' : '');
        item.title = addr;

        // Highlight matching part
        if (q) {
            const idx = addr.toLowerCase().indexOf(q);
            item.innerHTML =
                escHtml(addr.slice(0, idx)) +
                `<mark>${escHtml(addr.slice(idx, idx + q.length))}</mark>` +
                escHtml(addr.slice(idx + q.length));
        } else {
            item.textContent = addr;
        }

        item.addEventListener('click', () => selectMailbox(addr));
        list.appendChild(item);
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="picker-empty">No matches</div>';
    }
}

// ============================================================
//  RANDOM MAILBOX
// ============================================================
function randomMailbox() {
    let idx;
    do {
        idx = Math.floor(Math.random() * MAILBOXES.length);
    } while (MAILBOXES[idx] === currentEmail && MAILBOXES.length > 1);
    selectMailbox(MAILBOXES[idx]);
}

// ============================================================
//  DEMO EMAILS
// ============================================================
const demoEmailData = [
    {
        fromName: 'GitHub',
        from:     'noreply@github.com',
        subject:  'Please verify your email address',
        body: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;padding:24px;">
                <div style="margin-bottom:20px;">
                    <svg height="28" viewBox="0 0 16 16" width="28" fill="#24292f">
                        <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38
                        0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95
                        0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27
                        -.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12
                        -.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07
                        -.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13
                        .16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
                    </svg>
                </div>
                <h2 style="color:#24292f;font-size:17px;margin:0 0 14px;">Verify your GitHub email address</h2>
                <p style="color:#57606a;font-size:13px;margin:0 0 20px;line-height:1.6;">Click the button below to verify the email address associated with your GitHub account.</p>
                <a href="#" onclick="return false" style="display:inline-block;background:#1f883d;color:#fff;padding:11px 22px;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:20px;">Verify email address</a>
                <p style="color:#8b949e;font-size:11px;margin:0;line-height:1.6;">This link expires in 24 hours.</p>
            </div>`
    },
    {
        fromName: 'Notion',
        from:     'notion-noreply@notion.so',
        subject:  'Your verification code: 847291',
        body: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;padding:24px;background:#fff;">
                <h2 style="color:#191919;font-size:18px;margin:0 0 8px;font-weight:700;">Your Notion login code</h2>
                <p style="color:#888;font-size:13px;margin:0 0 24px;">Use this temporary code to sign in. It expires in 15 minutes.</p>
                <div style="background:#f7f7f5;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px;">
                    <span style="font-size:38px;font-weight:700;letter-spacing:10px;color:#191919;font-family:monospace;">847291</span>
                </div>
                <p style="color:#aaa;font-size:11px;margin:0;">If you did not request this code, you can safely ignore this email.</p>
            </div>`
    },
    {
        fromName: 'Spotify',
        from:     'no-reply@spotify.com',
        subject:  'Welcome — confirm your email address',
        body: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;">
                <div style="background:#1db954;padding:22px;text-align:center;border-radius:8px 8px 0 0;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                </div>
                <div style="padding:24px;background:#fff;border-radius:0 0 8px 8px;">
                    <h2 style="color:#191919;font-size:17px;margin:0 0 14px;">Welcome to Spotify!</h2>
                    <p style="color:#666;font-size:13px;margin:0 0 20px;line-height:1.6;">Confirm your email to start enjoying your music.</p>
                    <div style="text-align:center;margin-bottom:20px;">
                        <a href="#" onclick="return false" style="display:inline-block;background:#1db954;color:#fff;padding:13px 34px;text-decoration:none;border-radius:50px;font-weight:700;font-size:13px;">CONFIRM EMAIL</a>
                    </div>
                </div>
            </div>`
    }
];

function scheduleDemoEmails() {
    [4500, 11000, 19000].forEach((delay, i) => {
        const t = setTimeout(() => {
            if (i >= demoEmailData.length) return;
            const d = demoEmailData[i];
            emails.unshift({ id: nextId++, fromName: d.fromName, from: d.from, subject: d.subject, body: d.body, time: new Date(), read: false });
            renderInboxList();
            notifyNewMail();
        }, delay);
        demoTimers.push(t);
    });
}

function notifyNewMail() {
    const orig = document.title;
    document.title = '(★) New message';
    setTimeout(() => { document.title = orig; }, 5000);

    const badge = document.getElementById('messageCount');
    badge.style.background  = 'rgba(192,120,8,0.35)';
    badge.style.borderColor = 'rgba(192,120,8,0.7)';
    setTimeout(() => { badge.style.background = ''; badge.style.borderColor = ''; }, 1200);
}

// ============================================================
//  INBOX RENDERING
// ============================================================
function renderInboxList() {
    const list  = document.getElementById('inboxList');
    const badge = document.getElementById('messageCount');
    badge.textContent = emails.length;
    list.innerHTML = '';

    if (emails.length === 0) {
        const div = document.createElement('div');
        div.className = 'inbox-empty';
        div.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
            </svg>
            <p>Waiting for messages</p>`;
        list.appendChild(div);
        return;
    }

    emails.forEach(email => {
        const item = document.createElement('div');
        item.className = ['inbox-item', email.id === selectedId ? 'active' : '', !email.read ? 'unread' : ''].filter(Boolean).join(' ');
        item.innerHTML = `
            <div class="inbox-from">${escHtml(email.fromName)}</div>
            <div class="inbox-subject">${escHtml(email.subject)}</div>
            <div class="inbox-time">${formatTime(email.time)}</div>`;
        item.addEventListener('click', () => openEmail(email.id));
        list.appendChild(item);
    });
}

// ============================================================
//  EMAIL VIEWER
// ============================================================
function openEmail(id) {
    selectedId = id;
    const email = emails.find(e => e.id === id);
    if (email) email.read = true;
    renderInboxList();
    renderViewer();
}

function renderViewer() {
    const empty   = document.getElementById('viewerEmpty');
    const content = document.getElementById('emailContent');

    if (!selectedId) {
        empty.style.display = 'flex'; content.style.display = 'none'; content.innerHTML = ''; return;
    }
    const email = emails.find(e => e.id === selectedId);
    if (!email) {
        selectedId = null; empty.style.display = 'flex'; content.style.display = 'none'; content.innerHTML = ''; return;
    }

    empty.style.display = 'none';
    content.style.display = 'flex';

    content.innerHTML = `
        <div class="email-meta">
            <div class="email-meta-row"><span class="meta-label">FROM</span><span class="meta-value">${escHtml(email.fromName)} &lt;${escHtml(email.from)}&gt;</span></div>
            <div class="email-meta-row"><span class="meta-label">TO</span><span class="meta-value">${escHtml(currentEmail)}</span></div>
            <div class="email-meta-row"><span class="meta-label">DATE</span><span class="meta-value">${email.time.toLocaleString()}</span></div>
        </div>
        <div class="email-subject-display">${escHtml(email.subject)}</div>
        <div class="email-body">
            <iframe class="email-body-iframe" sandbox="allow-same-origin" scrolling="no" id="emailFrame-${email.id}" title="Email body"></iframe>
        </div>
        <div class="email-toolbar">
            <button class="btn btn-danger" onclick="deleteEmail(${email.id})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                DELETE
            </button>
        </div>`;

    const frame = document.getElementById(`emailFrame-${email.id}`);
    if (frame) {
        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:16px;font-family:-apple-system,sans-serif;font-size:13px;line-height:1.6;color:#333;background:#fff;}img{max-width:100%;}a{color:#1a73e8;}</style></head><body>${email.body}</body></html>`);
        doc.close();
        const resize = () => { try { frame.style.height = frame.contentDocument.body.scrollHeight + 24 + 'px'; } catch(_){} };
        frame.onload = resize;
        setTimeout(resize, 150);
    }

    content.style.animation = 'none';
    void content.offsetWidth;
    content.style.animation = 'fade-in 0.2s ease';
}

function deleteEmail(id) {
    emails = emails.filter(e => e.id !== id);
    selectedId = null;
    renderInboxList();
    renderViewer();
}

// ============================================================
//  UTILITIES
// ============================================================
function formatTime(date) {
    if (!date) return '';
    const diff = (Date.now() - date) / 1000;
    if (diff < 10)   return 'just now';
    if (diff < 60)   return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

setInterval(() => { if (emails.length > 0) renderInboxList(); }, 30000);
