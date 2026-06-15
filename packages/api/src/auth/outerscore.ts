import jwt from 'jsonwebtoken';
import { logger } from '@librechat/data-schemas';

export interface OuterscoreUserClaim {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatar?: string | null;
}

export interface OuterscoreTokenPayload {
  user_name?: string;
  client_id?: string;
  exp: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  scope?: string[];
  user: OuterscoreUserClaim;
  [claim: string]: unknown;
}

export interface OuterscoreVerifyOptions {
  tokenKeyUrl: string;
  issuer?: string;
  audience?: string;
  /**
   * When true, `issuer` and `audience` are mandatory — verification throws if
   * either is missing (rejecting tokens minted for a different service with the
   * same signing key). The bridge wires this to the explicit, opt-in env flag
   * `OUTERSCORE_JWT_ENFORCE_CLAIMS` — deliberately NOT to `NODE_ENV`, since
   * `npm run backend` runs `NODE_ENV=production` for local/demo too. When false
   * (default), a missing claim is accepted on signature alone with a one-time
   * warning rather than a hard failure.
   */
  requireIssuerAudience?: boolean;
}

interface CachedKey {
  url: string;
  pem: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const TOKEN_KEY_FETCH_TIMEOUT_MS = 5000;
let cachedKey: CachedKey | null = null;
/** Process-lifetime guard so the "no iss/aud" gap warns once, not per request. */
let warnedMissingClaims = false;

interface TokenKeyResponse {
  alg?: string;
  value?: string;
}

async function fetchTokenKey(url: string): Promise<string> {
  // Bound the fetch — a hung token_key endpoint would otherwise stall every
  // bridge request waiting on a cache miss.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_KEY_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(
      `[outerscore] token_key fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as TokenKeyResponse;
  if (!body.value || !body.value.includes('BEGIN PUBLIC KEY')) {
    throw new Error('[outerscore] token_key response missing a PEM "value" field');
  }
  return body.value;
}

export async function getOuterscorePublicKey(tokenKeyUrl: string): Promise<string> {
  const now = Date.now();
  // Key the cache by URL too: a changed `tokenKeyUrl` must never return a key
  // that was fetched from the previous endpoint.
  if (cachedKey && cachedKey.url === tokenKeyUrl && now - cachedKey.fetchedAt < CACHE_TTL_MS) {
    return cachedKey.pem;
  }
  const pem = await fetchTokenKey(tokenKeyUrl);
  cachedKey = { url: tokenKeyUrl, pem, fetchedAt: now };
  return pem;
}

export function resetOuterscorePublicKeyCache(): void {
  cachedKey = null;
}

export async function verifyOuterscoreToken(
  token: string,
  options: OuterscoreVerifyOptions | string,
): Promise<OuterscoreTokenPayload> {
  const opts: OuterscoreVerifyOptions =
    typeof options === 'string' ? { tokenKeyUrl: options } : options;

  // The signed iss/aud are the trust anchor (accounts are keyed on user.id
  // alone). When the caller opts into enforcement, a missing issuer/audience is
  // a hard failure — refuse to verify on signature alone, otherwise any token
  // minted by the same signing key for a different service/audience would bridge
  // to a LibreChat account. When NOT enforcing, accept on signature alone (so a
  // demo / interim shared-key deployment keeps working) but warn once so the gap
  // is visible. Either way, configure both claims and set the enforce flag.
  if (!opts.issuer || !opts.audience) {
    if (opts.requireIssuerAudience) {
      logger.error(
        '[outerscore] OUTERSCORE_JWT_ISSUER / OUTERSCORE_JWT_AUDIENCE are not set while ' +
          'OUTERSCORE_JWT_ENFORCE_CLAIMS is on — rejecting the login instead of accepting on signature alone.',
      );
      throw new Error(
        '[outerscore] OUTERSCORE_JWT_ISSUER and OUTERSCORE_JWT_AUDIENCE must both be set when ' +
          'OUTERSCORE_JWT_ENFORCE_CLAIMS=true. Refusing to verify on signature alone.',
      );
    }
    if (!warnedMissingClaims) {
      warnedMissingClaims = true;
      logger.warn(
        '[outerscore] OUTERSCORE_JWT_ISSUER / OUTERSCORE_JWT_AUDIENCE are not set — tokens are ' +
          'accepted on signature alone. Set both and OUTERSCORE_JWT_ENFORCE_CLAIMS=true to reject ' +
          'tokens minted for other services with the same signing key.',
      );
    }
  }

  const verifyOptions: jwt.VerifyOptions = { algorithms: ['RS256'] };
  if (opts.issuer) {
    verifyOptions.issuer = opts.issuer;
  }
  if (opts.audience) {
    verifyOptions.audience = opts.audience;
  }

  let pem = await getOuterscorePublicKey(opts.tokenKeyUrl);

  try {
    return jwt.verify(token, pem, verifyOptions) as OuterscoreTokenPayload;
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError && err.message.includes('invalid signature')) {
      logger.warn('[outerscore] invalid signature — refreshing token_key and retrying');
      resetOuterscorePublicKeyCache();
      pem = await getOuterscorePublicKey(opts.tokenKeyUrl);
      return jwt.verify(token, pem, verifyOptions) as OuterscoreTokenPayload;
    }
    throw err;
  }
}

export function extractOuterscoreUser(payload: OuterscoreTokenPayload): OuterscoreUserClaim {
  if (!payload.user || typeof payload.user !== 'object') {
    throw new Error('[outerscore] token payload is missing "user" claim');
  }
  const { id, email, firstName, lastName, avatar } = payload.user;
  if (!id || !email) {
    throw new Error('[outerscore] token "user" claim is missing id or email');
  }
  return { id, email, firstName, lastName, avatar };
}
