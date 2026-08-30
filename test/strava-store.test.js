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
