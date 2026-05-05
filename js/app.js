// ═══════════════════════════════════════════════════════
// app.js — App entry point and session restore
// ═══════════════════════════════════════════════════════

async function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').classList.add('visible');

  const initials = (state.me.display_name || state.me.username)
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('sidebar-username').textContent = state.me.display_name || state.me.username;

  // Always reset chat pane on fresh enter
  document.getElementById('chat-welcome').style.display = 'flex';
  document.getElementById('chat-window').style.display = 'none';
  document.getElementById('back-btn').style.display = 'none';

  await loadConversations();
  connectWebSocket();
}

async function tryRestoreSession() {
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  overlay.style.display = 'flex';

  await openDB();

  const accessToken = await dbGet('session', 'accessToken');
  const refreshToken = await dbGet('session', 'refreshToken');

  if (!accessToken || !refreshToken) {
    overlay.style.display = 'none';
    return;
  }

  try {
    loadingText.textContent = 'Restoring session…';
    state.accessToken = accessToken;
    state.refreshToken = refreshToken;

    await doTokenRefresh();

    loadingText.textContent = 'Loading profile…';
    const me = await api('GET', '/auth/me');
    state.me = me;

    overlay.style.display = 'none';

    // Show quick-unlock overlay (password needed to restore private key)
    document.getElementById('login-username').value = me.username || '';
    document.getElementById('quick-unlock-name').textContent = me.display_name || me.username;
    document.getElementById('quick-unlock-banner').style.display = 'flex';
    setTimeout(() => document.getElementById('login-password').focus(), 100);
  } catch {
    await dbDel('session', 'accessToken');
    await dbDel('session', 'refreshToken');
    state.accessToken = null;
    state.refreshToken = null;
    overlay.style.display = 'none';
  }
}

function hideQuickUnlock() {
  document.getElementById('quick-unlock-banner').style.display = 'none';
}

// ═══════════════════════════════════════════════════════
// BACK BUTTON — works on all screen sizes
// ═══════════════════════════════════════════════════════

function isMobile() {
  return window.innerWidth <= 580;
}

function openChatPanel() {
  // Back button always visible when in a chat
  document.getElementById('back-btn').style.display = 'flex';
  if (isMobile()) {
    document.querySelector('.app-layout').classList.add('chat-open');
  }
}

function closeChat() {
  if (isMobile()) {
    document.querySelector('.app-layout').classList.remove('chat-open');
  }
  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('chat-window').style.display = 'none';
  document.getElementById('chat-welcome').style.display = 'flex';
  state.activeConv = null;
  renderConvList();
}

window.addEventListener('resize', () => {
  if (!isMobile()) {
    document.querySelector('.app-layout').classList.remove('chat-open');
  }
});

// ── Bootstrap ──
tryRestoreSession();
