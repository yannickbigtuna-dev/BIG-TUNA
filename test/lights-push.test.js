'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createLightsPush } = require('../lib/lights-push');
const { createAuraCipher } = require('../lib/aura-apns');

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

function setup(sendImpl) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lights-push-')), 'devices.json');
  const sent = [];
  const apns = {
    cipher: createAuraCipher({ env: { AURA_DEVICE_TOKEN_CRYPTO_SECRET: 'x'.repeat(32) } }),
    send: async request => { sent.push(request); return sendImpl ? sendImpl(request) : { delivery: 'sent' }; },
  };
  return { push: createLightsPush({ file, apns, logger: null, debounceMs: 5 }), sent, file };
}

test('registers widget and control tokens and pushes both with matching topics', async () => {
  const { push, sent, file } = setup();
  push.register({ token: TOKEN_A, channel: 'widgets', environment: 'production' });
  push.register({ token: TOKEN_B, channel: 'controls' });
  push.register({ token: TOKEN_B, channel: 'controls' });
  assert.equal(push.devices().length, 2);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(TOKEN_A), 'tokens are encrypted at rest');
  await push.sendNow();
  const byType = Object.fromEntries(sent.map(s => [s.pushType, s]));
  assert.equal(byType.widgets.topic, 'ca.yannickmorgans.bigtuna.lights.push-type.widgets');
  assert.equal(byType.controls.topic, 'ca.yannickmorgans.bigtuna.lights.push-type.controls');
  assert.equal(byType.widgets.token, TOKEN_A);
  assert.deepEqual(byType.controls.payload, { aps: { 'content-changed': true } });
});

test('coalesces rapid changes into one push', async () => {
  const { push, sent } = setup();
  push.register({ token: TOKEN_A, channel: 'widgets' });
  push.notifyChanged(); push.notifyChanged(); push.notifyChanged();
  await new Promise(r => setTimeout(r, 40));
  assert.equal(sent.length, 1);
});

test('drops unregistered tokens and validates input', async () => {
  const { push } = setup(() => ({ delivery: 'failed', reason: 'invalid_token' }));
  push.register({ token: TOKEN_A, channel: 'widgets' });
  await push.sendNow();
  assert.equal(push.devices().length, 0);
  push.register({ token: TOKEN_B, channel: 'controls' });
  push.unregister([TOKEN_B]);
  assert.equal(push.devices().length, 0);
  assert.equal(push.validate({ token: 'nope', channel: 'widgets' }), 'Invalid token');
  assert.equal(push.validate({ token: TOKEN_A, channel: 'alert' }), 'Invalid channel');
  assert.equal(push.validate({ token: TOKEN_A, channel: 'controls', environment: 'production' }), null);
});
