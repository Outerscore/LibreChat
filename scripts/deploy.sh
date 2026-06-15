#!/usr/bin/env bash
# Canonical LibreChat (Outerscore fork) build + deploy.
#
# What it does:
#   1. Validates required env vars are present.
#   2. Builds the Docker image, passing build-time Vite vars as --build-arg.
#      (These are inlined into the client bundle by Vite and cannot be changed
#      at runtime — a rebuild is needed to change them.)
#   3. Starts the stack via `docker compose` using docker-compose.yml +
#      docker-compose.prod.yml, which reads runtime vars from the environment.
#
# Intended use:
#   - CI/CD: export secrets from the CI's secret store into env vars, then run.
#   - Manual prod deploy: `source your-secrets.env && ./scripts/deploy.sh`.
#
# Required env vars:
#   Build-time (inlined into client):
#     VITE_OUTERSCORE_PARENT_ORIGIN   Origin allowed to postMessage us
#
#   Runtime backend:
#     DOMAIN_CLIENT, DOMAIN_SERVER
#     MONGO_URI                       Full Mongo connection string
#     MEILI_MASTER_KEY
#     JWT_SECRET, JWT_REFRESH_SECRET  256-bit hex values
#     CREDS_KEY, CREDS_IV             Encryption key/IV for stored creds
#     OUTERSCORE_SSO_ENABLED          true to enable the SSO bridge
#     OUTERSCORE_TOKEN_KEY_URL        Spring /oauth/token_key endpoint
#
#   Optional runtime:
#     OUTERSCORE_JWT_ISSUER, OUTERSCORE_JWT_AUDIENCE
#     OUTERSCORE_JWT_ENFORCE_CLAIMS   true to reject logins missing iss/aud (fail-closed)
#     OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_KEY
#     LIBRECHAT_IMAGE                 Image tag (default: librechat:latest)
#     ENVIRONMENT                     Label for logs (dev/staging/prod)

set -euo pipefail

REQUIRED=(
  VITE_OUTERSCORE_PARENT_ORIGIN
  DOMAIN_CLIENT
  DOMAIN_SERVER
  MONGO_URI
  MEILI_MASTER_KEY
  JWT_SECRET
  JWT_REFRESH_SECRET
  CREDS_KEY
  CREDS_IV
  OUTERSCORE_SSO_ENABLED
  OUTERSCORE_TOKEN_KEY_URL
)

missing=()
for var in "${REQUIRED[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "❌ Missing required env vars: ${missing[*]}" >&2
  echo "   Set them in your CI secret store (or source a local secrets file) before running this script." >&2
  exit 1
fi

ENVIRONMENT="${ENVIRONMENT:-prod}"
IMAGE="${LIBRECHAT_IMAGE:-librechat:${ENVIRONMENT}}"
export LIBRECHAT_IMAGE="$IMAGE"

echo "🔨 Building ${IMAGE}"
echo "   VITE_OUTERSCORE_PARENT_ORIGIN=${VITE_OUTERSCORE_PARENT_ORIGIN}"
docker build \
  --build-arg VITE_OUTERSCORE_PARENT_ORIGIN="$VITE_OUTERSCORE_PARENT_ORIGIN" \
  -t "$IMAGE" \
  .

echo "🚀 Deploying (${ENVIRONMENT})"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d

echo "✅ Done. Tail logs with: docker compose logs -f api"
