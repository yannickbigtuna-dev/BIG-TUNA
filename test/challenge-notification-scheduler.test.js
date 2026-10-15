'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChallengeNotificationScheduler, _test } = require('../lib/challenge-notification-scheduler');

function dashboard({ yannick = 2, emma = 1, seasonYannick = 3, seasonEmma = 2, activities = [], weekStart = '2026-09-14' } = {}) {
  return { currentWeek: { weekStart, score: { yannick, emma }, activities }, season: { score: { yannick: seasonYannick, emma: seasonEmma } } };
}

// 19:00 ADT on Friday 2026-09-18 is 22:00Z.
const DAILY = '2026-09-18T22:02:00.000Z';

function fixture({ iso = DAILY, board = dashboard(), apnsConfigured = true, pending = [], prefs = {} } = {}) {
  let clock = new Date(iso);
  let current = board;
  const state = { devices: {
    'account-y:fy': { userId: 'account-y', fingerprint: 'fy', tokenEncrypted: 'token-y', disabledAt: null, environment: 'production' },
    'account-e:fe': { userId: 'account-e', fingerprint: 'fe', tokenEncrypted: 'token-e', disabledAt: null },
  }, timedNotificationLedger: {} };
  const sent = [];
  let refreshes = 0;
  const build = (overrides = {}) => createChallengeNotificationScheduler({
    now: () => new Date(clock), refresh: async () => { refreshes++; }, getDashboard: async () => current,
    getPendingReviews: async () => pending, readState: () => structuredClone(state),
    mutateState: async fn => fn(state), resolveAccountId: id => id === 'yannick' ? 'account-y' : 'account-e',
    decryptToken: value => value, sendNotification: async payload => { sent.push(payload); return { delivery: 'sent' }; },
    isAllowed: (accountId, kind) => !(prefs[accountId] && prefs[accountId][kind] === false),
    apnsConfigured, logger: { warn() {} }, ...overrides,
  });
  return {
    build, state, sent, prefs,
    get refreshes() { return refreshes; },
    setClock(value) { clock = new Date(value); },
    setBoard(value) { current = value; },
  };
}

test('the daily score update sends once per participant across repeated ticks and restarts', async () => {
  const f = fixture();
  assert.deepEqual(await f.build().tick(), { claimed: 2, delivered: 2, reminders: 0 });
  assert.equal(f.refreshes, 1);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent.every(x => x.eventType === 'daily_score'), true);
  assert.deepEqual(await f.build().tick(), { claimed: 0, delivered: 0, reminders: 0 });
  assert.equal(f.sent.length, 2);
  assert.equal(Object.values(f.state.timedNotificationLedger).filter(x => x.slot === 'daily').every(x => x.status === 'sent'), true);
});

test('daily updates always include the current score and route to the device environment', async () => {
  const f = fixture({ iso: '2026-09-16T22:02:00.000Z', board: dashboard({ yannick: 4, emma: 1 }) });
  await f.build().tick();
  const yannick = f.sent.find(x => x.token === 'token-y');
  const emma = f.sent.find(x => x.token === 'token-e');
  assert.match(yannick.body, /4–1/);
  assert.match(emma.body, /1–4|4–1/);
  assert.equal(yannick.environment, 'production');
  assert.equal(emma.environment, null);
});

test('expired daily slots are durably skipped and are never caught up', async () => {
  const f = fixture({ iso: '2026-09-18T22:45:00.000Z' });
  await f.build().tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.refreshes, 0);
  assert.equal(Object.values(f.state.timedNotificationLedger).filter(x => x.slot === 'daily').every(x => x.status === 'skipped' && x.reason === 'expired'), true);
});

test('daily slot follows Halifax daylight and standard time', async () => {
  const summer = fixture({ iso: '2026-07-15T22:02:00.000Z' });
  await summer.build().tick();
  assert.equal(summer.sent.length, 2, '19:02 ADT is 22:02Z');
  const winter = fixture({ iso: '2026-12-15T23:02:00.000Z' });
  await winter.build().tick();
  assert.equal(winter.sent.length, 2, '19:02 AST is 23:02Z');
});

test('daily category keeps Friday, Sunday and standings semantics', () => {
  const friday = { year: 2026, month: 9, day: 18, hour: 19, minute: 1, second: 0 };
  assert.equal(_test.selectCategory({ slot: 'daily', participantId: 'yannick', dashboard: dashboard(), nowParts: friday, timeZone: 'America/Halifax' }), 'friday_pressure');
  assert.equal(_test.selectCategory({ slot: 'daily', participantId: 'yannick', dashboard: dashboard(), nowParts: { ...friday, day: 20 }, timeZone: 'America/Halifax' }), 'sunday_final_push');
  assert.equal(_test.selectCategory({ slot: 'daily', participantId: 'emma', dashboard: dashboard({ yannick: 6, emma: 1 }), nowParts: { ...friday, day: 16 }, timeZone: 'America/Halifax' }), 'losing_badly');
  assert.equal(_test.selectCategory({ slot: 'daily', participantId: 'yannick', dashboard: dashboard({ yannick: 2, emma: 2 }), nowParts: { ...friday, day: 16 }, timeZone: 'America/Halifax' }), 'tied');
});

test('opted-out users are skipped for that kind only', async () => {
  const f = fixture({ prefs: { 'account-e': { dailyScore: false } } });
  assert.deepEqual(await f.build().tick(), { claimed: 2, delivered: 1, reminders: 0 });
  assert.deepEqual(f.sent.map(x => x.token), ['token-y']);
  const skipped = Object.values(f.state.timedNotificationLedger).find(x => x.participantId === 'emma');
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.reason, 'opted_out');
});

test('provider failure and invalid tokens are final for a claimed slot', async () => {
  const f = fixture();
  const scheduler = f.build({
    sendNotification: async ({ token }) => token === 'token-y' ? { delivery: 'failed', reason: 'invalid_token' } : { delivery: 'failed', reason: 'provider_unavailable' },
  });
  await scheduler.tick();
  assert.ok(f.state.devices['account-y:fy'].disabledAt);
  await scheduler.tick();
  assert.equal(Object.values(f.state.timedNotificationLedger).filter(x => x.status === 'failed').length, 2);
});

test('a failed refresh still sends the daily update from the latest stored scores', async () => {
  const f = fixture();
  const scheduler = f.build({ refresh: async () => ({ yannick: { ok: true }, emma: { ok: false, error: 'upstream unavailable' } }) });
  assert.deepEqual(await scheduler.tick(), { claimed: 2, delivered: 2, reminders: 0 });
});

test('the first event pass seeds the cursor without replaying existing activities', async () => {
  const f = fixture({ iso: '2026-09-18T15:00:00.000Z', board: dashboard({ yannick: 1, emma: 1, activities: [
    { id: 'a1', participantId: 'yannick', qualifies: true, name: 'Run' },
    { id: 'a2', participantId: 'emma', qualifies: true, name: 'Swim' },
  ] }) });
  assert.deepEqual(await f.build().handleAuthoritativeUpdate(), { delivered: 0, seeded: true });
  assert.deepEqual(await f.build().handleAuthoritativeUpdate(), { delivered: 0 });
  assert.equal(f.sent.length, 0);
  assert.equal(f.state.eventNotificationCursor.seen.a1 !== undefined, true);
});

test('a new activity notifies the uploader and the opponent exactly once', async () => {
  const f = fixture({ iso: '2026-09-18T15:00:00.000Z', board: dashboard({ yannick: 1, emma: 2, activities: [] }) });
  await f.build().handleAuthoritativeUpdate();
  f.setBoard(dashboard({ yannick: 2, emma: 2, activities: [{ id: 'run1', participantId: 'yannick', qualifies: true, name: 'Morning Run', distanceMeters: 5200 }] }));
  assert.deepEqual(await f.build().handleAuthoritativeUpdate(), { delivered: 2 });
  const toYannick = f.sent.find(x => x.token === 'token-y');
  const toEmma = f.sent.find(x => x.token === 'token-e');
  assert.equal(toYannick.eventType, 'activity_logged');
  assert.match(toYannick.body, /Morning Run \(5\.2 km\)/);
  assert.match(toYannick.body, /2 ?– ?2/);
  assert.equal(toEmma.eventType, 'opponent_activity');
  assert.match(toEmma.title, /Yannick/);
  assert.deepEqual(await f.build().handleAuthoritativeUpdate(), { delivered: 0 });
  assert.equal(f.sent.length, 2);
});

test('passing the opponent sends overtook/overtaken instead of a plain activity event', async () => {
  const f = fixture({ iso: '2026-09-18T15:00:00.000Z', board: dashboard({ yannick: 2, emma: 2, activities: [] }) });
  await f.build().handleAuthoritativeUpdate();
  f.setBoard(dashboard({ yannick: 2, emma: 3, activities: [{ id: 'swim', participantId: 'emma', qualifies: true, name: 'Pool Swim', distanceMeters: 3000 }] }));
  await f.build().handleAuthoritativeUpdate();
  assert.equal(f.sent.find(x => x.token === 'token-e').eventType, 'overtook');
  assert.equal(f.sent.find(x => x.token === 'token-y').eventType, 'overtaken');
  assert.match(f.sent.find(x => x.token === 'token-y').body, /Pool Swim/);
});

test('a lead change without a new activity (approved review) still notifies', async () => {
  const f = fixture({ iso: '2026-09-18T15:00:00.000Z', board: dashboard({ yannick: 2, emma: 2, activities: [{ id: 'p', participantId: 'yannick', qualifies: false }] }) });
  await f.build().handleAuthoritativeUpdate();
  f.setBoard(dashboard({ yannick: 3, emma: 2, activities: [{ id: 'p', participantId: 'yannick', qualifies: true }] }));
  assert.deepEqual(await f.build().handleAuthoritativeUpdate(), { delivered: 2 });
  assert.equal(f.sent.find(x => x.token === 'token-y').eventType, 'overtook');
});

test('a non-qualifying upload tells the uploader why it did not count', async () => {
  const f = fixture({ iso: '2026-09-18T15:00:00.000Z', board: dashboard({ yannick: 1, emma: 1, activities: [] }) });
  await f.build().handleAuthoritativeUpdate();
  f.setBoard(dashboard({ yannick: 1, emma: 1, activities: [{ id: 'short', participantId: 'emma', qualifies: false, name: 'Walk', explanation: '5m short of 30m' }] }));
  await f.build().handleAuthoritativeUpdate();
  const toEmma = f.sent.find(x => x.token === 'token-e');
  assert.equal(toEmma.eventType, 'activity_not_counted');
  assert.match(toEmma.body, /5m short of 30m/);
  assert.equal(f.sent.find(x => x.token === 'token-y').eventType, 'opponent_activity_not_counted');
});

test('activity events respect the activityEvents preference', async () => {
  const f = fixture({ iso: '2026-09-18T15:00:00.000Z', board: dashboard({ yannick: 1, emma: 1 }), prefs: { 'account-y': { activityEvents: false } } });
  await f.build().handleAuthoritativeUpdate();
  f.setBoard(dashboard({ yannick: 1, emma: 2, activities: [{ id: 'e1', participantId: 'emma', qualifies: true }] }));
  assert.deepEqual(await f.build().handleAuthoritativeUpdate(), { delivered: 1 });
  assert.deepEqual(f.sent.map(x => x.token), ['token-e']);
});

test('a new week resets the score baseline without false passes', async () => {
  const f = fixture({ iso: '2026-09-21T15:00:00.000Z', board: dashboard({ yannick: 5, emma: 1, weekStart: '2026-09-14' }) });
  await f.build().handleAuthoritativeUpdate();
  f.setBoard(dashboard({ yannick: 0, emma: 1, weekStart: '2026-09-21', activities: [{ id: 'mon', participantId: 'emma', qualifies: true }] }));
  await f.build().handleAuthoritativeUpdate();
  assert.equal(f.sent.find(x => x.token === 'token-e').eventType, 'overtook');
  assert.equal(f.sent.find(x => x.token === 'token-y').eventType, 'overtaken');
});

test('weekly results notify both participants once with the right outcome', async () => {
  const f = fixture({ iso: '2026-09-21T11:05:00.000Z' });
  const snapshot = { weekStart: '2026-09-14', winner: 'emma', winningMethod: 'activity_count', yannick: { qualifyingActivities: 3 }, emma: { qualifyingActivities: 5 }, seasonScoreAfter: { yannick: 1, emma: 2 } };
  assert.deepEqual(await f.build().handleWeekFinalized(snapshot), { delivered: 2 });
  assert.deepEqual(await f.build().handleWeekFinalized(snapshot), { delivered: 0 });
  const toEmma = f.sent.find(x => x.token === 'token-e');
  const toYannick = f.sent.find(x => x.token === 'token-y');
  assert.equal(toEmma.eventType, 'week_result');
  assert.match(toEmma.title + toEmma.body, /won|crown/i);
  assert.match(toEmma.body, /5–3/);
  assert.match(toYannick.body, /5–3|3–5/);
  assert.deepEqual(await f.build().handleWeekFinalized({ ...snapshot, weekStart: '2026-09-07', alreadyFinalized: true }), { delivered: 0 });
});

test('tie and tiebreaker weeks pick dedicated categories', async () => {
  const f = fixture({ iso: '2026-09-21T11:05:00.000Z', prefs: { 'account-y': { weeklyResults: false } } });
  await f.build().handleWeekFinalized({ weekStart: '2026-09-14', winner: 'emma', winningMethod: 'activity_time_tiebreaker', yannick: { qualifyingActivities: 4 }, emma: { qualifyingActivities: 4 }, seasonScoreAfter: {} });
  assert.deepEqual(f.sent.map(x => x.token), ['token-e']);
  assert.match(f.sent[0].title, /tiebreaker/i);
  const ledger = Object.values(f.state.timedNotificationLedger);
  assert.equal(ledger.find(x => x.participantId === 'yannick').category, 'week_close_loss');
  assert.equal(ledger.find(x => x.participantId === 'yannick').reason, 'opted_out');
});

test('pending review reminders start after two hours, then back off and respect quiet hours', async () => {
  const review = { id: 'review-one', createdAt: '2026-09-18T10:00:00.000Z', recipientParticipantId: 'emma', recipientAccountId: 'account-e' };
  const f = fixture({ iso: '2026-09-18T12:01:00.000Z', pending: [review] });
  await f.build().tick();
  assert.equal(f.sent.filter(x => x.eventType === 'review_reminder').length, 1);
  f.setClock('2026-09-18T15:30:00.000Z');
  await f.build().tick();
  assert.equal(f.sent.filter(x => x.eventType === 'review_reminder').length, 1);
  f.setClock('2026-09-18T18:02:00.000Z');
  await f.build().tick();
  assert.equal(f.sent.filter(x => x.eventType === 'review_reminder').length, 2);
  f.setClock('2026-09-19T04:00:00.000Z');
  await f.build().tick();
  assert.equal(f.sent.filter(x => x.eventType === 'review_reminder').length, 2, '01:00 ADT is quiet hours');
});

test('review reminders respect the reviewRequests preference', async () => {
  const review = { id: 'review-two', createdAt: '2026-09-18T10:00:00.000Z', recipientParticipantId: 'emma', recipientAccountId: 'account-e' };
  const f = fixture({ iso: '2026-09-18T12:01:00.000Z', pending: [review], prefs: { 'account-e': { reviewRequests: false } } });
  await f.build().tick();
  assert.equal(f.sent.length, 0);
});
