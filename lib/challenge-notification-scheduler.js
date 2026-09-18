'use strict';

const crypto = require('crypto');
const { CHALLENGE_TIME_ZONE, getZonedParts } = require('./strava-challenge/time');

const DEFAULT_SLOTS = Object.freeze([
  Object.freeze({ id: 'morning', hour: 9, minute: 0 }),
  Object.freeze({ id: 'midday', hour: 13, minute: 0 }),
  Object.freeze({ id: 'night', hour: 20, minute: 0 }),
]);
const PARTICIPANTS = Object.freeze({ yannick: 'Yannick', emma: 'Emma' });
const TEMPLATES = Object.freeze({
  overtaken: [['You have been overtaken 🚨', '{opponent} just moved ahead, {name}. Go make this notification obsolete.']],
  overtook: [['You took the lead 🔥', '{name}, you just moved ahead of {opponent}. Try not to celebrate too early.']],
  comeback_in_progress: [['Comeback in progress 📈', '{name}, you narrowed the gap to {gap}. Keep going.']],
  lead_slipping: [['Your lead is shrinking 👀', '{name}, {opponent} just made the score {score}–{opponent_score}.']],
  review_reminder: [['A challenge review is waiting 📋', '{name}, an activity still needs your decision.']],
  friday_pressure: [
    ['Friday pressure is on 🔥', '{name}, it is {score}–{opponent_score}. The weekend is your chance to make {opponent} nervous.'],
    ['Friday leaderboard check 🚨', '{opponent} can see that {gap}. Time to make the scoreboard interesting, {name}.'],
  ],
  sunday_final_push: [
    ['Sunday final push 🏁', '{name}, the week stands at {score}–{opponent_score}. There is still time for one last move.'],
    ['The weekly clock is ticking ⏳', '{gap} separates you and {opponent}. Finish the week loudly, {name}.'],
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
    ['Narrow lead alert 👑', '{opponent} is only {gap} back. Protect the lead, {name}.'],
  ],
  winning_comfortably: [
    ['Comfortable, not safe 😎', '{name}, you lead {score}–{opponent_score}. Keep the door closed.'],
    ['Leaderboard breathing room 🏆', 'A {gap} lead over {opponent}. Very tidy work, {name}.'],
  ],
  winning_big: [
    ['This is getting disrespectful 😂', '{name}, you lead {score}–{opponent_score}. {opponent} may request a recount.'],
    ['Big lead energy 🚀', 'You are {gap} ahead, {name}. Please try to look humble.'],
  ],
  tied: [
    ['Dead even ⚖️', '{name} and {opponent}: {score}–{opponent_score}. Somebody do something.'],
    ['The scoreboard refuses to choose 🍿', 'It is tied, {name}. This is excellent drama and poor separation.'],
  ],
  losing_by_a_little: [
    ['One move changes everything 👀', '{name}, you trail {score}–{opponent_score}. {opponent} is absolutely catchable.'],
    ['Close enough to cause trouble 🔥', 'Only {gap} behind, {name}. Go make {opponent} regret relaxing.'],
  ],
  losing_by_a_bit: [
    ['Comeback territory 🛠️', '{name}, {opponent} leads {opponent_score}–{score}. Time to close the {gap}.'],
    ['The gap is fixable 💥', 'You are {gap} behind, {name}. Annoying? Yes. Final? Absolutely not.'],
  ],
  losing_badly: [
    ['Emergency comeback meeting 🚨', '{name}, the score is {score}–{opponent_score}. Shoes on.'],
    ['The scoreboard chose violence 🥲', '{opponent} leads by {gap}. Your comeback montage starts now, {name}.'],
  ],
});

function localDateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function weekday(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

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
  const opponentId = participantId === 'yannick' ? 'emma' : 'yannick';
  const weekly = dashboard.currentWeek && dashboard.currentWeek.score || {};
  const season = dashboard.season && dashboard.season.score || {};
  const mine = Number(weekly[participantId]) || 0;
  const theirs = Number(weekly[opponentId]) || 0;
  const mySeason = Number(season[participantId]) || 0;
  const theirSeason = Number(season[opponentId]) || 0;
  const seasonGap = Math.abs(mySeason - theirSeason);
  const day = weekday(nowParts);
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

function renderMessage({ category, participantId, dashboard, slotKey }) {
  const opponentId = participantId === 'yannick' ? 'emma' : 'yannick';
  const weekly = dashboard.currentWeek && dashboard.currentWeek.score || {};
  const season = dashboard.season && dashboard.season.score || {};
  const mine = Number(weekly[participantId]) || 0;
  const theirs = Number(weekly[opponentId]) || 0;
  const values = {
    name: PARTICIPANTS[participantId], opponent: PARTICIPANTS[opponentId], score: mine,
    opponent_score: theirs, gap: `${Math.abs(mine - theirs)} point${Math.abs(mine - theirs) === 1 ? '' : 's'}`,
    season_gap: `${Math.abs((Number(season[participantId]) || 0) - (Number(season[opponentId]) || 0))} point${Math.abs((Number(season[participantId]) || 0) - (Number(season[opponentId]) || 0)) === 1 ? '' : 's'}`,
  };
  const options = TEMPLATES[category] || TEMPLATES.tied;
  const index = Array.from(`${slotKey}:${participantId}:${category}`).reduce((sum, char) => sum + char.charCodeAt(0), 0) % options.length;
  const replace = value => String(value).replace(/\{([a-z_]+)\}/g, (_, key) => String(values[key] ?? '')).trim();
  return { title: replace(options[index][0]).slice(0, 100), body: replace(options[index][1]).slice(0, 256) };
}

function createChallengeNotificationScheduler({
  now = () => new Date(), timeZone = CHALLENGE_TIME_ZONE, slots = DEFAULT_SLOTS, windowMinutes = 5,
  intervalMs = 60_000, refresh, getDashboard, readState, mutateState, resolveAccountId,
  decryptToken, sendNotification, apnsConfigured = true, logger = console,
  getPendingReviews = () => [], eventFreshnessMinutes = 30, eventCooldownMinutes = 15,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
} = {}) {
  let timer = null;
  let inFlight = null;
  const log = (method, value) => { try { logger && typeof logger[method] === 'function' && logger[method](`[challenge notifications] ${value}`); } catch {} };
  const ledgerKey = (date, slot, participantId) => `${date}:${slot}:${participantId}`;

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

  async function deliver(item, { category, dashboard, eventType = 'timed_score', reviewId = '' }) {
    const message = renderMessage({ category, participantId: item.participantId, dashboard, slotKey: item.key });
    const state = readState();
    const devices = Object.entries(state.devices || {}).filter(([, device]) => device && !device.disabledAt && item.accountId && device.userId === item.accountId);
    let sentCount = 0;
    let invalidCount = 0;
    let failureReason = !apnsConfigured ? 'apns_unconfigured' : devices.length ? 'delivery_failed' : 'no_registered_devices';
    if (apnsConfigured) for (const [deviceKey, device] of devices) {
      try {
        const token = await decryptToken(device.tokenEncrypted);
        const result = await sendNotification({ token, platform: 'ios', eventType, challengeId: 'website_yannick_emma', reviewId, title: message.title, body: message.body });
        if (result && (result.delivery === 'sent' || result.sent === true)) sentCount++;
        else if (result && (result.reason === 'invalid_token' || result.invalidToken)) {
          invalidCount++;
          await mutateState(current => { if (current.devices && current.devices[deviceKey]) current.devices[deviceKey].disabledAt = now().toISOString(); });
        } else if (result && result.reason) failureReason = String(result.reason).slice(0, 64);
      } catch {
        failureReason = 'delivery_failed';
      }
    }
    await complete(item.key, {
      status: sentCount ? 'sent' : 'failed', reason: sentCount ? null : failureReason,
      category, deviceCount: devices.length, sentCount, invalidTokenCount: invalidCount,
    });
    return sentCount > 0;
  }

  async function processReviewReminder(tickTime, dashboard) {
    const pending = await getPendingReviews();
    const eligible = (Array.isArray(pending) ? pending : []).filter(review => {
      const age = tickTime.getTime() - Date.parse(review.createdAt);
      return Number.isFinite(age) && age >= 2 * 60 * 60_000 && review.recipientParticipantId && PARTICIPANTS[review.recipientParticipantId];
    }).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const review of eligible) {
      const age = tickTime.getTime() - Date.parse(review.createdAt);
      const bucket = Math.floor((age - 2 * 60 * 60_000) / (3 * 60 * 60_000));
      const key = `review:${review.id}:${bucket}`;
      let claimed = false;
      await mutateState(state => {
        state.timedNotificationLedger = pruneLedger(state.timedNotificationLedger);
        if (state.timedNotificationLedger[key]) return;
        const recentReminder = Object.values(state.timedNotificationLedger).some(record => record && record.type === 'review_reminder'
          && record.reviewId === review.id && tickTime.getTime() - Date.parse(record.claimedAt) < 3 * 60 * 60_000);
        if (recentReminder) return;
        claimed = true;
        state.timedNotificationLedger[key] = {
          key, type: 'review_reminder', localDate: localDateKey(getZonedParts(tickTime, timeZone)), reviewId: review.id, participantId: review.recipientParticipantId,
          accountId: review.recipientAccountId || resolveAccountId(review.recipientParticipantId) || null,
          claimedAt: tickTime.toISOString(), completedAt: null, status: 'processing', reason: null,
        };
      });
      if (!claimed) continue;
      const item = { key, participantId: review.recipientParticipantId, accountId: review.recipientAccountId || resolveAccountId(review.recipientParticipantId) || null };
      await deliver(item, { category: 'review_reminder', dashboard, eventType: 'review_reminder', reviewId: review.id });
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
        throw new Error('one or more participant refreshes failed');
      }
      dashboard = await getDashboard();
    } catch (error) {
      for (const item of due) await complete(item.key, { status: 'failed', reason: 'refresh_failed', sentCount: 0 });
      log('warn', `authoritative refresh failed: ${error && error.message ? error.message : 'unavailable'}`);
      return { claimed: due.length, delivered: 0 };
    }
    let delivered = 0;
    for (const item of due) {
      const category = selectCategory({ slot: item.slot, participantId: item.participantId, dashboard, nowParts: item.parts, timeZone });
      if (await deliver(item, { category, dashboard })) delivered++;
    }
    const reminders = await processReviewReminder(tickTime, dashboard);
    return { claimed: due.length, delivered, reminders };
  }

  function recentNewActivities(before, after, tickTime, baselineEstablished) {
    const prior = new Set((before.currentWeek && before.currentWeek.activities || []).map(activity => activity.id));
    return (after.currentWeek && after.currentWeek.activities || []).filter(activity => {
      const timestamp = Date.parse(activity.startDate);
      return activity && activity.qualifies && !prior.has(activity.id) && (baselineEstablished || (Number.isFinite(timestamp)
        && tickTime.getTime() - timestamp >= 0 && tickTime.getTime() - timestamp <= eventFreshnessMinutes * 60_000));
    });
  }

  function eventCategory(before, after, participantId, recent, tickTime) {
    const opponentId = participantId === 'yannick' ? 'emma' : 'yannick';
    const beforeScore = before.currentWeek && before.currentWeek.score || {};
    const afterScore = after.currentWeek && after.currentWeek.score || {};
    const myBefore = Number(beforeScore[participantId]) || 0, theirBefore = Number(beforeScore[opponentId]) || 0;
    const myAfter = Number(afterScore[participantId]) || 0, theirAfter = Number(afterScore[opponentId]) || 0;
    if (myBefore >= theirBefore && myAfter < theirAfter && recent.some(a => a.participantId === opponentId)) return 'overtaken';
    if (myBefore <= theirBefore && myAfter > theirAfter && recent.some(a => a.participantId === participantId)) return 'overtook';
    if (myAfter < theirAfter && myAfter > myBefore && theirAfter - myAfter < theirBefore - myBefore) return 'comeback_in_progress';
    if (myAfter > theirAfter && theirAfter > theirBefore && myAfter - theirAfter < myBefore - theirBefore) return 'lead_slipping';
    const parts = getZonedParts(tickTime, timeZone);
    const activity = activitySummary(after, participantId, parts, timeZone);
    if (recent.some(a => a.participantId === participantId) && (activity.todayCount >= 2 || activity.streak >= 3)) return 'streak_hot';
    return null;
  }

  async function handleAuthoritativeUpdate({ before, after, at = now(), baselineEstablished = false } = {}) {
    if (!before || !after) return { delivered: 0 };
    const recent = recentNewActivities(before, after, at, baselineEstablished);
    if (!recent.length) return { delivered: 0 };
    let delivered = 0;
    for (const participantId of Object.keys(PARTICIPANTS)) {
      const category = eventCategory(before, after, participantId, recent, at);
      if (!category) continue;
      const accountId = resolveAccountId(participantId) || null;
      const score = after.currentWeek && after.currentWeek.score || {};
      const signature = crypto.createHash('sha256').update(`${category}:${Number(score.yannick) || 0}:${Number(score.emma) || 0}:${recent.map(a => a.id).sort().join(',')}`).digest('hex').slice(0, 24);
      const key = `event:${participantId}:${signature}`;
      let claimed = false;
      await mutateState(state => {
        state.timedNotificationLedger = pruneLedger(state.timedNotificationLedger);
        if (state.timedNotificationLedger[key]) return;
        const cooldown = Object.values(state.timedNotificationLedger).some(record => record && record.type === 'score_event'
          && record.participantId === participantId && record.category === category
          && at.getTime() - Date.parse(record.claimedAt) < eventCooldownMinutes * 60_000);
        if (cooldown) return;
        claimed = true;
        state.timedNotificationLedger[key] = { key, type: 'score_event', localDate: localDateKey(getZonedParts(at, timeZone)), category, participantId, accountId, claimedAt: at.toISOString(), completedAt: null, status: 'processing', reason: null };
      });
      if (claimed && await deliver({ key, participantId, accountId }, { category, dashboard: after, eventType: category })) delivered++;
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
  return { start, stop, tick, handleAuthoritativeUpdate, _test: { selectCategory, renderMessage, reserve, localDateKey, processReviewReminder, eventCategory } };
}

module.exports = { createChallengeNotificationScheduler, DEFAULT_SLOTS, _test: { selectCategory, renderMessage, localDateKey, activitySummary } };
