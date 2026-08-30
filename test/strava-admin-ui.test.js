const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'apps', 'admin', 'index.html'), 'utf8');

test('challenge admin remains inside the authenticated owner dashboard', () => {
  assert.match(page, /Auth\.onReady\(user =>/);
  assert.match(page, /user\.username\.toLowerCase\(\) !== 'yannick'/);
  assert.match(page, /Authorization: `Bearer \$\{Auth\.token\}`/);
  assert.match(page, /data-view="challenge">Strava Challenge/);
});

test('challenge management calls protected endpoints and protects finalization', () => {
  assert.match(page, /const challengeApiBase = '\/api\/admin\/strava-challenge'/);
  assert.match(page, /invites\/\$\{encodeURIComponent\(participant\)\}\/send/);
  assert.match(page, /invites\/\$\{encodeURIComponent\(participant\)\}\/generate/);
  assert.match(page, /sync\/\$\{encodeURIComponent\(participant\)\}/);
  assert.match(page, /finalization-preview\?week=/);
  assert.match(page, /FINALIZE \$\{weekStart\}/);
  assert.match(page, /email-preview\?type=/);
});

test('challenge controls provide expected safe operational copy without credential UI', () => {
  assert.match(page, /Send connection email/);
  assert.match(page, /Generate test link/);
  assert.match(page, /One-time test link/);
  assert.match(page, /Credentials and invitation secrets are never shown here/);
  assert.match(page, /Yannick email/);
  assert.match(page, /Emma email/);
  assert.doesNotMatch(page, /Refresh token\s*<input/i);
  assert.doesNotMatch(page, /Client secret\s*<input/i);
  assert.doesNotMatch(page, /Invite token hash\s*<input/i);
});
