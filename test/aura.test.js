'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createAura } = require('../lib/aura');
const { createAuraCipher } = require('../lib/aura-apns');

const USERS = [
  { id: 'user-a', username: 'alice' },
  { id: 'user-b', username: 'bob' },
  { id: 'user-c', username: 'carol' },
];
const TOKENS = { 'tok-a': USERS[0], 'tok-b': USERS[1], 'tok-c': USERS[2] };
const DEV_A = 'a1'.repeat(32);
const DEV_B_APP = 'b1'.repeat(32);
const DEV_B_W = 'b2'.repeat(32);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 9)]);

async function harness(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-test-'));
  const clock = { t: Date.parse('2026-10-15T12:00:00Z') };
  const sent = [];
  const behavior = { result: () => ({ delivery: 'sent' }) };
  const cipher = createAuraCipher({ env: opts.noSecret ? {} : { AURA_DEVICE_TOKEN_CRYPTO_SECRET: 'z'.repeat(32) } });
  const apns = {
    configured: true, bundleId: 'ca.yannickmorgans.aura', cipher,
    send: async req => { sent.push(req); return behavior.result(req); },
  };
  const aura = createAura({
    dataDir: path.join(dir, 'aura'),
    getSessionUser: token => TOKENS[token] || null,
    readUsers: () => USERS,
    apns, now: () => clock.t, logger: { warn() {} }, debounceMs: opts.debounceMs ?? 0,
  });
  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (!(await aura.handle(req, res, urlPath))) { res.writeHead(418); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/aura/v1`;
  async function call(method, route, { token, json, raw, headers } = {}) {
    const h = { ...(headers || {}) };
    if (token) h.authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (raw !== undefined) body = raw;
    const res = await fetch(base + route, { method, headers: h, body });
    const buf = Buffer.from(await res.arrayBuffer());
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) data = JSON.parse(buf.toString('utf8'));
    return { status: res.status, data, buf, headers: res.headers };
  }
  const close = async () => { aura.stopScheduler(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); };
  return { dir, clock, sent, behavior, aura, call, close, auraDir: path.join(dir, 'aura') };
}

async function pair(h) {
  const inv = await h.call('POST', '/invites', { token: 'tok-a', json: {} });
  assert.equal(inv.status, 200);
  const token = inv.data.url.split('#token=')[1];
  const acc = await h.call('POST', '/invites/accept', { token: 'tok-b', json: { token } });
  assert.equal(acc.status, 200);
  return token;
}
async function register(h, who, token, channel, environment = 'production') {
  const r = await h.call('POST', '/devices', { token: who, json: { token, channel, environment } });
  assert.equal(r.status, 200);
}

test('pairing flow: invite, public preview, accept, reuse, third party, already paired', async () => {
  const h = await harness();
  try {
    const inv = await h.call('POST', '/invites', { token: 'tok-a', json: {} });
    assert.match(inv.data.url, /^https:\/\/yannickmorgans\.ca\/aura\/invite#token=[A-Za-z0-9_-]{43}$/);
    assert.match(inv.data.expiresAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(inv.headers.get('cache-control'), 'no-store');
    const token = inv.data.url.split('#token=')[1];
    // token is stored hashed only
    assert.ok(!fs.readFileSync(path.join(h.auraDir, 'invites.json'), 'utf8').includes(token));

    const preview = await h.call('POST', '/invites/preview', { json: { token } });
    assert.deepEqual(preview.data.fromName, 'alice');
    assert.equal((await h.call('POST', '/invites/preview', { json: { token: 'nope-nope-nope-nope-nope' } })).status, 404);

    assert.equal((await h.call('POST', '/invites/accept', { token: 'tok-a', json: { token } })).data.error, 'You cannot accept your own invitation.');
    assert.equal((await h.call('POST', '/invites/accept', { token: 'tok-a', json: { token } })).status, 400);

    const acc = await h.call('POST', '/invites/accept', { token: 'tok-b', json: { token } });
    assert.equal(acc.status, 200);
    assert.equal(acc.data.partner.displayName, 'alice');
    const meA = await h.call('GET', '/me', { token: 'tok-a' });
    const meB = await h.call('GET', '/me', { token: 'tok-b' });
    assert.equal(meA.data.partner.id, 'user-b');
    assert.equal(meB.data.partner.id, 'user-a');
    assert.equal(meA.data.pairedAt, meB.data.pairedAt);
    assert.equal(meA.data.user.avatarVersion, 0);

    assert.equal((await h.call('POST', '/invites/accept', { token: 'tok-b', json: { token } })).status, 404);
    assert.equal((await h.call('POST', '/invites/accept', { token: 'tok-c', json: { token } })).status, 404);
    assert.equal((await h.call('POST', '/invites/preview', { json: { token } })).status, 404);
    assert.equal((await h.call('POST', '/invites', { token: 'tok-a', json: {} })).status, 409);
    assert.equal((await h.call('POST', '/invites', { token: 'tok-a', json: {} })).data.error, 'already_paired');
  } finally { await h.close(); }
});

test('third user cannot accept an invite once its owner is paired; new invite revokes older; expiry', async () => {
  const h = await harness();
  try {
    const first = (await h.call('POST', '/invites', { token: 'tok-a', json: {} })).data.url.split('#token=')[1];
    const second = (await h.call('POST', '/invites', { token: 'tok-a', json: {} })).data.url.split('#token=')[1];
    assert.equal((await h.call('POST', '/invites/preview', { json: { token: first } })).status, 404);
    h.clock.t += 8 * 24 * 3600_000;
    assert.equal((await h.call('POST', '/invites/preview', { json: { token: second } })).status, 404);
    assert.equal((await h.call('POST', '/invites/accept', { token: 'tok-b', json: { token: second } })).status, 404);
  } finally { await h.close(); }
});

test('concurrent accepts of one invite pair exactly once', async () => {
  const h = await harness();
  try {
    const token = (await h.call('POST', '/invites', { token: 'tok-a', json: {} })).data.url.split('#token=')[1];
    const results = await Promise.all([
      h.call('POST', '/invites/accept', { token: 'tok-b', json: { token } }),
      h.call('POST', '/invites/accept', { token: 'tok-c', json: { token } }),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 404]);
    assert.equal(fs.readdirSync(path.join(h.auraDir, 'pairs')).length, 1);
  } finally { await h.close(); }
});

test('preview is public but rate limited per IP', async () => {
  const h = await harness();
  try {
    let last;
    for (let i = 0; i < 31; i++) last = await h.call('POST', '/invites/preview', { json: { token: 'x'.repeat(30) }, headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' } });
    assert.equal(last.status, 429);
    const other = await h.call('POST', '/invites/preview', { json: { token: 'x'.repeat(30) }, headers: { 'x-forwarded-for': '8.8.8.8' } });
    assert.equal(other.status, 404);
  } finally { await h.close(); }
});

test('profile and avatar', async () => {
  const h = await harness();
  try {
    assert.equal((await h.call('PUT', '/profile', { token: 'tok-a', json: { displayName: '   ' } })).status, 400);
    assert.equal((await h.call('PUT', '/profile', { token: 'tok-a', json: { displayName: 'x'.repeat(41) } })).status, 400);
    assert.equal((await h.call('PUT', '/profile', { token: 'tok-a', json: { displayName: '  Ally  ' } })).data.displayName, 'Ally');
    assert.equal((await h.call('PUT', '/profile/avatar', { token: 'tok-a', raw: Buffer.from('not an image') })).status, 400);
    assert.equal((await h.call('PUT', '/profile/avatar', { token: 'tok-a', raw: Buffer.alloc(1024 * 1024 + 1, 0xff) })).status, 413);
    const up = await h.call('PUT', '/profile/avatar', { token: 'tok-a', raw: PNG });
    assert.equal(up.data.avatarVersion, 1);
    assert.equal((await h.call('PUT', '/profile/avatar', { token: 'tok-a', raw: JPEG })).data.avatarVersion, 2);
    const own = await h.call('GET', '/avatar/user-a', { token: 'tok-a' });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('content-type'), 'image/jpeg');
    assert.equal((await h.call('GET', '/avatar/user-a', { token: 'tok-b' })).status, 404);
    await pair(h);
    assert.equal((await h.call('GET', '/avatar/user-a', { token: 'tok-b' })).status, 200);
    assert.equal((await h.call('GET', '/avatar/user-a', { token: 'tok-c' })).status, 404);
    assert.equal((await h.call('GET', '/me', { token: 'tok-b' })).data.partner.displayName, 'Ally');
  } finally { await h.close(); }
});

test('counters CRUD, validation and partner counters', async () => {
  const h = await harness();
  try {
    const c = { id: 'c1', name: 'Trip', date: '2026-12-01T00:00:00.000Z', mode: 'until', emoji: '\u{1F334}', createdAt: '2026-10-01T00:00:00Z' };
    const put = await h.call('PUT', '/counters/c1', { token: 'tok-a', json: c });
    assert.equal(put.status, 200);
    assert.equal(put.data.date, '2026-12-01T00:00:00Z');
    assert.deepEqual((await h.call('GET', '/counters', { token: 'tok-a' })).data.map(x => x.id), ['c1']);
    await h.call('PUT', '/counters/c1', { token: 'tok-a', json: { ...c, name: 'Renamed' } });
    assert.equal((await h.call('GET', '/counters', { token: 'tok-a' })).data[0].name, 'Renamed');
    for (const bad of [{ ...c, id: 'other' }, { ...c, name: '' }, { ...c, name: 'x'.repeat(61) }, { ...c, date: 'yesterday' }, { ...c, mode: 'sideways' }, { ...c, emoji: 'x'.repeat(17) }]) {
      assert.equal((await h.call('PUT', '/counters/c1', { token: 'tok-a', json: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await h.call('GET', '/partner/counters', { token: 'tok-b' })).data.error, 'not_paired');
    await pair(h);
    assert.equal((await h.call('GET', '/partner/counters', { token: 'tok-b' })).data[0].name, 'Renamed');
    assert.deepEqual((await h.call('GET', '/counters', { token: 'tok-b' })).data, []);
    assert.deepEqual((await h.call('DELETE', '/counters/c1', { token: 'tok-a' })).data, {});
    assert.deepEqual((await h.call('GET', '/counters', { token: 'tok-a' })).data, []);
  } finally { await h.close(); }
});

test('counter limit of 100', async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 100; i++) {
      const r = await h.call('PUT', `/counters/n${i}`, { token: 'tok-a', json: { id: `n${i}`, name: 'n', date: '2026-12-01T00:00:00Z', mode: 'since', emoji: '' } });
      assert.equal(r.status, 200);
    }
    assert.equal((await h.call('PUT', '/counters/over', { token: 'tok-a', json: { id: 'over', name: 'n', date: '2026-12-01T00:00:00Z', mode: 'since', emoji: '' } })).status, 400);
  } finally { await h.close(); }
});

test('devices: upsert, limit, validation, 503 without crypto secret', async () => {
  const h = await harness();
  try {
    const bad = [{ token: 'zz', channel: 'app', environment: 'sandbox' }, { token: DEV_A, channel: 'x', environment: 'sandbox' }, { token: DEV_A, channel: 'app', environment: 'x' }];
    for (const json of bad) assert.equal((await h.call('POST', '/devices', { token: 'tok-a', json })).status, 400);
    await register(h, 'tok-a', DEV_A, 'app');
    await register(h, 'tok-a', DEV_A.toUpperCase(), 'app');
    await register(h, 'tok-a', DEV_A, 'widgets');
    const stored = JSON.parse(fs.readFileSync(path.join(h.auraDir, 'users', 'user-a.json'), 'utf8'));
    assert.equal(stored.devices.length, 2);
    assert.ok(!JSON.stringify(stored).includes(DEV_A));
    for (let i = 0; i < 12; i++) await register(h, 'tok-a', String(i).padStart(2, '0').repeat(32), 'app');
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.auraDir, 'users', 'user-a.json'), 'utf8')).devices.length, 10);
  } finally { await h.close(); }
  const h2 = await harness({ noSecret: true });
  try {
    assert.equal((await h2.call('POST', '/devices', { token: 'tok-a', json: { token: DEV_A, channel: 'app', environment: 'sandbox' } })).status, 503);
  } finally { await h2.close(); }
});

test('widgets report and partner read', async () => {
  const h = await harness();
  try {
    assert.equal((await h.call('PUT', '/widgets', { token: 'tok-a', json: { widgets: [{ kind: '', family: 'small' }] } })).status, 400);
    assert.equal((await h.call('PUT', '/widgets', { token: 'tok-a', json: { widgets: Array.from({ length: 51 }, () => ({ kind: 'k', family: 'f' })) } })).status, 400);
    assert.equal((await h.call('GET', '/partner/widgets', { token: 'tok-b' })).status, 409);
    await pair(h);
    assert.deepEqual((await h.call('GET', '/partner/widgets', { token: 'tok-b' })).data, { widgets: [], reportedAt: null });
    assert.equal((await h.call('PUT', '/widgets', { token: 'tok-a', json: { widgets: [{ kind: 'counter', family: 'systemSmall', counterId: 'c1', style: 'bold' }] } })).status, 200);
    const got = (await h.call('GET', '/partner/widgets', { token: 'tok-b' })).data;
    assert.equal(got.widgets[0].counterId, 'c1');
    assert.match(got.reportedAt, /Z$/);
  } finally { await h.close(); }
});

test('multi-device: per-device widget reports merge for the partner', async () => {
  const h = await harness();
  try {
    await pair(h);
    const phone = [{ kind: 'AURADoodleWidget', family: 'systemSmall' }, { kind: 'AURAPhotoWidget', family: 'systemMedium' }];
    const ipad = [{ kind: 'AURADoodleWidget', family: 'systemSmall' }, { kind: 'AURADoodleWidget', family: 'systemLarge' }];
    assert.equal((await h.call('PUT', '/widgets', { token: 'tok-a', json: { installId: 'phone-1', widgets: phone } })).status, 200);
    h.clock.t += 1000;
    assert.equal((await h.call('PUT', '/widgets', { token: 'tok-a', json: { installId: 'ipad-1', widgets: ipad } })).status, 200);
    let got = (await h.call('GET', '/partner/widgets', { token: 'tok-b' })).data;
    assert.deepEqual(got.widgets.map(w => w.family).sort(), ['systemLarge', 'systemMedium', 'systemSmall']);
    // Re-reporting from one device replaces only that device's list.
    await h.call('PUT', '/widgets', { token: 'tok-a', json: { installId: 'ipad-1', widgets: [] } });
    got = (await h.call('GET', '/partner/widgets', { token: 'tok-b' })).data;
    assert.deepEqual(got.widgets, phone);
    // Signing out the phone drops its report.
    assert.equal((await h.call('POST', '/devices/remove', { token: 'tok-a', json: { installId: 'phone-1', tokens: [] } })).status, 200);
    assert.deepEqual((await h.call('GET', '/partner/widgets', { token: 'tok-b' })).data.widgets, []);
  } finally { await h.close(); }
});

test('switching accounts: a push token moves to the new account; remove unregisters it', async () => {
  const h = await harness();
  try {
    const read = id => JSON.parse(fs.readFileSync(path.join(h.auraDir, 'users', `${id}.json`), 'utf8')).devices;
    await register(h, 'tok-a', DEV_A, 'app');
    await register(h, 'tok-a', DEV_B_APP, 'app');   // second device, same account
    await register(h, 'tok-a', DEV_A, 'widgets');
    assert.equal(read('user-a').length, 3);
    // Same phone signs into carol: alice keeps her other device only.
    await register(h, 'tok-c', DEV_A, 'app');
    await register(h, 'tok-c', DEV_A, 'widgets');
    assert.equal(read('user-a').length, 1);
    assert.equal(read('user-c').length, 2);
    assert.equal((await h.call('POST', '/devices/remove', { token: 'tok-c', json: { tokens: [DEV_A.toUpperCase(), 'nope'] } })).status, 200);
    assert.equal(read('user-c').length, 0);
    assert.equal(read('user-a').length, 1);
  } finally { await h.close(); }
});

test('canvas: inbox versions, validation, limits and pushes to the partner only', async () => {
  const h = await harness();
  try {
    await pair(h);
    await register(h, 'tok-a', DEV_A, 'app');
    await register(h, 'tok-b', DEV_B_APP, 'app', 'sandbox');
    await register(h, 'tok-b', DEV_B_W, 'widgets');

    assert.equal((await h.call('PUT', '/canvas/doodle?size=small', { token: 'tok-a', raw: Buffer.from('garbage-bytes') })).status, 400);
    assert.equal((await h.call('PUT', '/canvas/doodle?size=huge', { token: 'tok-a', raw: PNG })).status, 400);
    assert.equal((await h.call('PUT', '/canvas/sketch?size=small', { token: 'tok-a', raw: PNG })).status, 400);
    assert.equal((await h.call('PUT', '/canvas/doodle?size=small', { token: 'tok-a', raw: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]) })).status, 413);
    assert.equal(h.sent.length, 0);

    const one = await h.call('PUT', '/canvas/doodle?size=small', { token: 'tok-a', raw: PNG });
    assert.equal(one.status, 200);
    assert.deepEqual(Object.keys(one.data).sort(), ['fromName', 'kind', 'sentAt', 'size', 'version']);
    assert.equal(one.data.version, 1);
    assert.equal(one.data.fromName, 'alice');
    const two = await h.call('PUT', '/canvas/doodle?size=small', { token: 'tok-a', raw: JPEG });
    assert.equal(two.data.version, 2);

    assert.deepEqual((await h.call('GET', '/inbox/doodle', { token: 'tok-a' })).data, []);
    const list = await h.call('GET', '/inbox/doodle', { token: 'tok-b' });
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].version, 2);
    const img = await h.call('GET', '/inbox/doodle/image?size=small', { token: 'tok-b' });
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.ok(img.buf.equals(JPEG));
    assert.equal((await h.call('GET', '/inbox/doodle/image?size=large', { token: 'tok-b' })).status, 404);
    assert.equal((await h.call('GET', '/inbox/photo', { token: 'tok-b' })).data.length, 0);

    // pushes: 2 canvases x (1 widgets + 1 app) to B only
    assert.equal(h.sent.length, 4);
    const w = h.sent.filter(s => s.pushType === 'widgets');
    const a = h.sent.filter(s => s.pushType === 'background');
    assert.equal(w.length, 2);
    assert.equal(a.length, 2);
    assert.equal(w[0].topic, 'ca.yannickmorgans.aura.push-type.widgets');
    assert.equal(w[0].priority, 10);
    assert.equal(w[0].token, DEV_B_W);
    assert.deepEqual(w[0].payload, { aps: { 'content-changed': true } });
    assert.equal(a[0].topic, 'ca.yannickmorgans.aura');
    assert.equal(a[0].priority, 5);
    assert.equal(a[0].token, DEV_B_APP);
    assert.equal(a[0].environment, 'sandbox');
    assert.deepEqual(a[0].payload, { aps: { 'content-available': 1 }, aura: { kind: 'doodle', size: 'small' } });
    assert.ok(h.sent.every(s => s.token !== DEV_A));
  } finally { await h.close(); }
});

test('canvas requires a pair and is rate limited to 30/hour', async () => {
  const h = await harness();
  try {
    assert.equal((await h.call('PUT', '/canvas/photo?size=medium', { token: 'tok-a', raw: JPEG })).status, 409);
    await pair(h);
    for (let i = 0; i < 30; i++) assert.equal((await h.call('PUT', '/canvas/photo?size=medium', { token: 'tok-a', raw: JPEG })).status, 200);
    assert.equal((await h.call('PUT', '/canvas/photo?size=medium', { token: 'tok-a', raw: JPEG })).status, 429);
    h.clock.t += 3600_001;
    assert.equal((await h.call('PUT', '/canvas/photo?size=medium', { token: 'tok-a', raw: JPEG })).status, 200);
  } finally { await h.close(); }
});

test('widgets pushes are debounced with one trailing push', async () => {
  const h = await harness({ debounceMs: 80 });
  try {
    await pair(h);
    await register(h, 'tok-b', DEV_B_W, 'widgets');
    for (let i = 0; i < 3; i++) await h.call('PUT', '/canvas/doodle?size=small', { token: 'tok-a', raw: PNG });
    assert.equal(h.sent.filter(s => s.pushType === 'widgets').length, 1);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(h.sent.filter(s => s.pushType === 'widgets').length, 2);
  } finally { await h.close(); }
});

test('notes: immediate delivery maps sound and interruption; validation', async () => {
  const h = await harness();
  try {
    await pair(h);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { title: '', body: '', sound: 'standard', interruption: 'active' } })).status, 400);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { title: 'x'.repeat(101) } })).status, 400);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'x'.repeat(1001) } })).status, 400);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'hi', badge: 100 } })).status, 400);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'hi', sound: 'boom' } })).status, 400);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'hi', imageId: 'a'.repeat(32) } })).status, 400);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'hi', sendAt: new Date(h.clock.t + 400 * 24 * 3600_000).toISOString() } })).status, 400);

    // no devices yet -> still 201, status failed
    const none = await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'hi', sound: 'standard', interruption: 'active' } });
    assert.equal(none.status, 201);
    assert.equal(none.data.status, 'failed');

    await register(h, 'tok-b', DEV_B_APP, 'app');
    await register(h, 'tok-b', DEV_B_W, 'widgets');
    const image = await h.call('POST', '/notes/images', { token: 'tok-a', raw: JPEG });
    assert.match(image.data.imageId, /^[0-9a-f]{32}$/);
    assert.equal((await h.call('POST', '/notes/images', { token: 'tok-a', raw: PNG })).status, 400);
    assert.equal((await h.call('PUT', '/notes/images', { token: 'tok-a', raw: JPEG })).status, 200);
    assert.equal((await h.call('POST', '/notes/images', { token: 'tok-a', raw: Buffer.alloc(1024 * 1024 + 1, 0xff) })).status, 413);
    h.sent.length = 0;
    const note = await h.call('POST', '/notes', { token: 'tok-a', json: { title: '', subtitle: 'sub', body: 'hello', imageId: image.data.imageId, sound: 'kiss', interruption: 'timeSensitive', badge: 3 } });
    assert.equal(note.status, 201);
    assert.equal(note.data.status, 'sent');
    assert.equal(h.sent.length, 1);
    const s = h.sent[0];
    assert.equal(s.pushType, 'alert');
    assert.equal(s.priority, 10);
    assert.equal(s.topic, 'ca.yannickmorgans.aura');
    assert.equal(s.token, DEV_B_APP);
    const { aps, aura } = s.payload;
    assert.deepEqual(aps.alert, { title: 'alice', subtitle: 'sub', body: 'hello' });
    assert.equal(aps.sound, 'kiss.caf');
    assert.equal(aps['interruption-level'], 'time-sensitive');
    assert.equal(aps.badge, 3);
    assert.equal(aps['mutable-content'], 1);
    assert.match(aps['thread-id'], /^[0-9a-f]{24}$/);
    assert.deepEqual(aura, { noteId: note.data.id, imageId: image.data.imageId });
    assert.equal((await h.call('GET', `/notes/images/${image.data.imageId}`, { token: 'tok-b' })).status, 200);
    assert.equal((await h.call('GET', `/notes/images/${image.data.imageId}`, { token: 'tok-c' })).status, 409);

    h.sent.length = 0;
    await h.call('POST', '/notes', { token: 'tok-a', json: { title: 'T', body: '', sound: 'none', interruption: 'passive' } });
    assert.equal(h.sent[0].priority, 5);
    assert.equal(h.sent[0].payload.aps.sound, undefined);
    assert.equal(h.sent[0].payload.aps['interruption-level'], 'passive');
    assert.equal(h.sent[0].payload.aura.imageId, undefined);
    await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'x', sound: 'standard' } });
    assert.equal(h.sent[1].payload.aps.sound, 'default');

    const mine = (await h.call('GET', '/notes', { token: 'tok-a' })).data;
    assert.equal(mine.length, 4);
    assert.ok(mine[0].createdAt >= mine[mine.length - 1].createdAt);
    assert.deepEqual((await h.call('GET', '/notes', { token: 'tok-b' })).data, []);
  } finally { await h.close(); }
});

test('notes: all pushes failing yields failed; invalid tokens are removed', async () => {
  const h = await harness();
  try {
    await pair(h);
    await register(h, 'tok-b', DEV_B_APP, 'app');
    h.behavior.result = () => ({ delivery: 'failed', reason: 'invalid_token' });
    const n = await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'x' } });
    assert.equal(n.status, 201);
    assert.equal(n.data.status, 'failed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.auraDir, 'users', 'user-b.json'), 'utf8')).devices.length, 0);
  } finally { await h.close(); }
});

test('notes: scheduled note delivered by scheduler tick; cancel rules; late notes fail', async () => {
  const h = await harness();
  try {
    await pair(h);
    await register(h, 'tok-b', DEV_B_APP, 'app');
    const at = iso => new Date(iso).toISOString();
    const sendAt = at(h.clock.t + 3600_000);
    const sched = await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'later', sendAt } });
    assert.equal(sched.status, 201);
    assert.equal(sched.data.status, 'scheduled');
    assert.equal(h.sent.length, 0);
    await h.aura.tick();
    assert.equal(h.sent.length, 0);

    // 4 seconds ahead still counts as immediate
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'soon', sendAt: at(h.clock.t + 4000) } })).data.status, 'sent');
    h.sent.length = 0;

    // cancel permissions
    const toCancel = await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'cancel me', sendAt: at(h.clock.t + 7200_000) } });
    assert.equal((await h.call('DELETE', `/notes/${toCancel.data.id}`, { token: 'tok-b' })).status, 403);
    assert.equal((await h.call('DELETE', `/notes/${toCancel.data.id}`, { token: 'tok-c' })).status, 409);
    assert.equal((await h.call('DELETE', `/notes/${toCancel.data.id}`, { token: 'tok-a' })).status, 200);
    assert.equal((await h.call('DELETE', `/notes/${toCancel.data.id}`, { token: 'tok-a' })).status, 409);
    assert.equal((await h.call('DELETE', '/notes/nonexistent', { token: 'tok-a' })).status, 404);

    h.clock.t += 3600_000 + 1000;
    await h.aura.tick();
    const delivered = h.sent.filter(s => s.pushType === 'alert');
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].payload.aps.alert.body, 'later');
    await h.aura.tick();
    assert.equal(h.sent.filter(s => s.pushType === 'alert').length, 1);
    const list = (await h.call('GET', '/notes', { token: 'tok-a' })).data;
    assert.equal(list.find(n => n.id === sched.data.id).status, 'sent');
    assert.equal(list.find(n => n.id === toCancel.data.id).status, 'cancelled');
    // sent notes cannot be cancelled
    assert.equal((await h.call('DELETE', `/notes/${sched.data.id}`, { token: 'tok-a' })).status, 409);

    // missed by more than 24h -> failed, not sent
    const stale = await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'stale', sendAt: at(h.clock.t + 600_000) } });
    h.sent.length = 0;
    h.clock.t += 600_000 + 25 * 3600_000;
    await h.aura.tick();
    assert.equal(h.sent.length, 0);
    assert.equal((await h.call('GET', '/notes', { token: 'tok-a' })).data.find(n => n.id === stale.data.id).status, 'failed');
  } finally { await h.close(); }
});

test('scheduler start/stop is idempotent', async () => {
  const h = await harness();
  try { h.aura.startScheduler(); h.aura.startScheduler(); h.aura.stopScheduler(); h.aura.stopScheduler(); } finally { await h.close(); }
});

test('notes: accept dates with or without milliseconds', async () => {
  const h = await harness();
  try {
    await pair(h);
    const r = await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'x', sendAt: '2026-10-16T00:00:00.500Z' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.draft.sendAt, '2026-10-16T00:00:00Z');
    assert.match(r.data.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'x', sendAt: '2026-10-16T00:00:00Z' } })).status, 201);
    assert.equal((await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'x', sendAt: 'tomorrow' } })).status, 400);
  } finally { await h.close(); }
});

test('unpair deletes inboxes, notes and images; partner routes then 409', async () => {
  const h = await harness();
  try {
    await pair(h);
    await h.call('PUT', '/canvas/doodle?size=small', { token: 'tok-a', raw: PNG });
    await h.call('PUT', '/canvas/photo?size=small', { token: 'tok-b', raw: JPEG });
    const image = await h.call('POST', '/notes/images', { token: 'tok-a', raw: JPEG });
    await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'x', sendAt: new Date(h.clock.t + 3600_000).toISOString(), imageId: image.data.imageId } });
    for (const d of ['inbox', 'pairs', 'notes', 'note-images', 'history']) assert.ok(fs.readdirSync(path.join(h.auraDir, d)).length > 0, d);

    assert.deepEqual((await h.call('DELETE', '/pair', { token: 'tok-b' })).data, {});
    for (const d of ['inbox', 'pairs', 'notes', 'note-images', 'history']) assert.deepEqual(fs.readdirSync(path.join(h.auraDir, d)), [], d);
    for (const who of ['tok-a', 'tok-b']) {
      const me = (await h.call('GET', '/me', { token: who })).data;
      assert.equal(me.partner, null);
      assert.equal(me.pairedAt, null);
      assert.equal((await h.call('GET', '/partner/counters', { token: who })).status, 409);
      assert.equal((await h.call('GET', '/partner/widgets', { token: who })).status, 409);
      assert.equal((await h.call('PUT', '/canvas/doodle?size=small', { token: who, raw: PNG })).status, 409);
      assert.equal((await h.call('POST', '/notes', { token: who, json: { body: 'x' } })).status, 409);
      assert.deepEqual((await h.call('GET', '/inbox/doodle', { token: who })).data, []);
    }
    // can pair again with someone else
    const token = (await h.call('POST', '/invites', { token: 'tok-a', json: {} })).data.url.split('#token=')[1];
    assert.equal((await h.call('POST', '/invites/accept', { token: 'tok-c', json: { token } })).status, 200);
  } finally { await h.close(); }
});

test('auth: every non-public route requires a bearer token', async () => {
  const h = await harness();
  try {
    const routes = [
      ['GET', '/me'], ['PUT', '/profile'], ['PUT', '/profile/avatar'], ['GET', '/avatar/user-a'], ['POST', '/invites'], ['POST', '/invites/accept'],
      ['DELETE', '/pair'], ['POST', '/devices'], ['GET', '/counters'], ['PUT', '/counters/c1'], ['DELETE', '/counters/c1'], ['GET', '/partner/counters'],
      ['PUT', '/widgets'], ['GET', '/partner/widgets'], ['PUT', '/canvas/doodle?size=small'], ['GET', '/inbox/doodle'], ['GET', '/inbox/doodle/image?size=small'],
      ['POST', '/notes/images'], ['GET', '/notes/images/abc'], ['POST', '/notes'], ['GET', '/notes'], ['DELETE', '/notes/abc'], ['GET', '/nonexistent'],
    ];
    for (const [m, r] of routes) {
      assert.equal((await h.call(m, r, {})).status, 401, `${m} ${r}`);
      assert.equal((await h.call(m, r, { token: 'bogus' })).status, 401, `${m} ${r} bogus`);
    }
    const res = await h.call('GET', '/me', {});
    assert.equal(typeof res.data.error, 'string');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await h.call('GET', '/nonexistent', { token: 'tok-a' })).status, 404);
  } finally { await h.close(); }
});

test('ids are validated against path traversal', async () => {
  const h = await harness();
  try {
    await pair(h);
    for (const bad of ['..%2F..%2Fetc', 'a.b', 'x'.repeat(65), 'a%20b']) {
      for (const [m, r] of [['GET', `/avatar/${bad}`], ['PUT', `/counters/${bad}`], ['DELETE', `/counters/${bad}`], ['GET', `/notes/images/${bad}`], ['DELETE', `/notes/${bad}`]]) {
        const res = await h.call(m, r, { token: 'tok-a', json: m === 'PUT' ? { id: bad } : undefined });
        assert.ok([400, 404].includes(res.status), `${m} ${r} -> ${res.status}`);
        assert.ok(res.status !== 200);
      }
    }
    assert.equal((await h.call('GET', '/avatar/a.b', { token: 'tok-a' })).status, 400);
    // fetch() normalizes '..' client-side, so exercise handle() directly.
    for (const urlPath of ['/api/aura/v1/notes/images/..', '/api/aura/v1/avatar/../../x', '/api/aura/v1/counters/..']) {
      let status = 0;
      let body = '';
      const res = { headersSent: false, writeHead(s) { status = s; }, end(b) { body = b; } };
      await h.aura.handle({ method: 'GET', url: urlPath, headers: { authorization: 'Bearer tok-a' } }, res, urlPath);
      assert.ok(status === 400 || status === 404, `${urlPath} -> ${status}`);
    }
    assert.equal(fs.existsSync(path.join(h.dir, 'etc')), false);
  } finally { await h.close(); }
});

test('handle ignores non-AURA paths and never leaks stack traces on bad JSON', async () => {
  const h = await harness();
  try {
    const res = await h.call('PUT', '/profile', { token: 'tok-a', raw: '{not json', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.data), ['error']);
    const r = { writeHead() { throw new Error('should not be called'); } };
    assert.equal(await h.aura.handle({ method: 'GET', headers: {} }, r, '/api/other'), false);
  } finally { await h.close(); }
});

test('history: canvases from both members, newest first, images, seeding and pair privacy', async () => {
  const h = await harness();
  try {
    assert.deepEqual((await h.call('GET', '/history/doodle', { token: 'tok-a' })).data, []);
    await pair(h);
    // a canvas sent before history existed is seeded from the inbox
    await h.call('PUT', '/canvas/doodle?size=small', { token: 'tok-a', raw: PNG });
    fs.rmSync(path.join(h.auraDir, 'history'), { recursive: true, force: true });
    h.clock.t += 1000;
    let list = (await h.call('GET', '/history/doodle', { token: 'tok-b' })).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].fromMe, false);
    assert.equal(list[0].fromName, 'alice');

    await h.call('PUT', '/canvas/doodle?size=medium', { token: 'tok-b', raw: JPEG });
    h.clock.t += 1000;
    await h.call('PUT', '/canvas/doodle?size=small', { token: 'tok-a', raw: JPEG });
    list = (await h.call('GET', '/history/doodle', { token: 'tok-a' })).data;
    assert.deepEqual(list.map(e => [e.fromMe, e.size]), [[true, 'small'], [false, 'medium'], [true, 'small']]);
    assert.deepEqual(Object.keys(list[0]).sort(), ['fromMe', 'fromName', 'id', 'kind', 'sentAt', 'size']);
    const img = await h.call('GET', `/history/doodle/${list[2].id}/image`, { token: 'tok-b' });
    assert.ok(img.buf.equals(PNG));
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await h.call('GET', `/history/doodle/${list[2].id}/image`, { token: 'tok-c' })).status, 404);
    assert.equal((await h.call('GET', `/history/photo/${list[2].id}/image`, { token: 'tok-a' })).status, 404);
    assert.equal((await h.call('GET', '/history/doodle/a.b/image', { token: 'tok-a' })).status, 400);
    assert.deepEqual((await h.call('GET', '/history/photo', { token: 'tok-a' })).data, []);
    assert.deepEqual((await h.call('GET', '/history/doodle', { token: 'tok-c' })).data, []);
  } finally { await h.close(); }
});

test('history: notes in both directions; recipients only see delivered notes', async () => {
  const h = await harness();
  try {
    await pair(h);
    await register(h, 'tok-b', DEV_B_APP, 'app');
    await register(h, 'tok-a', DEV_A, 'app');
    await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'hi bob' } });
    h.clock.t += 1000;
    await h.call('POST', '/notes', { token: 'tok-b', json: { title: 'hey', body: 'hi alice' } });
    const later = await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'later', sendAt: new Date(h.clock.t + 3600_000).toISOString() } });
    const cancelled = await h.call('POST', '/notes', { token: 'tok-a', json: { body: 'nope', sendAt: new Date(h.clock.t + 3600_000).toISOString() } });
    await h.call('DELETE', `/notes/${cancelled.data.id}`, { token: 'tok-a' });

    const a = (await h.call('GET', '/history/notes', { token: 'tok-a' })).data;
    assert.deepEqual(a.map(n => [n.draft.body, n.fromMe, n.status]), [['later', true, 'scheduled'], ['hi alice', false, 'sent'], ['hi bob', true, 'sent']]);
    const b = (await h.call('GET', '/history/notes', { token: 'tok-b' })).data;
    assert.deepEqual(b.map(n => [n.draft.body, n.fromMe]), [['hi alice', true], ['hi bob', false]]);
    assert.ok(!b.some(n => n.id === later.data.id));
    assert.deepEqual((await h.call('GET', '/history/notes', { token: 'tok-c' })).data, []);
  } finally { await h.close(); }
});
