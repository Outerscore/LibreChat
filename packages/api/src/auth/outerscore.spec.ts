import crypto from 'crypto';
import jwt from 'jsonwebtoken';

jest.mock(
  '@librechat/data-schemas',
  () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  }),
  { virtual: true },
);

import { logger } from '@librechat/data-schemas';
import {
  verifyOuterscoreToken,
  extractOuterscoreUser,
  resetOuterscorePublicKeyCache,
} from './outerscore';

const TOKEN_KEY_URL = 'https://auth.example.com/oauth/token_key';

const generateKeyPair = () =>
  crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const { publicKey, privateKey } = generateKeyPair();

const basePayload = {
  user: {
    id: 'os-user-1',
    email: 'buyer@example.com',
    firstName: 'Bea',
    lastName: 'Buyer',
  },
};

const sign = (payload: object, key: string = privateKey, options: jwt.SignOptions = {}) =>
  jwt.sign(payload, key, { algorithm: 'RS256', expiresIn: '5m', ...options });

/** Stub only the external token_key HTTP call — everything else runs real crypto. */
const mockTokenKey = (pem: string = publicKey) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ alg: 'SHA256withRSA', value: pem }),
  }) as unknown as typeof fetch;
};

describe('verifyOuterscoreToken', () => {
  beforeEach(() => {
    resetOuterscorePublicKeyCache();
    jest.restoreAllMocks();
  });

  it('verifies a token signed by the matching private key', async () => {
    mockTokenKey();
    const token = sign(basePayload);
    const payload = await verifyOuterscoreToken(token, { tokenKeyUrl: TOKEN_KEY_URL });
    expect(payload.user.id).toBe('os-user-1');
    expect(payload.user.email).toBe('buyer@example.com');
  });

  it('rejects a token signed by a different key (invalid signature)', async () => {
    mockTokenKey();
    const { privateKey: otherKey } = generateKeyPair();
    const token = sign(basePayload, otherKey);
    // The forged token triggers a single key-refresh retry, then still fails.
    await expect(verifyOuterscoreToken(token, { tokenKeyUrl: TOKEN_KEY_URL })).rejects.toThrow(
      /invalid signature/,
    );
  });

  it('rejects an expired token', async () => {
    mockTokenKey();
    const token = sign(basePayload, privateKey, { expiresIn: '-10s' });
    await expect(verifyOuterscoreToken(token, { tokenKeyUrl: TOKEN_KEY_URL })).rejects.toThrow(
      jwt.TokenExpiredError,
    );
  });

  it('enforces the issuer claim when provided', async () => {
    mockTokenKey();
    const token = sign({ ...basePayload, iss: 'wrong-issuer' });
    await expect(
      verifyOuterscoreToken(token, { tokenKeyUrl: TOKEN_KEY_URL, issuer: 'outerscore' }),
    ).rejects.toThrow(/jwt issuer invalid/);
  });

  it('enforces the audience claim when provided', async () => {
    mockTokenKey();
    const token = sign({ ...basePayload, aud: 'other-service' });
    await expect(
      verifyOuterscoreToken(token, { tokenKeyUrl: TOKEN_KEY_URL, audience: 'librechat' }),
    ).rejects.toThrow(/jwt audience invalid/);
  });

  it('accepts a token whose issuer and audience match', async () => {
    mockTokenKey();
    const token = sign({ ...basePayload, iss: 'outerscore', aud: 'librechat' });
    const payload = await verifyOuterscoreToken(token, {
      tokenKeyUrl: TOKEN_KEY_URL,
      issuer: 'outerscore',
      audience: 'librechat',
    });
    expect(payload.user.id).toBe('os-user-1');
  });

  it('warns but still verifies when requireIssuerAudience is set without issuer/audience', async () => {
    mockTokenKey();
    const token = sign(basePayload);
    const payload = await verifyOuterscoreToken(token, {
      tokenKeyUrl: TOKEN_KEY_URL,
      requireIssuerAudience: true,
    });
    expect(payload.user.id).toBe('os-user-1');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('OUTERSCORE_JWT_ISSUER'));
  });

  it('refreshes the public key once and succeeds after a key rotation', async () => {
    const { publicKey: stalePublic } = generateKeyPair();
    // First fetch returns a stale key (signature fails), refresh returns the real one.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: stalePublic }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: publicKey }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = sign(basePayload);
    const payload = await verifyOuterscoreToken(token, { tokenKeyUrl: TOKEN_KEY_URL });
    expect(payload.user.id).toBe('os-user-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('extractOuterscoreUser', () => {
  it('returns the user claim when id and email are present', () => {
    const claim = extractOuterscoreUser({ exp: 0, user: basePayload.user });
    expect(claim).toEqual({
      id: 'os-user-1',
      email: 'buyer@example.com',
      firstName: 'Bea',
      lastName: 'Buyer',
      avatar: undefined,
    });
  });

  it('throws when the user claim is missing', () => {
    expect(() =>
      extractOuterscoreUser({ exp: 0 } as unknown as Parameters<typeof extractOuterscoreUser>[0]),
    ).toThrow(/missing "user" claim/);
  });

  it('throws when id or email is missing', () => {
    expect(() =>
      extractOuterscoreUser({
        exp: 0,
        user: { id: '', email: 'x@example.com' },
      } as unknown as Parameters<typeof extractOuterscoreUser>[0]),
    ).toThrow(/missing id or email/);
  });
});
