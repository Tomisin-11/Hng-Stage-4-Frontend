// ═══════════════════════════════════════════════════════
// auth.js — Login, Register, Logout flows
// ═══════════════════════════════════════════════════════

/**
 * Handles the login flow:
 * 1. POST /auth/login to get tokens + key material
 * 2. Re-derive AES-KW wrapping key from password + salt
 * 3. Unwrap private key into memory
 * 4. Persist tokens to IndexedDB and enter the app
 */
async function doLogin() {
  clearAuthError();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if (!username || !password) return showAuthError('Please fill in all fields.');

  showKeygen('Signing in and restoring keys…');
  try {
    const data = await api('POST', '/auth/login', { username, password }, false);
    state.accessToken = data.access_token;
    state.refreshToken = data.refresh_token;
    state.me = data.user;

    showKeygen('Deriving encryption key from password…');
    const salt = b64ToBytes(data.user.pbkdf2_salt);
    const wrapKey = await deriveWrappingKey(password, salt);

    showKeygen('Unlocking private key…');
    const privKey = await unwrapPrivateKey(data.user.wrapped_private_key, wrapKey);
    const pubKey = await importPublicKeyFromB64(data.user.public_key);
    state.privateKey = privKey;
    state.publicKey = pubKey;

    await dbSet('session', 'accessToken', data.access_token);
    await dbSet('session', 'refreshToken', data.refresh_token);
    await dbSet('session', 'userId', data.user.id);

    scheduleTokenRefresh(data.expires_in);
    hideKeygen();
    enterApp();
  } catch (e) {
    hideKeygen();
    showAuthError(e.message);
  }
}

/**
 * Handles the registration flow:
 * 1. Generate RSA-OAEP keypair client-side
 * 2. Derive AES-KW wrapping key from password + random salt
 * 3. Wrap private key, export public key as base64
 * 4. POST /auth/register with all key material
 * 5. Persist tokens and enter the app
 */
async function doRegister() {
  clearAuthError();
  const username = document.getElementById('reg-username').value.trim();
  const displayName = document.getElementById('reg-display').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!username || !displayName || !password) return showAuthError('Please fill in all fields.');
  if (password.length < 8) return showAuthError('Password must be at least 8 characters.');

  showKeygen('Generating RSA-OAEP key pair…');
  try {
    const { publicKey, privateKey } = await generateRSAKeypair();
    const salt = crypto.getRandomValues(new Uint8Array(16));

    showKeygen('Wrapping private key with your password…');
    const wrapKey = await deriveWrappingKey(password, salt);
    const wrappedPrivKey = await wrapPrivateKey(privateKey, wrapKey);
    const pubKeyB64 = await exportPublicKeyB64(publicKey);
    const saltB64 = bytesToB64(salt);

    showKeygen('Creating account…');
    const data = await api('POST', '/auth/register', {
      username,
      display_name: displayName,
      password,
      public_key: pubKeyB64,
      wrapped_private_key: wrappedPrivKey,
      pbkdf2_salt: saltB64,
    }, false);

    state.accessToken = data.access_token;
    state.refreshToken = data.refresh_token;
    state.me = data.user;
    state.privateKey = privateKey;
    state.publicKey = publicKey;

    await dbSet('session', 'accessToken', data.access_token);
    await dbSet('session', 'refreshToken', data.refresh_token);
    await dbSet('session', 'userId', data.user.id);

    scheduleTokenRefresh(data.expires_in);
    hideKeygen();
    enterApp();
  } catch (e) {
    hideKeygen();
    showAuthError(e.message);
  }
}

/**
 * Logs out: revokes refresh token, clears IndexedDB, resets state.
 */
async function doLogout() {
  try {
    await api('POST', '/auth/logout', { refresh_token: state.refreshToken });
  } catch {}

  await dbDel('session', 'accessToken');
  await dbDel('session', 'refreshToken');
  await dbDel('session', 'userId');

  resetState();

  document.getElementById('app-screen').classList.remove('visible');
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('user-menu').classList.remove('open');
}
