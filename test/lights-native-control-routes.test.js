'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-native-lights-'));
const previousDataDir = process.env.BIG_TUNA_DATA_DIR;
const previousDeviceToken = process.env.LIGHTS_DEVICE_API_TOKEN;
process.env.BIG_TUNA_DATA_DIR = tempData;
process.env.LIGHTS_DEVICE_API_TOKEN = 'device-test-token';
const { server } = require('../server');

let baseUrl;
const OWNER_TOKEN = 'native-owner-token';
const OTHER_TOKEN = 'native-other-token';

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function request(method, pathname, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(url, {
      method,
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(async () => {
  const now = new Date(Date.now() + 60_000).toISOString();
  writeJson(path.join(tempData, 'users.json'), [
    { id: 'owner-id', username: 'yannick' },
    { id: 'other-id', username: 'emma' },
  ]);
  writeJson(path.join(tempData, 'sessions.json'), [
    { token: OWNER_TOKEN, userId: 'owner-id', expiresAt: now },
    { token: OTHER_TOKEN, userId: 'other-id', expiresAt: now },
  ]);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  if (previousDataDir === undefined) delete process.env.BIG_TUNA_DATA_DIR;
  else process.env.BIG_TUNA_DATA_DIR = previousDataDir;
  if (previousDeviceToken === undefined) delete process.env.LIGHTS_DEVICE_API_TOKEN;
  else process.env.LIGHTS_DEVICE_API_TOKEN = previousDeviceToken;
  fs.rmSync(tempData, { recursive: true, force: true });
});

test('native Lights route is owner-only and returns physical state without changing legacy contracts', async () => {
  assert.equal((await request('GET', '/api/lights/native/v1')).status, 401);
  assert.equal((await request('GET', '/api/lights/native/v1', { token: OTHER_TOKEN })).status, 403);

  const initial = await request('GET', '/api/lights/native/v1', { token: OWNER_TOKEN });
  assert.equal(initial.status, 200);
  assert.deepEqual(Object.keys(initial.body).sort(), [
    'physicalOn', 'recentlyPolled', 'reportedPhysicalOn', 'revision', 'updatedAt',
  ]);
  assert.equal(initial.body.physicalOn, true, 'stored false remains physical on under the existing inversion');
  assert.equal(initial.body.reportedPhysicalOn, null);
  assert.equal(initial.body.revision, '0');

  const legacy = await request('GET', '/api/lights');
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.on, false, 'legacy website value stays inverted');
  const device = await request('GET', '/api/lights/device', { headers: { 'X-Big-Tuna-Device-Token': 'device-test-token' } });
  assert.equal(device.body.on, true, 'ESP output contract remains physical relay state');
});

test('native mutation validates its request and translates physical target through inversion', async () => {
  for (const body of [{}, { physicalOn: 'true', commandId: 'a' }, { physicalOn: true },
    { physicalOn: true, commandId: '' }, { physicalOn: true, commandId: 'bad space' },
    { physicalOn: true, commandId: 'a'.repeat(129) }]) {
    const response = await request('PUT', '/api/lights/native/v1', { token: OWNER_TOKEN, body });
    assert.equal(response.status, 400);
  }

  const changed = await request('PUT', '/api/lights/native/v1', {
    token: OWNER_TOKEN, body: { physicalOn: false, commandId: 'watch-toggle-1' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.physicalOn, false);
  assert.equal(changed.body.revision, '1');

  const legacy = await request('GET', '/api/lights');
  const device = await request('GET', '/api/lights/device', { headers: { 'X-Big-Tuna-Device-Token': 'device-test-token' } });
  assert.equal(legacy.body.on, true, 'physical off is stored with the existing inverted website value');
  assert.equal(device.body.on, false, 'the ESP still receives physical relay off');
});

test('native command retries are idempotent and conflicting reuse is rejected', async () => {
  const first = await request('PUT', '/api/lights/native/v1', {
    token: OWNER_TOKEN, body: { physicalOn: true, commandId: 'control-center-1' },
  });
  const replay = await request('PUT', '/api/lights/native/v1', {
    token: OWNER_TOKEN, body: { physicalOn: true, commandId: 'control-center-1' },
  });
  assert.equal(first.status, 200);
  assert.deepEqual(replay, first);

  const conflict = await request('PUT', '/api/lights/native/v1', {
    token: OWNER_TOKEN, body: { physicalOn: false, commandId: 'control-center-1' },
  });
  assert.equal(conflict.status, 409);

  const [on, off] = await Promise.all([
    request('PUT', '/api/lights/native/v1', { token: OWNER_TOKEN, body: { physicalOn: true, commandId: 'serial-on' } }),
    request('PUT', '/api/lights/native/v1', { token: OWNER_TOKEN, body: { physicalOn: false, commandId: 'serial-off' } }),
  ]);
  assert.equal(on.status, 200);
  assert.equal(off.status, 200);
  assert.equal(Number(off.body.revision), Number(on.body.revision) + 1, 'mutations receive serialized revisions');
});

test('native read includes a known physical relay report and polling recency', async () => {
  assert.equal((await request('GET', '/api/lights/device')).status, 401);
  assert.equal((await request('POST', '/api/lights/device/status', { body: { on: false } })).status, 401);
  const report = await request('POST', '/api/lights/device/status', {
    headers: { 'X-Big-Tuna-Device-Token': 'device-test-token' }, body: { on: true },
  });
  assert.equal(report.status, 200);
  await request('GET', '/api/lights/device', { headers: { 'X-Big-Tuna-Device-Token': 'device-test-token' } });
  const state = await request('GET', '/api/lights/native/v1', { token: OWNER_TOKEN });
  assert.equal(state.status, 200);
  assert.equal(state.body.reportedPhysicalOn, true);
  assert.equal(state.body.recentlyPolled, true);
});

test('native route issues scoped sessions and bounds command bodies', async () => {
  const exchange = await request('POST', '/api/lights/native/v1/session', { token: OWNER_TOKEN });
  assert.equal(exchange.status, 200);
  assert.equal(typeof exchange.body.token, 'string');
  assert.notEqual(exchange.body.token, OWNER_TOKEN);
  assert.equal((await request('GET', '/api/lights/native/v1', { token: exchange.body.token })).status, 200);
  assert.equal((await request('GET', '/api/auth/me', { token: exchange.body.token })).status, 401,
    'a Lights token cannot access the wider website API');

  const oversized = await request('PUT', '/api/lights/native/v1', {
    token: exchange.body.token,
    body: { physicalOn: true, commandId: 'bounded', padding: 'x'.repeat(2500) },
  });
  assert.equal(oversized.status, 413);
  assert.equal((await request('DELETE', '/api/lights/native/v1/session', { token: exchange.body.token })).status, 200);
  assert.equal((await request('GET', '/api/lights/native/v1', { token: exchange.body.token })).status, 401);
});

test('native command conflict protection survives control recreation', async () => {
  const { createNativeLightsControl } = require('../lib/lights-native-control');
  let desired = { on: false, revision: 0, updatedAt: new Date().toISOString() };
  let journal = [];
  const options = {
    readDesired: () => desired,
    writeDesired: on => { desired = { on, revision: desired.revision + 1, updatedAt: new Date().toISOString() }; },
    readDeviceStatus: () => ({}),
    invertOutput: false,
    loadCommands: () => journal,
    saveCommands: value => { journal = JSON.parse(JSON.stringify(value)); },
  };
  await createNativeLightsControl(options).setTarget({ targetOn: true, commandId: 'restart-safe', updatedBy: 'test' });
  await assert.rejects(
    createNativeLightsControl(options).setTarget({ targetOn: false, commandId: 'restart-safe', updatedBy: 'test' }),
    error => error && error.code === 'COMMAND_ID_CONFLICT'
  );
  assert.equal(desired.revision, 1);
});
