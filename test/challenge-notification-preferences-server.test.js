'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-notification-prefs-'));
const saved = { data: process.env.BIG_TUNA_DATA_DIR, secret: process.env.CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET };
process.env.BIG_TUNA_DATA_DIR = dataDir;
process.env.CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET = 'notification-preferences-test-secret-0123456789';
const { server } = require('../server');

const ADMIN = 'prefs-admin-token';
const EMMA = 'prefs-emma-token';
let baseUrl;

function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function request(method, pathname, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(new URL(pathname, baseUrl), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text && String(res.headers['content-type'] || '').includes('application/json') ? JSON.parse(text) : text || null }));
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

before(async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  writeJson(path.join(dataDir, 'users.json'), [{ id: 'admin-id', username: 'yannick' }, { id: 'emma-id', username: 'fishyemma' }]);
  writeJson(path.join(dataDir, 'sessions.json'), [{ token: ADMIN, userId: 'admin-id', expiresAt }, { token: EMMA, userId: 'emma-id', expiresAt }]);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  if (saved.data === undefined) delete process.env.BIG_TUNA_DATA_DIR; else process.env.BIG_TUNA_DATA_DIR = saved.data;
  if (saved.secret === undefined) delete process.env.CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET; else process.env.CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET = saved.secret;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('notification preferences default on, persist per account, and validate input', async () => {
  assert.equal((await request('GET', '/api/challenge-notifications/preferences')).status, 401);
  const initial = await request('GET', '/api/challenge-notifications/preferences', { token: EMMA });
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.preferences, { dailyScore: true, activityEvents: true, weeklyResults: true, reviewRequests: true });

  const updated = await request('PUT', '/api/challenge-notifications/preferences', { token: EMMA, body: { dailyScore: false, weeklyResults: false, unknownKey: 'ignored' } });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.preferences, { dailyScore: false, activityEvents: true, weeklyResults: false, reviewRequests: true });

  assert.equal((await request('PUT', '/api/challenge-notifications/preferences', { token: EMMA, body: { dailyScore: 'no' } })).status, 400);
  assert.deepEqual((await request('GET', '/api/challenge-notifications/preferences', { token: EMMA })).body.preferences.dailyScore, false);
  assert.deepEqual((await request('GET', '/api/challenge-notifications/preferences', { token: ADMIN })).body.preferences.dailyScore, true, 'preferences are per account');
});

test('device registration records the APNs environment reported by the app', async () => {
  const registered = await request('POST', '/api/challenge-devices', { token: EMMA, body: { token: 'c'.repeat(64), platform: 'ios', environment: 'development' } });
  assert.equal(registered.status, 201);
  await request('POST', '/api/challenge-devices', { token: ADMIN, body: { token: 'd'.repeat(64), platform: 'ios', environment: 'production' } });
  const health = await request('GET', '/api/admin/custom-notifications/health', { token: ADMIN });
  assert.equal(health.status, 200);
  const environments = Object.fromEntries(health.body.devices.map(d => [d.username, d.environment]));
  assert.deepEqual(environments, { fishyemma: 'sandbox', yannick: 'production' });
  assert.equal(health.body.apns.configured, false);
  assert.equal(JSON.stringify(health.body).includes('c'.repeat(64)), false);
  assert.equal((await request('GET', '/api/admin/custom-notifications/health', { token: EMMA })).status, 403);
});

test('admin custom notifications ignore preferences and can target everyone', async () => {
  const sent = await request('POST', '/api/admin/custom-notifications', { token: ADMIN, body: { recipientUsername: 'everyone', title: 'Hello', body: 'Broadcast' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.notification.deviceCount, 2, 'both registered devices are targeted, regardless of preferences');
  assert.equal(sent.body.notification.status, 'failed');
  assert.equal(sent.body.notification.failureReason, 'apns_unconfigured');
});
