// ═══════════════════════════════════════════════════════
// websocket.js — Real-time WebSocket connection manager
// ═══════════════════════════════════════════════════════

/**
 * Connects to the WhisperBox WebSocket server.
 * Automatically reconnects every 3 seconds on disconnect.
 */
function connectWebSocket() {
  if (!state.accessToken) return;
  setWsState('connecting');

  const ws = new WebSocket(`wss://whisperbox.koyeb.app/ws?token=${state.accessToken}`);
  state.ws = ws;

  ws.onopen = () => setWsState('connected');

  ws.onclose = () => {
    setWsState('disconnected');
    setTimeout(connectWebSocket, 3000);
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
        console.error('WS error from server:', msg.detail);
        break;
    }
  };
}

/**
 * Handles an incoming message.receive WebSocket event:
 * decrypts it, appends to message list, updates conversation order.
 */
async function handleIncomingMessage(msg) {
  const fromId = msg.from_user_id;
  const decrypted = await decryptMsg(msg);

  if (!state.messages[fromId]) state.messages[fromId] = [];
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
    state.conversations.unshift({
      user_id: fromId,
      display_name: 'Unknown',
      username: '…',
      last_message_at: msg.created_at,
    });
  }

  renderConvList();
}
