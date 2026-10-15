'use strict';

// Deployment-only APNs transport.  Keep credential parsing and provider errors
// here so the challenge API never logs or returns raw device tokens/details.
const crypto = require('crypto');
const http2 = require('http2');

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }

function configured(env = process.env) {
  const hasKey = prefix => Boolean(text(env[`${prefix}KEY_ID`]) && text(env[`${prefix}AUTH_KEY_BASE64`]));
  return Boolean(text(env.APNS_TEAM_ID) && text(env.APNS_BUNDLE_ID) && (hasKey('APNS_') || hasKey('APNS_PRODUCTION_') || hasKey('APNS_SANDBOX_')));
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

function createChallengeApns({ env = process.env, logger = console, now = () => Date.now(), connect = http2.connect } = {}) {
  // Apple can issue keys restricted to one APNs environment. Optional
  // APNS_PRODUCTION_* / APNS_SANDBOX_* overrides let a production-only and a
  // sandbox-only key coexist; otherwise the shared APNS_KEY_ID/AUTH key is used.
  const credentialsFor = name => {
    const prefix = name === 'sandbox' ? 'APNS_SANDBOX_' : 'APNS_PRODUCTION_';
    const keyId = text(env[`${prefix}KEY_ID`]) || text(env.APNS_KEY_ID);
    const authKeyBase64 = text(env[`${prefix}AUTH_KEY_BASE64`]) || text(env.APNS_AUTH_KEY_BASE64);
    return { APNS_TEAM_ID: env.APNS_TEAM_ID, APNS_KEY_ID: keyId, APNS_AUTH_KEY_BASE64: authKeyBase64 };
  };
  const enabled = configured(env);
  const hosts = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
  const defaultEnvironment = text(env.APNS_ENVIRONMENT).toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  const jwtCache = {};
  function safeWarn(message) { if (logger && typeof logger.warn === 'function') logger.warn(`[challenge apns] ${message}`); }
  function normalizeEnvironment(value) {
    const v = text(value).toLowerCase();
    if (v === 'development' || v === 'sandbox') return 'sandbox';
    if (v === 'production') return 'production';
    return null;
  }
  // APNs rejects provider tokens refreshed more than once every 20 minutes and
  // older than an hour, so each environment's JWT is reused for 40 minutes.
  function providerToken(name) {
    const cached = jwtCache[name];
    if (cached && now() - cached.issuedAt < 40 * 60_000) return cached.jwt;
    const jwt = createJwt(credentialsFor(name), now);
    jwtCache[name] = { jwt, issuedAt: now() };
    return jwt;
  }

  async function postToHost(name, token, payload) {
    let client;
    try {
      client = connect(hosts[name]);
      client.on('error', () => {});
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
        const request = client.request({
          ':method': 'POST', ':path': `/3/device/${token}`,
          authorization: `bearer ${providerToken(name)}`,
          'apns-topic': text(env.APNS_BUNDLE_ID), 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json',
        });
        let status = 0;
        let body = '';
        request.on('response', headers => { status = Number(headers[':status']) || 0; });
        request.on('data', chunk => { body += chunk; });
        request.on('error', error => { clearTimeout(timer); reject(error); });
        request.on('end', () => {
          clearTimeout(timer);
          let reason = null;
          try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed.reason === 'string') reason = parsed.reason;
          } catch {}
          if (status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken')) delete jwtCache[name];
          resolve({ status, reason });
        });
        request.end(payload);
      });
    } finally {
      if (client) client.close();
    }
  }

  // Reasons that mean "this host/key cannot serve this token" rather than
  // "the token is dead"; the other environment is tried before giving up.
  const WRONG_ENVIRONMENT = new Set(['BadDeviceToken', 'BadEnvironmentKeyInToken', 'BadEnvironmentKeyIdInToken', 'InvalidProviderToken']);

  async function send({ token, eventType, challengeId, reviewId, title, body, environment }) {
    if (!enabled) return { delivery: 'failed', reason: 'unavailable' };
    if (!/^[0-9a-f]{64,200}$/i.test(String(token || ''))) return { delivery: 'failed', reason: 'invalid_token' };
    const payload = JSON.stringify({
      aps: { alert: { title: text(title).slice(0, 100), body: text(body).slice(0, 256) }, sound: 'default' },
      eventType: text(eventType).slice(0, 64), challengeId: text(challengeId).slice(0, 96), reviewId: text(reviewId).slice(0, 128),
      title: text(title).slice(0, 100), body: text(body).slice(0, 256),
    });
    const first = normalizeEnvironment(environment) || defaultEnvironment;
    const order = [first, first === 'production' ? 'sandbox' : 'production'];
    const attempts = [];
    for (const name of order) {
      let res;
      try { res = await postToHost(name, token, payload); }
      catch (error) { safeWarn(`${name} delivery unavailable: ${error && error.message}`); attempts.push({ name, status: 0, reason: 'provider_unavailable' }); continue; }
      if (res.status >= 200 && res.status < 300) return { delivery: 'sent', environment: name };
      attempts.push({ name, ...res });
      if (res.status === 410 || res.reason === 'Unregistered') return { delivery: 'failed', reason: 'invalid_token', providerReason: 'Unregistered' };
      if (!WRONG_ENVIRONMENT.has(res.reason)) break;
    }
    // A token is only treated as dead when every environment that accepted our
    // key rejected it; a key/environment mismatch is a server configuration issue.
    const keyAccepted = attempts.filter(a => a.status > 0 && a.reason !== 'BadEnvironmentKeyInToken' && a.reason !== 'BadEnvironmentKeyIdInToken' && a.reason !== 'InvalidProviderToken');
    if (attempts.length === 2 && keyAccepted.length === 2 && keyAccepted.every(a => a.reason === 'BadDeviceToken')) return { delivery: 'failed', reason: 'invalid_token', providerReason: 'BadDeviceToken' };
    const informative = attempts.find(a => a.reason && a.reason !== 'BadDeviceToken') || attempts[0] || {};
    const reason = informative.reason || 'provider_unavailable';
    if (reason !== 'provider_unavailable') safeWarn(`delivery rejected: ${attempts.map(a => `${a.name}=${a.status}/${a.reason || '-'}`).join(' ')}`);
    return { delivery: 'failed', reason };
  }

  // Health check that never reaches a device: an all-zero token is rejected by
  // APNs, but only after it has validated the provider key for that host.
  async function probe() {
    if (!enabled) return { configured: false, bundleId: text(env.APNS_BUNDLE_ID) || null, production: 'unconfigured', sandbox: 'unconfigured' };
    const out = { configured: true, bundleId: text(env.APNS_BUNDLE_ID), defaultEnvironment };
    for (const name of ['production', 'sandbox']) {
      try {
        const res = await postToHost(name, '0'.repeat(64), JSON.stringify({ aps: { alert: { title: 'probe' } } }));
        out[name] = res.reason === 'BadDeviceToken' ? 'ok' : (res.reason || `http_${res.status}`);
      } catch (error) { out[name] = 'unreachable'; }
    }
    return out;
  }
  return { configured: enabled, send, probe };
}

module.exports = { createChallengeApns, createDeviceTokenCipher, configured };
