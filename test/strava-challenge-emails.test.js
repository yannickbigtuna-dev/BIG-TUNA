'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { defaultEmailPool, createStore } = require('../lib/strava-challenge/store');
const { interpolateTemplate, formatEmailBody, renderWeeklyEmails, evaluateEmailRule, selectCandidateFromPool } = require('../lib/strava-challenge/emails');
const { createStravaChallenge } = require('../lib/strava-challenge');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'strava-emails-test-'));
}

function makeFixtureService({ now = new Date('2026-09-14T12:00:00Z'), activities = [], envOverrides = {} } = {}) {
  const dir = makeTempDir();
  const clock = new Date(now);
  const emailsSent = [];
  const env = {
    STRAVA_CHALLENGE_CRYPTO_SECRET: 'a'.repeat(48),
    STRAVA_CLIENT_ID: 'test_client_id',
    STRAVA_CLIENT_SECRET: 'test_client_secret',
    STRAVA_REDIRECT_URI: 'https://challenge.example.test/callback',
    CHALLENGE_BASE_URL: 'https://challenge.example.test',
    STRAVA_CHALLENGE_YEAR: '2026',
    STRAVA_CHALLENGE_START_DATE: '2026-01-01',
    STRAVA_CHALLENGE_YANNICK_EMAIL: 'yannick@example.test',
    STRAVA_CHALLENGE_EMMA_EMAIL: 'emma@example.test',
    ...envOverrides
  };

  const service = createStravaChallenge({
    dataDir: dir,
    now: () => new Date(clock),
    env,
    sendEmail: async (...args) => {
      emailsSent.push(args);
      return { ok: true, id: 'test-email-id' };
    },
    fetchImpl: async url => {
      if (url.includes('/oauth/token')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({
            access_token: 'test_access',
            refresh_token: 'test_refresh',
            expires_at: Math.floor(Date.now() / 1000) + 7200,
            athlete: { id: 'athlete_' + Math.random(), firstname: 'Tester' }
          })
        };
      }
      if (url.includes('/athlete/activities')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify(activities)
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '[]'
      };
    },
    logger: { warn() {}, error() {}, info() {} }
  });

  return { service, dir, emailsSent, clock };
}

test('interpolateTemplate replaces {{key}}, {key}, and ${key}', () => {
  const data = {
    score: '6–4',
    winner: 'Yannick',
    loser: 'Emma',
    margin: '12m 30s',
    winner_time: '1h 30m',
    loser_time: '1h 17m',
    season_score: '2–1',
    week_start: '2026-09-07'
  };

  const text1 = 'Score: {{score}}, Winner: {{winner}}, Loser: {{loser}}, Margin: {{margin}}, WinTime: {{winner_time}}, LoseTime: {{loser_time}}, Season: {{season_score}}, Week: {{week_start}}';
  assert.equal(
    interpolateTemplate(text1, data),
    'Score: 6–4, Winner: Yannick, Loser: Emma, Margin: 12m 30s, WinTime: 1h 30m, LoseTime: 1h 17m, Season: 2–1, Week: 2026-09-07'
  );

  const text2 = 'Score: {score}, Winner: {winner} beat {loser} by {margin} on ${week_start}';
  assert.equal(
    interpolateTemplate(text2, data),
    'Score: 6–4, Winner: Yannick beat Emma by 12m 30s on 2026-09-07'
  );

  const text3 = 'Unknown: {{foo_bar}} and empty: {{}}';
  assert.equal(interpolateTemplate(text3, data), 'Unknown: {{foo_bar}} and empty: {{}}');

  assert.equal(interpolateTemplate(null, data), '');
});

test('formatEmailBody converts plain-text paragraphs to HTML and preserves HTML tags', () => {
  const plainSingle = 'Big victory this week!';
  assert.equal(formatEmailBody(plainSingle), '<p>Big victory this week!</p>');

  const plainMulti = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
  assert.equal(formatEmailBody(plainMulti), '<p>Paragraph one.</p><p>Paragraph two.</p><p>Paragraph three.</p>');

  const plainWithBreak = 'Line one\nLine two';
  assert.equal(formatEmailBody(plainWithBreak), '<p>Line one<br>Line two</p>');

  const existingHtml = '<p>Already formatted <strong>bold</strong> paragraph.</p>';
  assert.equal(formatEmailBody(existingHtml), existingHtml);

  assert.equal(formatEmailBody(''), '');
  assert.equal(formatEmailBody(null), '');
});

test('defaultEmailPool returns standard 4 templates and seeds store defaults and mergeState', () => {
  const pool = defaultEmailPool();
  assert.equal(typeof pool, 'object');
  assert.ok(pool['win-default']);
  assert.ok(pool['loss-default']);
  assert.ok(pool['tiebreaker-win-default']);
  assert.ok(pool['tiebreaker-loss-default']);

  assert.equal(pool['win-default'].type, 'win');
  assert.equal(pool['loss-default'].type, 'loss');
  assert.equal(pool['tiebreaker-win-default'].type, 'tiebreaker_win');
  assert.equal(pool['tiebreaker-loss-default'].type, 'tiebreaker_loss');

  for (const tpl of Object.values(pool)) {
    assert.equal(tpl.active, true);
    assert.ok(tpl.subject);
    assert.ok(tpl.body);
    assert.ok(tpl.createdAt);
    assert.ok(tpl.updatedAt);
  }

  const dir = makeTempDir();
  const store = createStore({ dataDir: dir });
  const loaded = store.read(s => s);
  assert.ok(loaded.emailPool);
  assert.equal(Object.keys(loaded.emailPool).length, 4);

  // Test mergeState on old state missing emailPool
  const legacyState = { version: 2, config: {}, participants: {}, weeks: {} };
  const tempFile = path.join(dir, 'state.json');
  fs.writeFileSync(tempFile, JSON.stringify(legacyState, null, 2));
  const freshStore = createStore({ dataDir: dir });
  const mergedState = freshStore.read(s => s);
  assert.ok(mergedState.emailPool['win-default']);
  assert.ok(mergedState.emailPool['loss-default']);
});

test('saveChallengeEmail and deleteChallengeEmail enforce validation and minimum pool protection', async () => {
  const { service } = makeFixtureService();

  // List initial emails
  const initial = await service.listChallengeEmails();
  assert.equal(initial.length, 4);

  // Validation: missing required fields
  await assert.rejects(
    () => service.saveChallengeEmail({ type: 'invalid_type', name: 'Test', subject: 'Sub', body: 'Body' }),
    /Template type must be one of/
  );
  await assert.rejects(
    () => service.saveChallengeEmail({ type: 'win', name: '', subject: 'Sub', body: 'Body' }),
    /Template name is required/
  );
  await assert.rejects(
    () => service.saveChallengeEmail({ type: 'win', name: 'Test', subject: '', body: 'Body' }),
    /Email subject is required/
  );
  await assert.rejects(
    () => service.saveChallengeEmail({ type: 'win', name: 'Test', subject: 'Sub', body: '' }),
    /Email body is required/
  );

  // Add a second win template
  const newWin = await service.saveChallengeEmail({
    type: 'win',
    name: 'Celebratory Win',
    subject: 'Champ of the week!',
    body: 'You crushed it {{score}}!',
    active: true
  });
  assert.ok(newWin.id);
  assert.equal(newWin.type, 'win');
  assert.equal(newWin.name, 'Celebratory Win');

  const afterAdd = await service.listChallengeEmails();
  assert.equal(afterAdd.length, 5);

  // Deleting the newly added win is allowed because win-default is still active
  const delResult = await service.deleteChallengeEmail(newWin.id);
  assert.equal(delResult.ok, true);

  // Attempting to delete win-default should now fail because it is the last active win template
  await assert.rejects(
    () => service.deleteChallengeEmail('win-default'),
    /Cannot delete the last active win email template/
  );

  // Attempting to delete loss-default should fail because it is the last active loss template
  await assert.rejects(
    () => service.deleteChallengeEmail('loss-default'),
    /Cannot delete the last active loss email template/
  );

  // Attempting to deactivate win-default via save should fail
  await assert.rejects(
    () => service.saveChallengeEmail({
      id: 'win-default',
      type: 'win',
      name: 'Standard Victory (Default)',
      subject: 'Subject',
      body: 'Body',
      active: false
    }),
    /at least one active win template is required/
  );

  // Attempting to delete non-existent template returns 404 error
  await assert.rejects(
    () => service.deleteChallengeEmail('non-existent-id'),
    /Email template not found/
  );
});

test('renderWeeklyEmails selects active templates from pool, handles tiebreaker, and falls back cleanly', () => {
  const pool = {
    'win-custom-1': {
      id: 'win-custom-1',
      type: 'win',
      name: 'Win 1',
      subject: 'Winner {{winner}}!',
      body: 'Crushed with {{score}} against {{loser}}',
      active: true
    },
    'loss-custom-1': {
      id: 'loss-custom-1',
      type: 'loss',
      name: 'Loss 1',
      subject: 'Tough luck {{loser}}',
      body: '{{winner}} took it {{score}}',
      active: true
    },
    'tie-win-1': {
      id: 'tie-win-1',
      type: 'tiebreaker_win',
      name: 'Tie Win 1',
      subject: 'Tiebreaker conquered by {{winner}}',
      body: 'You had {{winner_time}} vs {{loser_time}}',
      active: true
    },
    'tie-loss-1': {
      id: 'tie-loss-1',
      type: 'tiebreaker_loss',
      name: 'Tie Loss 1',
      subject: 'Tiebreaker lost to {{winner}}',
      body: 'Margin was {{margin}}',
      active: true
    }
  };

  const resultWin = {
    winner: 'yannick',
    winningMethod: 'activity_count',
    yannick: { qualifyingActivities: 6, qualifyingActivityTime: 7200 },
    emma: { qualifyingActivities: 4, qualifyingActivityTime: 5000 },
    seasonScoreAfter: { yannick: 3, emma: 2 }
  };

  const emails = renderWeeklyEmails(resultWin, { emailPool: pool });
  assert.equal(emails.yannick.templateId, 'win-custom-1');
  assert.equal(emails.yannick.subject, 'Winner Yannick!');
  assert.match(emails.yannick.text, /Crushed with 6–4 against Emma/);

  assert.equal(emails.emma.templateId, 'loss-custom-1');
  assert.equal(emails.emma.subject, 'Tough luck Emma');
  assert.match(emails.emma.text, /Yannick took it 6–4/);

  // Tiebreaker test
  const resultTiebreaker = {
    winner: 'emma',
    winningMethod: 'activity_time_tiebreaker',
    yannick: { qualifyingActivities: 5, qualifyingActivityTime: 3600 },
    emma: { qualifyingActivities: 5, qualifyingActivityTime: 4200 },
    seasonScoreAfter: { yannick: 2, emma: 3 }
  };

  const tieEmails = renderWeeklyEmails(resultTiebreaker, { emailPool: pool });
  assert.equal(tieEmails.emma.templateId, 'tie-win-1');
  assert.equal(tieEmails.emma.subject, 'Tiebreaker conquered by Emma');
  assert.equal(tieEmails.yannick.templateId, 'tie-loss-1');
  assert.equal(tieEmails.yannick.subject, 'Tiebreaker lost to Emma');

  // Passing specific template overrides pool selection
  const specificEmails = renderWeeklyEmails(resultWin, {
    winTemplate: pool['tie-win-1'],
    lossTemplate: pool['tie-loss-1'],
    emailPool: pool
  });
  assert.equal(specificEmails.yannick.templateId, 'tie-win-1');
  assert.equal(specificEmails.emma.templateId, 'tie-loss-1');

  // No custom template and no pool passed -> uses default strings exactly and templateId: null
  const defaultEmails = renderWeeklyEmails(resultWin);
  assert.equal(defaultEmails.yannick.templateId, null);
  assert.match(defaultEmails.yannick.subject, /won this week/i);
  assert.match(defaultEmails.emma.text, /Yannick took this one 6–4/);
});

test('win and loss emails have equal random chance of selection among active templates', () => {
  const pool = {
    'win-1': { id: 'win-1', type: 'win', name: 'Win 1', subject: 'W1', body: 'B1', active: true },
    'win-2': { id: 'win-2', type: 'win', name: 'Win 2', subject: 'W2', body: 'B2', active: true },
    'win-3': { id: 'win-3', type: 'win', name: 'Win 3', subject: 'W3', body: 'B3', active: true },
    'win-inactive': { id: 'win-inactive', type: 'win', name: 'Win Inactive', subject: 'WInact', body: 'BInact', active: false },
    'loss-1': { id: 'loss-1', type: 'loss', name: 'Loss 1', subject: 'L1', body: 'B1', active: true },
    'loss-2': { id: 'loss-2', type: 'loss', name: 'Loss 2', subject: 'L2', body: 'B2', active: true },
    'loss-inactive': { id: 'loss-inactive', type: 'loss', name: 'Loss Inactive', subject: 'LInact', body: 'BInact', active: false }
  };

  const resultWin = {
    winner: 'yannick',
    winningMethod: 'activity_count',
    yannick: { qualifyingActivities: 5, qualifyingActivityTime: 3600 },
    emma: { qualifyingActivities: 3, qualifyingActivityTime: 2400 },
    seasonScoreAfter: { yannick: 4, emma: 1 }
  };

  const counts = {
    'win-1': 0, 'win-2': 0, 'win-3': 0, 'win-inactive': 0,
    'loss-1': 0, 'loss-2': 0, 'loss-inactive': 0
  };

  const iterations = 6000;
  for (let i = 0; i < iterations; i++) {
    const emails = renderWeeklyEmails(resultWin, { emailPool: pool });
    if (counts[emails.yannick.templateId] !== undefined) counts[emails.yannick.templateId]++;
    if (counts[emails.emma.templateId] !== undefined) counts[emails.emma.templateId]++;
  }

  // Inactive templates must never be selected
  assert.equal(counts['win-inactive'], 0, 'Inactive win template should receive 0 selections');
  assert.equal(counts['loss-inactive'], 0, 'Inactive loss template should receive 0 selections');

  // Win templates: 3 candidates, expected ~2,000 each (33.3%). Allow ±15% tolerance.
  assert.ok(counts['win-1'] > 1700 && counts['win-1'] < 2300, `win-1 count (${counts['win-1']}) should be near 2000`);
  assert.ok(counts['win-2'] > 1700 && counts['win-2'] < 2300, `win-2 count (${counts['win-2']}) should be near 2000`);
  assert.ok(counts['win-3'] > 1700 && counts['win-3'] < 2300, `win-3 count (${counts['win-3']}) should be near 2000`);

  // Loss templates: 2 candidates, expected ~3,000 each (50.0%). Allow ±10% tolerance.
  assert.ok(counts['loss-1'] > 2700 && counts['loss-1'] < 3300, `loss-1 count (${counts['loss-1']}) should be near 3000`);
  assert.ok(counts['loss-2'] > 2700 && counts['loss-2'] < 3300, `loss-2 count (${counts['loss-2']}) should be near 3000`);
});

test('evaluateEmailRule correctly evaluates all supported conditions', () => {
  const baseResult = {
    winner: 'yannick',
    winningMethod: 'activity_count',
    yannick: { qualifyingActivities: 6, qualifyingActivityTime: 7200 },
    emma: { qualifyingActivities: 3, qualifyingActivityTime: 4000 },
    seasonScoreBefore: { yannick: 2, emma: 2 },
    seasonScoreAfter: { yannick: 3, emma: 2 }
  };

  // 1. none / empty rule
  assert.equal(evaluateEmailRule({ rule: { condition: 'none' } }, baseResult, 'winner'), true);
  assert.equal(evaluateEmailRule({}, baseResult, 'winner'), true);

  // 2. margin_gt for winner: 6 - 3 = 3
  assert.equal(evaluateEmailRule({ rule: { condition: 'margin_gt', param: 2 } }, baseResult, 'winner'), true); // 3 > 2 -> true
  assert.equal(evaluateEmailRule({ rule: { condition: 'margin_gt', param: 3 } }, baseResult, 'winner'), false); // 3 > 3 -> false
  assert.equal(evaluateEmailRule({ rule: { condition: 'margin_gt', param: 4 } }, baseResult, 'winner'), false); // 3 > 4 -> false

  // 3. margin_gt for loser
  assert.equal(evaluateEmailRule({ rule: { condition: 'margin_gt', param: 2 } }, baseResult, 'loser'), true);
  assert.equal(evaluateEmailRule({ rule: { condition: 'margin_gt', param: 3 } }, baseResult, 'loser'), false);

  // 4. overtake_season (winner): went from tied (2==2) to ahead (3>2) -> true
  assert.equal(evaluateEmailRule({ rule: { condition: 'overtake_season' } }, baseResult, 'winner'), true);

  // If winner was already ahead before (e.g. 3-2 to 4-2) -> false (did not overtake)
  const alreadyAhead = {
    ...baseResult,
    seasonScoreBefore: { yannick: 3, emma: 2 },
    seasonScoreAfter: { yannick: 4, emma: 2 }
  };
  assert.equal(evaluateEmailRule({ rule: { condition: 'overtake_season' } }, alreadyAhead, 'winner'), false);

  // 5. overtaken_season (loser)
  assert.equal(evaluateEmailRule({ rule: { condition: 'overtaken_season' } }, baseResult, 'loser'), true);
  assert.equal(evaluateEmailRule({ rule: { condition: 'overtaken_season' } }, alreadyAhead, 'loser'), false);

  // 6. season_lead_gt (winner): 3 - 2 = 1 point lead
  assert.equal(evaluateEmailRule({ rule: { condition: 'season_lead_gt', param: 0 } }, baseResult, 'winner'), true); // 1 > 0 -> true
  assert.equal(evaluateEmailRule({ rule: { condition: 'season_lead_gt', param: 1 } }, baseResult, 'winner'), false); // 1 > 1 -> false

  const bigLead = {
    ...baseResult,
    seasonScoreAfter: { yannick: 5, emma: 2 } // 3 point lead
  };
  assert.equal(evaluateEmailRule({ rule: { condition: 'season_lead_gt', param: 2 } }, bigLead, 'winner'), true); // 3 > 2 -> true
  assert.equal(evaluateEmailRule({ rule: { condition: 'season_lead_gt', param: 3 } }, bigLead, 'winner'), false); // 3 > 3 -> false

  // 7. season_trail_gt (loser)
  assert.equal(evaluateEmailRule({ rule: { condition: 'season_trail_gt', param: 2 } }, bigLead, 'loser'), true);
  assert.equal(evaluateEmailRule({ rule: { condition: 'season_trail_gt', param: 3 } }, bigLead, 'loser'), false);

  // 8. tiebreaker
  assert.equal(evaluateEmailRule({ rule: { condition: 'tiebreaker' } }, baseResult, 'winner'), false);
  const tiebreakerResult = { ...baseResult, winningMethod: 'activity_time_tiebreaker' };
  assert.equal(evaluateEmailRule({ rule: { condition: 'tiebreaker' } }, tiebreakerResult, 'winner'), true);
  assert.equal(evaluateEmailRule({ rule: { condition: 'tiebreaker' } }, tiebreakerResult, 'loser'), true);
});

test('renderWeeklyEmails prioritizes matching rule-based templates and falls back to standard pool', () => {
  const pool = {
    'win-default': {
      id: 'win-default',
      type: 'win',
      name: 'Default Win',
      subject: 'Standard Win',
      body: 'Standard Body',
      active: true,
      rule: { condition: 'none' }
    },
    'win-crush': {
      id: 'win-crush',
      type: 'win',
      name: 'Crush Victory',
      subject: 'Crushed It {{winner}}!',
      body: 'You won by more than 2!',
      active: true,
      rule: { condition: 'margin_gt', param: 2 }
    },
    'win-overtake': {
      id: 'win-overtake',
      type: 'win',
      name: 'Overtake Victory',
      subject: 'You took the lead in the season!',
      body: 'Overtook {{loser}}!',
      active: true,
      rule: { condition: 'overtake_season' }
    },
    'loss-default': {
      id: 'loss-default',
      type: 'loss',
      name: 'Default Loss',
      subject: 'Standard Loss',
      body: 'Standard Body',
      active: true,
      rule: { condition: 'none' }
    },
    'loss-crush': {
      id: 'loss-crush',
      type: 'loss',
      name: 'Crushed Defeat',
      subject: 'Rough beating {{loser}}',
      body: 'Lost by more than 2',
      active: true,
      rule: { condition: 'margin_gt', param: 2 }
    }
  };

  // Case A: Margin is 3 (> 2) -> win-crush and loss-crush match and are prioritized!
  const crushResult = {
    winner: 'yannick',
    winningMethod: 'activity_count',
    yannick: { qualifyingActivities: 6, qualifyingActivityTime: 7200 },
    emma: { qualifyingActivities: 3, qualifyingActivityTime: 4000 },
    seasonScoreBefore: { yannick: 3, emma: 2 },
    seasonScoreAfter: { yannick: 4, emma: 2 }
  };

  const crushEmails = renderWeeklyEmails(crushResult, { emailPool: pool });
  assert.equal(crushEmails.yannick.templateId, 'win-crush');
  assert.match(crushEmails.yannick.subject, /Crushed It Yannick!/);
  assert.equal(crushEmails.emma.templateId, 'loss-crush');
  assert.match(crushEmails.emma.subject, /Rough beating Emma/);

  // Case B: Margin is 1 (<= 2) and did not overtake -> rules don't match -> falls back to default templates
  const closeResult = {
    winner: 'yannick',
    winningMethod: 'activity_count',
    yannick: { qualifyingActivities: 5, qualifyingActivityTime: 6000 },
    emma: { qualifyingActivities: 4, qualifyingActivityTime: 5000 },
    seasonScoreBefore: { yannick: 3, emma: 2 },
    seasonScoreAfter: { yannick: 4, emma: 2 }
  };

  const closeEmails = renderWeeklyEmails(closeResult, { emailPool: pool });
  assert.equal(closeEmails.yannick.templateId, 'win-default');
  assert.equal(closeEmails.emma.templateId, 'loss-default');

  // Case C: Margin is 1 (<= 2) but Yannick overtook Emma (was tied 2-2, now 3-2) -> win-overtake matches!
  const overtakeResult = {
    winner: 'yannick',
    winningMethod: 'activity_count',
    yannick: { qualifyingActivities: 5, qualifyingActivityTime: 6000 },
    emma: { qualifyingActivities: 4, qualifyingActivityTime: 5000 },
    seasonScoreBefore: { yannick: 2, emma: 2 },
    seasonScoreAfter: { yannick: 3, emma: 2 }
  };

  const overtakeEmails = renderWeeklyEmails(overtakeResult, { emailPool: pool });
  assert.equal(overtakeEmails.yannick.templateId, 'win-overtake');
  assert.match(overtakeEmails.yannick.subject, /You took the lead in the season!/);
  // Emma has no overtake-loss rule template configured, so she cleanly falls back to loss-default
  assert.equal(overtakeEmails.emma.templateId, 'loss-default');
});

test('service finalizeWeek chooses email template and saves provisional.emailTemplates', async () => {
  const activities = [
    { id: 'act-1', name: 'Morning Run', sport_type: 'Run', start_date: '2026-09-08T10:00:00Z', distance: 5000, moving_time: 1800, elapsed_time: 1800 }
  ];
  const { service, dir } = makeFixtureService({ activities });

  // Connect both participants
  for (const id of ['yannick', 'emma']) {
    const inv = await service.generateInvite(id);
    const prep = await service.prepareOAuth(inv.token);
    const st = new URL(prep.authorizeUrl).searchParams.get('state');
    await service.completeOAuth({ code: 'test_code', state: st, scope: 'activity:read_all' });
  }

  // Finalize week
  const snapshot = await service.finalizeWeek({ weekStart: '2026-09-07' });
  assert.ok(snapshot.winner);
  assert.ok(snapshot.emailTemplates);
  assert.ok(snapshot.emailTemplates.winner);
  assert.ok(snapshot.emailTemplates.loser);

  // Ensure template IDs are valid templates from the pool
  const pool = await service.listChallengeEmails();
  const poolIds = pool.map(t => t.id);
  assert.ok(poolIds.includes(snapshot.emailTemplates.winner));
  assert.ok(poolIds.includes(snapshot.emailTemplates.loser));

  // Previewing with specific template works
  const preview = await service.previewEmail({ templateId: snapshot.emailTemplates.winner, participantId: 'yannick' });
  assert.equal(preview.templateId, snapshot.emailTemplates.winner);
  assert.ok(preview.subject);
});

test('admin API routes for challenge emails and aliases', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-api-test-'));
  const previousDataDir = process.env.BIG_TUNA_DATA_DIR;
  process.env.BIG_TUNA_DATA_DIR = dataDir;

  const { server } = require('../server');
  const OWNER_TOKEN = 'test-owner-token';
  const OTHER_TOKEN = 'test-other-token';

  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
    { id: 'yannick-id', username: 'yannick' },
    { id: 'other-id', username: 'otheruser' }
  ], null, 2));
  fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify([
    { token: OWNER_TOKEN, userId: 'yannick-id', expiresAt },
    { token: OTHER_TOKEN, userId: 'other-id', expiresAt }
  ], null, 2));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function apiReq(method, pathname, { token = OWNER_TOKEN, body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const req = http.request(new URL(pathname, baseUrl), {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, body: parsed, raw: text });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    // 1. Auth check
    const unauth = await apiReq('GET', '/api/admin/strava-challenge/emails', { token: null });
    assert.equal(unauth.status, 401);

    const forbidden = await apiReq('GET', '/api/admin/strava-challenge/emails', { token: OTHER_TOKEN });
    assert.equal(forbidden.status, 403);

    // 2. GET /api/admin/strava-challenge/emails
    const listRes = await apiReq('GET', '/api/admin/strava-challenge/emails');
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.ok, true);
    assert.ok(Array.isArray(listRes.body.emails));
    assert.equal(listRes.body.emails.length, 4);

    // 3. POST /api/admin/strava-challenge/emails
    const createRes = await apiReq('POST', '/api/admin/strava-challenge/emails', {
      body: {
        type: 'win',
        name: 'New Custom Win',
        subject: 'Incredible job {{winner}}',
        body: 'You scored {{score}} to take the point.',
        rule: { condition: 'margin_gt', param: 2 }
      }
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.ok, true);
    assert.ok(createRes.body.email.id);
    assert.equal(createRes.body.email.name, 'New Custom Win');
    assert.equal(createRes.body.email.rule.condition, 'margin_gt');
    assert.equal(createRes.body.email.rule.param, 2);
    const createdId = createRes.body.email.id;

    // 4. GET /api/admin/strava-challenge/emails/:id
    const getRes = await apiReq('GET', `/api/admin/strava-challenge/emails/${createdId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.ok, true);
    assert.equal(getRes.body.email.id, createdId);
    assert.equal(getRes.body.email.rule.condition, 'margin_gt');
    assert.equal(getRes.body.email.rule.param, 2);

    const notFoundRes = await apiReq('GET', '/api/admin/strava-challenge/emails/non-existent-id');
    assert.equal(notFoundRes.status, 404);

    // 5. PUT /api/admin/strava-challenge/emails/:id
    const putRes = await apiReq('PUT', `/api/admin/strava-challenge/emails/${createdId}`, {
      body: {
        type: 'win',
        name: 'Updated Win Name',
        subject: 'Updated Subject',
        body: 'Updated Body',
        active: true,
        rule: { condition: 'overtake_season', param: null }
      }
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.ok, true);
    assert.equal(putRes.body.email.name, 'Updated Win Name');
    assert.equal(putRes.body.email.rule.condition, 'overtake_season');

    // 6. DELETE /api/admin/strava-challenge/emails/:id
    const delRes = await apiReq('DELETE', `/api/admin/strava-challenge/emails/${createdId}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.ok, true);

    // 7. Test alias routes under /api/admin/email/challenge-emails
    const aliasListRes = await apiReq('GET', '/api/admin/email/challenge-emails');
    assert.equal(aliasListRes.status, 200);
    assert.equal(aliasListRes.body.ok, true);
    assert.equal(aliasListRes.body.emails.length, 4);

    const aliasItemRes = await apiReq('GET', '/api/admin/email/challenge-emails/win-default');
    assert.equal(aliasItemRes.status, 200);
    assert.equal(aliasItemRes.body.ok, true);
    assert.equal(aliasItemRes.body.email.id, 'win-default');

    const aliasCreateRes = await apiReq('POST', '/api/admin/email/challenge-emails', {
      body: {
        type: 'loss',
        name: 'Alias Loss',
        subject: 'Defeat {{loser}}',
        body: '{{winner}} took it.'
      }
    });
    assert.equal(aliasCreateRes.status, 201);
    assert.equal(aliasCreateRes.body.ok, true);

    const aliasDelRes = await apiReq('DELETE', `/api/admin/email/challenge-emails/${aliasCreateRes.body.email.id}`);
    assert.equal(aliasDelRes.status, 200);
    assert.equal(aliasDelRes.body.ok, true);

  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousDataDir === undefined) delete process.env.BIG_TUNA_DATA_DIR;
    else process.env.BIG_TUNA_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
