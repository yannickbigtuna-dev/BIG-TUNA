const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../lib/strava-challenge/domain');
const { getWeekBounds } = require('../lib/strava-challenge/time');
function a(participantId, sport_type, values = {}) { return d.normalizeActivity({ id: `${participantId}-${sport_type}-${Math.random()}`, name: 'Activity', sport_type, start_date: '2026-03-18T12:00:00Z', ...values }, participantId); }
test('qualification boundaries use centralized exact thresholds', () => {
  for (const [type, field, fail, pass] of [['Run', 'distance', 3990, 4000], ['Swim', 'distance', 2990, 3000], ['Walk', 'distance', 1999, 2000], ['Workout', 'elapsed_time', 1199, 1200], ['Kayaking', 'moving_time', 1799, 1800], ['RockClimbing', 'elapsed_time', 3599, 3600]]) { assert.equal(d.evaluateActivity({ sport_type: type, [field]: fail }).qualifies, false, `${type} below`); assert.equal(d.evaluateActivity({ sport_type: type, [field]: pass }).qualifies, true, `${type} minimum`); }
  assert.equal(d.evaluateActivity({ sport_type: 'Run', distance: 4010 }).qualifies, true);
  const gym = d.evaluateActivity({ sport_type: 'Workout', moving_time: 1, elapsed_time: 1200 });
  assert.equal(gym.qualifies, true);
  assert.equal(gym.durationField, 'elapsed_time');
});
test('official Strava sport enums map centrally and unsupported activities remain visible', () => { assert.equal(d.categorizeSportType({ sport_type: 'TrailRun' }), 'run'); assert.equal(d.categorizeSportType({ sport_type: 'VirtualRow' }), 'paddle'); assert.equal(d.categorizeSportType({ sport_type: 'HighIntensityIntervalTraining' }), 'gym'); const x = d.evaluateActivity({ sport_type: 'Ride' }); assert.equal(x.category, 'other'); assert.equal(x.qualifies, false); });
test('week scoring chooses count, qualifying time, then true tie', () => {
  const bounds = getWeekBounds('2026-03-18T12:00:00Z'); const y = a('yannick', 'Run', { distance: 4000, moving_time: 100 }), e = a('emma', 'Run', { distance: 4000, moving_time: 200 });
  assert.equal(d.calculateWeekResult([y, y, e], bounds).winner, 'yannick'); assert.equal(d.calculateWeekResult([y, e, e], bounds).winner, 'emma');
  let r = d.calculateWeekResult([y, e], bounds); assert.equal(r.winner, 'emma'); assert.equal(r.winningMethod, 'activity_time_tiebreaker'); r = d.calculateWeekResult([a('yannick','Run',{distance:4000,moving_time:300}), a('emma','Run',{distance:4000,moving_time:200})], bounds); assert.equal(r.winner, 'yannick'); assert.equal(r.winningMethod, 'activity_time_tiebreaker'); r = d.calculateWeekResult([a('yannick','Run',{distance:4000,moving_time:200}), a('emma','Run',{distance:4000,moving_time:200})], bounds); assert.equal(r.winner, null); assert.equal(r.winningMethod, 'true_tie');
});
test('non-qualifiers do not score or influence tiebreaker', () => { const b = getWeekBounds('2026-03-18'); const r = d.calculateWeekResult([a('yannick','Run',{distance:3999,moving_time:99999}), a('emma','Run',{distance:4000,moving_time:1})], b); assert.equal(r.winner, 'emma'); assert.equal(r.yannick.qualifyingActivityTime, 0); });
test('public dashboard allowlists activity data and excludes private state', () => { const activity = a('yannick', 'Run', { distance: 4000, moving_time: 600 }); const pub = d.buildPublicDashboard({ config: { secret: 'nope' }, activities: { x: { ...activity, accessToken: 'secret' } }, participants: { yannick: { email: 'private@example.com' } }, oauthStates: [{ tokenHash: 'secret' }], finalizedWeeks: {} }, new Date('2026-03-18T12:00:00Z')); const serial = JSON.stringify(pub); assert.equal(serial.includes('secret'), false); assert.equal(serial.includes('private@example.com'), false); assert.equal(pub.currentWeek.activities[0].qualifies, true); });
test('current activity rules refresh stale stored evaluations without changing finalized snapshots', () => {
  const walk = { ...a('yannick', 'Walk', { distance: 3000, moving_time: 900 }), qualifies: false, actual: 3000, required: 4000, difference: -1000, explanation: '1.00 km short of 4.00 km' };
  const snapshot = { weekStart: '2026-03-09', dateRange: 'Mar 9 - Mar 15', winner: 'emma', winningMethod: 'activity_count', pointAwarded: true, yannick: { qualifyingActivities: 0 }, emma: { qualifyingActivities: 1 }, activities: [{ ...walk, qualifies: false, required: 4000, difference: -1000 }] };
  const state = { activities: { walk }, finalizedWeeks: { '2026-03-09': snapshot } };
  const dashboard = d.buildPublicDashboard(state, new Date('2026-03-18T12:00:00Z'));
  assert.equal(dashboard.currentWeek.score.yannick, 1);
  assert.equal(dashboard.currentWeek.activities[0].qualifies, true);
  assert.equal(dashboard.currentWeek.activities[0].required, 2000);
  assert.equal(walk.qualifies, false);
  assert.equal(d.buildPublicWeek(state, '2026-03-09').activities[0].qualifies, false);
  assert.equal(d.buildPublicWeek(state, '2026-03-09').activities[0].required, 4000);
});
