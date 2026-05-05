// ═══════════════════════════════════════════════════════
// app.js — App entry point and session restore
// ═══════════════════════════════════════════════════════

/**
 * Called after successful login or registration.
 * Populates the sidebar UI, loads conversations, and opens the WebSocket.
 */
async function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').classList.add('visible');

  const initials = (state.me.display_name || state.me.username)
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('sidebar-username').textContent = state.me.display_name || state.me.username;

  await loadConversations();
  connectWebSocket();
}

/**
 * Attempts to restore a previous session from IndexedDB.
 * Since the private key cannot be persisted, the user is prompted
 * to re-enter their password to unwrap it. The username is pre-filled.
 */
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

    // Attempt a token refresh to validate the session
    await doTokenRefresh();

    loadingText.textContent = 'Loading profile…';
    const me = await api('GET', '/auth/me');
    state.me = me;

    // Private key can only be restored with the user's password.
    // Pre-fill the username and show a friendly prompt.
    overlay.style.display = 'none';
    document.getElementById('login-username').value = me.username || '';
    toast('Welcome back! Enter your password to unlock your keys.', 4000);
  } catch {
    // Session is invalid — clear it and show a clean login screen
    await dbDel('session', 'accessToken');
    await dbDel('session', 'refreshToken');
    state.accessToken = null;
    state.refreshToken = null;
    overlay.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════
// MOBILE PANEL SWITCHING
// ═══════════════════════════════════════════════════════

function isMobile() {
  return window.innerWidth <= 580;
}

/**
 * On mobile: slides the chat panel into view and shows the back button.
 */
function openChatPanel() {
  if (!isMobile()) return;
  document.querySelector('.app-layout').classList.add('chat-open');
  document.getElementById('back-btn').style.display = 'flex';
}

/**
 * On mobile: slides back to the conversation list.
 */
function closeChat() {
  document.querySelector('.app-layout').classList.remove('chat-open');
  document.getElementById('back-btn').style.display = 'none';
  state.activeConv = null;
  renderConvList();
}

// Show/hide back button on resize
window.addEventListener('resize', () => {
  const backBtn = document.getElementById('back-btn');
  if (!isMobile()) {
    backBtn.style.display = 'none';
    document.querySelector('.app-layout').classList.remove('chat-open');
  }
});

// ── Bootstrap ──
tryRestoreSession();
