const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'apps', 'strava-connect', 'index.html'), 'utf8');

test('connection page accepts only a fragment token and clears it immediately', () => {
  assert.match(page, /new URLSearchParams\(location\.hash\.slice\(1\)\)/);
  assert.match(page, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/);
  assert.match(page, /JSON\.stringify\(\{ inviteToken: token \}\)/);
  assert.doesNotMatch(page, /localStorage/);
  assert.doesNotMatch(page, /[?&]token=/);
});

test('connection page uses the prepare endpoint and keeps identity server-validated', () => {
  assert.match(page, /\/api\/strava-challenge\/oauth\/prepare/);
  assert.match(page, /participantId !== 'yannick' && participantId !== 'emma'/);
  assert.match(page, /data\.authorizationUrl/);
  assert.match(page, /Connect with Strava/);
  assert.match(page, /Yannick.*var\(--c-red\)/s);
  assert.match(page, /Emma.*var\(--c-blue\)/s);
});

test('connection page explains permissions, public display, revocation, and safe failure states', () => {
  assert.match(page, /Activity types, names, start times, distances, and durations/);
  assert.match(page, /public challenge display, and season history/);
  assert.match(page, /revoke access anytime in your Strava settings/);
  assert.match(page, /needed Strava activity permission was not granted/);
  assert.match(page, /invalid, expired, revoked, or has already been used/);
  assert.match(page, /name="referrer" content="no-referrer"/);
});
