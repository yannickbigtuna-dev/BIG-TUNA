'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'apps', 'strava-challenge.js'), 'utf8');
const openapi = fs.readFileSync(path.join(root, 'docs', 'openapi.yaml'), 'utf8');

test('authoritative review routes use fixed authenticated identity mapping and service methods', () => {
  assert.match(server, /function challengeReviewUser/);
  assert.match(server, /\{ yannick: 'yannick', fishyemma: 'emma' \}/);
  assert.match(server, /urlPath === '\/api\/strava-challenge\/review-requests'/);
  assert.match(server, /stravaReviewDecisionMatch/);
  assert.match(server, /urlPath === '\/api\/strava-challenge\/notification-events'/);
  assert.match(server, /service\.createWebsiteReview\(\{ \.\.\.identity, body \}\)/);
  assert.match(server, /service\.listWebsiteReviews\(\{ \.\.\.identity, status: status \|\| undefined \}\)/);
  assert.match(server, /service\.decideWebsiteReview\(\{ \.\.\.identity, reviewId: stravaReviewDecisionMatch\[1\], body \}\)/);
  assert.match(server, /service\.listWebsiteNotificationEvents\(identity\)/);
  assert.match(server, /setSensitiveResponseHeaders\(res\)/);
});

test('homepage review UI calls only the authoritative review and notification APIs', () => {
  assert.match(ui, /\/api\/strava-challenge\/review-requests\?status=pending/);
  assert.match(ui, /\/api\/strava-challenge\/notification-events/);
  assert.match(ui, /\/api\/strava-challenge\/review-requests'\s*,\{method:'POST'/);
  assert.match(ui, /\/api\/strava-challenge\/review-requests\/\$\{encodeURIComponent\(id\)\}\/decision/);
  assert.match(ui, /reviewState/);
  assert.match(ui, /data-review-activity/);
  assert.match(ui, /data-review-decision/);
  assert.doesNotMatch(ui, /\/api\/challenges\//);
});

test('OpenAPI publishes the three authoritative review surfaces', () => {
  assert.match(openapi, /\/api\/strava-challenge\/review-requests:/);
  assert.match(openapi, /\/api\/strava-challenge\/review-requests\/\{reviewId\}\/decision:/);
  assert.match(openapi, /\/api\/strava-challenge\/notification-events:/);
  assert.match(openapi, /AuthoritativeReviewDecisionResult/);
});
