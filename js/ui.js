// ═══════════════════════════════════════════════════════
// ui.js — UI helpers, rendering, DOM utilities
// ═══════════════════════════════════════════════════════

/**
 * Escapes HTML special characters to prevent XSS.
 */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats an ISO timestamp as a human-friendly time or date string.
 */
function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Shows a brief toast notification.
 */
function toast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

/**
 * Shows/hides the user context menu.
 */
function toggleUserMenu() {
  document.getElementById('user-menu').classList.toggle('open');
}

// Close user menu when clicking outside
document.addEventListener('click', e => {
  const menu = document.getElementById('user-menu');
  const pill = document.getElementById('user-pill-btn');
  if (!menu.contains(e.target) && !pill.contains(e.target)) {
    menu.classList.remove('open');
  }
});

/**
 * Copies the current user's username to the clipboard.
 */
function copyUsername() {
  navigator.clipboard.writeText(state.me?.username || '').then(() => toast('Username copied!'));
  document.getElementById('user-menu').classList.remove('open');
}

/**
 * Auto-resizes the message textarea as the user types.
 */
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/**
 * Sends a message on Enter (but not Shift+Enter).
 */
function onMsgKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

/**
 * Updates the WebSocket connection status indicator.
 */
function setWsState(s) {
  state.wsState = s;
  const dot = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');
  dot.className = 'ws-dot ' + s;
  label.textContent = s === 'connected' ? 'Live' : s === 'connecting' ? 'Connecting' : 'Offline';
}

/**
 * Toggles a password input between visible and hidden,
 * and swaps the eye icon accordingly.
 */
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

/**
 * Renders the conversation list in the sidebar.
 */
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

/**
 * Renders all decrypted messages for a given conversation.
 */
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

    const bubbleContent = m.text
      ? `<div class="msg-bubble">${esc(m.text)}</div>`
      : `<div class="msg-bubble"><span class="msg-decrypt-fail">🔒 Could not decrypt</span></div>`;

    html += `<div class="msg-group ${side}">`;
    if (!m.isMine) {
      html += `<div class="msg-row"><div class="msg-avatar-xs">${initials}</div>${bubbleContent}</div>`;
    } else {
      html += `<div class="msg-row">${bubbleContent}</div>`;
    }
    html += `<div class="msg-time">${timeStr}</div></div>`;
  });

  area.innerHTML = html;
  area.scrollTop = area.scrollHeight;
}

/**
 * Updates online/offline status in the chat header and conversation list.
 */
function updateOnlineStatus(userId, online) {
  if (state.activeConv?.user_id === userId) {
    document.getElementById('chat-status-dot').className = 'status-dot' + (online ? ' online' : '');
    document.getElementById('chat-status-text').textContent = online ? 'Online' : 'Offline';
  }
  renderConvList();
}

/**
 * Shows/hides the search results panel vs the conversation list.
 */
function showSearchResults(show) {
  document.getElementById('conv-section-label').textContent = show ? 'Search results' : 'Messages';
  document.getElementById('conv-list').style.display = show ? 'none' : '';
  document.getElementById('search-results-list').style.display = show ? 'block' : 'none';
}
