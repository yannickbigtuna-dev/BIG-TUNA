'use strict';

// Deployment-only APNs transport.  Keep credential parsing and provider errors
// here so the challenge API never logs or returns raw device tokens/details.
const crypto = require('crypto');
const http2 = require('http2');

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }

function configured(env = process.env) {
  return Boolean(text(env.APNS_TEAM_ID) && text(env.APNS_KEY_ID) && text(env.APNS_BUNDLE_ID) && text(env.APNS_AUTH_KEY_BASE64));
}

function authKey(env) {
  const encoded = text(env.APNS_AUTH_KEY_BASE64);
  if (!encoded) return null;
  try { return Buffer.from(encoded, 'base64').toString('utf8'); } catch { return null; }
}

function createJwt(env, now = () => Date.now()) {
  const key = authKey(env);
  if (!key) throw new Error('APNs credentials are unavailable.');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: text(env.APNS_KEY_ID) }));
  const claims = b64url(JSON.stringify({ iss: text(env.APNS_TEAM_ID), iat: Math.floor(now() / 1000) }));
  const unsigned = `${header}.${claims}`;
  // P1363 is the fixed-width JOSE representation required by ES256 JWTs.
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}

function createDeviceTokenCipher({ env = process.env } = {}) {
  const secret = text(env.CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET);
  const key = secret.length >= 24 ? crypto.createHash('sha256').update(secret).digest() : null;
  function requireKey() { if (!key) throw new Error('CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET is required for iOS device registration.'); }
  return {
    configured: Boolean(key),
    encrypt(token) {
      requireKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
      return Buffer.from(JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') })).toString('base64');
    },
    decrypt(record) {
      requireKey();
      let parsed;
      try { parsed = JSON.parse(Buffer.from(String(record || ''), 'base64').toString('utf8')); } catch { throw new Error('Stored device token is unavailable.'); }
      if (!parsed || parsed.v !== 1 || !text(parsed.iv) || !text(parsed.tag) || !text(parsed.data)) throw new Error('Stored device token is unavailable.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}

function createChallengeApns({ env = process.env, logger = console, now } = {}) {
  const enabled = configured(env);
  const host = text(env.APNS_ENVIRONMENT).toLowerCase() === 'sandbox'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';
  function safeWarn(message) { if (logger && typeof logger.warn === 'function') logger.warn(`[challenge apns] ${message}`); }
  async function send({ token, eventType, challengeId, reviewId, title, body }) {
    if (!enabled) return { delivery: 'failed', reason: 'unavailable' };
    if (!/^[0-9a-f]{64,200}$/i.test(String(token || ''))) return { delivery: 'failed', reason: 'invalid_token' };
    const payload = JSON.stringify({
      aps: { alert: { title: text(title).slice(0, 80), body: text(body).slice(0, 160) }, sound: 'default' },
      eventType: text(eventType).slice(0, 64), challengeId: text(challengeId).slice(0, 96), reviewId: text(reviewId).slice(0, 128),
    });
    let client;
    try {
      client = http2.connect(host);
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
        const request = client.request({
          ':method': 'POST', ':path': `/3/device/${token}`,
          authorization: `bearer ${createJwt(env, now)}`,
          'apns-topic': text(env.APNS_BUNDLE_ID), 'apns-push-type': 'alert', 'content-type': 'application/json',
        });
        let status = 0;
        request.on('response', headers => { status = Number(headers[':status']) || 0; });
        request.on('error', reject);
        request.on('end', () => { clearTimeout(timer); resolve(status); });
        request.end(payload);
      });
      if (result >= 200 && result < 300) return { delivery: 'sent' };
      if ([400, 404, 410].includes(result)) return { delivery: 'failed', reason: 'invalid_token' };
      return { delivery: 'failed', reason: 'provider_unavailable' };
    } catch (error) {
      safeWarn('delivery unavailable');
      return { delivery: 'failed', reason: 'provider_unavailable' };
    } finally { if (client) client.close(); }
  }
  return { configured: enabled, send };
}

module.exports = { createChallengeApns, createDeviceTokenCipher, configured };
