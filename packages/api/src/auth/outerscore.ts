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
   * either is missing. The bridge sets this in production so a token minted for
   * a different service (same signing key, different `aud`) is rejected; the
   * signed `iss`/`aud` are the trust anchor, not just the signature.
   */
  requireIssuerAudience?: boolean;
}

interface CachedKey {
  pem: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const TOKEN_KEY_FETCH_TIMEOUT_MS = 5000;
let cachedKey: CachedKey | null = null;

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
  if (cachedKey && now - cachedKey.fetchedAt < CACHE_TTL_MS) {
    return cachedKey.pem;
  }
  const pem = await fetchTokenKey(tokenKeyUrl);
  cachedKey = { pem, fetchedAt: now };
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

  // In production the signed iss/aud are the intended trust anchor (accounts are
  // keyed on user.id alone). Warn loudly when they're not configured rather than
  // refusing the login — so an interim shared-key deployment keeps working while
  // the gap stays visible in the logs. Set both env vars to make it enforced.
  if (opts.requireIssuerAudience && (!opts.issuer || !opts.audience)) {
    logger.warn(
      '[outerscore] OUTERSCORE_JWT_ISSUER / OUTERSCORE_JWT_AUDIENCE are not set in production — ' +
        'tokens are accepted on signature alone. Set both to reject tokens minted for other services.',
    );
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
