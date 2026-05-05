// ═══════════════════════════════════════════════════════
// api.js — Fetch wrapper with auto token refresh
// ═══════════════════════════════════════════════════════

const BASE = 'https://whisperbox.koyeb.app';

/**
 * Makes an authenticated API request.
 * Automatically retries once after refreshing the token on 401.
 */
async function api(method, path, body, retry = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && state.refreshToken) {
    await doTokenRefresh();
    return api(method, path, body, false);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || JSON.stringify(err));
  }

  return res.status === 204 ? null : res.json();
}

/**
 * Refreshes the access token using the stored refresh token.
 */
async function doTokenRefresh() {
  const data = await fetch(BASE + '/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: state.refreshToken }),
  }).then(r => r.json());

  state.accessToken = data.access_token;
  await dbSet('session', 'accessToken', data.access_token);
  scheduleTokenRefresh(data.expires_in);
  // Reconnect WebSocket with the new token so it doesn't use the expired one
  if (typeof connectWebSocket === 'function') connectWebSocket();
}

/**
 * Schedules automatic token refresh 60 seconds before expiry.
 */
function scheduleTokenRefresh(expiresIn) {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(doTokenRefresh, (expiresIn - 60) * 1000);
}
