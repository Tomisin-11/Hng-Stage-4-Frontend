// ═══════════════════════════════════════════════════════
// messages.js — Conversations, message loading, sending, CRUD, file upload
// ═══════════════════════════════════════════════════════

async function loadConversations() {
  try {
    const convs = await api('GET', '/conversations');
    state.conversations = convs;
    renderConvList();
  } catch {}
}

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

  // ── FIX: properly hide welcome, show window ──
  document.getElementById('chat-welcome').style.display = 'none';
  const cw = document.getElementById('chat-window');
  cw.style.display = 'flex';

  openChatPanel();
  setTimeout(() => document.getElementById('msg-input')?.focus(), 100);

  document.getElementById('messages-area').innerHTML =
    '<div class="empty-state" style="padding:40px 0;"><div class="spinner"></div></div>';

  await loadMessages(conv.user_id);
}

async function loadMessages(userId) {
  try {
    const msgs = await api('GET', `/conversations/${userId}/messages?limit=50`);
    const existingIds = new Set((state.messages[userId] || []).map(m => m.id));
    const fresh = msgs.filter(m => !existingIds.has(m.id)).reverse();
    const decrypted = await Promise.all(fresh.map(m => decryptMsg(m)));
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

async function decryptMsg(m) {
  const isMine = m.from_user_id === state.me.id;
  const text = isMine
    ? await decryptOwnMessage(m.payload, state.privateKey)
    : await decryptMessage(m.payload, state.privateKey);
  return { ...m, text, isMine };
}

// ═══════════════════════════════════════════════════════
// SEND — text + file/image upload
// ═══════════════════════════════════════════════════════

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const sendBtn = document.getElementById('send-btn');
  const fileInput = document.getElementById('file-input');
  const text = input.value.trim();
  const files = fileInput.files;

  if (!text && (!files || files.length === 0)) return;
  if (!state.activeConv) return;

  sendBtn.disabled = true;

  // Handle file upload first if present
  if (files && files.length > 0) {
    for (const file of files) {
      await sendFileMessage(file);
    }
    fileInput.value = '';
    updateFilePreview();
  }

  // Handle text message
  if (text) {
    input.value = '';
    input.style.height = 'auto';
    input.style.height = '24px';
    await sendTextMessage(text);
  }

  sendBtn.disabled = false;
  input.focus();
}

async function sendTextMessage(text) {
  const recipientId = state.activeConv.user_id;
  try {
    const pkData = await api('GET', `/users/${recipientId}/public-key`);
    const recipientPubKey = await importPublicKeyFromB64(pkData.public_key);
    const payload = await encryptMessage(text, recipientPubKey, state.publicKey);

    let sent;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ event: 'message.send', to: recipientId, payload }));
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
    if (!state.messages[recipientId].some(m => m.id === decrypted.id)) {
      state.messages[recipientId].push(decrypted);
    }
    renderMessages(recipientId);
    upsertConvToTop(recipientId);
  } catch (e) {
    toast('Failed to send: ' + e.message);
  }
}

/**
 * Sends a file as a base64-embedded message.
 * The file is read client-side and embedded in the encrypted payload.
 */
async function sendFileMessage(file) {
  const recipientId = state.activeConv.user_id;
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit

  if (file.size > MAX_SIZE) {
    toast(`File "${file.name}" is too large (max 5 MB).`);
    return;
  }

  try {
    // Read file as base64 data URL
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Encode file as JSON payload so it can be encrypted like a message
    const filePayloadText = JSON.stringify({
      type: 'file',
      name: file.name,
      mime: file.type || 'application/octet-stream',
      data: dataUrl,
    });

    const pkData = await api('GET', `/users/${recipientId}/public-key`);
    const recipientPubKey = await importPublicKeyFromB64(pkData.public_key);
    const payload = await encryptMessage(filePayloadText, recipientPubKey, state.publicKey);

    let sent;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ event: 'message.send', to: recipientId, payload }));
      sent = {
        from_user_id: state.me.id,
        to_user_id: recipientId,
        payload,
        created_at: new Date().toISOString(),
        id: `local_file_${Date.now()}`,
      };
    } else {
      sent = await api('POST', '/messages', { to: recipientId, payload });
    }

    // Attach fileData so renderMessages can show it without re-decrypting
    const decrypted = await decryptMsg(sent);
    if (!state.messages[recipientId]) state.messages[recipientId] = [];
    if (!state.messages[recipientId].some(m => m.id === decrypted.id)) {
      state.messages[recipientId].push(decrypted);
    }
    renderMessages(recipientId);
    upsertConvToTop(recipientId);
  } catch (e) {
    toast(`Failed to send file: ${e.message}`);
  }
}

function upsertConvToTop(userId) {
  const existing = state.conversations.findIndex(c => c.user_id === userId);
  const conv = existing >= 0 ? state.conversations.splice(existing, 1)[0] : { ...state.activeConv };
  conv.last_message_at = new Date().toISOString();
  state.conversations.unshift(conv);
  renderConvList();
}

// ═══════════════════════════════════════════════════════
// CRUD — Delete & Edit messages
// ═══════════════════════════════════════════════════════

/**
 * Deletes a message by ID from local state and optionally from server.
 */
async function deleteMessage(msgId, userId) {
  // Optimistic remove from local state
  state.messages[userId] = (state.messages[userId] || []).filter(m => m.id !== msgId);
  renderMessages(userId);

  // Try server delete if it's a real (non-local) message
  if (!msgId.startsWith('local_')) {
    try {
      await api('DELETE', `/messages/${msgId}`);
    } catch {
      // Server delete failed — silently continue (message is gone locally)
    }
  }
}

/**
 * Enters edit mode for a message bubble.
 */
function startEditMessage(msgId, currentText, userId) {
  state.editingMsgId = msgId;
  state.editingUserId = userId;

  const bubble = document.querySelector(`[data-msg-id="${msgId}"] .msg-bubble`);
  if (!bubble) return;

  bubble.innerHTML = `
    <div class="msg-edit-wrap">
      <textarea class="msg-edit-input" id="edit-input-${msgId}" rows="1">${esc(currentText)}</textarea>
      <div class="msg-edit-actions">
        <button class="msg-edit-save" onclick="saveEditMessage('${msgId}')">Save</button>
        <button class="msg-edit-cancel" onclick="cancelEditMessage()">Cancel</button>
      </div>
    </div>`;

  const ta = document.getElementById(`edit-input-${msgId}`);
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  ta.focus();
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditMessage(msgId); }
    if (e.key === 'Escape') cancelEditMessage();
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
}

async function saveEditMessage(msgId) {
  const ta = document.getElementById(`edit-input-${msgId}`);
  if (!ta) return;
  const newText = ta.value.trim();
  if (!newText) return;

  const userId = state.editingUserId;
  const msg = (state.messages[userId] || []).find(m => m.id === msgId);
  if (!msg) return;

  // Update local state
  msg.text = newText;
  msg.edited = true;
  state.editingMsgId = null;
  state.editingUserId = null;
  renderMessages(userId);

  // Try server update
  if (!msgId.startsWith('local_')) {
    try {
      // Re-encrypt edited text for both parties
      const recipientId = state.activeConv.user_id;
      const pkData = await api('GET', `/users/${recipientId}/public-key`);
      const recipientPubKey = await importPublicKeyFromB64(pkData.public_key);
      const payload = await encryptMessage(newText, recipientPubKey, state.publicKey);
      await api('PATCH', `/messages/${msgId}`, { payload });
    } catch {
      // If server update fails, edited state stays locally
    }
  }
}

function cancelEditMessage() {
  const userId = state.editingUserId;
  state.editingMsgId = null;
  state.editingUserId = null;
  if (userId) renderMessages(userId);
}

// ═══════════════════════════════════════════════════════
// FILE PICKER UI
// ═══════════════════════════════════════════════════════

function triggerFilePicker() {
  document.getElementById('file-input').click();
}

function updateFilePreview() {
  const fileInput = document.getElementById('file-input');
  const preview = document.getElementById('file-preview');
  const files = fileInput.files;

  if (!files || files.length === 0) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    return;
  }

  preview.style.display = 'flex';
  preview.innerHTML = Array.from(files).map((f, i) => {
    const isImage = f.type.startsWith('image/');
    const icon = isImage
      ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
    return `<div class="file-chip">
      ${icon}
      <span>${esc(f.name)}</span>
      <button onclick="removeFileFromPicker(${i})" aria-label="Remove">×</button>
    </div>`;
  }).join('');
}

function removeFileFromPicker(index) {
  // FileList is read-only; swap via DataTransfer
  const dt = new DataTransfer();
  const fileInput = document.getElementById('file-input');
  Array.from(fileInput.files).forEach((f, i) => { if (i !== index) dt.items.add(f); });
  fileInput.files = dt.files;
  updateFilePreview();
}

// ═══════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════

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

function onSearch(val) {
  clearTimeout(state.searchDebounce);
  if (!val.trim()) {
    showSearchResults(false);
    return;
  }
  state.searchDebounce = setTimeout(() => searchUsers(val.trim()), 300);
}

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
