'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createStore, PARTICIPANTS, ChallengeStoreError } = require('../lib/strava-challenge/store');
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'strava-store-')); }
test('store persists serialized mutations and preserves fixed participant identities', async () => {
  const dir = temp(); const store = createStore({ dataDir: dir, env: { STRAVA_CHALLENGE_YEAR: '2026' } });
  await Promise.all(Array.from({ length: 8 }, (_, n) => store.mutate(s => { s.activities[n] = { n }; })));
  await store.mutate(s => { s.participants.yannick.name = 'not allowed'; });
  const again = createStore({ dataDir: dir, env: {} }); assert.equal(Object.keys(again.read(s => s.activities)).length, 8); assert.deepEqual(again.read(s => s.participants.yannick), { ...again.read(s => s.participants.yannick), ...PARTICIPANTS.yannick });
});
test('store fails closed on corrupt existing state', () => { const dir = temp(); fs.writeFileSync(path.join(dir, 'state.json'), '{oops'); assert.throws(() => createStore({ dataDir: dir }).read(), ChallengeStoreError); });
test('v1 state migrates account challenge data into a scoped adapter', async () => { const dir = temp(); fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 1, accountChallenges: { version: 1, challenges: { one: { id: 'one' } }, devices: {}, notificationEvents: {} } })); const store = createStore({ dataDir: dir }); const adapter = store.createAccountChallengeStateAdapter(); assert.equal(adapter.read(s => s.challenges.one.id), 'one'); await adapter.mutate(s => { s.devices.example = { id: 'example' }; }); assert.equal(store.read(s => s.challengeAccounts.devices.example.id), 'example'); assert.equal(store.read(s => s.accountConnections).example, undefined); assert.equal(store.read(s => s.version), 2); });
test('store persists authoritative website review and notification records', async () => { const dir = temp(); const store = createStore({ dataDir: dir }); await store.mutate(s => { s.websiteReviews.review_one = { id: 'review_one' }; s.websiteNotificationEvents.event_one = { id: 'event_one' }; }); const again = createStore({ dataDir: dir }); assert.equal(again.read(s => s.websiteReviews.review_one.id), 'review_one'); assert.equal(again.read(s => s.websiteNotificationEvents.event_one.id), 'event_one'); });
