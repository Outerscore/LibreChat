# Deploying the Outerscore LibreChat fork to TEST

Runbook for the `Deploy LibreChat to Test` GitHub Action
(`.github/workflows/deploy-test.yml`). The chat is served under the **subpath**
`https://test.outerscore.com/ai/chat` (same-origin with the Buyer app) and embedded
as an iframe by the Angular Buyer app. Images are built in CI and published to
**GitHub Container Registry (GHCR)** — no AWS is involved for the test environment.

```
Browser ──HTTPS──> test.outerscore.com (existing Apache/Nginx on the test box)
  ├─ /            → Angular Buyer SPA        [unchanged]
  ├─ /api/*       → Spring buyer-service     [unchanged]
  └─ /ai/chat/*   → 127.0.0.1:3080 (strips /ai/chat)  → Compose stack below
                        api (Node+FE)  ·  mongodb  ·  meilisearch
```

The frontend is built **into** the Node image (Express serves `client/dist`), so
"Node + FE" is one container; only Mongo + Meilisearch are separate.

---

## One-time setup

### 1. Test host (`/opt/librechat`)

Requires `docker` and `docker compose` only (no AWS CLI). Run as the deploy user
(reuse the existing Outerscore dev/staging SSH user):

```bash
sudo mkdir -p /opt/librechat/{images,uploads,logs}
sudo chown -R "$(id -u)":"$(id -g)" /opt/librechat
# The api image runs as uid/gid 1000 (the "node" user); bind-mounted dirs must be writable by it:
sudo chown -R 1000:1000 /opt/librechat/{images,uploads,logs}
# Ensure the deploy user is in the docker group. The workflow handles `docker login ghcr.io`.
```

### 2. Reverse-proxy route (host vhost for `test.outerscore.com`)

Add **one** block to the existing `test.outerscore.com` server config. The trailing
slash on the upstream **strips** `/ai/chat`, so Express sees `/api/...`, `/assets/...`,
`/health`. The CSP is **required** — the app ships no frame protection of its own.

**nginx**
```nginx
location = /ai/chat { return 308 /ai/chat/; }
location /ai/chat/ {
    proxy_pass http://127.0.0.1:3080/;          # trailing "/" strips /ai/chat
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection        "";       # SSE streaming
    proxy_buffering    off;
    proxy_cache        off;
    proxy_read_timeout 3600s;
    client_max_body_size 25m;
    add_header Content-Security-Policy "frame-ancestors 'self'" always;
}
```

**Apache**
```apache
RewriteEngine On
RewriteRule ^/ai/chat$ /ai/chat/ [R=308,L]
<Location /ai/chat/>
    ProxyPass        http://127.0.0.1:3080/ flushpackets=on
    ProxyPassReverse http://127.0.0.1:3080/
    RequestHeader set X-Forwarded-Proto "https"
    Header always set Content-Security-Policy "frame-ancestors 'self'"
</Location>
```

### 3. GitHub `test` Environment + secrets

Create a repository **Environment** named `test` and add:

| Secret | Purpose |
|---|---|
| `LIBRECHAT_TEST_ENV` | The full `.env` (see template below) |
| `SSH_HOST`, `SSH_USER`, `SSH_KEY` | The self-hosted test host (reuse Outerscore's) |

**Protection vs. automation:** the workflow **auto-deploys on every merge to `dev`**, so do
**not** enable *required reviewers* on this environment — that would pause every merge for
manual approval. Trust the auto path via **branch protection on `dev`** (PR review before
merge). To stop an arbitrary branch from being manually dispatched to read these secrets, set
the environment's **Deployment branches** policy to `dev` only — note that also limits manual
any-branch deploys to whitelisted branches (pick the trade-off you want).

> No registry secret is needed: the build job pushes to GHCR and the host pulls using
> the run's built-in `GITHUB_TOKEN` (workflow has `packages: write`). The package is
> created private and linked to this repo; if a pull ever 403s, confirm the package is
> linked to the repo under **Packages → Package settings**.
> The SSH key secret must be named `SSH_KEY` (some Outerscore repos use `SSH_key`).

### 4. `LIBRECHAT_TEST_ENV` template

Generate the secrets once, then paste the whole block into the `LIBRECHAT_TEST_ENV`
secret. `LIBRECHAT_IMAGE` is appended automatically by the deploy job — do not set it.

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "CREDS_KEY=$(openssl rand -hex 32)"     # 64 hex chars
echo "CREDS_IV=$(openssl rand -hex 16)"      # 32 hex chars
echo "MEILI_MASTER_KEY=$(openssl rand -hex 32)"
```

```dotenv
# --- subpath / URLs (same-origin with the Buyer app) ---
DOMAIN_CLIENT=https://test.outerscore.com/ai/chat
DOMAIN_SERVER=https://test.outerscore.com/ai/chat

# --- secrets (generated above) ---
JWT_SECRET=...
JWT_REFRESH_SECRET=...
CREDS_KEY=...
CREDS_IV=...
MEILI_MASTER_KEY=...

# --- LLM ---
ANTHROPIC_API_KEY=sk-ant-...

# --- Outerscore SSO bridge ---
OUTERSCORE_TOKEN_KEY_URL=https://test.outerscore.com/api/oauth/token_key   # confirm exact path with BE
OUTERSCORE_JWT_ISSUER=
OUTERSCORE_JWT_AUDIENCE=
```

> `HOST`, `PORT`, `NODE_ENV`, `MONGO_URI`, `MEILI_HOST`, `NO_INDEX`, `TRUST_PROXY`,
> `OUTERSCORE_SSO_ENABLED`, and the `ALLOW_*` toggles are pinned in
> `docker-compose.test.yml` and intentionally **not** in `.env`.
> Model selection (Claude only) lives in `librechat.test.yaml` (tracked; the local
> `librechat.yaml` is gitignored). It is mounted into the container as `/app/librechat.yaml`.

---

## Deploy

**Automatic:** every merge to **`dev`** builds and redeploys test (`dev` is the test line).

**Manual (any branch):** GitHub → Actions → **Deploy LibreChat to Test** → *Run workflow* →
pick a branch.

Either way the build pushes `ghcr.io/<owner>/librechat-test:<branch>-<sha>` (and `:test-latest`)
and the deploy job pulls it and restarts the stack.

> The workflow file must be on **`dev`** for the push trigger to fire, and on the **default
> branch** for the manual "Run workflow" button to appear. `docker-compose.test.yml` and
> `librechat.test.yaml` must exist on whatever branch is deployed.

### Standalone smoke test (SSO disabled path)

Registration/email login are off (SSO-only). To log in directly for a smoke test,
mint a user on the host:

```bash
cd /opt/librechat
docker compose -f docker-compose.test.yml exec api npm run create-user
```

---

## Verify

1. `curl -fsS https://test.outerscore.com/ai/chat/health` → `OK`
2. Open `https://test.outerscore.com/ai/chat/` — login renders; in DevTools Network,
   assets load from `/ai/chat/assets/...` and API calls hit `/ai/chat/api/...`
   (no bare `/api`, no 404s). Send a Claude message → it streams.
3. Embedded: open the Buyer test app → AI launcher → iframe loads `…/ai/chat/`,
   SSO auto-login (no second prompt), theme matches, a Claude turn streams.
4. Security: framing from a non-`test.outerscore.com` origin is blocked (CSP);
   the response carries `X-Robots-Tag: noindex`; Mongo/Meili are unreachable from
   outside the host.

---

## Security notes

- **Auto-deploy + secrets:** `dev` is the trusted test line — protect it with PR review.
  The `test` environment has no required reviewers (so merges deploy unattended); to stop an
  arbitrary branch from reading the secrets via manual dispatch, use the environment's
  **Deployment branches** policy (`dev` only).
- App is **SSO-only** (`ALLOW_REGISTRATION/EMAIL_LOGIN/SOCIAL_LOGIN=false`); remove any
  bootstrap admin after smoke testing.
- Datastores have **no published ports**; the api listens on `127.0.0.1` only.
- `.env` is written `chmod 600`; rotate `JWT_*`/`CREDS_*`/`MEILI_MASTER_KEY` on exposure.
  The host's GHCR credential is dropped (`docker logout`) at the end of each deploy.
- Back up the `mongo-data` volume (`mongodump`). Keep the GHCR package **private**.
- To add file-RAG later, switch to the canonical `docker-compose.yml` +
  `docker-compose.prod.yml` stack (adds `rag_api` + pgvector).
