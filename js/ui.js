// ═══════════════════════════════════════════════════════
// ui.js — UI helpers, rendering, DOM utilities
// ═══════════════════════════════════════════════════════

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function toast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

function toggleUserMenu() {
  document.getElementById('user-menu').classList.toggle('open');
}

document.addEventListener('click', e => {
  const menu = document.getElementById('user-menu');
  const pill = document.getElementById('user-pill-btn');
  if (!menu.contains(e.target) && !pill.contains(e.target)) {
    menu.classList.remove('open');
  }

  // Close any open message context menu on outside click
  if (!e.target.closest('.msg-ctx-menu') && !e.target.closest('.msg-more-btn')) {
    document.querySelectorAll('.msg-ctx-menu.open').forEach(m => m.classList.remove('open'));
  }
});

function copyUsername() {
  navigator.clipboard.writeText(state.me?.username || '').then(() => toast('Username copied!'));
  document.getElementById('user-menu').classList.remove('open');
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function onMsgKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function setWsState(s) {
  state.wsState = s;
  const dot = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');
  dot.className = 'ws-dot ' + s;
  label.textContent = s === 'connected' ? 'Live' : s === 'connecting' ? 'Connecting' : 'Offline';
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
      </svg>`;
}

function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0) === (tab === 'login'));
  });
  document.getElementById('login-form').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? '' : 'none';
  clearAuthError();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function clearAuthError() {
  document.getElementById('auth-error').style.display = 'none';
}

function showKeygen(msg) {
  const el = document.getElementById('keygen-status');
  document.getElementById('keygen-text').textContent = msg;
  el.style.display = 'flex';
}

function hideKeygen() {
  document.getElementById('keygen-status').style.display = 'none';
}

// ─────────────────────────────────────────────────────
// Message context menu toggle
// ─────────────────────────────────────────────────────
function toggleMsgMenu(msgId) {
  const menu = document.getElementById(`ctx-${msgId}`);
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  document.querySelectorAll('.msg-ctx-menu.open').forEach(m => m.classList.remove('open'));
  if (!wasOpen) menu.classList.add('open');
}

// ─────────────────────────────────────────────────────
// renderConvList
// ─────────────────────────────────────────────────────
function renderConvList() {
  const el = document.getElementById('conv-list');
  if (!state.conversations.length) {
    el.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
      <span>No conversations yet.<br>Search for someone to message.</span>
    </div>`;
    return;
  }

  el.innerHTML = state.conversations.map(c => {
    const initials = (c.display_name || c.username).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const online = state.onlineUsers.has(c.user_id);
    const time = c.last_message_at ? formatTime(c.last_message_at) : '';
    const unread = state.unread[c.user_id] || 0;
    const active = state.activeConv?.user_id === c.user_id ? 'active' : '';
    const convJson = JSON.stringify(c).replace(/"/g, '&quot;');
    return `<div class="conv-item ${active}" onclick="openConversation(${convJson})">
      <div class="conv-avatar">${initials}${online ? '<div class="online-dot"></div>' : ''}</div>
      <div class="conv-info">
        <div class="conv-name">${esc(c.display_name || c.username)}</div>
        <div class="conv-preview">@${esc(c.username)}</div>
      </div>
      <div>
        <div class="conv-time">${time}</div>
        ${unread ? `<div class="new-msg-badge">${unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────
// renderMessages — with file support, edit/delete CRUD
// ─────────────────────────────────────────────────────
function renderMessages(userId) {
  const area = document.getElementById('messages-area');
  const msgs = state.messages[userId] || [];

  if (!msgs.length) {
    area.innerHTML = `<div class="empty-state" style="padding:40px 0;">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:32px;height:32px;opacity:0.3;">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
      </svg>
      <span>No messages yet.<br>Start the conversation!</span>
    </div>`;
    return;
  }

  let html = '';
  let lastDate = '';

  msgs.forEach(m => {
    const d = new Date(m.created_at);
    const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    if (dateStr !== lastDate) {
      html += `<div class="date-divider">${dateStr}</div>`;
      lastDate = dateStr;
    }

    const side = m.isMine ? 'mine' : 'theirs';
    const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const partner = state.activeConv;
    const initials = (partner?.display_name || partner?.username || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    // Parse file messages
    let bubbleContent;
    if (m.text) {
      let parsed = null;
      try { parsed = JSON.parse(m.text); } catch {}

      if (parsed && parsed.type === 'file' && parsed.data) {
        const isImage = parsed.mime && parsed.mime.startsWith('image/');
        if (isImage) {
          bubbleContent = `<div class="msg-bubble msg-bubble--file">
            <img class="msg-image" src="${parsed.data}" alt="${esc(parsed.name)}" onclick="openImageLightbox('${parsed.data}', '${esc(parsed.name)}')" />
            <div class="msg-filename">${esc(parsed.name)}</div>
          </div>`;
        } else {
          bubbleContent = `<div class="msg-bubble msg-bubble--file">
            <a class="msg-file-link" href="${parsed.data}" download="${esc(parsed.name)}">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
              <span>${esc(parsed.name)}</span>
              <svg class="download-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            </a>
          </div>`;
        }
      } else {
        const editedTag = m.edited ? ' <span class="msg-edited">(edited)</span>' : '';
        bubbleContent = `<div class="msg-bubble">${esc(m.text)}${editedTag}</div>`;
      }
    } else {
      bubbleContent = `<div class="msg-bubble"><span class="msg-decrypt-fail">🔒 Could not decrypt</span></div>`;
    }

    // CRUD context menu — only for own messages
    const ctxMenu = m.isMine && m.text && !m.text.includes('"type":"file"') ? `
      <button class="msg-more-btn" onclick="toggleMsgMenu('${m.id}')" aria-label="Message options">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
      <div class="msg-ctx-menu" id="ctx-${m.id}">
        <div class="msg-ctx-item" onclick="startEditMessage('${m.id}', ${JSON.stringify(m.text || '').replace(/'/g, "&#39;")}, '${userId}'); toggleMsgMenu('${m.id}')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          Edit
        </div>
        <div class="msg-ctx-item danger" onclick="deleteMessage('${m.id}', '${userId}'); toggleMsgMenu('${m.id}')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          Delete
        </div>
      </div>` : '';

    html += `<div class="msg-group ${side}" data-msg-id="${m.id}">`;
    if (!m.isMine) {
      html += `<div class="msg-row"><div class="msg-avatar-xs">${initials}</div>${bubbleContent}</div>`;
    } else {
      html += `<div class="msg-row">${bubbleContent}<div class="msg-actions">${ctxMenu}</div></div>`;
    }
    html += `<div class="msg-time">${timeStr}</div></div>`;
  });

  area.innerHTML = html;
  area.scrollTop = area.scrollHeight;
}

// ─────────────────────────────────────────────────────
// Image lightbox
// ─────────────────────────────────────────────────────
function openImageLightbox(src, name) {
  let lb = document.getElementById('img-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'img-lightbox';
    lb.className = 'img-lightbox';
    lb.innerHTML = `<div class="img-lightbox-backdrop" onclick="closeImageLightbox()"></div>
      <div class="img-lightbox-inner">
        <img id="lb-img" src="" alt="" />
        <div class="lb-footer">
          <span id="lb-name"></span>
          <a id="lb-dl" download="" class="lb-btn">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            Download
          </a>
          <button class="lb-btn lb-close" onclick="closeImageLightbox()">✕ Close</button>
        </div>
      </div>`;
    document.body.appendChild(lb);
  }
  document.getElementById('lb-img').src = src;
  document.getElementById('lb-img').alt = name;
  document.getElementById('lb-name').textContent = name;
  const dl = document.getElementById('lb-dl');
  dl.href = src;
  dl.download = name;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeImageLightbox() {
  const lb = document.getElementById('img-lightbox');
  if (lb) lb.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeImageLightbox();
});

function updateOnlineStatus(userId, online) {
  if (state.activeConv?.user_id === userId) {
    document.getElementById('chat-status-dot').className = 'status-dot' + (online ? ' online' : '');
    document.getElementById('chat-status-text').textContent = online ? 'Online' : 'Offline';
  }
  renderConvList();
}

function showSearchResults(show) {
  document.getElementById('conv-section-label').textContent = show ? 'Search results' : 'Messages';
  document.getElementById('conv-list').style.display = show ? 'none' : '';
  document.getElementById('search-results-list').style.display = show ? 'block' : 'none';
}
