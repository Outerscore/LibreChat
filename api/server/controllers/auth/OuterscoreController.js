const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { verifyOuterscoreToken, extractOuterscoreUser } = require('@librechat/api');
const { findUser, createUser, updateUser } = require('~/models');
const { setAuthTokens } = require('~/server/services/AuthService');
const { getAppConfig } = require('~/server/services/Config');

const isSsoEnabled = () => process.env.OUTERSCORE_SSO_ENABLED === 'true';

const outerscoreBridgeController = async (req, res) => {
  if (!isSsoEnabled()) {
    return res.status(404).json({ message: 'Outerscore SSO is not enabled' });
  }

  const tokenKeyUrl = process.env.OUTERSCORE_TOKEN_KEY_URL;
  if (!tokenKeyUrl) {
    logger.error('[outerscore] OUTERSCORE_TOKEN_KEY_URL is not configured');
    return res.status(500).json({ message: 'SSO misconfigured' });
  }

  const token = req.body?.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ message: 'token is required' });
  }

  let payload;
  try {
    payload = await verifyOuterscoreToken(token, {
      tokenKeyUrl,
      issuer: process.env.OUTERSCORE_JWT_ISSUER || undefined,
      audience: process.env.OUTERSCORE_JWT_AUDIENCE || undefined,
    });
  } catch (err) {
    logger.warn('[outerscore] token verification failed:', {
      name: err?.name,
      message: err?.message || '(empty)',
      code: err?.code,
      cause: err?.cause?.message || err?.cause,
      stack: err?.stack?.split('\n').slice(0, 4).join('\n'),
    });
    return res.status(401).json({ message: 'Invalid Outerscore token' });
  }

  let claim;
  try {
    claim = extractOuterscoreUser(payload);
  } catch (err) {
    logger.warn('[outerscore] payload missing expected claims:', err.message);
    return res.status(400).json({ message: 'Outerscore token missing required claims' });
  }

  try {
    const email = claim.email.toLowerCase();
    // The signed token's user id is the ONLY account key. There is deliberately
    // no email-based fallback: an email is an attacker-influenceable value, and
    // looking accounts up by it allowed a token for identity A to capture (and
    // re-bind) an existing account owned by identity B. If a legacy account
    // already holds this email, createUser below fails on the unique index —
    // a loud, safe collision an admin resolves manually, never an auto-merge.
    let user = await findUser({ outerscoreId: claim.id });

    if (user) {
      const patch = {};
      const expectedName = [claim.firstName, claim.lastName].filter(Boolean).join(' ').trim();
      if (expectedName && user.name !== expectedName) {
        patch.name = expectedName;
      }
      if (!user.emailVerified) {
        patch.emailVerified = true;
      }
      if (Object.keys(patch).length > 0) {
        await updateUser(user._id, patch);
      }
    } else {
      const appConfig = await getAppConfig({ baseOnly: true });
      const name = [claim.firstName, claim.lastName].filter(Boolean).join(' ').trim() || email;
      user = await createUser(
        {
          email,
          username: email,
          name,
          avatar: claim.avatar ?? null,
          provider: 'outerscore',
          outerscoreId: claim.id,
          role: SystemRoles.USER,
          emailVerified: true,
        },
        appConfig?.balance,
        true,
        true,
      );
    }

    const sessionToken = await setAuthTokens(user._id, res);
    const { password: _p, totpSecret: _t, __v, ...safeUser } = user.toObject
      ? user.toObject()
      : user;
    safeUser.id = safeUser._id.toString();

    return res.status(200).json({ token: sessionToken, user: safeUser });
  } catch (err) {
    logger.error('[outerscore] bridge error:', err);
    return res.status(500).json({ message: 'Outerscore SSO failed' });
  }
};

module.exports = {
  outerscoreBridgeController,
  isSsoEnabled,
};
