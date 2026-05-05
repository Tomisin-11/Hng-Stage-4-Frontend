# WhisperBox — E2EE Messaging Client

A fully client-side, end-to-end encrypted messaging application built with vanilla HTML, CSS, and JavaScript. The server never sees plaintext — all encryption and decryption happens in the browser using the native Web Crypto API.

---

## Live Demo

Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari). No build step required.

> ⚠️ Must be served over **HTTPS** or `localhost` for the Web Crypto API to be available.

---

## Project Structure

```
whisperbox/
├── index.html          # App shell and all HTML markup
├── css/
│   └── style.css       # All styles (green/white theme, layout, components)
└── js/
    ├── db.js           # IndexedDB wrapper (session persistence)
    ├── crypto.js       # All Web Crypto API operations
    ├── api.js          # Fetch wrapper with auto token refresh
    ├── state.js        # Global application state
    ├── ui.js           # DOM rendering, helpers, event handlers
    ├── auth.js         # Login, register, logout flows
    ├── messages.js     # Conversations, message loading, sending, search
    ├── websocket.js    # Real-time WebSocket connection manager
    └── app.js          # App entry point and session restore
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (Client)                    │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐ │
│  │  auth.js │  │messages.js│  │     websocket.js      │ │
│  └────┬─────┘  └────┬──────┘  └──────────┬────────────┘ │
│       │              │                    │              │
│  ┌────▼──────────────▼────────────────────▼───────────┐ │
│  │                  crypto.js                          │ │
│  │  RSA-OAEP keygen · PBKDF2 · AES-KW · AES-GCM      │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  state.js│  │   ui.js  │  │   db.js  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                   IndexedDB (tokens only)               │
└────────────────────────────┬────────────────────────────┘
                             │ HTTPS / WSS
                             ▼
                  ┌─────────────────────┐
                  │  WhisperBox Backend  │
                  │  (stores ciphertext  │
                  │   blobs only — no   │
                  │   plaintext access) │
                  └─────────────────────┘
```

---

## Encryption Flow

### Registration

```
1. Generate RSA-OAEP 2048-bit keypair (client-side)
2. Generate random 128-bit PBKDF2 salt
3. Derive AES-KW wrapping key: PBKDF2(password, salt, 200_000 iterations, SHA-256)
4. Wrap private key with AES-KW → wrapped_private_key (base64)
5. Export public key as SPKI → public_key (base64)
6. POST /auth/register with { public_key, wrapped_private_key, pbkdf2_salt }
   → Server stores these blobs verbatim, never sees the raw private key
```

### Login / Session Restore

```
1. POST /auth/login → receive { wrapped_private_key, pbkdf2_salt, access_token, refresh_token }
2. Re-derive AES-KW wrapping key from password + salt (same PBKDF2 params)
3. Unwrap private key into memory (CryptoKey object — never serialised to disk)
4. Private key lives only in JS memory for the session duration
```

### Sending a Message

```
1. GET /users/{recipientId}/public-key → fetch recipient RSA-OAEP public key
2. Generate random 256-bit AES-GCM key + 96-bit IV
3. Encrypt plaintext with AES-GCM → ciphertext
4. Encrypt AES key with recipient's RSA-OAEP public key → encryptedKey
5. Encrypt AES key with own RSA-OAEP public key → encryptedKeyForSelf
6. Send { ciphertext, iv, encryptedKey, encryptedKeyForSelf } via WebSocket
   (falls back to POST /messages if WebSocket is unavailable)
```

### Receiving a Message

```
1. Receive encrypted payload from WebSocket or REST
2. Decrypt encryptedKey with own RSA-OAEP private key → AES-GCM key
3. Decrypt ciphertext with AES-GCM key + iv → plaintext
4. Render plaintext in the UI
   (shows "🔒 Could not decrypt" on failure — no crash)
```

---

## Key Management

| Key | Where generated | Where stored | Leaves device? |
|---|---|---|---|
| RSA-OAEP public key | Client (registration) | Backend (plaintext) | Yes — intentional |
| RSA-OAEP private key | Client (registration) | **Never persisted** — memory only | **Never** |
| AES-KW wrapping key | Client (derived from password) | **Never stored** | **Never** |
| Wrapped private key | Client | Backend (encrypted blob) | Yes — safe (encrypted) |
| PBKDF2 salt | Client | Backend | Yes — not secret |
| Per-message AES-GCM key | Client (per send) | **Never stored** | **Never** |

---

## Security Decisions & Trade-offs

### What we did

- **Private key never persisted** — only lives in JS memory. Refreshing/closing the tab requires re-entering the password to unwrap it again.
- **PBKDF2 with 200,000 iterations** — makes offline brute-force attacks on the wrapped key expensive.
- **Per-message AES-GCM keys** — each message uses a fresh symmetric key, limiting the blast radius of any single key compromise.
- **encryptedKeyForSelf** — sender encrypts the AES key with their own public key so sent messages are readable in their own conversation history.
- **No raw private keys in localStorage** — tokens (non-sensitive) are stored in IndexedDB; the private key is memory-only.
- **XSS prevention** — all user-generated content is HTML-escaped before insertion into the DOM.
- **Graceful decryption failure** — failed decryptions show a locked icon rather than crashing the app.

### Known Limitations

- **No forward secrecy** — RSA-OAEP is used for key encapsulation rather than ephemeral ECDH (e.g. Signal's Double Ratchet). A future improvement would be ECDH with per-session ephemeral keys.
- **No replay attack protection** — the server does not enforce message ordering or deduplicate IDs. A sequence number or timestamp-based nonce could address this.
- **Single device** — the private key is tied to the browser it was created in. Multi-device support would require a key export/import mechanism.
- **Session requires password on refresh** — since the private key cannot be safely persisted, users must re-enter their password after each page load. This is a security feature, but affects UX.
- **No message deletion or expiry** — encrypted blobs persist on the server indefinitely.

## Device Compatibility

- ✅ Desktop (Chrome, Firefox, Edge, Safari)
- ✅ Tablet — sidebar shrinks to 260px
- ✅ Mobile — full-screen panel switching (sidebar ↔ chat), back button navigation

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Framework | Vanilla HTML/CSS/JS | No build step, easy to audit, full Web Crypto access |
| Encryption | Web Crypto API (native) | RSA-OAEP, AES-GCM, AES-KW, PBKDF2 — zero dependencies |
| Storage | IndexedDB | Secure session token persistence, not accessible cross-origin |
| Networking | Fetch API + native WebSocket | No dependencies needed |
| Styling | Pure CSS with custom properties + media queries | Green/white theme, fully responsive (mobile/tablet/desktop) |

---

## Running Locally

```bash
# Any static file server works — e.g.:
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

---

## Deploying a Live Demo (Free)

### Option 1 — Netlify (Recommended, 1 minute)
1. Go to [netlify.com](https://netlify.com) → Log in
2. Drag and drop the `whisperbox/` folder onto the Netlify dashboard
3. Done — you get a live HTTPS URL instantly

### Option 2 — Vercel
```bash
npm i -g vercel
cd whisperbox
vercel
```

### Option 3 — GitHub Pages
1. Push the `whisperbox/` folder contents to a GitHub repo
2. Go to repo Settings → Pages → Deploy from branch → `main` / `root`
3. Live at `https://yourusername.github.io/repo-name`

> All three options serve over HTTPS automatically, which is required for the Web Crypto API.

---

## API

Backend: `https://whisperbox.koyeb.app`  
Docs: `https://whisperbox.koyeb.app/docs`
