'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createPocketShift, APPLE_EPOCH_OFFSET } = require('../lib/pocketshift');

const TOKEN = 'ab'.repeat(32);
const ID = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';

function request(service, method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return new Promise(resolve => {
    const res = {
      writeHead(status) { this.status = status; },
      end(data) { resolve({ status: this.status, body: data ? JSON.parse(data) : null }); },
    };
    service.handle(req, res, url);
  });
}

function setup(t, nowRef) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketshift-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const sent = [];
  const apns = { configured: true, send: async message => { sent.push(message); return { delivery: 'sent' }; } };
  const service = createPocketShift({ dataDir, apns, now: () => nowRef.ms, logger: null });
  return { service, sent, dataDir, apns };
}

test('pushes the current earnings for a running shift', async t => {
  const nowRef = { ms: 1_800_000_000_000 };
  const { service, sent } = setup(t, nowRef);
  const startedAt = nowRef.ms / 1000;
  const put = await request(service, 'PUT', `/api/pocketshift/v1/activities/${ID}`, {
    pushToken: TOKEN, environment: 'sandbox',
    state: { hourlyRate: 36, currencyCode: 'CAD', accumulatedSeconds: 600, runningSince: startedAt },
  });
  assert.equal(put.status, 200);

  nowRef.ms += 100_000;
  await service.tick();
  assert.equal(sent.length, 1);
  const [message] = sent;
  assert.equal(message.pushType, 'liveactivity');
  assert.equal(message.topic, 'ca.yannickmorgans.pocketshift.push-type.liveactivity');
  assert.equal(message.environment, 'sandbox');
  assert.equal(message.priority, 10);
  const state = message.payload.aps['content-state'];
  assert.equal(message.payload.aps.event, 'update');
  assert.equal(state.earned, 36 * 700 / 3600);
  assert.equal(state.runningSince, startedAt - APPLE_EPOCH_OFFSET);

  nowRef.ms += 5_000;
  await service.tick();
  assert.equal(sent[1].priority, 5, 'pushes between the minutely high-priority one stay low priority');
});

test('paused and deleted activities are not pushed', async t => {
  const nowRef = { ms: 1_800_000_000_000 };
  const { service, sent } = setup(t, nowRef);
  const state = { hourlyRate: 20, currencyCode: 'USD', accumulatedSeconds: 60, runningSince: null };
  await request(service, 'PUT', `/api/pocketshift/v1/activities/${ID}`, { pushToken: TOKEN, state });
  await service.tick();
  assert.equal(sent.length, 0);

  await request(service, 'PUT', `/api/pocketshift/v1/activities/${ID}`, { pushToken: TOKEN, state: { ...state, runningSince: nowRef.ms / 1000 } });
  await request(service, 'DELETE', `/api/pocketshift/v1/activities/${ID}`);
  await service.tick();
  assert.equal(sent.length, 0);
});

test('rejects invalid registrations and survives a restart', async t => {
  const nowRef = { ms: 1_800_000_000_000 };
  const { service, dataDir, apns } = setup(t, nowRef);
  const bad = await request(service, 'PUT', `/api/pocketshift/v1/activities/${ID}`, { pushToken: 'nope', state: {} });
  assert.equal(bad.status, 400);
  const badState = await request(service, 'PUT', `/api/pocketshift/v1/activities/${ID}`, { pushToken: TOKEN, state: { hourlyRate: -1, currencyCode: 'CAD', accumulatedSeconds: 0 } });
  assert.equal(badState.status, 400);

  await request(service, 'PUT', `/api/pocketshift/v1/activities/${ID}`, {
    pushToken: TOKEN, state: { hourlyRate: 20, currencyCode: 'CAD', accumulatedSeconds: 0, runningSince: nowRef.ms / 1000 },
  });
  const reloaded = createPocketShift({ dataDir, apns, now: () => nowRef.ms, logger: null });
  assert.equal(reloaded.activities.get(ID).token, TOKEN);
});

test('drops activities whose token APNs no longer accepts', async t => {
  const nowRef = { ms: 1_800_000_000_000 };
  const { service, apns } = setup(t, nowRef);
  apns.send = async () => ({ delivery: 'failed', reason: 'invalid_token' });
  await request(service, 'PUT', `/api/pocketshift/v1/activities/${ID}`, {
    pushToken: TOKEN, state: { hourlyRate: 20, currencyCode: 'CAD', accumulatedSeconds: 0, runningSince: nowRef.ms / 1000 },
  });
  await service.tick();
  assert.equal(service.activities.size, 0);
});
