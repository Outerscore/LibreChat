/**
 * Outerscore embed hardening — defense-in-depth clickjacking guard. When
 * `OUTERSCORE_FRAME_ANCESTORS` is set, the app emits a
 * `Content-Security-Policy: frame-ancestors <sources>` header itself, not only the
 * reverse proxy, so a hostile site still cannot iframe the chat even if the proxy
 * rule is ever missing. The value is a literal CSP `frame-ancestors` source list:
 * `'self'` for the same-origin embed (the chat is served under /ai/chat on the
 * parent app's origin), or a space-separated list of parent origins when the host
 * app lives on a different origin. Unset = no header (upstream behavior unchanged).
 *
 * Only `frame-ancestors` is set, so this imposes no other CSP restrictions
 * (scripts/styles/connect are unaffected). Mirrors the env-gated `noIndex`.
 */
const KEYWORD_SOURCES = new Set(['self', 'none']);

/** A lone CSP keyword is invalid unquoted (`self` must be `'self'`); quote it so a
 *  `=self` style misconfig still produces an enforced directive, not a silently
 *  ignored one. Multi-token lists (origins) are the operator's to format. */
const normalizeSources = (raw) => (KEYWORD_SOURCES.has(raw) ? `'${raw}'` : raw);

const frameAncestors = (req, res, next) => {
  const raw = process.env.OUTERSCORE_FRAME_ANCESTORS?.trim();

  if (raw) {
    res.setHeader('Content-Security-Policy', `frame-ancestors ${normalizeSources(raw)}`);
  }

  next();
};

module.exports = frameAncestors;
