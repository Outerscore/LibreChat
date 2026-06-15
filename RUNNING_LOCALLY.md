# Running LibreChat (Outerscore fork) locally

This fork embeds LibreChat as an **iframe inside the Outerscore app** and logs the user
in automatically via an SSO bridge. This guide gets it running on your machine.

> **TL;DR for a demo:** use **Dev mode** (below). It's the fastest, most reliable path and
> picks up the Outerscore config live. Docker is for production, not quick demos — see why
> at the bottom.

---

## What you're running

Three things must be up at the same time:

| Piece | Where | Port | Notes |
|---|---|---|---|
| **MongoDB** | local or Docker | 27017 | LibreChat's database |
| **LibreChat** | this repo | backend 3080 + dev frontend 3090 | the chat app |
| **Outerscore app** | the Outerscore frontend repo | **4200** | the *parent* that embeds the iframe |

The Outerscore app embeds LibreChat in an iframe and hands it a login token via
`postMessage`. LibreChat trusts only the origin set in `VITE_OUTERSCORE_PARENT_ORIGIN`
(currently `http://localhost:4200`), so the Outerscore app **must** run on that origin.

---

## Dev mode (recommended)

### 1. Start MongoDB
Either is fine:
```powershell
docker compose up -d mongodb        # needs Docker Desktop running
```
…or a locally-installed MongoDB service. The app expects `mongodb://127.0.0.1:27017/LibreChat`
(already set as `MONGO_URI` in `.env`).

### 2. Build the shared packages (first run, or after pulling changes)
```powershell
npm run build:packages
```

### 3. Start the backend (terminal 1)
```powershell
npm run backend:dev
```
Listens on **http://localhost:3080**.

### 4. Start the frontend dev server (terminal 2)
```powershell
npm run frontend:dev
```
Serves the app with hot-reload on **http://localhost:3090** and proxies `/api/*` to the backend.

### 5. Start the Outerscore app
Run the Outerscore frontend so it's available at **http://localhost:4200**, and point its
embedded iframe `src` at **http://localhost:3090** (the LibreChat dev server).

Open the Outerscore app — LibreChat should load inside it and log you in automatically.

---

## The Outerscore SSO handshake (how login works)

You don't have to do anything for this manually — it's automatic — but this is what happens,
which helps when debugging:

1. The iframe boots and posts `{ type: 'outerscore:ready' }` to its parent.
2. The Outerscore app replies with `{ type: 'outerscore:handshake', token: <JWT> }`.
3. LibreChat verifies that JWT against Outerscore's public key
   (`OUTERSCORE_TOKEN_KEY_URL`), finds-or-creates the user, and logs in.
4. On success the iframe posts `outerscore:auth-success` back to the parent.

The token is verified server-side; the user is keyed by `outerscoreId`/email.

---

## Relevant `.env` settings (already configured)

```ini
HOST=0.0.0.0                                                   # must NOT be "localhost" — see Troubleshooting
PORT=3080
MONGO_URI=mongodb://127.0.0.1:27017/LibreChat

OUTERSCORE_SSO_ENABLED=true
OUTERSCORE_TOKEN_KEY_URL=https://test.outerscore.com/api/oauth/token_key   # public key used to verify tokens
VITE_OUTERSCORE_PARENT_ORIGIN=http://localhost:4200            # the ONLY origin allowed to embed + send tokens
```

- `OUTERSCORE_TOKEN_KEY_URL` must match wherever the tokens are **signed**. If the Outerscore
  app authenticates against `test.outerscore.com`, leave it as-is. If you run the Outerscore
  backend fully locally, point this at that backend's `/oauth/token_key`.
- `VITE_OUTERSCORE_PARENT_ORIGIN` is read by the Vite **dev server** live — change it and just
  restart `npm run frontend:dev` (no rebuild). In a Docker/production build it is baked in at
  build time instead.

---

## Troubleshooting

**`[vite] http proxy error … ECONNREFUSED` on `/api/config`, `/api/banner`**
The backend isn't reachable from the proxy. The usual cause on Windows is `HOST=localhost`,
which binds the backend to IPv6 `[::1]` only while the proxy connects over IPv4. Fix: set
`HOST=0.0.0.0` in `.env` and restart the backend. (Already applied.)

**Blank / broken page inside the Outerscore iframe**
Almost always a downstream symptom of the proxy error above — fix that first. If it persists:
- Confirm the iframe `src` points at the dev server (**3090**), not a stale build.
- Confirm the Outerscore app is served from exactly `http://localhost:4200` (must match
  `VITE_OUTERSCORE_PARENT_ORIGIN` — protocol, host, and port).

**Logs in but immediately logs out / "auth required" loop**
The token failed verification. Check the backend logs and confirm `OUTERSCORE_TOKEN_KEY_URL`
matches the signer of the token the Outerscore app is sending.

**Stale dependencies after a pull**
```powershell
npm run smart-reinstall
```

---

## Why not Docker for the demo?

The bundled `docker-compose.yml` pulls the **upstream** LibreChat image — it does **not**
contain this fork's Outerscore code. Running your fork in Docker means:

- `docker build` the whole image yourself, passing `--build-arg VITE_OUTERSCORE_PARENT_ORIGIN=…`
  (the parent origin is inlined at build time and can't be changed at runtime), then
- run with `docker-compose.prod.yml`, which expects ~10 secrets (`JWT_SECRET`, `CREDS_KEY`,
  `MEILI_MASTER_KEY`, …) exported into the environment.

`scripts/deploy.sh` automates this for CI, but it's a bash script (use Git Bash/WSL on Windows)
and a multi-minute build. **Great for production, too heavy and risky for a demo in a couple
hours.** Use Dev mode above instead.

### Production (for reference)
```bash
source your-secrets.env          # exports the required vars
./scripts/deploy.sh              # builds the fork image + brings up the prod stack
```
