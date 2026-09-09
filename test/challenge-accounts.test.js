'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createChallengeAccounts, ChallengeAccountsError } = require('../lib/challenge-accounts');

const now = () => new Date('2026-09-09T12:00:00.000Z');
function service(options = {}) { return createChallengeAccounts({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'challenge-accounts-')), now, deviceTokenCipher: { encrypt: token => Buffer.from(token).toString('base64'), decrypt: cipher => Buffer.from(cipher, 'base64').toString() }, ...options }); }
const user = (id, username = id) => ({ id, username });
async function challenge(s, owner = user('owner')) { return s.createChallenge(owner, { template: 'custom', name: 'Test', participants: [{ userId: 'owner', role: 'owner' }, { userId: 'member', role: 'member' }], qualifyingActivities: ['Run'], thresholds: { distanceMeters: 5000 }, manualReview: true }); }
async function seedActivity(s, challengeId, activity) { await s._mutate(state => { state.challenges[challengeId].activities[activity.id] = activity; }); }
async function rejectsCode(promise, code) { await assert.rejects(promise, error => error instanceof ChallengeAccountsError && error.code === code); }

test('validates rules and isolates challenge visibility by membership', async () => {
  const s = service();
  await rejectsCode(s.createChallenge(user('owner'), { template: 'custom', qualifyingActivities: [] }), 'invalid_rules');
  const c = await challenge(s);
  await rejectsCode(s.getChallenge(user('outsider'), c.id), 'not_found');
  assert.equal((await s.listChallenges(user('member')))[0].id, c.id);
  await rejectsCode(s.updateSettings(user('member'), c.id, { manualReview: false }), 'forbidden');
});

test('creation grants the authenticated creator owner control for every template', async () => {
  const s = service();
  const c = await s.createChallenge(user('actual-user'), { template: 'yannick-emma-default' });
  assert.deepEqual(c.participants.find(p => p.userId === 'actual-user'), { userId: 'actual-user', role: 'owner' });
  const supplied = await s.createChallenge(user('creator'), { template: 'custom', participants: [{ userId: 'someone-else', role: 'owner' }] });
  assert.deepEqual(supplied.participants.find(p => p.userId === 'creator'), { userId: 'creator', role: 'owner' });
});

test('rejects malformed object inputs with public 400 errors', async () => {
  const s = service(); const c = await challenge(s);
  await rejectsCode(s.createChallenge(user('owner'), null), 'invalid_challenge');
  await rejectsCode(s.updateSettings(user('owner'), c.id, []), 'invalid_challenge');
  await rejectsCode(s.createReviewRequest(user('member'), c.id, null), 'invalid_review');
  await rejectsCode(s.decideReviewRequest(user('owner'), c.id, 'missing', []), 'invalid_decision');
  await rejectsCode(s.registerDevice(user('owner'), 'subscription'), 'invalid_device');
  await rejectsCode(s.listReviewRequests(user('owner'), c.id, null), 'invalid_review');
});

test('prevents duplicate pending reviews and self approval', async () => {
  const s = service(); const c = await challenge(s);
  await seedActivity(s, c.id, { id: 'a1', userId: 'owner', sportType: 'Run', distanceMeters: 1000, movingTime: 300, startDate: now().toISOString() });
  const review = await s.createReviewRequest(user('owner'), c.id, { activityId: 'a1', reason: 'GPS was wrong' });
  await rejectsCode(s.createReviewRequest(user('owner'), c.id, { activityId: 'a1' }), 'review_pending');
  await rejectsCode(s.decideReviewRequest(user('owner'), c.id, review.id, { decision: 'approve' }), 'self_approval_forbidden');
});

test('trusted activity ingestion is member-scoped, bounded, normalized, and preserves review state', async () => {
  const s = service(); const c = await challenge(s);
  await rejectsCode(s.ingestActivities(user('outsider'), c.id, []), 'not_found');
  const saved = await s.ingestActivities(user('owner'), c.id, [{ id: 'strava-1', userId: 'member', type: 'Run', name: 'Morning run', startDate: now().toISOString(), distance: 1000, durationSeconds: 300 }]);
  assert.deepEqual(saved[0], { id: 'strava-1', sportType: 'Run', name: 'Morning run', startDate: now().toISOString(), distanceMeters: 1000, movingTime: 300, qualifies: false, reviewState: null });
  await s._mutate(state => { state.challenges[c.id].activities['strava-1'].manualQualification = true; state.challenges[c.id].activities['strava-1'].reviewState = 'approved'; });
  await s.ingestActivities(user('owner'), c.id, [{ id: 'strava-1', userId: 'member', sportType: 'Run', startDate: now().toISOString(), distanceMeters: 1100, movingTime: 360 }]);
  const detail = await s.getChallenge(user('member'), c.id);
  assert.equal(detail.activities[0].qualifies, true); assert.equal(detail.activities[0].reviewState, 'approved');
  await rejectsCode(s.ingestActivities(user('owner'), c.id, [{ id: 'bad', userId: 'outsider', sportType: 'Run', startDate: now().toISOString() }]), 'invalid_activities');
});

test('current score follows weekly cadence while season score retains prior weeks', async () => {
  const s = service(); const c = await challenge(s);
  await s.ingestActivities(user('owner'), c.id, [
    { id: 'current', userId: 'member', sportType: 'Run', startDate: '2026-09-08T12:00:00.000Z', distanceMeters: 6000, movingTime: 1800 },
    { id: 'prior', userId: 'member', sportType: 'Run', startDate: '2026-08-31T12:00:00.000Z', distanceMeters: 6000, movingTime: 1800 }
  ]);
  const detail = await s.getChallenge(user('member'), c.id);
  assert.equal(detail.currentScore.member, 1); assert.equal(detail.seasonScore.member, 2);
});

test('approval is idempotent, recalculates score, and retains redacted events', async () => {
  const s = service({ notificationConfigured: false }); const c = await challenge(s);
  await seedActivity(s, c.id, { id: 'a1', userId: 'member', sportType: 'Run', distanceMeters: 1000, movingTime: 300, startDate: now().toISOString() });
  const review = await s.createReviewRequest(user('member'), c.id, { activityId: 'a1' });
  const approved = await s.decideReviewRequest(user('owner'), c.id, review.id, { decision: 'approve' });
  assert.equal(approved.idempotent, false); assert.equal(approved.challenge.currentScore.member, 1);
  const again = await s.decideReviewRequest(user('owner'), c.id, review.id, { decision: 'approve' });
  assert.equal(again.idempotent, true); assert.equal(again.challenge.currentScore.member, 1);
  const events = await s.listNotificationEvents(user('member'), c.id);
  assert.equal(events[0].delivery, 'failed'); assert.equal(JSON.stringify(events).includes('endpoint'), false);
});

test('profile and device registration redact Strava credentials and subscriptions', async () => {
  const s = service({ notificationConfigured: true, getStravaStatus: () => ({ connected: true, accessToken: 'secret', refreshToken: 'secret2', athlete: { id: 9, firstname: 'A', lastname: 'Private' } }) });
  const profile = await s.getProfile(user('owner', 'Owner'));
  assert.equal(profile.strava.connected, true); assert.equal(JSON.stringify(profile).includes('secret'), false);
  const token = 'a'.repeat(64);
  const device = await s.registerDevice(user('owner'), { token, platform: 'ios' });
  assert.equal(device.registered, true); assert.equal(JSON.stringify(device).includes('private'), false);
  assert.equal(JSON.stringify(s._readState()).includes(token), false);
});

test('two-person peers can decide each other’s reviews while settings stay manager-only', async () => {
  const s = service(); const c = await challenge(s);
  await seedActivity(s, c.id, { id: 'a1', userId: 'owner', sportType: 'Run', distanceMeters: 1000, movingTime: 300, startDate: now().toISOString() });
  const review = await s.createReviewRequest(user('owner'), c.id, { activityId: 'a1' });
  const inbox = await s.listReviewInbox(user('member'));
  assert.equal(inbox.length, 1); assert.equal(inbox[0].challenge.id, c.id); assert.equal(inbox[0].review.id, review.id);
  await rejectsCode(s.updateSettings(user('member'), c.id, { manualReview: false }), 'forbidden');
  const decision = await s.decideReviewRequest(user('member'), c.id, review.id, { decision: 'approve' });
  assert.equal(decision.review.status, 'approved');
  assert.equal(decision.challenge.currentScore.owner, 1);
  const again = await s.decideReviewRequest(user('member'), c.id, review.id, { decision: 'approve' });
  assert.equal(again.idempotent, true);
  const state = s._readState().challenges[c.id];
  assert.equal(state.history.filter(x => x.type === 'review_approved').length, 1);
  assert.equal(state.audit.filter(x => x.type === 'review_approved').length, 1);
});

test('three-or-more participant reviews require a non-requester manager', async () => {
  const s = service(); const c = await s.createChallenge(user('owner'), { template: 'custom', name: 'Three', participants: [{ userId: 'owner', role: 'owner' }, { userId: 'member', role: 'member' }, { userId: 'peer', role: 'member' }], qualifyingActivities: ['Run'], thresholds: { distanceMeters: 5000 }, manualReview: true });
  await seedActivity(s, c.id, { id: 'a1', userId: 'member', sportType: 'Run', distanceMeters: 1, movingTime: 1, startDate: now().toISOString() });
  const review = await s.createReviewRequest(user('member'), c.id, { activityId: 'a1' });
  assert.equal((await s.listReviewInbox(user('peer'))).length, 0);
  await rejectsCode(s.decideReviewRequest(user('peer'), c.id, review.id, { decision: 'approve' }), 'forbidden');
  assert.equal((await s.listReviewInbox(user('owner'))).length, 1);
});

test('push fallback persists events and invalid tokens are disabled without leakage', async () => {
  const sends = [];
  const s = service({ notificationSender: async input => { sends.push(input); return { invalidToken: true }; } }); const c = await challenge(s);
  const token = 'b'.repeat(64); await s.registerDevice(user('owner'), { token, platform: 'ios' });
  await seedActivity(s, c.id, { id: 'a1', userId: 'member', sportType: 'Run', distanceMeters: 1, movingTime: 1, startDate: now().toISOString() });
  await s.createReviewRequest(user('member'), c.id, { activityId: 'a1' });
  assert.equal(sends.length, 1); assert.equal(sends[0].token, token);
  const state = s._readState(); assert.equal(Object.values(state.devices)[0].disabledAt !== null, true);
  assert.equal(JSON.stringify(await s.listNotificationEvents(user('owner'), c.id)).includes(token), false);
  await rejectsCode(s.registerDevice(user('owner'), { token: 'not-a-token', platform: 'ios' }), 'invalid_device');
});

test('shared state adapter stores challenge account data in the existing state transaction', async () => {
  const root = {}; const adapter = { read: fn => fn(root), mutate: async fn => fn(root) };
  const s = createChallengeAccounts({ stateAdapter: adapter, now, deviceTokenCipher: { encrypt: token => Buffer.from(token).toString('base64'), decrypt: cipher => Buffer.from(cipher, 'base64').toString() } });
  await s.createChallenge(user('owner'), { template: 'custom', name: 'Shared', qualifyingActivities: ['Run'] });
  assert.ok(root.challengeAccounts); assert.equal(Object.keys(root.challengeAccounts.challenges).length, 1);
});
