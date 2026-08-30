'use strict';

const crypto = require('crypto');

class ChallengeCryptoError extends Error { constructor(message) { super(message); this.name = 'ChallengeCryptoError'; } }
function assertCryptoConfigured(env = process.env) {
  const secret = env && env.STRAVA_CHALLENGE_CRYPTO_SECRET;
  if (!secret || String(secret).length < 24) throw new ChallengeCryptoError('STRAVA_CHALLENGE_CRYPTO_SECRET is required to store Strava credentials.');
}
function keyFromEnv(env) {
  assertCryptoConfigured(env);
  const secret = env && env.STRAVA_CHALLENGE_CRYPTO_SECRET;
  return crypto.createHash('sha256').update(String(secret)).digest();
}
function encrypt(value, aad, env = process.env) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', keyFromEnv(env), iv);
  cipher.setAAD(Buffer.from(String(aad)));
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}
function decrypt(payload, aad, env = process.env) {
  try {
    if (!payload || payload.v !== 1 || !payload.iv || !payload.tag || !payload.data) throw new Error('Malformed encrypted value');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromEnv(env), Buffer.from(payload.iv, 'base64url'));
    decipher.setAAD(Buffer.from(String(aad))); decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) { throw new ChallengeCryptoError(error instanceof ChallengeCryptoError ? error.message : 'Unable to decrypt Strava credentials.'); }
}
function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
function tokenHash(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function equalHash(token, hash) { const actual = Buffer.from(tokenHash(token), 'hex'); const expected = /^[a-f0-9]{64}$/i.test(String(hash || '')) ? Buffer.from(hash, 'hex') : Buffer.alloc(32); return crypto.timingSafeEqual(actual, expected); }
module.exports = { ChallengeCryptoError, assertCryptoConfigured, encrypt, decrypt, randomToken, tokenHash, equalHash };
