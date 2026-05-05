// ═══════════════════════════════════════════════════════
// crypto.js — All Web Crypto API operations
// ═══════════════════════════════════════════════════════

const subtle = crypto.subtle;

/**
 * Converts a base64 string to Uint8Array.
 * Handles URL-safe base64, strips whitespace, and fixes padding.
 */
function b64ToBytes(b64) {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const s = atob(padded);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

/**
 * Converts ArrayBuffer / Uint8Array to base64.
 * Chunks the conversion to avoid call-stack overflow on large RSA keys.
 */
function bytesToB64(bytes) {
  const a = new Uint8Array(bytes);
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < a.length; i += CHUNK) {
    s += String.fromCharCode(...a.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/**
 * Derives an AES-KW 256-bit wrapping key from password + salt via PBKDF2.
 */
async function deriveWrappingKey(password, salt) {
  const enc = new TextEncoder();
  const keyMat = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** Generates a fresh RSA-OAEP 2048-bit keypair. */
async function generateRSAKeypair() {
  return subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  );
}

/** Exports a public CryptoKey as base64 SPKI. */
async function exportPublicKeyB64(publicKey) {
  const spki = await subtle.exportKey('spki', publicKey);
  return bytesToB64(spki);
}

/** Imports a base64 SPKI string as an RSA-OAEP public key. */
async function importPublicKeyFromB64(b64) {
  return subtle.importKey('spki', b64ToBytes(b64), { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
}

/**
 * Wraps a private key with AES-KW.
 * PKCS8 export is always padded to a multiple of 8 bytes — satisfies AES-KW requirement.
 */
async function wrapPrivateKey(privateKey, wrappingKey) {
  const wrapped = await subtle.wrapKey('pkcs8', privateKey, wrappingKey, { name: 'AES-KW' });
  return bytesToB64(wrapped);
}

/** Unwraps a base64 AES-KW-wrapped private key. */
async function unwrapPrivateKey(wrappedB64, wrappingKey) {
  return subtle.unwrapKey(
    'pkcs8',
    b64ToBytes(wrappedB64),
    wrappingKey,
    { name: 'AES-KW' },
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

/**
 * Hybrid-encrypts a plaintext string:
 *   AES-GCM 256 for the message body
 *   RSA-OAEP for the AES key (once for recipient, once for sender self-read)
 */
async function encryptMessage(plaintext, recipientPubKey, senderPubKey) {
  const aesKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext));
  const rawAES = await subtle.exportKey('raw', aesKey);
  const [encKey, encKeyForSelf] = await Promise.all([
    subtle.encrypt({ name: 'RSA-OAEP' }, recipientPubKey, rawAES),
    subtle.encrypt({ name: 'RSA-OAEP' }, senderPubKey, rawAES),
  ]);
  return {
    ciphertext: bytesToB64(ciphertext),
    iv: bytesToB64(iv),
    encryptedKey: bytesToB64(encKey),
    encryptedKeyForSelf: bytesToB64(encKeyForSelf),
  };
}

/** Decrypts a received message. Returns null on any failure. */
async function decryptMessage(payload, privateKey) {
  try {
    const aesRaw = await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64ToBytes(payload.encryptedKey));
    const aesKey = await subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, aesKey, b64ToBytes(payload.ciphertext));
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

/** Decrypts a message the user sent themselves (via encryptedKeyForSelf). Returns null on failure. */
async function decryptOwnMessage(payload, privateKey) {
  try {
    const aesRaw = await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64ToBytes(payload.encryptedKeyForSelf));
    const aesKey = await subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, aesKey, b64ToBytes(payload.ciphertext));
    return new TextDecoder().decode(plain);
  } catch { return null; }
}
