// ═══════════════════════════════════════════════════════
// state.js — Global application state
// ═══════════════════════════════════════════════════════

let state = {
  accessToken: null,
  refreshToken: null,
  me: null,
  privateKey: null,        // CryptoKey — in-memory only, never persisted
  publicKey: null,         // CryptoKey
  conversations: [],
  activeConv: null,
  onlineUsers: new Set(),
  ws: null,
  wsState: 'disconnected',
  refreshTimer: null,
  messages: {},            // { [userId]: decryptedMessage[] }
  unread: {},              // { [userId]: number }
  searchDebounce: null,
};

/**
 * Resets all state to defaults (used on logout).
 */
function resetState() {
  if (state.ws) state.ws.close();
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state = {
    accessToken: null,
    refreshToken: null,
    me: null,
    privateKey: null,
    publicKey: null,
    conversations: [],
    activeConv: null,
    onlineUsers: new Set(),
    ws: null,
    wsState: 'disconnected',
    refreshTimer: null,
    messages: {},
    unread: {},
    searchDebounce: null,
  };
}
