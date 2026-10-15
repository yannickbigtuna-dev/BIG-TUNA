'use strict';

const crypto = require('crypto');
const { CHALLENGE_TIME_ZONE, getZonedParts } = require('./strava-challenge/time');

// One score update per day, early evening in the challenge time zone.
const DEFAULT_SLOTS = Object.freeze([
  Object.freeze({ id: 'daily', hour: 19, minute: 0 }),
]);
const PARTICIPANTS = Object.freeze({ yannick: 'Yannick', emma: 'Emma' });
const WEBSITE_CHALLENGE_ID = 'website_yannick_emma';

// Notification kinds map 1:1 to the user-facing toggles in the iOS app.
const KIND = Object.freeze({
  daily: 'dailyScore',
  events: 'activityEvents',
  weekly: 'weeklyResults',
  reviews: 'reviewRequests',
});

const TEMPLATES = Object.freeze({
  // ── Activity & lead-change events ──
  overtaken: [
    ['You have been overtaken 🚨', '{opponent} just moved ahead {opponent_score}–{score}{activity_suffix}. Go make this notification obsolete, {name}.'],
    ['{opponent} passed you 😤', '{opponent} leads {opponent_score}–{score} this week{activity_suffix}. Your move, {name}.'],
  ],
  overtook: [
    ['You took the lead 🔥', '{name}, you just moved ahead of {opponent}, {score}–{opponent_score}{activity_suffix}. Try not to celebrate too early.'],
    ['You passed {opponent} 🚀', '{activity_lead}You lead {score}–{opponent_score}. {opponent} has been notified. Probably.'],
  ],
  activity_logged: [
    ['Activity counted ✅', '{activity_lead}It counts! You and {opponent} are now {score}–{opponent_score}.'],
    ['Point on the board 💪', '{activity_lead}That one counts. Score: {name} {score} – {opponent_score} {opponent}.'],
  ],
  activity_not_counted: [
    ['Activity logged, not counted 🤏', '{activity_lead}It didn’t qualify ({explanation}). You can request a review in the app.'],
  ],
  opponent_activity: [
    ['{opponent} just logged an activity 👀', '{opponent} logged {activity_name}. It counts — score is now {score}–{opponent_score}.'],
    ['{opponent} is moving 🏃', '{activity_name} from {opponent} just counted. You’re at {score}–{opponent_score}, {name}.'],
  ],
  opponent_activity_not_counted: [
    ['{opponent} just logged an activity 👀', '{opponent} logged {activity_name}, but it didn’t count. Still {score}–{opponent_score}.'],
  ],
  // ── Manual reviews ──
  review_reminder: [['A challenge review is waiting 📋', '{name}, an activity from {opponent} still needs your decision.']],
  // ── Weekly results ──
  week_win: [
    ['You won the week 🏆', '{name}, you beat {opponent} {score}–{opponent_score}. Season: {season_score}–{opponent_season_score}.'],
    ['Weekly crown secured 👑', '{score}–{opponent_score} over {opponent}. Season now {season_score}–{opponent_season_score}, {name}.'],
  ],
  week_loss: [
    ['{opponent} took the week 😤', '{opponent} won {opponent_score}–{score}. Season: {season_score}–{opponent_season_score}. New week, new chances, {name}.'],
    ['Week lost, war not over 🛠️', 'Final: {score}–{opponent_score} to {opponent}. Season sits at {season_score}–{opponent_season_score}.'],
  ],
  week_close_win: [['Won on the tiebreaker 😅', '{score}–{opponent_score} on activities, but your extra time beat {opponent}. Season: {season_score}–{opponent_season_score}.']],
  week_close_loss: [['Lost on the tiebreaker 🥲', '{score}–{opponent_score} on activities, but {opponent} had more active time. Season: {season_score}–{opponent_season_score}.']],
  week_tie: [['A perfectly tied week ⚖️', '{score}–{opponent_score} with {opponent} and identical time. No point awarded. Season: {season_score}–{opponent_season_score}.']],
  // ── Daily score update ──
  friday_pressure: [
    ['Friday pressure is on 🔥', '{name}, it is {score}–{opponent_score}. The weekend is your chance to make {opponent} nervous.'],
    ['Friday leaderboard check 🚨', 'You’re {score}–{opponent_score} with {opponent}. Time to make the scoreboard interesting, {name}.'],
  ],
  sunday_final_push: [
    ['Sunday final push 🏁', '{name}, the week stands at {score}–{opponent_score}. There is still time for one last move.'],
    ['The weekly clock is ticking ⏳', '{score}–{opponent_score} with {opponent} and the week ends tonight. Finish loudly, {name}.'],
  ],
  inactive_nudge: [
    ['The scoreboard is suspiciously quiet 👀', '{name}, you have no qualifying activity today. {opponent} would love for that to continue.'],
    ['Official movement reminder 🦾', 'Zero qualifying activities today, {name}. Go make this notification age badly.'],
  ],
  streak_hot: [
    ['You are on a roll 🔥', '{name}, the streak is alive and {opponent} has been formally warned.'],
    ['Hot streak detected 🚀', 'Keep it going, {name}. The current score is {score}–{opponent_score}.'],
  ],
  winning_season: [
    ['Season lead secured… for now 👑', '{name}, you lead {opponent} by {season_gap} in the season race.'],
    ['Top of the season table 🏆', '{name}, enjoy the {season_gap} season lead. Defending it is tomorrow’s problem.'],
  ],
  losing_season: [
    ['The season has notes 📝', '{name}, {opponent} leads the season by {season_gap}. Consider this your dramatic comeback cue.'],
    ['Season comeback requested 🚨', 'You are {season_gap} behind {opponent}, {name}. Plenty of time to become annoying.'],
  ],
  winning_by_a_little: [
    ['A lead is a lead 😏', '{name}, you are ahead {score}–{opponent_score}. Tiny crown, same bragging rights.'],
    ['Narrow lead alert 👑', '{opponent} is only {gap} back at {score}–{opponent_score}. Protect the lead, {name}.'],
  ],
  winning_comfortably: [
    ['Comfortable, not safe 😎', '{name}, you lead {score}–{opponent_score}. Keep the door closed.'],
    ['Leaderboard breathing room 🏆', 'A {gap} lead over {opponent} ({score}–{opponent_score}). Very tidy work, {name}.'],
  ],
  winning_big: [
    ['This is getting disrespectful 😂', '{name}, you lead {score}–{opponent_score}. {opponent} may request a recount.'],
    ['Big lead energy 🚀', 'You are {gap} ahead at {score}–{opponent_score}, {name}. Please try to look humble.'],
  ],
  tied: [
    ['Dead even ⚖️', '{name} and {opponent}: {score}–{opponent_score}. Somebody do something.'],
    ['The scoreboard refuses to choose 🍿', 'It is tied {score}–{opponent_score}, {name}. Excellent drama, poor separation.'],
  ],
  losing_by_a_little: [
    ['One move changes everything 👀', '{name}, you trail {score}–{opponent_score}. {opponent} is absolutely catchable.'],
    ['Close enough to cause trouble 🔥', 'Only {gap} behind at {score}–{opponent_score}, {name}. Go make {opponent} regret relaxing.'],
  ],
  losing_by_a_bit: [
    ['Comeback territory 🛠️', '{name}, {opponent} leads {opponent_score}–{score}. Time to close the {gap}.'],
    ['The gap is fixable 💥', 'You are {gap} behind at {score}–{opponent_score}, {name}. Annoying? Yes. Final? Absolutely not.'],
  ],
  losing_badly: [
    ['Emergency comeback meeting 🚨', '{name}, the score is {score}–{opponent_score}. Shoes on.'],
    ['The scoreboard chose violence 🥲', '{opponent} leads {opponent_score}–{score}. Your comeback montage starts now, {name}.'],
  ],
});

function localDateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function weekday(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function opponentOf(participantId) { return participantId === 'yannick' ? 'emma' : 'yannick'; }

function activityDateKey(activity, timeZone) {
  const parsed = Date.parse(activity && (activity.startDateLocal || activity.startDate));
  return Number.isFinite(parsed) ? localDateKey(getZonedParts(new Date(parsed), timeZone)) : null;
}

function weeklyCategory(mine, theirs) {
  const gap = Math.abs(mine - theirs);
  if (mine < theirs) return gap <= 1 ? 'losing_by_a_little' : gap <= 3 ? 'losing_by_a_bit' : 'losing_badly';
  if (mine > theirs) return gap <= 1 ? 'winning_by_a_little' : gap <= 3 ? 'winning_comfortably' : 'winning_big';
  return 'tied';
}

function activitySummary(dashboard, participantId, nowParts, timeZone) {
  const dates = (dashboard.currentWeek && Array.isArray(dashboard.currentWeek.activities) ? dashboard.currentWeek.activities : [])
    .filter(activity => activity && activity.qualifies && activity.participantId === participantId)
    .map(activity => activityDateKey(activity, timeZone))
    .filter(Boolean);
  const today = localDateKey(nowParts);
  const todayCount = dates.filter(value => value === today).length;
  const daySet = new Set(dates);
  let streak = 0;
  let cursor = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  if (!daySet.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!daySet.has(key)) break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { todayCount, streak };
}

function selectCategory({ slot, participantId, dashboard, nowParts, timeZone }) {
  const opponentId = opponentOf(participantId);
  const weekly = dashboard.currentWeek && dashboard.currentWeek.score || {};
  const season = dashboard.season && dashboard.season.score || {};
  const mine = Number(weekly[participantId]) || 0;
  const theirs = Number(weekly[opponentId]) || 0;
  const mySeason = Number(season[participantId]) || 0;
  const theirSeason = Number(season[opponentId]) || 0;
  const seasonGap = Math.abs(mySeason - theirSeason);
  const day = weekday(nowParts);
  if (slot === 'daily') {
    // The daily update is a score update first: Friday/Sunday flavour, otherwise
    // the current weekly standing. Every daily template renders the score.
    if (day === 5) return 'friday_pressure';
    if (day === 0) return 'sunday_final_push';
    return weeklyCategory(mine, theirs);
  }
  if (slot === 'morning') {
    if (day === 5) return 'friday_pressure';
    if (day === 0) return 'sunday_final_push';
    return weeklyCategory(mine, theirs);
  }
  const activity = activitySummary(dashboard, participantId, nowParts, timeZone);
  if (slot === 'midday') {
    if (activity.todayCount === 0) return 'inactive_nudge';
    if (seasonGap >= 1) return mySeason < theirSeason ? 'losing_season' : 'winning_season';
    return weeklyCategory(mine, theirs);
  }
  if (day === 0) return 'sunday_final_push';
  if (activity.todayCount >= 2 || activity.streak >= 3) return 'streak_hot';
  if (seasonGap >= 1) return mySeason < theirSeason ? 'losing_season' : 'winning_season';
  return weeklyCategory(mine, theirs);
}

function points(value) { const n = Number(value) || 0; return `${n} point${n === 1 ? '' : 's'}`; }

function describeActivity(activity) {
  if (!activity) return '';
  const name = String(activity.name || activity.sportType || 'an activity').trim().slice(0, 60);
  const meters = Number(activity.distanceMeters ?? activity.distance) || 0;
  const seconds = Number(activity.durationSeconds ?? activity.movingTime) || 0;
  let detail = '';
  if (meters >= 100) detail = `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
  else if (seconds >= 60) detail = seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m` : `${Math.round(seconds / 60)} min`;
  return detail ? `${name} (${detail})` : name;
}

function renderMessage({ category, participantId, dashboard, slotKey, extra = {}, score: scoreOverride, seasonScore }) {
  const opponentId = opponentOf(participantId);
  const weekly = scoreOverride || (dashboard && dashboard.currentWeek && dashboard.currentWeek.score) || {};
  const season = seasonScore || (dashboard && dashboard.season && dashboard.season.score) || {};
  const mine = Number(weekly[participantId]) || 0;
  const theirs = Number(weekly[opponentId]) || 0;
  const mySeason = Number(season[participantId]) || 0;
  const theirSeason = Number(season[opponentId]) || 0;
  const values = {
    name: PARTICIPANTS[participantId], opponent: PARTICIPANTS[opponentId], score: mine,
    opponent_score: theirs, gap: points(Math.abs(mine - theirs)),
    season_gap: points(Math.abs(mySeason - theirSeason)), season_score: mySeason, opponent_season_score: theirSeason,
    activity_name: 'an activity', activity_lead: '', activity_suffix: '', explanation: 'below the minimum',
    ...extra,
  };
  const options = TEMPLATES[category] || TEMPLATES.tied;
  const index = Array.from(`${slotKey}:${participantId}:${category}`).reduce((sum, char) => sum + char.charCodeAt(0), 0) % options.length;
  const replace = value => String(value).replace(/\{([a-z_]+)\}/g, (_, key) => String(values[key] ?? '')).replace(/\s+/g, ' ').trim();
  return { title: replace(options[index][0]).slice(0, 100), body: replace(options[index][1]).slice(0, 256) };
}

function createChallengeNotificationScheduler({
  now = () => new Date(), timeZone = CHALLENGE_TIME_ZONE, slots = DEFAULT_SLOTS, windowMinutes = 30,
  intervalMs = 60_000, refresh, getDashboard, readState, mutateState, resolveAccountId,
  decryptToken, sendNotification, apnsConfigured = true, logger = console,
  getPendingReviews = () => [], isAllowed = () => true,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
} = {}) {
  let timer = null;
  let inFlight = null;
  let eventChain = Promise.resolve();
  const log = (method, value) => { try { logger && typeof logger[method] === 'function' && logger[method](`[challenge notifications] ${value}`); } catch {} };
  const ledgerKey = (date, slot, participantId) => `${date}:${slot}:${participantId}`;
  const allowed = (accountId, kind) => { try { return !kind || !accountId || isAllowed(accountId, kind) !== false; } catch { return true; } };

  function pruneLedger(ledger) {
    const entries = Object.entries(ledger || {}).sort((a, b) => String(b[1] && b[1].claimedAt || '').localeCompare(String(a[1] && a[1].claimedAt || '')));
    const today = localDateKey(getZonedParts(now(), timeZone));
    const protectedEntries = entries.filter(([, record]) => record && (record.status === 'processing'
      || record.localDate === today
      || (record.claimedAt && localDateKey(getZonedParts(new Date(record.claimedAt), timeZone)) === today)));
    const protectedKeys = new Set(protectedEntries.map(([key]) => key));
    const historical = entries.filter(([key]) => !protectedKeys.has(key)).slice(0, Math.max(0, 192 - protectedEntries.length));
    return Object.fromEntries([...protectedEntries, ...historical]);
  }

  async function reserve(nowDate) {
    const parts = getZonedParts(nowDate, timeZone);
    const date = localDateKey(parts);
    const minuteOfDay = parts.hour * 60 + parts.minute;
    const due = [];
    await mutateState(state => {
      state.timedNotificationLedger = pruneLedger(state.timedNotificationLedger);
      for (const slot of slots) {
        const ageMinutes = minuteOfDay - (slot.hour * 60 + slot.minute);
        if (ageMinutes < 0) continue;
        for (const participantId of Object.keys(PARTICIPANTS)) {
          const key = ledgerKey(date, slot.id, participantId);
          if (state.timedNotificationLedger[key]) continue;
          const accountId = resolveAccountId(participantId);
          const withinWindow = ageMinutes < windowMinutes;
          state.timedNotificationLedger[key] = {
            key, localDate: date, slot: slot.id, participantId, accountId: accountId || null,
            claimedAt: nowDate.toISOString(), completedAt: withinWindow ? null : nowDate.toISOString(),
            status: withinWindow ? 'processing' : 'skipped', reason: withinWindow ? null : 'expired',
          };
          if (withinWindow) due.push({ key, slot: slot.id, participantId, accountId: accountId || null, parts });
        }
      }
      state.timedNotificationLedger = pruneLedger(state.timedNotificationLedger);
    });
    return due;
  }

  async function complete(key, outcome) {
    await mutateState(state => {
      const record = state.timedNotificationLedger && state.timedNotificationLedger[key];
      if (!record) return;
      Object.assign(record, outcome, { completedAt: now().toISOString() });
      state.timedNotificationLedger = pruneLedger(state.timedNotificationLedger);
    });
  }

  // Claims a one-off ledger key. Returns false when it was already claimed.
  async function claim(key, record) {
    let claimed = false;
    await mutateState(state => {
      state.timedNotificationLedger = pruneLedger(state.timedNotificationLedger);
      if (state.timedNotificationLedger[key]) return;
      claimed = true;
      state.timedNotificationLedger[key] = { key, claimedAt: now().toISOString(), completedAt: null, status: 'processing', reason: null, ...record };
    });
    return claimed;
  }

  async function deliver(item, { category, dashboard, eventType = 'daily_score', reviewId = '', kind = KIND.daily, message: preset, renderOptions = {} }) {
    if (!allowed(item.accountId, kind)) {
      await complete(item.key, { status: 'skipped', reason: 'opted_out', category, sentCount: 0 });
      return false;
    }
    const message = preset || renderMessage({ category, participantId: item.participantId, dashboard, slotKey: item.key, ...renderOptions });
    const state = readState();
    const devices = Object.entries(state.devices || {}).filter(([, device]) => device && !device.disabledAt && item.accountId && device.userId === item.accountId);
    let sentCount = 0;
    let invalidCount = 0;
    let failureReason = !apnsConfigured ? 'apns_unconfigured' : devices.length ? 'delivery_failed' : 'no_registered_devices';
    if (apnsConfigured) for (const [deviceKey, device] of devices) {
      try {
        const token = await decryptToken(device.tokenEncrypted);
        const result = await sendNotification({ token, platform: 'ios', environment: device.environment || null, eventType, challengeId: WEBSITE_CHALLENGE_ID, reviewId, title: message.title, body: message.body });
        if (result && (result.delivery === 'sent' || result.sent === true)) {
          sentCount++;
          if (result.environment && result.environment !== device.environment) {
            await mutateState(current => { if (current.devices && current.devices[deviceKey]) current.devices[deviceKey].environment = result.environment; });
          }
        } else if (result && (result.reason === 'invalid_token' || result.invalidToken)) {
          invalidCount++;
          await mutateState(current => { if (current.devices && current.devices[deviceKey]) current.devices[deviceKey].disabledAt = now().toISOString(); });
        } else if (result && result.reason) failureReason = String(result.reason).slice(0, 64);
      } catch {
        failureReason = 'delivery_failed';
      }
    }
    await complete(item.key, {
      status: sentCount ? 'sent' : 'failed', reason: sentCount ? null : failureReason,
      category, title: message.title, deviceCount: devices.length, sentCount, invalidTokenCount: invalidCount,
    });
    return sentCount > 0;
  }

  async function processReviewReminder(tickTime, dashboard) {
    const pending = await getPendingReviews();
    const eligible = (Array.isArray(pending) ? pending : []).filter(review => {
      const age = tickTime.getTime() - Date.parse(review.createdAt);
      return Number.isFinite(age) && age >= 2 * 60 * 60_000 && review.recipientParticipantId && PARTICIPANTS[review.recipientParticipantId];
    }).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    // Quiet hours: reminders wait until 08:00–22:00 local time.
    const hour = getZonedParts(tickTime, timeZone).hour;
    if (hour < 8 || hour >= 22) return 0;
    for (const review of eligible) {
      const age = tickTime.getTime() - Date.parse(review.createdAt);
      // Reminders at ~2h and ~8h, then once a day; never more than five per review.
      const bucket = age < 8 * 60 * 60_000 ? 0 : age < 24 * 60 * 60_000 ? 1 : 1 + Math.floor(age / (24 * 60 * 60_000));
      if (bucket > 4) continue;
      const key = `review:${review.id}:${bucket}`;
      const accountId = review.recipientAccountId || resolveAccountId(review.recipientParticipantId) || null;
      const claimed = await claim(key, { type: 'review_reminder', localDate: localDateKey(getZonedParts(tickTime, timeZone)), reviewId: review.id, participantId: review.recipientParticipantId, accountId });
      if (!claimed) continue;
      await deliver({ key, participantId: review.recipientParticipantId, accountId }, { category: 'review_reminder', dashboard, eventType: 'review_reminder', reviewId: review.id, kind: KIND.reviews });
      return 1;
    }
    return 0;
  }

  async function runTick() {
    const tickTime = now();
    const due = await reserve(tickTime);
    if (!due.length) {
      const dashboard = await getDashboard();
      const reminders = await processReviewReminder(tickTime, dashboard);
      return { claimed: 0, delivered: 0, reminders };
    }
    let dashboard;
    try {
      const refreshResult = await refresh();
      if (refreshResult && typeof refreshResult === 'object' && Object.values(refreshResult).some(result => !result || result.ok === false)) {
        log('warn', 'a participant refresh failed before the daily update; using the latest stored scores');
      }
      dashboard = await getDashboard();
    } catch (error) {
      log('warn', `refresh before daily update failed: ${error && error.message ? error.message : 'unavailable'}`);
      try { dashboard = await getDashboard(); } catch {}
    }
    if (!dashboard) {
      for (const item of due) await complete(item.key, { status: 'failed', reason: 'refresh_failed', sentCount: 0 });
      return { claimed: due.length, delivered: 0 };
    }
    let delivered = 0;
    for (const item of due) {
      const category = selectCategory({ slot: item.slot, participantId: item.participantId, dashboard, nowParts: item.parts, timeZone });
      if (await deliver(item, { category, dashboard, eventType: 'daily_score', kind: KIND.daily })) delivered++;
    }
    const reminders = await processReviewReminder(tickTime, dashboard);
    return { claimed: due.length, delivered, reminders };
  }

  // ── Activity / lead-change events ─────────────────────────────────────────
  // A durable cursor (seen activity IDs + last known weekly score) makes event
  // detection independent of which code path performed the Strava sync, and
  // keeps restarts from replaying old activities.
  function eventPlanFor(participantId, plan) {
    const opponentId = opponentOf(participantId);
    const { prevScore, score, newActivities } = plan;
    const myBefore = Number(prevScore[participantId]) || 0, theirBefore = Number(prevScore[opponentId]) || 0;
    const myAfter = Number(score[participantId]) || 0, theirAfter = Number(score[opponentId]) || 0;
    const mine = newActivities.filter(a => a.participantId === participantId);
    const theirs = newActivities.filter(a => a.participantId === opponentId);
    const myCounted = mine.filter(a => a.qualifies);
    const theirCounted = theirs.filter(a => a.qualifies);
    const lead = list => list.length === 1 ? `${describeActivity(list[0])}: ` : list.length > 1 ? `${list.length} new activities: ` : '';
    const names = list => list.length === 1 ? describeActivity(list[0]) : `${list.length} activities`;
    if (myBefore <= theirBefore && myAfter > theirAfter) {
      const source = myCounted.length ? myCounted : mine;
      return { category: 'overtook', activities: source, extra: { activity_lead: lead(source), activity_suffix: source.length ? ` with ${names(source)}` : '' } };
    }
    if (myBefore >= theirBefore && myAfter < theirAfter) {
      const source = theirCounted.length ? theirCounted : theirs;
      return { category: 'overtaken', activities: source, extra: { activity_suffix: source.length ? ` after logging ${names(source)}` : '' } };
    }
    if (mine.length) {
      if (myCounted.length) return { category: 'activity_logged', activities: myCounted, extra: { activity_lead: lead(myCounted) } };
      const first = mine[0];
      return { category: 'activity_not_counted', activities: mine, extra: { activity_lead: lead(mine), explanation: String(first.explanation || 'below the minimum').slice(0, 80) } };
    }
    if (theirs.length) {
      if (theirCounted.length) return { category: 'opponent_activity', activities: theirCounted, extra: { activity_name: names(theirCounted) } };
      return { category: 'opponent_activity_not_counted', activities: theirs, extra: { activity_name: names(theirs) } };
    }
    return null;
  }

  async function processAuthoritativeUpdate({ at = now(), dashboard: provided } = {}) {
    const dashboard = provided || await getDashboard();
    const week = dashboard && dashboard.currentWeek;
    if (!week) return { delivered: 0 };
    const score = { yannick: Number(week.score && week.score.yannick) || 0, emma: Number(week.score && week.score.emma) || 0 };
    const activities = (Array.isArray(week.activities) ? week.activities : []).filter(a => a && a.id && PARTICIPANTS[a.participantId]);
    let plan = null;
    await mutateState(state => {
      const cursor = state.eventNotificationCursor;
      const stamp = at.toISOString();
      if (!cursor || !cursor.seen || typeof cursor.seen !== 'object') {
        state.eventNotificationCursor = { weekStart: week.weekStart || null, score, seen: Object.fromEntries(activities.map(a => [String(a.id), stamp])), initializedAt: stamp, updatedAt: stamp };
        return;
      }
      const prevScore = cursor.weekStart === (week.weekStart || null) ? (cursor.score || { yannick: 0, emma: 0 }) : { yannick: 0, emma: 0 };
      const newActivities = activities.filter(a => !cursor.seen[String(a.id)]);
      for (const a of newActivities) cursor.seen[String(a.id)] = stamp;
      const cutoff = at.getTime() - 21 * 24 * 60 * 60_000;
      for (const [id, seenAt] of Object.entries(cursor.seen)) if (Date.parse(seenAt) < cutoff) delete cursor.seen[id];
      cursor.weekStart = week.weekStart || null;
      cursor.score = score;
      cursor.updatedAt = stamp;
      plan = { prevScore, score, newActivities };
    });
    if (!plan) return { delivered: 0, seeded: true };
    const leaderChanged = Math.sign(plan.prevScore.yannick - plan.prevScore.emma) !== Math.sign(score.yannick - score.emma);
    if (!plan.newActivities.length && !leaderChanged) return { delivered: 0 };
    let delivered = 0;
    for (const participantId of Object.keys(PARTICIPANTS)) {
      const event = eventPlanFor(participantId, plan);
      if (!event) continue;
      const accountId = resolveAccountId(participantId) || null;
      const signature = crypto.createHash('sha256').update(`${event.category}:${score.yannick}:${score.emma}:${plan.newActivities.map(a => a.id).sort().join(',')}`).digest('hex').slice(0, 24);
      const key = `event:${participantId}:${signature}`;
      const claimed = await claim(key, { type: 'score_event', localDate: localDateKey(getZonedParts(at, timeZone)), category: event.category, participantId, accountId });
      if (!claimed) continue;
      if (await deliver({ key, participantId, accountId }, { category: event.category, dashboard, eventType: event.category, kind: KIND.events, renderOptions: { extra: event.extra } })) delivered++;
    }
    return { delivered };
  }

  function handleAuthoritativeUpdate(update = {}) {
    const run = eventChain.then(() => processAuthoritativeUpdate(update));
    eventChain = run.catch(error => log('warn', `event notifications failed: ${error && error.message ? error.message : 'unavailable'}`));
    return run;
  }

  // ── Weekly results ────────────────────────────────────────────────────────
  async function handleWeekFinalized(snapshot) {
    if (!snapshot || !snapshot.weekStart || snapshot.alreadyFinalized) return { delivered: 0 };
    const score = { yannick: Number(snapshot.yannick && snapshot.yannick.qualifyingActivities) || 0, emma: Number(snapshot.emma && snapshot.emma.qualifyingActivities) || 0 };
    const seasonScore = { yannick: Number(snapshot.seasonScoreAfter && snapshot.seasonScoreAfter.yannick) || 0, emma: Number(snapshot.seasonScoreAfter && snapshot.seasonScoreAfter.emma) || 0 };
    let delivered = 0;
    for (const participantId of Object.keys(PARTICIPANTS)) {
      const tiebreak = snapshot.winningMethod === 'activity_time_tiebreaker';
      const category = !snapshot.winner ? 'week_tie'
        : snapshot.winner === participantId ? (tiebreak ? 'week_close_win' : 'week_win')
          : (tiebreak ? 'week_close_loss' : 'week_loss');
      const accountId = resolveAccountId(participantId) || null;
      const key = `week:${snapshot.weekStart}:${participantId}`;
      const claimed = await claim(key, { type: 'week_result', localDate: localDateKey(getZonedParts(now(), timeZone)), weekStart: snapshot.weekStart, category, participantId, accountId });
      if (!claimed) continue;
      if (await deliver({ key, participantId, accountId }, { category, eventType: 'week_result', kind: KIND.weekly, renderOptions: { score, seasonScore } })) delivered++;
    }
    return { delivered };
  }

  function tick() {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(runTick).catch(error => log('warn', error && error.message ? error.message : 'scheduler tick failed')).finally(() => { inFlight = null; });
    return inFlight;
  }
  function start() {
    if (timer) return;
    tick();
    timer = setIntervalFn(tick, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  function stop() { if (timer) clearIntervalFn(timer); timer = null; }
  return { start, stop, tick, handleAuthoritativeUpdate, handleWeekFinalized, _test: { selectCategory, renderMessage, reserve, localDateKey, processReviewReminder, eventPlanFor } };
}

module.exports = { createChallengeNotificationScheduler, DEFAULT_SLOTS, KIND, TEMPLATES, _test: { selectCategory, renderMessage, localDateKey, activitySummary, describeActivity } };
