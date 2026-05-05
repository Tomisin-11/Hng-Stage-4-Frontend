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

  // Focus the input
  setTimeout(() => document.getElementById('msg-input')?.focus(), 100);

  document.getElementById('messages-area').innerHTML =
    '<div class="empty-state" style="padding:40px 0;"><div class="spinner"></div></div>';

  await loadMessages(conv.user_id);
}

/**
 * Fetches paginated message history, deduplicates, and decrypts.
 */
async function loadMessages(userId) {
  try {
    const msgs = await api('GET', `/conversations/${userId}/messages?limit=50`);
    // ── Fix #5: Build a Set of known IDs to deduplicate against WS-delivered msgs ──
    const existingIds = new Set((state.messages[userId] || []).map(m => m.id));
    const fresh = msgs.filter(m => !existingIds.has(m.id)).reverse();
    const decrypted = await Promise.all(fresh.map(m => decryptMsg(m)));
    // Merge: history first, then any WS messages that arrived while loading
    const wsOnly = (state.messages[userId] || []).filter(m => !msgs.find(h => h.id === m.id));
    state.messages[userId] = [...decrypted, ...wsOnly].sort((a, b) =>
      new Date(a.created_at) - new Date(b.created_at)
    );
    renderMessages(userId);
  } catch {
    document.getElementById('messages-area').innerHTML =
      '<div class="empty-state">Failed to load messages. Please try again.</div>';
  }
}

/**
 * Decrypts a message object. Uses encryptedKeyForSelf for sent messages.
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
 * ── Fix #1: Input validation + #6: send button disabled during send ──
 */
async function sendMessage() {
  const input = document.getElementById('msg-input');
  const sendBtn = document.getElementById('send-btn');
  const text = input.value.trim();

  // Fix #1: validate — no empty or whitespace-only messages
  if (!text || !state.activeConv) return;

  // Fix #6: disable send button during in-flight request
  sendBtn.disabled = true;
  input.value = '';
  // Fix #7: properly reset textarea height
  input.style.height = 'auto';
  input.style.height = '24px';

  const recipientId = state.activeConv.user_id;
  try {
    const pkData = await api('GET', `/users/${recipientId}/public-key`);
    const recipientPubKey = await importPublicKeyFromB64(pkData.public_key);
    const payload = await encryptMessage(text, recipientPubKey, state.publicKey);

    let sent;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ event: 'message.send', to: recipientId, payload }));
      // Optimistic local insertion (WS echo may never come back to sender)
      sent = {
        from_user_id: state.me.id,
        to_user_id: recipientId,
        payload,
        created_at: new Date().toISOString(),
        id: `local_${Date.now()}`,
      };
    } else {
      sent = await api('POST', '/messages', { to: recipientId, payload });
    }

    const decrypted = await decryptMsg(sent);
    if (!state.messages[recipientId]) state.messages[recipientId] = [];

    // Deduplicate optimistic local message
    if (!state.messages[recipientId].some(m => m.id === decrypted.id)) {
      state.messages[recipientId].push(decrypted);
    }
    renderMessages(recipientId);

    // Upsert conversation to top of list
    const existing = state.conversations.findIndex(c => c.user_id === recipientId);
    const conv = existing >= 0 ? state.conversations.splice(existing, 1)[0] : { ...state.activeConv };
    conv.last_message_at = new Date().toISOString();
    state.conversations.unshift(conv);
    renderConvList();
  } catch (e) {
    // Restore the text so the user doesn't lose their message
    input.value = text;
    autoResize(input);
    toast('Failed to send: ' + e.message);
  } finally {
    // Fix #6: always re-enable send button
    sendBtn.disabled = false;
    input.focus();
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
