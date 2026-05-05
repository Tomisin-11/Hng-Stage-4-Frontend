// ═══════════════════════════════════════════════════════
// messages.js — Conversations, message loading, sending, search
// ═══════════════════════════════════════════════════════

/**
 * Loads the conversation list from the API and renders it.
 */
async function loadConversations() {
  try {
    const convs = await api('GET', '/conversations');
    state.conversations = convs;
    renderConvList();
  } catch {}
}

/**
 * Opens a conversation: updates the chat header, loads message history.
 */
async function openConversation(conv) {
  state.activeConv = conv;
  state.unread[conv.user_id] = 0;
  document.getElementById('search-input').value = '';
  showSearchResults(false);
  renderConvList();

  const initials = (conv.display_name || conv.username).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const online = state.onlineUsers.has(conv.user_id);

  document.getElementById('chat-hdr-avatar').textContent = initials;
  document.getElementById('chat-hdr-name').textContent = conv.display_name || conv.username;
  document.getElementById('chat-status-dot').className = 'status-dot' + (online ? ' online' : '');
  document.getElementById('chat-status-text').textContent = online ? 'Online' : 'Offline';

  document.getElementById('chat-welcome').style.display = 'none';
  const cw = document.getElementById('chat-window');
  cw.style.display = 'flex';

  // Mobile: slide chat panel into view
  openChatPanel();

  document.getElementById('messages-area').innerHTML = `
    <div class="empty-state" style="padding:40px 0;"><div class="spinner"></div></div>`;

  await loadMessages(conv.user_id);
}

/**
 * Fetches paginated message history for a conversation and decrypts each message.
 */
async function loadMessages(userId) {
  try {
    const msgs = await api('GET', `/conversations/${userId}/messages?limit=50`);
    const decrypted = await Promise.all(msgs.reverse().map(m => decryptMsg(m)));
    state.messages[userId] = decrypted;
    renderMessages(userId);
  } catch {
    document.getElementById('messages-area').innerHTML =
      '<div class="empty-state">Failed to load messages.</div>';
  }
}

/**
 * Decrypts a message object. Uses encryptedKeyForSelf for sent messages,
 * encryptedKey for received messages. Returns null text on failure.
 */
async function decryptMsg(m) {
  const isMine = m.from_user_id === state.me.id;
  const text = isMine
    ? await decryptOwnMessage(m.payload, state.privateKey)
    : await decryptMessage(m.payload, state.privateKey);
  return { ...m, text, isMine };
}

/**
 * Encrypts and sends a message to the active conversation.
 * Uses WebSocket if connected, falls back to REST.
 */
async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !state.activeConv) return;
  input.value = '';
  autoResize(input);

  const recipientId = state.activeConv.user_id;
  try {
    // Fetch recipient's public key fresh each time (key rotation friendly)
    const pkData = await api('GET', `/users/${recipientId}/public-key`);
    const recipientPubKey = await importPublicKeyFromB64(pkData.public_key);
    const payload = await encryptMessage(text, recipientPubKey, state.publicKey);

    let sent;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ event: 'message.send', to: recipientId, payload }));
      // Optimistic local message
      sent = {
        from_user_id: state.me.id,
        to_user_id: recipientId,
        payload,
        created_at: new Date().toISOString(),
        id: Date.now().toString(),
      };
    } else {
      sent = await api('POST', '/messages', { to: recipientId, payload });
    }

    const decrypted = await decryptMsg(sent);
    if (!state.messages[recipientId]) state.messages[recipientId] = [];
    state.messages[recipientId].push(decrypted);
    renderMessages(recipientId);

    // Upsert conversation to top of list
    const existing = state.conversations.findIndex(c => c.user_id === recipientId);
    const conv = existing >= 0 ? state.conversations.splice(existing, 1)[0] : { ...state.activeConv };
    conv.last_message_at = new Date().toISOString();
    state.conversations.unshift(conv);
    renderConvList();
  } catch (e) {
    toast('Failed to send: ' + e.message);
  }
}

/**
 * Initiates a new conversation from search results.
 */
function startChat(user) {
  document.getElementById('search-input').value = '';
  showSearchResults(false);
  const conv = {
    user_id: user.id,
    display_name: user.display_name,
    username: user.username,
    last_message_at: null,
  };
  if (!state.conversations.find(c => c.user_id === user.id)) {
    state.conversations.unshift(conv);
  }
  openConversation(conv);
  renderConvList();
}

/**
 * Debounced user search handler.
 */
function onSearch(val) {
  clearTimeout(state.searchDebounce);
  if (!val.trim()) {
    showSearchResults(false);
    return;
  }
  state.searchDebounce = setTimeout(() => searchUsers(val.trim()), 300);
}

/**
 * Searches for users by username/display name and renders results.
 */
async function searchUsers(q) {
  try {
    const results = await api('GET', `/users/search?q=${encodeURIComponent(q)}`);
    const el = document.getElementById('search-results-list');
    showSearchResults(true);

    if (!results.length) {
      el.innerHTML = `<div class="empty-state"><span>No users found for "${esc(q)}"</span></div>`;
      return;
    }

    el.innerHTML = results.map(u => {
      const initials = (u.display_name || u.username).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const online = state.onlineUsers.has(u.id);
      const userJson = JSON.stringify(u).replace(/"/g, '&quot;');
      return `<div class="conv-item" onclick="startChat(${userJson})">
        <div class="conv-avatar">${initials}${online ? '<div class="online-dot"></div>' : ''}</div>
        <div class="conv-info">
          <div class="conv-name">${esc(u.display_name || u.username)}</div>
          <div class="conv-preview">@${esc(u.username)}</div>
        </div>
      </div>`;
    }).join('');
  } catch {}
}
