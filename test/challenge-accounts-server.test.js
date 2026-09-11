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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
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
  assert.match(minted.body.url, new RegExp(`#token=${minted.body.token}$`));
  assert.match(minted.body.qrDataURL, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(_test.getChallengeAccounts()._readState()).includes(minted.body.token), false);
  const preview = await request('POST', '/api/challenge-invites/preview', { body: { token: minted.body.token } });
  assert.equal(preview.status, 200);
  assert.deepEqual(Object.keys(preview.body).sort(), ['challengeId', 'expiresAt', 'name', 'participantCount']);
  assert.equal((await request('POST', '/api/challenge-invites/accept', { token: OUTSIDER, body: { token: minted.body.token, userId: 'owner-id', role: 'owner' } })).status, 400);
  const joined = await request('POST', '/api/challenge-invites/accept', { token: OUTSIDER, body: { token: minted.body.token } });
  assert.equal(joined.status, 200); assert.equal(joined.body.alreadyMember, false);
  assert.deepEqual(joined.body.challenge.participants.find(p => p.userId === 'outsider-id'), { userId: 'outsider-id', role: 'member' });
  assert.equal((await request('POST', '/api/challenge-invites/accept', { token: OUTSIDER, body: { token: minted.body.token } })).body.alreadyMember, true);
  assert.equal((await request('DELETE', `/api/challenges/${id}/invites`, { token: OWNER })).status, 200);
  assert.equal((await request('POST', '/api/challenge-invites/preview', { body: { token: minted.body.token } })).status, 410);
});

test('review decisions prevent self-approval, are idempotent, and emit safe events', async () => {
  const created = await request('POST', '/api/challenges', { token: OWNER, body: {
    template: 'custom', name: 'Review workflow', participants: [{ userId: 'member-id', role: 'member' }],
    qualifyingActivities: ['Run'], thresholds: { distanceMeters: 5000 }, manualReview: true,
  } });
  const id = created.body.id;
  const accounts = _test.getChallengeAccounts();
  await accounts._mutate(state => {
    state.challenges[id].activities.activity_1 = { id: 'activity_1', userId: 'member-id', sportType: 'Run', name: 'Short run', startDate: '2026-09-09T12:00:00.000Z', distanceMeters: 1000, movingTime: 300 };
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
