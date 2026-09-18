'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createStore, PARTICIPANTS, ChallengeStoreError } = require('../lib/strava-challenge/store');
const { createChallengeAccounts } = require('../lib/challenge-accounts');
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
test('nested deployed challenge-account records migrate non-destructively into the canonical namespace', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 2, challengeAccounts: {
    version: 1,
    devices: { canonical: { id: 'canonical', current: true } },
    challenges: {}, notificationEvents: {}, challengeCreationRequests: {},
    challengeAccounts: {
      devices: { canonical: { id: 'canonical', current: true }, legacy: { id: 'legacy' } },
      challenges: { legacyChallenge: { id: 'legacyChallenge' } },
      notificationEvents: { legacyEvent: { id: 'legacyEvent' } },
      challengeCreationRequests: { legacyRequest: { id: 'legacyRequest' } },
    },
  } }));
  const state = createStore({ dataDir: dir }).read(s => s.challengeAccounts);
  assert.equal(state.devices.canonical.current, true);
  assert.equal(state.devices.legacy.id, 'legacy');
  assert.equal(state.challenges.legacyChallenge.id, 'legacyChallenge');
  assert.equal(state.notificationEvents.legacyEvent.id, 'legacyEvent');
  assert.equal(state.challengeCreationRequests.legacyRequest.id, 'legacyRequest');
  assert.equal(state.challengeAccounts, undefined);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(persisted.challengeAccounts.devices.legacy.id, 'legacy');
  assert.equal(persisted.challengeAccounts.challengeAccounts, undefined);
  assert.ok(fs.existsSync(path.join(dir, 'state.last-good.json')));
});
test('nested challenge-account migration fails closed on unequal duplicate records', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 2, challengeAccounts: {
    devices: { duplicate: { id: 'new' } },
    challengeAccounts: { devices: { duplicate: { id: 'old' } } },
  } }));
  assert.throws(() => createStore({ dataDir: dir }).read(), ChallengeStoreError);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).challengeAccounts.devices.duplicate.id, 'new');
});
test('challenge account service and Strava adapter share the canonical device registry', async () => {
  const dir = temp();
  const store = createStore({ dataDir: dir });
  await store.mutate(s => { s.challengeAccounts.devices.existing = { id: 'existing', userId: 'user' }; });
  const accounts = createChallengeAccounts({ stateAdapter: store.createAccountChallengeStateAdapter() });
  assert.equal(accounts._readState().devices.existing.id, 'existing');
  await accounts._mutate(state => { state.devices.added = { id: 'added', userId: 'user' }; });
  assert.equal(store.read(s => s.challengeAccounts.devices.added.id), 'added');
  assert.equal(store.read(s => s.challengeAccounts.challengeAccounts), undefined);
});
