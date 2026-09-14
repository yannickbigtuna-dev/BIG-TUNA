'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { after, before, test } = require('node:test');
const { createChallengeApns, createDeviceTokenCipher } = require('../lib/challenge-apns');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-challenge-accounts-'));
const previousDataDir = process.env.BIG_TUNA_DATA_DIR;
process.env.BIG_TUNA_DATA_DIR = dataDir;
const { server, _test } = require('../server');

let baseUrl;
const OWNER = 'challenge-owner-token';
const MEMBER = 'challenge-member-token';
const OUTSIDER = 'challenge-outsider-token';

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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text && String(res.headers['content-type'] || '').includes('application/json') ? JSON.parse(text) : text || null }));
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

before(async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  writeJson(path.join(dataDir, 'users.json'), [
    { id: 'owner-id', username: 'yannick', salt: 'website-salt', passwordHash: crypto.createHash('sha256').update('website-saltnormal-password').digest('hex') }, { id: 'member-id', username: 'fishyemma' }, { id: 'outsider-id', username: 'other' },
  ]);
  writeJson(path.join(dataDir, 'sessions.json'), [
    { token: OWNER, userId: 'owner-id', expiresAt }, { token: MEMBER, userId: 'member-id', expiresAt }, { token: OUTSIDER, userId: 'outsider-id', expiresAt },
  ]);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  if (previousDataDir === undefined) delete process.env.BIG_TUNA_DATA_DIR; else process.env.BIG_TUNA_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('challenge routes enforce sessions, membership, and owner-only settings', async () => {
  assert.equal((await request('GET', '/api/challenges')).status, 401);
  assert.equal((await request('POST', '/api/challenges', { token: OWNER, body: [] })).status, 400);
  const profile = await request('GET', '/api/challenge-accounts/me', { token: OWNER });
  assert.equal(profile.status, 200); assert.equal(profile.headers['cache-control'], 'no-store');
  assert.equal(JSON.stringify(profile.body).includes('accessToken'), false);
  const created = await request('POST', '/api/challenges', { token: OWNER, body: {
    template: 'custom', name: 'Server workflow', participants: [{ userId: 'member-id', role: 'member' }],
    qualifyingActivities: ['Run'], thresholds: { distanceMeters: 5000 }, manualReview: true,
  } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await request('GET', `/api/challenges/${id}`, { token: MEMBER })).status, 200);
  assert.equal((await request('PUT', `/api/challenges/${id}/settings`, { token: MEMBER, body: { manualReview: false } })).status, 403);
  assert.equal((await request('GET', `/api/challenges/${id}`, { token: OUTSIDER })).status, 404);
  assert.equal((await request('DELETE', `/api/challenges/${id}`, { token: MEMBER })).status, 403);
  assert.deepEqual((await request('DELETE', `/api/challenges/${id}`, { token: OWNER })).body, { deleted: true });
  assert.equal((await request('GET', `/api/challenges/${id}`, { token: OWNER })).status, 404);
});

test('an admin route cannot promote itself or mutate ownership', async () => {
  const created = await request('POST', '/api/challenges', { token: OWNER, body: {
    template: 'custom', name: 'Route ownership', participants: [{ userId: 'member-id', role: 'admin' }], qualifyingActivities: ['Run'],
  } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const attempted = await request('PUT', `/api/challenges/${id}/settings`, { token: MEMBER, body: {
    participants: [{ userId: 'owner-id', role: 'owner' }, { userId: 'member-id', role: 'owner' }],
  } });
  assert.equal(attempted.status, 403);
  const detail = await request('GET', `/api/challenges/${id}`, { token: OWNER });
  assert.deepEqual(detail.body.participants.map(p => ({ userId: p.userId, role: p.role })), [
    { userId: 'owner-id', role: 'owner' }, { userId: 'member-id', role: 'admin' },
  ]);
  assert.equal((await request('DELETE', `/api/challenges/${id}`, { token: MEMBER })).status, 403);
});

test('ordinary website login bearer session accesses the challenge account profile', async () => {
  const login = await request('POST', '/api/auth/login', { body: { username: 'yannick', password: 'normal-password' } });
  assert.equal(login.status, 200);
  const profile = await request('GET', '/api/challenge-accounts/me', { token: login.body.token });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.id, 'owner-id');
});

test('invite routes keep tokens out of state, expose safe previews, and join only the current account', async () => {
  const created = await request('POST', '/api/challenges', { token: OWNER, body: {
    template: 'custom', name: 'Invite workflow', qualifyingActivities: ['Run'], thresholds: { distanceMeters: 5000 }, manualReview: true,
  } });
  const id = created.body.id;
  assert.equal((await request('POST', `/api/challenges/${id}/invites`, { token: MEMBER, body: {} })).status, 404);
  const minted = await request('POST', `/api/challenges/${id}/invites`, { token: OWNER, body: {} });
  assert.equal(minted.status, 201);
  assert.match(minted.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(minted.body.code, /^[A-Z]{6}$/);
  assert.match(minted.body.url, new RegExp(`#token=${minted.body.token}$`));
  assert.match(minted.body.qrDataURL, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(_test.getChallengeAccounts()._readState()).includes(minted.body.token), false);
  const preview = await request('POST', '/api/challenge-invites/preview', { body: { token: minted.body.token } });
  assert.equal(preview.status, 200);
  assert.deepEqual(Object.keys(preview.body).sort(), ['challengeId', 'expiresAt', 'name', 'participantCount']);
  assert.equal((await request('POST', '/api/challenge-invites/accept', { token: OUTSIDER, body: { token: minted.body.token, userId: 'owner-id', role: 'owner' } })).status, 404);
  const joined = await request('POST', '/api/challenge-invites/accept', { token: OUTSIDER, body: { token: minted.body.token } });
  assert.equal(joined.status, 200); assert.equal(joined.body.alreadyMember, false);
  assert.deepEqual(joined.body.challenge.participants.find(p => p.userId === 'outsider-id'), { userId: 'outsider-id', username: 'other', role: 'member', team: 'blue' });
  assert.equal((await request('POST', '/api/challenge-invites/accept', { token: OUTSIDER, body: { token: minted.body.token } })).body.alreadyMember, true);
  assert.equal((await request('DELETE', `/api/challenges/${id}/invites`, { token: OWNER })).status, 200);
  assert.equal((await request('POST', '/api/challenge-invites/preview', { body: { token: minted.body.token } })).status, 404);
});

test('code invitations use the same real routes and expiry rules as token invitations', async () => {
  const created = await request('POST', '/api/challenges', { token: OWNER, body: { template: 'custom', name: 'Code workflow', qualifyingActivities: ['Run'] } });
  assert.equal(created.status, 201);
  const minted = await request('POST', `/api/challenges/${created.body.id}/invites`, { token: OWNER, body: {} });
  assert.equal(minted.status, 201);
  const preview = await request('POST', '/api/challenge-invites/preview', { body: { code: ` ${minted.body.code.toLowerCase()} ` } });
  assert.equal(preview.status, 200);
  assert.equal((await request('POST', '/api/challenge-invites/preview', { body: { code: `${minted.body.code.slice(0, 3)} ${minted.body.code.slice(3)}` } })).status, 404);
  const joined = await request('POST', '/api/challenge-invites/accept', { token: MEMBER, body: { code: minted.body.code.toLowerCase() } });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.alreadyMember, false);
  await _test.getChallengeAccounts()._mutate(state => { state.challenges[created.body.id].invite.expiresAt = '2000-01-01T00:00:00.000Z'; });
  assert.equal((await request('POST', '/api/challenge-invites/preview', { body: { code: minted.body.code } })).status, 404);
});

test('member leave is separate from owner deletion and cleans member-scoped state', async () => {
  const created = await request('POST', '/api/challenges', { token: OWNER, body: { template: 'custom', name: 'Leave workflow', participants: [{ userId: 'member-id', role: 'member' }], qualifyingActivities: ['Run'], manualReview: true } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  await _test.getChallengeAccounts()._mutate(state => {
    const challenge = state.challenges[id];
    challenge.activities.member_activity = { id: 'member_activity', userId: 'member-id', sportType: 'Run', startDate: '2026-09-09T12:00:00.000Z', distanceMeters: 1, movingTime: 1 };
    challenge.reviews.member_review = { id: 'member_review', activityId: 'member_activity', requesterId: 'member-id', status: 'pending' };
    state.notificationEvents.member_event = { id: 'member_event', challengeId: id, recipientId: 'owner-id', reviewId: 'member_review' };
  });
  assert.equal((await request('POST', `/api/challenges/${id}/leave`, { token: OWNER, body: {} })).status, 403);
  assert.deepEqual((await request('POST', `/api/challenges/${id}/leave`, { token: MEMBER, body: {} })).body, { left: true });
  const ownerDetail = await request('GET', `/api/challenges/${id}`, { token: OWNER });
  assert.equal(ownerDetail.status, 200);
  assert.equal(ownerDetail.body.participants.some(participant => participant.userId === 'member-id'), false);
  assert.equal(ownerDetail.body.activities.some(activity => activity.participantID === 'member-id'), false);
  const state = _test.getChallengeAccounts()._readState();
  assert.equal(state.challenges[id].reviews.member_review, undefined);
  assert.equal(state.notificationEvents.member_event, undefined);
});

test('team selection is self-scoped and two-person selection flips the peer without changing roles', async () => {
  const created = await request('POST', '/api/challenges', { token: OWNER, body: { template: 'custom', name: 'Team workflow', participants: [{ userId: 'member-id', role: 'member' }], qualifyingActivities: ['Run'] } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.participants.map(p => ({ role: p.role, team: p.team })), [
    { role: 'owner', team: 'red' }, { role: 'member', team: 'blue' },
  ]);
  assert.equal((await request('PUT', `/api/challenges/${created.body.id}/team`, { token: OUTSIDER, body: { team: 'red' } })).status, 404);
  assert.equal((await request('PUT', `/api/challenges/${created.body.id}/team`, { token: MEMBER, body: { team: 'green' } })).status, 400);
  const changed = await request('PUT', `/api/challenges/${created.body.id}/team`, { token: MEMBER, body: { team: 'red' } });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.participants.map(p => ({ role: p.role, team: p.team })), [
    { role: 'owner', team: 'blue' }, { role: 'member', team: 'red' },
  ]);
});

test('detail reads are durable-only and refresh coalesces participants across visible challenges', async () => {
  const original = _test.getStravaChallenge();
  const syncCalls = [];
  const cached = {
    'owner-id': [{ id: 'owner-run', sportType: 'Run', name: 'Cached owner run', startDate: '2026-09-12T12:00:00.000Z', distanceMeters: 6000, movingTime: 1800 }],
    'member-id': [{ id: 'member-run', sportType: 'Run', name: 'Cached member run', startDate: '2026-09-12T13:00:00.000Z', distanceMeters: 7000, movingTime: 1900 }],
  };
  const stub = {
    getAccountStatus: async ({ id }) => ({ connected: id === 'owner-id' || id === 'member-id' }),
    syncAccountActivities: async ({ id }) => { syncCalls.push(id); if (id === 'member-id') throw new Error('provider unavailable'); return { activities: cached[id] }; },
    getAccountActivities: ({ id }) => cached[id] || [],
    getPublicDashboard: async () => ({ currentWeek: { activities: [] } }),
  };
  _test.setStravaChallenge(stub);
  try {
    const first = await request('POST', '/api/challenges', { token: OWNER, body: { template: 'custom', name: 'Refresh one', participants: [{ userId: 'member-id', role: 'member' }], qualifyingActivities: ['Run'] } });
    const second = await request('POST', '/api/challenges', { token: OWNER, body: { template: 'custom', name: 'Refresh two', participants: [{ userId: 'member-id', role: 'member' }], qualifyingActivities: ['Run'] } });
    assert.equal((await request('GET', `/api/challenges/${first.body.id}`, { token: OWNER })).status, 200);
    assert.deepEqual(syncCalls, []);
    assert.equal((await request('POST', '/api/challenges/refresh', { token: OWNER, body: {} })).status, 400);
    const refreshed = await request('POST', '/api/challenges/refresh', { token: OWNER });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.headers['cache-control'], 'no-store');
    assert.equal(refreshed.body.partial, true);
    assert.match(refreshed.body.refreshedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(syncCalls.sort(), ['member-id', 'owner-id']);
    for (const id of [first.body.id, second.body.id]) {
      const detail = refreshed.body.challenges.find(challenge => challenge.id === id);
      assert.ok(detail.activities.some(activity => activity.id === 'account_owner-id_owner-run'));
      assert.ok(detail.activities.some(activity => activity.id === 'account_member-id_member-run'));
    }
  } finally {
    _test.setStravaChallenge(original);
  }
});

test('refresh wait is bounded and overlapping requests reuse the participant sync', async () => {
  const detail = {
    id: 'challenge_bound',
    participants: [{ userId: 'bounded-user', role: 'owner', team: 'red' }],
    currentScore: { 'bounded-user': 7 },
    activities: [{ id: 'saved-activity' }],
  };
  const accounts = {
    listChallenges: async () => [detail],
    getChallenge: async () => detail,
    ingestActivities: async () => [],
  };
  let syncCalls = 0;
  const service = {
    getAccountStatus: async () => ({ connected: true }),
    syncAccountActivities: async () => { syncCalls++; return new Promise(() => {}); },
    getAccountActivities: () => [],
    getPublicDashboard: async () => ({ currentWeek: { activities: [] } }),
  };
  const startedAt = Date.now();
  const results = await Promise.all([
    _test.refreshChallengeAccountData({ id: 'bounded-user' }, { accounts, service, timeoutMs: 20 }),
    _test.refreshChallengeAccountData({ id: 'bounded-user' }, { accounts, service, timeoutMs: 20 }),
  ]);
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(syncCalls, 1);
  assert.equal(results.every(result => result.partial && result.challenges[0].id === detail.id), true);
  assert.equal(results.every(result => result.challenges[0].currentScore['bounded-user'] === 7), true);
  assert.equal(results.every(result => result.challenges[0].activities[0].id === 'saved-activity'), true);
  const retry = await _test.refreshChallengeAccountData({ id: 'bounded-user' }, { accounts, service, timeoutMs: 20 });
  assert.equal(retry.partial, true);
  assert.equal(syncCalls, 2);
});

test('refresh deadline also bounds cache and legacy dashboard reads', async () => {
  const detail = { id: 'challenge_bound_reads', participants: [{ userId: 'bounded-user', role: 'owner', team: 'red' }], activities: [] };
  const accounts = {
    listChallenges: async () => [detail],
    getChallenge: async () => detail,
    ingestActivities: async () => [],
  };
  const cases = [
    {
      name: 'account activity cache',
      service: {
        getAccountStatus: async () => ({ connected: false }),
        syncAccountActivities: async () => [],
        getAccountActivities: () => new Promise(() => {}),
        getPublicDashboard: async () => ({ currentWeek: { activities: [] } }),
      },
    },
    {
      name: 'legacy public dashboard',
      service: {
        getAccountStatus: async () => ({ connected: false }),
        syncAccountActivities: async () => [],
        getAccountActivities: async () => [],
        getPublicDashboard: () => new Promise(() => {}),
      },
    },
  ];
  for (const entry of cases) {
    const startedAt = Date.now();
    const result = await _test.refreshChallengeAccountData({ id: 'bounded-user' }, { accounts, service: entry.service, timeoutMs: 20 });
    assert.ok(Date.now() - startedAt < 500, `${entry.name} exceeded the bounded test window`);
    assert.equal(result.partial, true);
    assert.equal(result.challenges[0].id, detail.id);
  }
});

test('AASA is fail-closed until the exact application identifier is configured', async () => {
  const original = process.env.CHALLENGE_AASA_APPLICATION_ID;
  try {
    process.env.CHALLENGE_AASA_APPLICATION_ID = 'ABCDEFGHIJ.ca.yannickmorgans.OtherApp';
    assert.equal((await request('GET', '/.well-known/apple-app-site-association')).status, 404);
    process.env.CHALLENGE_AASA_APPLICATION_ID = 'ABCDEFGHIJ.ca.yannickmorgans.YannickChallengeIOS';
    const response = await request('GET', '/.well-known/apple-app-site-association?token=should-not-appear');
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(response.body, { applinks: { details: [{ appIDs: ['ABCDEFGHIJ.ca.yannickmorgans.YannickChallengeIOS'], components: [{ '/': '/challenge-invite' }, { '/': '/challenge-invite/*' }] }] } });
    assert.equal(JSON.stringify(response.body).includes('should-not-appear'), false);
    assert.equal((await request('HEAD', '/apple-app-site-association')).status, 200);
  } finally {
    if (original === undefined) delete process.env.CHALLENGE_AASA_APPLICATION_ID;
    else process.env.CHALLENGE_AASA_APPLICATION_ID = original;
  }
});

test('malformed deep-link path encoding returns a safe client error', async () => {
  const response = await request('GET', '/challenge-invite/%ZZ');
  assert.equal(response.status, 400);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('review decisions prevent self-approval, are idempotent, and emit safe events', async () => {
  const created = await request('POST', '/api/challenges', { token: OWNER, body: {
    template: 'custom', name: 'Review workflow', participants: [{ userId: 'member-id', role: 'member' }],
    qualifyingActivities: ['Run'], thresholds: { distanceMeters: 5000 }, manualReview: true,
  } });
  const id = created.body.id;
  const accounts = _test.getChallengeAccounts();
  await accounts._mutate(state => {
    state.challenges[id].activities.activity_1 = { id: 'activity_1', userId: 'member-id', sportType: 'Run', name: 'Short run', startDate: new Date().toISOString(), distanceMeters: 1000, movingTime: 300 };
  });
  const review = await request('POST', `/api/challenges/${id}/review-requests`, { token: MEMBER, body: { activityId: 'activity_1', reason: 'GPS correction' } });
  assert.equal(review.status, 201);
  assert.equal((await request('POST', `/api/challenges/${id}/review-requests`, { token: MEMBER, body: { activityId: 'activity_1' } })).status, 409);
  assert.equal((await request('POST', `/api/challenges/${id}/review-requests/${review.body.id}/decision`, { token: MEMBER, body: { decision: 'approve' } })).status, 403);
  const approved = await request('POST', `/api/challenges/${id}/review-requests/${review.body.id}/decision`, { token: OWNER, body: { decision: 'approve' } });
  assert.equal(approved.status, 200); assert.equal(approved.body.idempotent, false); assert.equal(approved.body.challenge.currentScore['member-id'], 1);
  assert.equal((await request('POST', `/api/challenges/${id}/review-requests/${review.body.id}/decision`, { token: OWNER, body: { decision: 'approve' } })).body.idempotent, true);
  const events = await request('GET', `/api/challenges/${id}/notification-events`, { token: MEMBER });
  assert.equal(events.status, 200); assert.equal(events.body.events[0].delivery, 'failed'); assert.equal(JSON.stringify(events.body).includes('endpoint'), false);
});

test('device-token encryption and unavailable APNs delivery never expose a raw token', async () => {
  const token = 'a'.repeat(64);
  const cipher = createDeviceTokenCipher({ env: { CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET: 'x'.repeat(48) } });
  const encrypted = cipher.encrypt(token);
  assert.equal(JSON.stringify(encrypted).includes(token), false);
  assert.equal(cipher.decrypt(encrypted), token);
  const delivery = await createChallengeApns({ env: {} }).send({ token, eventType: 'review_requested', challengeId: 'challenge_1', reviewId: 'review_1', title: 'Review requested', body: 'A participant requested a review.' });
  assert.deepEqual(delivery, { delivery: 'failed', reason: 'unavailable' });
  assert.equal(JSON.stringify(delivery).includes(token), false);
});

test('device registration fails safely when the deployment encryption key is absent', async () => {
  const token = 'b'.repeat(64);
  const result = await request('POST', '/api/challenge-devices', { token: OWNER, body: { token, platform: 'ios' } });
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.body).includes(token), false);
});

test('registration creates a shared scrypt account and concurrent duplicate signup is safe', async () => {
  const results = await Promise.all([1,2].map(() => request('POST','/api/auth/register',{body:{username:'new_runner',password:'a secure test password'}})));
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  const registered = results.find(x=>x.status===200);
  assert.equal(registered.headers['cache-control'],'no-store');
  const users = JSON.parse(fs.readFileSync(path.join(dataDir,'users.json')));
  assert.equal(users.filter(x=>x.username==='new_runner').length,1);
  const saved = users.find(x=>x.username==='new_runner');
  assert.match(saved.passwordHash,/^scrypt\$/);
  assert.equal(JSON.stringify(saved).includes('a secure test password'),false);
  const login = await request('POST','/api/auth/login',{body:{username:'NEW_RUNNER',password:'a secure test password'}});
  assert.equal(login.status,200); assert.equal(login.body.id,registered.body.id);
  const profile = await request('GET','/api/challenge-accounts/me',{token:registered.body.token});
  assert.equal(profile.body.id,registered.body.id);
  assert.equal((await request('POST','/api/auth/login',{body:{username:'new_runner',password:'wrong'}})).status,401);
  assert.equal((await request('POST','/api/auth/register',{body:{username:[],password:{}}})).status,400);
});

test('concurrent password resets are single-use and retain unrelated registrations',async()=>{
  const users = JSON.parse(fs.readFileSync(path.join(dataDir,'users.json')));
  const target=users.find(x=>x.username==='new_runner');
  writeJson(path.join(dataDir,'password-resets.json'),[{token:'test-reset',userId:target.id,expiresAt:new Date(Date.now()+60000).toISOString()}]);
  const results=await Promise.all([1,2].map(()=>request('POST','/api/auth/reset-password',{body:{token:'test-reset',password:'changed-password'}})));
  assert.deepEqual(results.map(x=>x.status).sort(),[200,400]);
  assert.equal((await request('POST','/api/auth/login',{body:{username:'new_runner',password:'changed-password'}})).status,200);
  assert.equal((await request('POST','/api/auth/login',{body:{username:'new_runner',password:'a secure test password'}})).status,401);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'users.json'))).length,users.length);
});

test('challenge-notifications routes require authentication and send test notifications', async () => {
  assert.equal((await request('POST', '/api/challenge-notifications/test')).status, 401);
  assert.equal((await request('GET', '/api/challenge-notifications/status')).status, 401);

  const statusResponse = await request('GET', '/api/challenge-notifications/status', { token: OWNER });
  assert.equal(statusResponse.status, 200);
  assert.equal(typeof statusResponse.body.hasRegisteredDevice, 'boolean');

  const testResponse = await request('POST', '/api/challenge-notifications/test', { token: OWNER });
  assert.equal(testResponse.status, 200);
  assert.equal(typeof testResponse.body.sent, 'boolean');
});

