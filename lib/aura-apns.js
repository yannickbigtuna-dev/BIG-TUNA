'use strict';

// AURA APNs transport: a generalized sibling of lib/challenge-apns.js that lets
// the caller choose push type, topic, priority and payload per send.
const crypto = require('crypto');
const http2 = require('http2');

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }

const DEFAULT_BUNDLE_ID = 'ca.yannickmorgans.aura';

function bundleId(env) { return text(env.AURA_APNS_BUNDLE_ID) || DEFAULT_BUNDLE_ID; }

function hasKey(env, prefix) { return Boolean(text(env[`${prefix}KEY_ID`]) && text(env[`${prefix}AUTH_KEY_BASE64`])); }

function configured(env = process.env) {
  return Boolean(text(env.APNS_TEAM_ID) && (hasKey(env, 'APNS_') || hasKey(env, 'APNS_PRODUCTION_') || hasKey(env, 'APNS_SANDBOX_')));
}

function createJwt(creds, now = () => Date.now()) {
  const encoded = text(creds.APNS_AUTH_KEY_BASE64);
  if (!encoded) throw new Error('APNs credentials are unavailable.');
  const key = Buffer.from(encoded, 'base64').toString('utf8');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: text(creds.APNS_KEY_ID) }));
  const claims = b64url(JSON.stringify({ iss: text(creds.APNS_TEAM_ID), iat: Math.floor(now() / 1000) }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}

// AES-256-GCM at rest for device tokens, keyed from AURA_ or CHALLENGE_ secret.
function createAuraCipher({ env = process.env } = {}) {
  const secret = text(env.AURA_DEVICE_TOKEN_CRYPTO_SECRET) || text(env.CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET);
  const key = secret.length >= 24 ? crypto.createHash('sha256').update(secret).digest() : null;
  function requireKey() { if (!key) throw new Error('AURA_DEVICE_TOKEN_CRYPTO_SECRET is required for device registration.'); }
  return {
    configured: Boolean(key),
    encrypt(token) {
      requireKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
      return Buffer.from(JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })).toString('base64');
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

function createAuraApns({ env = process.env, logger = console, now = () => Date.now(), connect = http2.connect } = {}) {
  const enabled = configured(env);
  const cipher = createAuraCipher({ env });
  const hosts = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
  const defaultEnvironment = text(env.APNS_ENVIRONMENT).toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  const jwtCache = {};
  const safeWarn = message => { if (logger && typeof logger.warn === 'function') logger.warn(`[aura apns] ${message}`); };

  function credentialsFor(name) {
    const prefix = name === 'sandbox' ? 'APNS_SANDBOX_' : 'APNS_PRODUCTION_';
    return {
      APNS_TEAM_ID: env.APNS_TEAM_ID,
      APNS_KEY_ID: text(env[`${prefix}KEY_ID`]) || text(env.APNS_KEY_ID),
      APNS_AUTH_KEY_BASE64: text(env[`${prefix}AUTH_KEY_BASE64`]) || text(env.APNS_AUTH_KEY_BASE64),
    };
  }
  function normalizeEnvironment(value) {
    const v = text(value).toLowerCase();
    if (v === 'development' || v === 'sandbox') return 'sandbox';
    if (v === 'production') return 'production';
    return null;
  }
  // Provider tokens are reused for 40 minutes (APNs allows 20 min - 60 min).
  function providerToken(name) {
    const cached = jwtCache[name];
    if (cached && now() - cached.issuedAt < 40 * 60_000) return cached.jwt;
    const jwt = createJwt(credentialsFor(name), now);
    jwtCache[name] = { jwt, issuedAt: now() };
    return jwt;
  }

  async function postToHost(name, token, { pushType, topic, priority, body }) {
    let client;
    try {
      client = connect(hosts[name]);
      client.on('error', () => {});
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
        const request = client.request({
          ':method': 'POST', ':path': `/3/device/${token}`,
          authorization: `bearer ${providerToken(name)}`,
          'apns-topic': topic, 'apns-push-type': pushType, 'apns-priority': String(priority), 'content-type': 'application/json',
        });
        let status = 0;
        let responseBody = '';
        request.on('response', headers => { status = Number(headers[':status']) || 0; });
        request.on('data', chunk => { responseBody += chunk; });
        request.on('error', error => { clearTimeout(timer); reject(error); });
        request.on('end', () => {
          clearTimeout(timer);
          let reason = null;
          try { const parsed = JSON.parse(responseBody); if (parsed && typeof parsed.reason === 'string') reason = parsed.reason; } catch {}
          if (status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken')) delete jwtCache[name];
          resolve({ status, reason });
        });
        request.end(body);
      });
    } finally {
      if (client) client.close();
    }
  }

  const WRONG_ENVIRONMENT = new Set(['BadDeviceToken', 'BadEnvironmentKeyInToken', 'BadEnvironmentKeyIdInToken', 'InvalidProviderToken']);

  async function send({ token, environment, pushType = 'alert', topic, priority = 10, payload } = {}) {
    if (!enabled) return { delivery: 'failed', reason: 'unavailable' };
    if (!/^[0-9a-f]{64,200}$/i.test(String(token || ''))) return { delivery: 'failed', reason: 'invalid_token' };
    const request = {
      pushType: text(pushType) || 'alert',
      topic: text(topic) || bundleId(env),
      priority: Number(priority) === 5 ? 5 : 10,
      body: JSON.stringify(payload || {}),
    };
    const first = normalizeEnvironment(environment) || defaultEnvironment;
    const order = [first, first === 'production' ? 'sandbox' : 'production'];
    const attempts = [];
    for (const name of order) {
      let res;
      try { res = await postToHost(name, token, request); }
      catch (error) { safeWarn(`${name} delivery unavailable: ${error && error.message}`); attempts.push({ name, status: 0, reason: 'provider_unavailable' }); continue; }
      if (res.status >= 200 && res.status < 300) return { delivery: 'sent', environment: name };
      attempts.push({ name, ...res });
      if (res.status === 410 || res.reason === 'Unregistered') return { delivery: 'failed', reason: 'invalid_token', providerReason: 'Unregistered' };
      if (!WRONG_ENVIRONMENT.has(res.reason)) break;
    }
    const keyAccepted = attempts.filter(a => a.status > 0 && a.reason !== 'BadEnvironmentKeyInToken' && a.reason !== 'BadEnvironmentKeyIdInToken' && a.reason !== 'InvalidProviderToken');
    if (attempts.length === 2 && keyAccepted.length === 2 && keyAccepted.every(a => a.reason === 'BadDeviceToken')) return { delivery: 'failed', reason: 'invalid_token', providerReason: 'BadDeviceToken' };
    const informative = attempts.find(a => a.reason && a.reason !== 'BadDeviceToken') || attempts[0] || {};
    const reason = informative.reason || 'provider_unavailable';
    if (reason !== 'provider_unavailable') safeWarn(`delivery rejected: ${attempts.map(a => `${a.name}=${a.status}/${a.reason || '-'}`).join(' ')}`);
    return { delivery: 'failed', reason };
  }

  return { configured: enabled, bundleId: bundleId(env), cipher, send };
}

module.exports = { createAuraApns, createAuraCipher, configured, DEFAULT_BUNDLE_ID };
