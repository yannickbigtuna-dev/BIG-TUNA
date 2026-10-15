'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createChallengeApns } = require('../lib/challenge-apns');

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
const ENV = { APNS_TEAM_ID: 'TEAM123456', APNS_KEY_ID: 'KEY1234567', APNS_BUNDLE_ID: 'ca.example.app', APNS_AUTH_KEY_BASE64: KEY, APNS_ENVIRONMENT: 'production' };
const TOKEN = 'ab'.repeat(32);

// Fake http2 transport: responses[host] is { status, reason } or a function of the request headers.
function fakeConnect(responses, calls) {
  return host => {
    const client = new EventEmitter();
    client.close = () => {};
    client.request = headers => {
      const req = new EventEmitter();
      req.end = () => {
        const spec = typeof responses[host] === 'function' ? responses[host](headers) : responses[host];
        calls.push({ host, headers });
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
const PROD = 'https://api.push.apple.com';
const SANDBOX = 'https://api.sandbox.push.apple.com';

test('a sandbox-only key with a production token is a config error, never a dead token', async () => {
  const calls = [];
  const apns = createChallengeApns({ env: ENV, logger: { warn() {} }, connect: fakeConnect({ [PROD]: { status: 403, reason: 'BadEnvironmentKeyInToken' }, [SANDBOX]: { status: 400, reason: 'BadDeviceToken' } }, calls) });
  const result = await apns.send({ token: TOKEN, title: 't', body: 'b' });
  assert.deepEqual(result, { delivery: 'failed', reason: 'BadEnvironmentKeyInToken' });
  assert.deepEqual(calls.map(c => c.host), [PROD, SANDBOX]);
});

test('devices are sent to their registered environment first', async () => {
  const calls = [];
  const apns = createChallengeApns({ env: ENV, connect: fakeConnect({ [PROD]: { status: 400, reason: 'BadDeviceToken' }, [SANDBOX]: { status: 200 } }, calls) });
  assert.deepEqual(await apns.send({ token: TOKEN, environment: 'development', title: 't', body: 'b' }), { delivery: 'sent', environment: 'sandbox' });
  assert.deepEqual(calls.map(c => c.host), [SANDBOX]);
  calls.length = 0;
  assert.deepEqual(await apns.send({ token: TOKEN, title: 't', body: 'b' }), { delivery: 'sent', environment: 'sandbox' }, 'unknown environment falls back to the other host');
  assert.deepEqual(calls.map(c => c.host), [PROD, SANDBOX]);
});

test('only Unregistered or BadDeviceToken from both accepting hosts marks a token invalid', async () => {
  const gone = createChallengeApns({ env: ENV, connect: fakeConnect({ [PROD]: { status: 410, reason: 'Unregistered' }, [SANDBOX]: { status: 200 } }, []) });
  assert.equal((await gone.send({ token: TOKEN, environment: 'production', title: 't', body: 'b' })).reason, 'invalid_token');
  const bad = createChallengeApns({ env: ENV, logger: { warn() {} }, connect: fakeConnect({ [PROD]: { status: 400, reason: 'BadDeviceToken' }, [SANDBOX]: { status: 400, reason: 'BadDeviceToken' } }, []) });
  assert.equal((await bad.send({ token: TOKEN, title: 't', body: 'b' })).reason, 'invalid_token');
});

test('environment-specific keys sign requests for their own host and JWTs are reused', async () => {
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  const env = { ...ENV, APNS_PRODUCTION_KEY_ID: 'PRODKEY123', APNS_PRODUCTION_AUTH_KEY_BASE64: Buffer.from(other.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
  const calls = [];
  const apns = createChallengeApns({ env, connect: fakeConnect({ [PROD]: { status: 200 }, [SANDBOX]: { status: 200 } }, calls) });
  await apns.send({ token: TOKEN, environment: 'production', title: 't', body: 'b' });
  await apns.send({ token: TOKEN, environment: 'production', title: 't', body: 'b' });
  await apns.send({ token: TOKEN, environment: 'sandbox', title: 't', body: 'b' });
  const kid = call => JSON.parse(Buffer.from(call.headers.authorization.slice(7).split('.')[0], 'base64url').toString()).kid;
  assert.equal(kid(calls[0]), 'PRODKEY123');
  assert.equal(kid(calls[2]), 'KEY1234567');
  assert.equal(calls[0].headers.authorization, calls[1].headers.authorization);
});

test('probe reports per-environment key validity without a real device', async () => {
  const apns = createChallengeApns({ env: ENV, connect: fakeConnect({ [PROD]: { status: 403, reason: 'BadEnvironmentKeyInToken' }, [SANDBOX]: { status: 400, reason: 'BadDeviceToken' } }, []) });
  const result = await apns.probe();
  assert.equal(result.production, 'BadEnvironmentKeyInToken');
  assert.equal(result.sandbox, 'ok');
  assert.deepEqual(await createChallengeApns({ env: {} }).probe(), { configured: false, bundleId: null, production: 'unconfigured', sandbox: 'unconfigured' });
});
