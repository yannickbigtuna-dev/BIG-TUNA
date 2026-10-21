'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createAuraApns, createAuraCipher } = require('../lib/aura-apns');

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
const ENV = { APNS_TEAM_ID: 'TEAM123456', APNS_KEY_ID: 'KEY1234567', APNS_AUTH_KEY_BASE64: KEY, APNS_ENVIRONMENT: 'production' };
const TOKEN = 'ab'.repeat(32);

function fakeConnect(responses, calls) {
  return host => {
    const client = new EventEmitter();
    client.close = () => {};
    client.request = headers => {
      const req = new EventEmitter();
      let body = '';
      req.end = data => {
        body = data;
        const spec = typeof responses[host] === 'function' ? responses[host](headers) : responses[host];
        calls.push({ host, headers, body });
        setImmediate(() => {
          req.emit('response', { ':status': spec.status });
          if (spec.reason) req.emit('data', JSON.stringify({ reason: spec.reason }));
          req.emit('end');
        });
      };
      return req;
    };
    return client;
  };
}
const OK = { status: 200 };
const PROD = 'https://api.push.apple.com';
const SANDBOX = 'https://api.sandbox.push.apple.com';

test('sends with caller supplied topic, push type, priority and payload', async () => {
  const calls = [];
  const apns = createAuraApns({ env: ENV, connect: fakeConnect({ [PROD]: OK }, calls) });
  assert.equal(apns.configured, true);
  const result = await apns.send({ token: TOKEN, environment: 'production', pushType: 'widgets', topic: 'ca.yannickmorgans.aura.push-type.widgets', priority: 10, payload: { aps: { 'content-changed': true } } });
  assert.equal(result.delivery, 'sent');
  const h = calls[0].headers;
  assert.equal(h['apns-push-type'], 'widgets');
  assert.equal(h['apns-topic'], 'ca.yannickmorgans.aura.push-type.widgets');
  assert.equal(h['apns-priority'], '10');
  assert.match(h.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(JSON.parse(calls[0].body), { aps: { 'content-changed': true } });
});

test('default topic honours AURA_APNS_BUNDLE_ID', async () => {
  const calls = [];
  const apns = createAuraApns({ env: { ...ENV, AURA_APNS_BUNDLE_ID: 'x.y.z' }, connect: fakeConnect({ [PROD]: OK }, calls) });
  assert.equal(apns.bundleId, 'x.y.z');
  await apns.send({ token: TOKEN, environment: 'production', pushType: 'background', priority: 5, payload: {} });
  assert.equal(calls[0].headers['apns-topic'], 'x.y.z');
  assert.equal(calls[0].headers['apns-priority'], '5');
});

test('wrong environment falls back to the other host', async () => {
  const calls = [];
  const apns = createAuraApns({ env: ENV, connect: fakeConnect({ [PROD]: { status: 400, reason: 'BadDeviceToken' }, [SANDBOX]: OK }, calls) });
  const result = await apns.send({ token: TOKEN, environment: 'production', payload: {} });
  assert.equal(result.delivery, 'sent');
  assert.equal(result.environment, 'sandbox');
  assert.deepEqual(calls.map(c => c.host), [PROD, SANDBOX]);
});

test('410 and Unregistered are reported as invalid_token', async () => {
  const calls = [];
  const apns = createAuraApns({ env: ENV, connect: fakeConnect({ [PROD]: { status: 410, reason: 'Unregistered' } }, calls) });
  assert.deepEqual(await apns.send({ token: TOKEN, environment: 'production', payload: {} }), { delivery: 'failed', reason: 'invalid_token', providerReason: 'Unregistered' });
  assert.equal(calls.length, 1);
});

test('BadDeviceToken in both environments is invalid_token', async () => {
  const bad = { status: 400, reason: 'BadDeviceToken' };
  const apns = createAuraApns({ env: ENV, connect: fakeConnect({ [PROD]: bad, [SANDBOX]: bad }, []) });
  assert.equal((await apns.send({ token: TOKEN, payload: {} })).reason, 'invalid_token');
});

test('provider JWT is cached and refreshed after 40 minutes', async () => {
  const calls = [];
  let t = 1_000_000;
  const apns = createAuraApns({ env: ENV, now: () => t, connect: fakeConnect({ [PROD]: OK }, calls) });
  await apns.send({ token: TOKEN, environment: 'production', payload: {} });
  t += 10 * 60_000;
  await apns.send({ token: TOKEN, environment: 'production', payload: {} });
  t += 31 * 60_000;
  await apns.send({ token: TOKEN, environment: 'production', payload: {} });
  assert.equal(calls[0].headers.authorization, calls[1].headers.authorization);
  assert.notEqual(calls[1].headers.authorization, calls[2].headers.authorization);
});

test('unconfigured sender and malformed tokens never touch the network', async () => {
  const calls = [];
  const off = createAuraApns({ env: {}, connect: fakeConnect({}, calls) });
  assert.equal(off.configured, false);
  assert.equal((await off.send({ token: TOKEN, payload: {} })).reason, 'unavailable');
  const on = createAuraApns({ env: ENV, connect: fakeConnect({}, calls) });
  assert.equal((await on.send({ token: 'nothex', payload: {} })).reason, 'invalid_token');
  assert.equal(calls.length, 0);
});

test('device token cipher round-trips and prefers the AURA secret', () => {
  const secret = 's'.repeat(32);
  const a = createAuraCipher({ env: { AURA_DEVICE_TOKEN_CRYPTO_SECRET: secret } });
  const enc = a.encrypt(TOKEN);
  assert.notEqual(enc, TOKEN);
  assert.equal(a.decrypt(enc), TOKEN);
  const fallback = createAuraCipher({ env: { CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET: secret } });
  assert.equal(fallback.decrypt(enc), TOKEN);
  assert.equal(createAuraCipher({ env: {} }).configured, false);
  assert.throws(() => createAuraCipher({ env: {} }).encrypt(TOKEN));
});

test('retries transient network errors and 5xx on the same host', async () => {
  const calls = [];
  let n = 0;
  const flaky = () => { n += 1; if (n === 1) throw new Error('socket disconnected'); return n === 2 ? { status: 503, reason: 'ServiceUnavailable' } : OK; };
  const connect = host => {
    const client = fakeConnect({ [host]: flaky }, calls)(host);
    const request = client.request;
    client.request = headers => {
      const req = request(headers);
      const end = req.end;
      req.end = data => { try { end(data); } catch (error) { setImmediate(() => req.emit('error', error)); } };
      return req;
    };
    return client;
  };
  const apns = createAuraApns({ env: ENV, connect, sleep: async () => {} });
  const r = await apns.send({ token: TOKEN, environment: 'production', payload: {} });
  assert.equal(r.delivery, 'sent');
  assert.equal(n, 3);
  assert.ok(calls.every(c => c.host === PROD));
});
