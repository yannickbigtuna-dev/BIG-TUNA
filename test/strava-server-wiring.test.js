'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const coach = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assignment-coach.js'), 'utf8');

test('Strava public, OAuth, and protected admin routes are wired explicitly', () => {
  for (const route of [
    '/api/strava-challenge/public',
    '/api/strava-challenge/oauth/prepare',
    '/api/strava-challenge/oauth/callback',
    '/api/admin/strava-challenge/status',
    '/api/admin/strava-challenge/config',
    '/api/admin/strava-challenge/finalization-preview',
    '/api/admin/strava-challenge/finalize',
    '/api/admin/strava-challenge/email-preview',
  ]) assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(server, /challengeAdminUser\(req, res\)/);
  assert.match(server, /invites\\\/\(yannick\|emma\)/);
  assert.match(server, /sync\\\/\(yannick\|emma\|all\)/);
});

test('request logging redacts OAuth and invitation credentials', () => {
  assert.match(server, /function sanitizeRequestUrl/);
  assert.match(server, /\['code', 'state', 'token', 't', 'inviteToken', 'resetToken'\]/);
  assert.match(server, /strava\\\/connect/);
  assert.doesNotMatch(server, /console\.log\(`\$\{new Date\(\)\.toISOString\(\)\} \$\{req\.method\} \$\{req\.url\}`\)/);
});

test('OAuth and invitation paths use no-store/no-referrer headers and do not return private service state', () => {
  assert.match(server, /function setSensitiveResponseHeaders/);
  assert.match(server, /'Referrer-Policy', 'no-referrer'/);
  assert.match(server, /'Cache-Control', 'no-store'/);
  assert.match(server, /\{ authorizationUrl: prepared\.authorizationUrl \}/);
  assert.match(server, /\{ ok: true, sent: Boolean\(result && result\.sent\) \}/);
  assert.match(server, /\{ ok: true, expiresAt: result && result\.expiresAt \|\| null \}/);
  assert.doesNotMatch(server, /jsonRes\(res, 200, prepared\)/);
});

test('Resend sender supports a validated optional idempotency key', () => {
  assert.match(coach, /idempotencyKey/);
  assert.match(coach, /\^\[A-Za-z0-9\._:-\]\{1,256\}\$/);
  assert.match(coach, /'Idempotency-Key': String\(idempotencyKey\)/);
  assert.match(coach, /idempotencyKey !== undefined/);
});
