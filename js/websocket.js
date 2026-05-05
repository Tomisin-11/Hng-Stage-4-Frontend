// ═══════════════════════════════════════════════════════
// websocket.js — Real-time WebSocket connection manager
// ═══════════════════════════════════════════════════════

let wsReconnectTimer = null;

/**
 * Connects to the WhisperBox WebSocket server.
 * Always uses the latest access token so expired-token reconnects work.
 * Automatically reconnects every 3 seconds on disconnect.
 */
function connectWebSocket() {
  if (!state.accessToken) return;

  // Cancel any pending reconnect
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

  // Close stale socket if still around
  if (state.ws && state.ws.readyState !== WebSocket.CLOSED) {
    state.ws.onclose = null; // prevent re-triggering reconnect
    state.ws.close();
  }

  setWsState('connecting');

  // Always read state.accessToken fresh — it may have been refreshed
  const ws = new WebSocket(`wss://whisperbox.koyeb.app/ws?token=${state.accessToken}`);
  state.ws = ws;

  ws.onopen = () => setWsState('connected');

  ws.onclose = (e) => {
    setWsState('disconnected');
    // Don't reconnect if we deliberately logged out (token cleared)
    if (!state.refreshToken) return;
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => setWsState('disconnected');

  ws.onmessage = async e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.event) {
      case 'message.receive':
        await handleIncomingMessage(msg);
        break;
      case 'user.online':
        state.onlineUsers.add(msg.user_id);
        updateOnlineStatus(msg.user_id, true);
        break;
      case 'user.offline':
        state.onlineUsers.delete(msg.user_id);
        updateOnlineStatus(msg.user_id, false);
        break;
      case 'error':
        console.error('WS server error:', msg.detail);
        break;
    }
  };
}

/**
 * Handles an incoming message.receive WebSocket event.
 * Deduplicates against already-loaded messages by ID.
 * Fetches real sender info if not already in conversations.
 */
async function handleIncomingMessage(msg) {
  const fromId = msg.from_user_id;

  // ── Fix #5: Deduplicate ──
  if (!state.messages[fromId]) state.messages[fromId] = [];
  const alreadyLoaded = state.messages[fromId].some(m => m.id === msg.id);
  if (alreadyLoaded) return;

  const decrypted = await decryptMsg(msg);
  state.messages[fromId].push(decrypted);

  if (state.activeConv?.user_id === fromId) {
    renderMessages(fromId);
  } else {
    state.unread[fromId] = (state.unread[fromId] || 0) + 1;
  }

  // Upsert conversation to top of list
  const existing = state.conversations.findIndex(c => c.user_id === fromId);
  if (existing >= 0) {
    const [c] = state.conversations.splice(existing, 1);
    c.last_message_at = msg.created_at;
    state.conversations.unshift(c);
  } else {
    // ── Fix #4: Fetch real sender info instead of hardcoding 'Unknown' ──
    let senderInfo = { user_id: fromId, display_name: 'Unknown', username: fromId, last_message_at: msg.created_at };
    try {
      const results = await api('GET', `/users/search?q=${encodeURIComponent(fromId)}`);
      const match = results.find(u => u.id === fromId);
      if (match) {
        senderInfo.display_name = match.display_name || match.username;
        senderInfo.username = match.username;
      }
    } catch {}
    state.conversations.unshift(senderInfo);
  }

  renderConvList();
}
