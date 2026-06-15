# Outerscore ↔ LibreChat authentication (SSO bridge)

How a user embedded in the Outerscore app gets signed into the LibreChat fork with no
second login. LibreChat runs **inside an iframe** in the Outerscore Angular app; auth is
bootstrapped by an **origin-pinned `postMessage` handshake** plus a one-time server-side
**token exchange**.

## Key concept: two tokens, two jobs

| | Outerscore token | LibreChat session tokens |
|---|---|---|
| Issued by | Outerscore auth server (Okta/Keycloak via Spring) | LibreChat itself (`setAuthTokens`) |
| Purpose | **Authentication** — proves *who the user is*, once | **Session** — authorizes *every* LibreChat API call after |
| Algorithm | RS256 (asymmetric) | HS256 (symmetric) |
| LibreChat's role | **verify only**, with the public key from `OUTERSCORE_TOKEN_KEY_URL` | **sign + verify** with `JWT_SECRET` / `JWT_REFRESH_SECRET` |
| Lifetime | the parent app's | access ≈ `SESSION_EXPIRY` (15 min); refresh ≈ `REFRESH_TOKEN_EXPIRY` (7 d) |

The Outerscore token only opens the door once; from then on LibreChat runs its own session.
This is why `JWT_SECRET`/`JWT_REFRESH_SECRET` are required even though the user "logs in
through Outerscore" — see also `docs/outerscore-test-deploy.md`.

## Components

- **Parent** — Outerscore Angular app. Origin: `http://localhost:4200` (dev) /
  `https://test.outerscore.com` (test). Holds the live Outerscore access token.
- **Iframe** — LibreChat React client (`client/`).
- **LibreChat backend** — Express; bridge endpoint `POST /api/auth/outerscore`.
- **Outerscore auth server** — Spring; publishes its RS256 **public** key at
  `OUTERSCORE_TOKEN_KEY_URL` (e.g. `/oauth/token_key`).

## Sequence

```
Outerscore app (parent)        LibreChat iframe (React)        LibreChat backend        Outerscore auth
      │  loads <iframe>                │                              │                        │
      │ ──────────────────────────────►                             │                        │
      │   'outerscore:ready'  ◄─────────  main.jsx:111              │                        │
      │   'outerscore:handshake'        │                           │                        │
      │   { token: OS-JWT }  ──────────► setOuterscoreToken (memory) │                        │
      │   (origin-pinned)               │ → window 'token-ready'     │                        │
      │                                 │ POST /api/auth/outerscore  │                        │
      │                                 │ { token } ────────────────► GET token_key ─────────►│
      │                                 │                            │ ◄──── PEM public key ──│
      │                                 │                            │ jwt.verify(RS256)      │
      │                                 │                            │ find/createUser(outerscoreId)
      │                                 │                            │ setAuthTokens():       │
      │                                 │                            │  • access JWT (JWT_SECRET) → body
      │                                 │                            │  • refreshToken cookie (JWT_REFRESH_SECRET, HttpOnly)
      │                                 │ ◄──── { token, user } ─────│                        │
      │  'outerscore:auth-success' ◄────│ AuthContext: logged in     │                        │
      │                                 │ every /api: Bearer <LibreChat JWT> ──► jwtLogin verifies JWT_SECRET
      │   'outerscore:logout'  ────────► clearToken + logoutUser     │                        │
```

## Step by step (with code references)

1. **Iframe boot** — `client/src/main.jsx`
   - Detects it is framed (`window.parent !== window`), pins theme to light, adds the
     `os-embedded` class.
   - Registers a `message` listener that **drops any message whose
     `event.origin !== VITE_OUTERSCORE_PARENT_ORIGIN`** (origin pinning; `:51`).
   - Posts `outerscore:ready` to the parent, targeted to the parent origin (`:111`).

2. **Parent → iframe: token** — host posts `outerscore:handshake { token }` (the Outerscore
   access token). The host re-posts it on every token refresh.

3. **Iframe stores it in memory only** — `main.jsx:58-60` → `client/src/utils/outerscoreToken.ts`.
   The token is held in a module variable, **never** in localStorage/sessionStorage, to
   shrink the XSS exfiltration surface. A `outerscore:token-ready` window event is fired.

4. **Token exchange** — `client/src/hooks/useOuterscoreAutoLogin.ts`
   - On `token-ready` (or initial mount if a token is present), `runBridge()` calls
     `dataService.outerscoreBridge(token)` → `POST /api/auth/outerscore` (`:96`).
   - Dedups the same token (`:82`); decodes the JWT `sub` to detect an Outerscore
     **user switch** and reset the chat (`:87-91`).
   - Success → posts `outerscore:auth-success` to the parent and runs `onSuccess` (logs the
     user into the React app). Failure → clears the token, posts `outerscore:auth-required`.

5. **Token verification** — `packages/api/src/auth/outerscore.ts`
   - `getOuterscorePublicKey()` fetches the PEM from `OUTERSCORE_TOKEN_KEY_URL`, cached 10 min
     (`:57-65`).
   - `verifyOuterscoreToken()` runs `jwt.verify(token, pem, { algorithms:['RS256'], issuer?, audience? })`
     (`:71-99`); on `invalid signature` it refreshes the key once and retries (key rotation).
   - `extractOuterscoreUser()` requires a `user` claim with at least `id` + `email` (`:101-110`).

6. **Find-or-create user** — `api/server/controllers/auth/OuterscoreController.js`
   - 404 if `OUTERSCORE_SSO_ENABLED !== 'true'` (`:11`); 500 if no `OUTERSCORE_TOKEN_KEY_URL` (`:16`).
   - Looks up **by `outerscoreId` (the signed `id`) only — no email fallback** (`:60`); email is
     attacker-influenceable, so matching on it would allow account takeover. New users are
     created `provider:'outerscore'`, `emailVerified:true` (`:77`). An email unique-index
     collision fails loudly for manual admin resolution — never an auto-merge.

7. **Mint the LibreChat session** — `setAuthTokens` (`api/server/services/AuthService.js:410`)
   - Access token: `generateToken(user, SESSION_EXPIRY)` (HS256, `JWT_SECRET`) → returned in the
     JSON body.
   - Refresh token: `generateRefreshToken` (HS256, `JWT_REFRESH_SECRET`) set as a `refreshToken`
     cookie — **HttpOnly, `SameSite=strict`, `secure` in prod** (`:431`). Plus a
     `token_provider=librechat` cookie.
   - Controller returns `{ token, user }` (`OuterscoreController.js:100`).

8. **Steady state** — the React app sends the LibreChat access token as
   `Authorization: Bearer` on every `/api/...` call; the `jwtLogin()` passport strategy verifies
   it with `JWT_SECRET`. On expiry, the `refreshToken` cookie (verified with `JWT_REFRESH_SECRET`)
   mints a new access token. The Outerscore token is no longer involved.

9. **Logout** — host posts `outerscore:logout`; the iframe clears the in-memory token
   (`main.jsx:97`) and `AuthContext` (`client/src/hooks/AuthContext.tsx:313`) calls `logoutUser`,
   tearing down the LibreChat session.

## postMessage contract

**Parent → iframe** (must be sent to the iframe's origin):

| Message | Payload | Effect |
|---|---|---|
| `outerscore:handshake` | `{ token }` | store token (memory) → trigger bridge |
| `outerscore:logout` | — | clear token + LibreChat logout |
| `outerscore:theme` | `{ vars: {'--os-…': value} }` | mirror host palette into the iframe |
| `outerscore:language` | `{ lang: 'en' \| 'de' }` | set chat language |
| `outerscore:canvas-context` | `{ content }` | inject current editor content into the next prompt |

**Iframe → parent** (sent to `VITE_OUTERSCORE_PARENT_ORIGIN`):

| Message | Meaning |
|---|---|
| `outerscore:ready` | iframe loaded; send the handshake |
| `outerscore:auth-success` | token exchange succeeded; user is signed in |
| `outerscore:auth-required` | no/invalid token; host should (re)send one |

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `OUTERSCORE_SSO_ENABLED` | backend | `true` enables `POST /api/auth/outerscore` |
| `OUTERSCORE_TOKEN_KEY_URL` | backend | URL of the RS256 **public** key (Spring `/oauth/token_key`) |
| `OUTERSCORE_JWT_ISSUER` | backend (recommended) | when set, the `iss` claim is verified |
| `OUTERSCORE_JWT_AUDIENCE` | backend (recommended) | when set, the `aud` claim is verified |
| `OUTERSCORE_JWT_ENFORCE_CLAIMS` | backend (optional) | `true` = **reject** logins whose token is missing iss/aud (fail-closed); default accepts on signature alone with a one-time warning. Not tied to `NODE_ENV` |
| `VITE_OUTERSCORE_PARENT_ORIGIN` | **build-time** | origin allowed to postMessage / receive our messages |
| `JWT_SECRET` | backend | signs/verifies the LibreChat access token |
| `JWT_REFRESH_SECRET` | backend | signs/verifies the LibreChat refresh token |
| `SESSION_EXPIRY` / `REFRESH_TOKEN_EXPIRY` | backend (optional) | token lifetimes |

> `VITE_OUTERSCORE_PARENT_ORIGIN` is inlined into the client bundle at build time — changing
> it requires a rebuild (see `scripts/deploy.sh`).

### Expected Outerscore token payload

`packages/api/src/auth/outerscore.ts` expects a `user` claim:

```json
{ "user": { "id": "…", "email": "…", "firstName": "…", "lastName": "…", "avatar": "…" }, "exp": 0 }
```

`id` and `email` are required; `id` is the permanent account key.

## Security properties

- **Origin-pinned** postMessage on both ends (`VITE_OUTERSCORE_PARENT_ORIGIN`).
- **Asymmetric** Outerscore token: LibreChat holds only the public key — it can verify but
  never forge Outerscore tokens.
- Outerscore token kept **in memory only** (no web storage).
- Account identity = the **signed `id`**, never email → no takeover via email.
- Refresh cookie is **HttpOnly + SameSite=strict + secure** (in prod). Same-origin embedding
  (the `/ai/chat` subpath) keeps this a clean first-party cookie.
- LibreChat's session uses its **own** HS256 secrets, decoupled from the parent.
- Bridge gated by `OUTERSCORE_SSO_ENABLED` + `OUTERSCORE_TOKEN_KEY_URL`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Iframe never authenticates; no `handshake` received | parent origin ≠ `VITE_OUTERSCORE_PARENT_ORIGIN` (message dropped at `main.jsx:51`) |
| `404 Outerscore SSO is not enabled` | `OUTERSCORE_SSO_ENABLED` not `true` |
| `500 SSO misconfigured` | `OUTERSCORE_TOKEN_KEY_URL` unset |
| `401 Invalid Outerscore token` | bad signature / expired / wrong issuer/audience; or `token_key` unreachable |
| `400 …missing required claims` | token has no `user.id` / `user.email` |
| Auth works then drops after ~15 min | refresh failing — check `JWT_REFRESH_SECRET` and that the `refreshToken` cookie reaches the backend (same-origin path / proxy) |
| `createUser` fails on duplicate email | a legacy account already holds that email — resolve manually (no auto-merge by design) |

## Standalone (non-embedded) mode

Outside an iframe the SSO hook is disabled (`isOuterscoreContext()` is false), so standalone
LibreChat uses its normal email/registration login. For test smoke-checks with
`ALLOW_REGISTRATION=false`, mint a user with `npm run create-user`.
