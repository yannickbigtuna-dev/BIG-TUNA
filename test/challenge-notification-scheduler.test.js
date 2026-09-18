'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChallengeNotificationScheduler, _test } = require('../lib/challenge-notification-scheduler');

function dashboard({ yannick = 2, emma = 1, seasonYannick = 3, seasonEmma = 2, activities = [] } = {}) {
  return { currentWeek: { score: { yannick, emma }, activities }, season: { score: { yannick: seasonYannick, emma: seasonEmma } } };
}

function fixture({ iso = '2026-09-18T12:02:00.000Z', board = dashboard(), apnsConfigured = true, pending = [] } = {}) {
  let clock = new Date(iso);
  const state = { devices: {
    'account-y:fy': { userId: 'account-y', fingerprint: 'fy', tokenEncrypted: 'token-y', disabledAt: null },
    'account-e:fe': { userId: 'account-e', fingerprint: 'fe', tokenEncrypted: 'token-e', disabledAt: null },
  }, timedNotificationLedger: {} };
  const sent = [];
  let refreshes = 0;
  const build = () => createChallengeNotificationScheduler({
    now: () => new Date(clock), refresh: async () => { refreshes++; }, getDashboard: async () => board,
    getPendingReviews: async () => pending, readState: () => structuredClone(state),
    mutateState: async fn => fn(state), resolveAccountId: id => id === 'yannick' ? 'account-y' : 'account-e',
    decryptToken: value => value, sendNotification: async payload => { sent.push(payload); return { delivery: 'sent' }; },
    apnsConfigured, logger: { warn() {} },
  });
  return { build, state, sent, get refreshes() { return refreshes; }, setClock(value) { clock = new Date(value); } };
}

test('Halifax current slots send once across repeated ticks and scheduler restarts', async () => {
  const f = fixture();
  assert.deepEqual(await f.build().tick(), { claimed: 2, delivered: 2, reminders: 0 });
  assert.equal(f.refreshes, 1);
  assert.equal(f.sent.length, 2);
  assert.deepEqual(await f.build().tick(), { claimed: 0, delivered: 0, reminders: 0 });
  assert.equal(f.refreshes, 1);
  assert.equal(f.sent.length, 2);
  assert.equal(Object.values(f.state.timedNotificationLedger).filter(x => x.slot === 'morning').every(x => x.status === 'sent'), true);
});

test('expired slots are durably skipped and are never caught up', async () => {
  const f = fixture({ iso: '2026-09-18T12:06:00.000Z' });
  await f.build().tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.refreshes, 0);
  assert.equal(Object.values(f.state.timedNotificationLedger).filter(x => x.slot === 'morning').every(x => x.status === 'skipped' && x.reason === 'expired'), true);
  f.setClock('2026-09-18T15:00:00.000Z');
  await f.build().tick();
  assert.equal(f.sent.length, 0);
});

test('Halifax slot selection follows both daylight and standard time', async () => {
  const summer = fixture({ iso: '2026-07-15T16:02:00.000Z' });
  await summer.build().tick();
  assert.equal(summer.sent.length, 2, '13:02 ADT is 16:02Z');
  const winter = fixture({ iso: '2026-12-15T17:02:00.000Z' });
  await winter.build().tick();
  assert.equal(winter.sent.length, 2, '13:02 AST is 17:02Z');
});

test('category cadence keeps Friday, inactivity, streak and standings semantics', () => {
  const friday = { year: 2026, month: 9, day: 18, hour: 9, minute: 1, second: 0 };
  assert.equal(_test.selectCategory({ slot: 'morning', participantId: 'yannick', dashboard: dashboard(), nowParts: friday, timeZone: 'America/Halifax' }), 'friday_pressure');
  assert.equal(_test.selectCategory({ slot: 'midday', participantId: 'emma', dashboard: dashboard(), nowParts: { ...friday, hour: 13 }, timeZone: 'America/Halifax' }), 'inactive_nudge');
  const active = dashboard({ activities: [
    { id: '1', participantId: 'yannick', qualifies: true, startDate: '2026-09-18T11:00:00Z' },
    { id: '2', participantId: 'yannick', qualifies: true, startDate: '2026-09-18T12:00:00Z' },
  ], seasonYannick: 0, seasonEmma: 0 });
  assert.equal(_test.selectCategory({ slot: 'night', participantId: 'yannick', dashboard: active, nowParts: { ...friday, hour: 20 }, timeZone: 'America/Halifax' }), 'streak_hot');
});

test('provider failure and invalid tokens are final for a claimed slot', async () => {
  const f = fixture();
  const scheduler = createChallengeNotificationScheduler({
    now: () => new Date('2026-09-18T12:02:00.000Z'), refresh: async () => {}, getDashboard: async () => dashboard(),
    getPendingReviews: async () => [], readState: () => structuredClone(f.state), mutateState: async fn => fn(f.state),
    resolveAccountId: id => id === 'yannick' ? 'account-y' : 'account-e', decryptToken: value => value,
    sendNotification: async ({ token }) => token === 'token-y' ? { delivery: 'failed', reason: 'invalid_token' } : { delivery: 'failed', reason: 'provider_unavailable' },
    logger: { warn() {} },
  });
  await scheduler.tick();
  assert.ok(f.state.devices['account-y:fy'].disabledAt);
  await scheduler.tick();
  assert.equal(Object.values(f.state.timedNotificationLedger).filter(x => x.status === 'failed').length, 2);
});

test('a partial authoritative refresh failure suppresses stale-score delivery permanently', async () => {
  const f = fixture();
  const scheduler = createChallengeNotificationScheduler({
    now: () => new Date('2026-09-18T12:02:00.000Z'),
    refresh: async () => ({ yannick: { ok: true }, emma: { ok: false, error: 'upstream unavailable' } }),
    getDashboard: async () => dashboard(), getPendingReviews: async () => [], readState: () => structuredClone(f.state),
    mutateState: async fn => fn(f.state), resolveAccountId: id => id === 'yannick' ? 'account-y' : 'account-e',
    decryptToken: value => value, sendNotification: async payload => { f.sent.push(payload); return { delivery: 'sent' }; }, logger: { warn() {} },
  });
  assert.deepEqual(await scheduler.tick(), { claimed: 2, delivered: 0 });
  assert.equal(f.sent.length, 0);
  assert.equal(Object.values(f.state.timedNotificationLedger).every(record => record.status === 'failed' && record.reason === 'refresh_failed'), true);
  await scheduler.tick();
  assert.equal(f.sent.length, 0);
});

test('fresh authoritative score changes emit one durable event, while stale changes do not replay', async () => {
  const f = fixture({ iso: '2026-09-18T15:00:00.000Z' });
  const before = dashboard({ yannick: 1, emma: 1 });
  const fresh = dashboard({ yannick: 2, emma: 1, activities: [{ id: 'new', participantId: 'yannick', qualifies: true, startDate: '2026-09-18T14:50:00.000Z' }] });
  const scheduler = f.build();
  assert.deepEqual(await scheduler.handleAuthoritativeUpdate({ before, after: fresh, at: new Date('2026-09-18T15:00:00.000Z') }), { delivered: 2 });
  assert.deepEqual(await f.build().handleAuthoritativeUpdate({ before, after: fresh, at: new Date('2026-09-18T15:00:00.000Z') }), { delivered: 0 });
  const stale = dashboard({ yannick: 3, emma: 1, activities: [{ id: 'old', participantId: 'yannick', qualifies: true, startDate: '2026-09-18T12:00:00.000Z' }] });
  assert.deepEqual(await scheduler.handleAuthoritativeUpdate({ before: fresh, after: stale, at: new Date('2026-09-18T15:00:00.000Z') }), { delivered: 0 });
});

test('an established runtime baseline detects newly synced long activities without startup replay', async () => {
  const f = fixture({ iso: '2026-09-18T15:00:00.000Z' });
  const before = dashboard({ yannick: 1, emma: 1 });
  const after = dashboard({ yannick: 2, emma: 1, activities: [{ id: 'long-workout', participantId: 'yannick', qualifies: true, startDate: '2026-09-18T12:00:00.000Z' }] });
  assert.deepEqual(await f.build().handleAuthoritativeUpdate({ before, after, at: new Date('2026-09-18T15:00:00.000Z'), baselineEstablished: true }), { delivered: 2 });
});

test('pending review reminders start after two hours and keep a three-hour cooldown', async () => {
  const review = { id: 'review-one', createdAt: '2026-09-18T10:00:00.000Z', recipientParticipantId: 'emma', recipientAccountId: 'account-e' };
  const f = fixture({ iso: '2026-09-18T12:01:00.000Z', pending: [review] });
  await f.build().tick();
  assert.equal(f.sent.filter(x => x.eventType === 'review_reminder').length, 1);
  f.setClock('2026-09-18T13:30:00.000Z');
  await f.build().tick();
  assert.equal(f.sent.filter(x => x.eventType === 'review_reminder').length, 1);
  f.setClock('2026-09-18T15:02:00.000Z');
  await f.build().tick();
  assert.equal(f.sent.filter(x => x.eventType === 'review_reminder').length, 2);
});
