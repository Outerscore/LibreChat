# Deploying the Outerscore LibreChat fork to TEST

This is the complete, step-by-step guide to running the AI chat (LibreChat fork) on the
**test** environment at **`https://test.outerscore.com/ai/chat`**.

> **Read this first — who does what.** The work happens in three different "places". You can do
> all the **GitHub (browser)** steps yourself; the two **test-server** steps need someone with
> SSH access to the box that runs `test.outerscore.com` (your devops / whoever set up test).
> Each step below is tagged with **WHERE** it runs. A copy-paste summary for the server person
> is in [§9](#9-hand-off-for-the-server-admin).
>
> For the branch model (which branch deploys where, and pulling LibreChat updates) see
> [`outerscore-branching.md`](./outerscore-branching.md); for how login/SSO works once deployed
> see [`outerscore-auth.md`](./outerscore-auth.md).

---

## 1. What gets deployed

LibreChat's frontend is built **into** its Node image, so the app is **one container** (Node +
web UI) plus two small data containers. Nothing here touches the existing Outerscore apps.

```
Browser ──HTTPS──> test.outerscore.com   (existing Apache/Nginx on the test box)
  ├─ /            → Angular Buyer SPA            [unchanged]
  ├─ /api/*       → Spring buyer-service         [unchanged]
  └─ /ai/chat/*   → 127.0.0.1:3080  (new proxy rule, strips /ai/chat)
                        │
                   ┌────┴───────────────┬──────────────────┐
                 api (Node + web UI)   mongodb            meilisearch
                 localhost-only        internal only       internal only
```

- **Image:** built in GitHub Actions, published to **GHCR** (`ghcr.io/<owner>/librechat-test`).
  No AWS is used for test.
- **Data:** MongoDB + Meilisearch run as containers with **named volumes** that survive redeploys.
- **URL:** served under the subpath `/ai/chat` on the existing domain (same-origin with the
  Buyer app), so it reuses the existing TLS certificate.
- **Seeded app content:** two Outerscore compliance agents auto-seed into MongoDB on first
  boot and are shared to every user; the upstream **Skills** feature ships in the image and
  is on by default. Both live in the database / the existing `mongo-data` + `uploads`
  volumes — there is **no `/app/skill` mount** here (unlike the upstream `docker-compose.yml`),
  and none is needed.

---

## 2. The three "places"

| Place | What happens there | Who |
|---|---|---|
| **GitHub** (website, in your browser) | add secrets, create the `test` environment, merge code | **You** |
| **Test server** (the Linux box behind `test.outerscore.com`) | one-time host prep + the `/ai/chat` proxy rule ([§4A](#4a-on-the-test-server)) | **Devops / server-admin** |
| **Automatic** (GitHub Actions) | building the image + deploying it to the server | **Nobody** — runs on merge to `dev` |

---

## 3. How a deploy is triggered

The workflow is `.github/workflows/deploy-test.yml`.

- **Automatic:** every merge to the **`dev`** branch builds and redeploys test. This is the normal path.
- **Manual:** GitHub → **Actions** → **Deploy LibreChat to Test** → **Run workflow** → pick any branch.

> For these to work, `deploy-test.yml` must be on the **default branch** (so the button appears)
> and on **`dev`** (so merges trigger it); `docker-compose.test.yml` and `librechat.test.yaml`
> must exist on whatever branch is deployed. (Done once you merge this branch into `dev`.)

---

## 4. One-time setup

Do these once. After that, deploys are automatic on merge to `dev`.

### 4A. On the test server
**WHERE: the test server (SSH) · WHO: devops/server-admin.** See [§9](#9-hand-off-for-the-server-admin)
for a self-contained version to hand off.

**(i) Create the deploy folder.** The deploy uploads files into `/opt/librechat` and writes the
`.env` there, so it must exist and be writable by the SSH user used for deploys:
```bash
sudo install -d -o "$USER" /opt/librechat
mkdir -p /opt/librechat/{images,uploads,logs}
# The container runs as uid/gid 1000 (the "node" user); make the bind-mounted dirs writable by it:
sudo chown -R 1000:1000 /opt/librechat/{images,uploads,logs}
```

**(ii) Prerequisites on the box:** `docker` + the `docker compose` plugin installed; the deploy
SSH user is in the `docker` group; TCP **3080 free on `127.0.0.1`** (the app binds to loopback
only; the reverse proxy reaches it there). No AWS CLI is needed.

**(iii) Add the `/ai/chat` reverse-proxy rule** to the existing `test.outerscore.com` server
config. The trailing slash on the upstream **strips** `/ai/chat`, so the app sees `/api/...`,
`/assets/...`, `/health`. The `Content-Security-Policy` line keeps the proxy as an **outer**
clickjacking guard — it allows the Buyer app to embed the chat in an iframe and blocks everyone
else. The app now **also** emits `Content-Security-Policy: frame-ancestors 'self'` itself (driven
by `OUTERSCORE_FRAME_ANCESTORS`, pinned in `docker-compose.test.yml`), so protection survives even
if this proxy line is missing. Keep both; if you ever change the value, change it in both places so
the two policies agree (the browser enforces the intersection of all CSP headers it receives).

If the box uses **nginx**:
```nginx
location = /ai/chat { return 308 /ai/chat/; }
location /ai/chat/ {
    proxy_pass http://127.0.0.1:3080/;          # trailing "/" strips /ai/chat
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";             # keep streaming (SSE) responses open
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    client_max_body_size 25m;
    add_header Content-Security-Policy "frame-ancestors 'self'" always;
}
```

If the box uses **Apache**:
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
Reload the web server after editing (`sudo nginx -t && sudo systemctl reload nginx`, or
`sudo apachectl configtest && sudo systemctl reload apache2`).

### 4B. The GitHub `test` environment + secrets
**WHERE: github.com (repo Settings) · WHO: you.**

Repo → **Settings → Environments → New environment** → name it **`test`**. Add these secrets
(**Add secret**):

| Secret | What it is |
|---|---|
| `LIBRECHAT_TEST_ENV` | the full `.env` contents (built in [§4C](#4c-the-env-secret-value)) |
| `SSH_HOST` | the test server's address |
| `SSH_USER` | the deploy username on that server |
| `SSH_KEY` | the deploy SSH **private** key |

(The `SSH_*` values are the same ones Outerscore already uses for its dev/staging deploys — ask
your devops person. No registry secret is needed: the image push/pull uses GitHub's built-in
token.)

**Important — do NOT enable "Required reviewers" on this environment.** That would pause every
merge to `dev` for manual approval and defeat auto-deploy. Instead protect the auto path by
enabling **branch protection / required PR review on `dev`** (repo → Settings → Branches). If you
also want to stop someone manually deploying an arbitrary branch and reading these secrets, set
the environment's **Deployment branches** policy to `dev` only (note: that also limits manual
deploys to `dev`).

### 4C. The `.env` secret value
**WHERE: your machine (terminal) and the browser · WHO: you.**

First generate fresh random secrets — **do not reuse** the values from the repo's example `.env`,
they're publicly known:
```bash
for k in JWT_SECRET JWT_REFRESH_SECRET CREDS_KEY MEILI_MASTER_KEY; do
  echo "$k=$(openssl rand -hex 32)"
done
echo "CREDS_IV=$(openssl rand -hex 16)"
```
> No `openssl`? On any machine with Node: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (use 16 bytes for `CREDS_IV`).

Then paste this whole block as the value of the `LIBRECHAT_TEST_ENV` secret, filling in the
generated values, your Claude key, and the token-key URL from [§4D](#4d-confirm-with-the-backend-team):
```dotenv
DOMAIN_CLIENT=https://test.outerscore.com/ai/chat
DOMAIN_SERVER=https://test.outerscore.com/ai/chat

JWT_SECRET=<generated>
JWT_REFRESH_SECRET=<generated>
CREDS_KEY=<generated 64 hex>
CREDS_IV=<generated 32 hex>
MEILI_MASTER_KEY=<generated>

ANTHROPIC_API_KEY=sk-ant-...

OUTERSCORE_TOKEN_KEY_URL=https://test.outerscore.com/api/oauth/token_key
OUTERSCORE_JWT_ISSUER=
OUTERSCORE_JWT_AUDIENCE=
OUTERSCORE_JWT_ENFORCE_CLAIMS=false

# Optional — leave blank. The two compliance agents auto-seed and are shared to every
# user regardless of these. Set them only to override the seeded model (default
# claude-sonnet-4-6) or to grant one user edit rights on the rules in the agent builder.
OUTERSCORE_COMPLIANCE_MODEL=
OUTERSCORE_COMPLIANCE_OWNER_EMAIL=
```

Notes:
- **`OUTERSCORE_JWT_ISSUER` / `OUTERSCORE_JWT_AUDIENCE` are recommended.** When set, the bridge
  verifies those claims so a token minted for another service signed with the same key can't be
  reused here. To make them **mandatory** (reject a login whose token lacks them, fail-closed),
  also set `OUTERSCORE_JWT_ENFORCE_CLAIMS=true`. Left as above the bridge accepts on signature
  alone and logs a one-time warning — fine for first bring-up; set the values + flag once the
  backend team confirms them (§4D). This is **not** tied to `NODE_ENV`.
- Everything else (`HOST`, `PORT`, `MONGO_URI`, `MEILI_HOST`, `NO_INDEX`, `TRUST_PROXY`,
  registration toggles, `OUTERSCORE_SSO_ENABLED`) is already fixed in `docker-compose.test.yml`.
- **`CREDS_KEY`/`CREDS_IV`: generate once and never change them** — rotating makes anything already
  encrypted in the database unreadable.
- The selectable Claude models live in `librechat.test.yaml` (committed), not in this file.
- **Compliance agents auto-seed.** On every startup the two Outerscore compliance agents are
  created (if absent — a live builder edit is never overwritten) and shared PUBLIC, so they
  appear in every user's agent picker with nothing to configure. The two `OUTERSCORE_COMPLIANCE_*`
  vars above are optional overrides; the default model (`claude-sonnet-4-6`) is already in the
  `librechat.test.yaml` model list.

### 4D. Confirm with the backend team
**WHO: you → backend team.** Confirm the exact Spring **`/oauth/token_key`** URL (the public key
endpoint LibreChat uses to verify Outerscore login tokens) and put it in `OUTERSCORE_TOKEN_KEY_URL`.

---

## 5. Deploy

Once [§4](#4-one-time-setup) is done:

- **Normal:** merge your changes into **`dev`** → the deploy runs automatically.
- **Manual:** GitHub → Actions → **Deploy LibreChat to Test** → **Run workflow** → choose a branch.

You can watch progress under the **Actions** tab. It builds the image, pushes it to GHCR, then
restarts the stack on the server.

---

## 6. Verify it worked

1. **Health check** (from anywhere):
   ```bash
   curl -fsS https://test.outerscore.com/ai/chat/health      # should print: OK
   ```
2. **Open** `https://test.outerscore.com/ai/chat/` in a browser — the login screen should render
   and assets should load from `/ai/chat/...` (no 404s in the browser's Network tab).
3. **Log in (standalone test).** Public registration is off, so create a user on the server:
   ```bash
   cd /opt/librechat
   docker compose -f docker-compose.test.yml exec api npm run create-user
   ```
   Then sign in and send a message — a Claude reply should stream back. The agent picker
   should also list the two auto-seeded **compliance agents** (shared to every user).
4. **Embedded** (once the Buyer-app AI integration is shipped — see [caveat](#caveats)): open the
   Buyer test app, open the assistant, and confirm it signs you in with no second login.

---

## 7. Day-2 operations (on the server)

```bash
cd /opt/librechat
docker compose -f docker-compose.test.yml ps          # status
docker compose -f docker-compose.test.yml logs -f api  # live logs
docker compose -f docker-compose.test.yml restart api  # restart just the app
```
- **Roll back:** re-run the workflow (manual dispatch) against a previous known-good branch/commit,
  or on the server set `LIBRECHAT_IMAGE` in `/opt/librechat/.env` to an earlier
  `ghcr.io/<owner>/librechat-test:<tag>` and run `docker compose -f docker-compose.test.yml up -d`.
- **Back up data:** `docker compose -f docker-compose.test.yml exec mongodb mongodump --archive` (the
  `mongo-data` / `meili-data` named volumes hold all state).

---

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Workflow doesn't appear under Actions | `deploy-test.yml` isn't on the **default branch** yet |
| Merge to `dev` didn't deploy | `deploy-test.yml` isn't on **`dev`**, or the run is paused waiting on a **Required reviewer** (remove it) |
| Deploy fails at the SSH step | `SSH_HOST/USER/KEY` wrong, or `/opt/librechat` missing/not writable |
| `curl …/ai/chat/health` not `OK` | container not running (`docker compose ... logs api`) or the proxy rule (§4A iii) not added/reloaded |
| Page loads but assets 404 / calls hit bare `/api` | proxy rule missing the trailing-slash strip, or `DOMAIN_CLIENT` not set to the `/ai/chat` URL |
| Chat won't embed in the Buyer app | the `Content-Security-Policy: frame-ancestors 'self'` header (§4A iii) is missing |
| Login via Outerscore fails | see the troubleshooting table in [`outerscore-auth.md`](./outerscore-auth.md) (token-key URL, 401/400/500 causes) |

---

## 9. Hand-off for the server admin

Paste this to whoever manages `test.outerscore.com`. It's the only part that needs server access.

> **Please help set up the AI chat (a Docker stack) on the test server. Two one-time things:**
>
> **1) Create its working folder** (the CI deploy uploads files + writes its `.env` here; it must
> be writable by the SSH user our GitHub Actions uses):
> ```bash
> sudo install -d -o <deploy-ssh-user> /opt/librechat
> mkdir -p /opt/librechat/{images,uploads,logs}
> sudo chown -R 1000:1000 /opt/librechat/{images,uploads,logs}
> ```
> Also confirm: docker + docker compose are installed, the deploy SSH user is in the `docker`
> group, and port **3080 on 127.0.0.1** is free.
>
> **2) Add a reverse-proxy rule** so `https://test.outerscore.com/ai/chat/` proxies to the
> container on `127.0.0.1:3080` (it strips the `/ai/chat` prefix), and sends a CSP header so the
> Buyer app can iframe it. Use the nginx or Apache block from §4A(iii) of this doc, then reload
> the web server.
>
> That's it — the app itself is deployed automatically by GitHub Actions; you don't need to pull
> images or run the app by hand.

---

## 10. Reference

**Files (in this repo):**

| File | Purpose |
|---|---|
| `.github/workflows/deploy-test.yml` | the deploy pipeline (auto on `dev` + manual) |
| `docker-compose.test.yml` | the stack: api + mongodb + meilisearch |
| `librechat.test.yaml` | Claude-only model config (mounted as `/app/librechat.yaml`) |
| `docs/outerscore-auth.md` | how Outerscore SSO / login works |

**Runtime variables** (everything not in `LIBRECHAT_TEST_ENV` is pinned in `docker-compose.test.yml`):

| Variable | Set in | Meaning |
|---|---|---|
| `DOMAIN_CLIENT` / `DOMAIN_SERVER` | secret | the public `/ai/chat` URL (drives the subpath) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | secret | sign LibreChat's own login session |
| `CREDS_KEY` / `CREDS_IV` | secret | encrypt stored credentials (set once, never change) |
| `MEILI_MASTER_KEY` | secret | search service auth |
| `ANTHROPIC_API_KEY` | secret | Claude API key |
| `OUTERSCORE_TOKEN_KEY_URL` | secret | verifies Outerscore login tokens |
| `OUTERSCORE_COMPLIANCE_MODEL` / `…_OWNER_EMAIL` | secret (optional) | override the seeded compliance-agent model / grant one user edit rights |
| `OUTERSCORE_FRAME_ANCESTORS` | compose | app-level CSP `frame-ancestors` (clickjacking guard; `'self'` for the same-origin embed) |
| `OUTERSCORE_SSO_ENABLED`, `NO_INDEX`, `TRUST_PROXY`, `ALLOW_*` | compose | fixed test-env settings |

**Caveats**
- **Standalone vs embedded:** this guide makes the chat live and testable on its own at the URL.
  Embedding it *inside the Buyer app* additionally needs the frontend AI integration (the iframe
  host component), which is a separate track.
- **Secrets location:** this setup keeps the `.env` as a GitHub `test`-environment secret. If you
  prefer secrets to live only on the server (never in GitHub), that's a small workflow change —
  ask the maintainer.
- **Build-time origin guard.** The image build **fails closed** if the parent origin isn't baked
  in: CI passes `--build-arg REQUIRE_OUTERSCORE_PARENT_ORIGIN=true`, so an empty
  `VITE_OUTERSCORE_PARENT_ORIGIN` aborts the build instead of shipping a bundle whose `postMessage`
  bridge falls back to `'*'` (which would broadcast canvas/compliance content to any embedder and
  trust any origin's SSO token). The test workflow sets the origin to `https://test.outerscore.com`;
  emptying that line now breaks the build rather than silently shipping unsafe.
