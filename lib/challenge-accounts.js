'use strict';

// Account-scoped challenge state.  This module intentionally knows nothing about
// sessions or OAuth credentials; server wiring supplies the authenticated user
// and a redacted Strava-status callback.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ChallengeAccountsError extends Error {
  constructor(message, code = 'challenge_error', status = 400) {
    super(message); this.name = 'ChallengeAccountsError'; this.code = code; this.status = status;
  }
}
const fail = (message, code, status) => { throw new ChallengeAccountsError(message, code, status); };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const iso = date => new Date(date).toISOString();
const id = prefix => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
const userId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const text = (value, max = 160) => typeof value === 'string' && value.trim().length <= max ? value.trim() : null;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function invitationToken() { return crypto.randomBytes(32).toString('base64url'); }
function invitationDigest(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function sameDigest(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function validInvitationToken(token) { return typeof token === 'string' && INVITE_TOKEN_RE.test(token); }

const TEMPLATES = Object.freeze({
  'yannick-emma-default': { name: 'Yannick & Emma Challenge', participants: [{ userId: 'yannick', role: 'owner' }, { userId: 'emma', role: 'member' }], qualifyingActivities: ['Run', 'Ride', 'Walk', 'Swim'], thresholds: { distanceMeters: 1000 }, scoring: { mode: 'count', pointsPerActivity: 1 }, cadence: { type: 'weekly' }, timezone: 'America/Halifax', manualReview: true },
  weekly: { name: 'Weekly Challenge', qualifyingActivities: ['Run', 'Ride', 'Walk'], thresholds: { distanceMeters: 1000 }, scoring: { mode: 'count', pointsPerActivity: 1 }, cadence: { type: 'weekly' }, timezone: 'America/Halifax', manualReview: true },
  season: { name: 'Season Challenge', qualifyingActivities: ['Run', 'Ride', 'Walk'], thresholds: { distanceMeters: 1000 }, scoring: { mode: 'count', pointsPerActivity: 1 }, cadence: { type: 'season' }, timezone: 'America/Halifax', manualReview: true },
  distance: { name: 'Distance Challenge', qualifyingActivities: ['Run', 'Ride', 'Walk'], thresholds: { distanceMeters: 1000 }, scoring: { mode: 'distance', pointsPerActivity: 1 }, cadence: { type: 'weekly' }, timezone: 'America/Halifax', manualReview: true },
  streak: { name: 'Streak Challenge', qualifyingActivities: ['Run', 'Ride', 'Walk'], thresholds: { durationSeconds: 1200 }, scoring: { mode: 'streak', pointsPerActivity: 1 }, cadence: { type: 'weekly' }, timezone: 'America/Halifax', manualReview: true },
  custom: { name: 'Custom Challenge', qualifyingActivities: ['Run'], thresholds: {}, scoring: { mode: 'count', pointsPerActivity: 1 }, cadence: { type: 'weekly' }, timezone: 'America/Halifax', manualReview: false }
});
const TEMPLATE_NAMES = new Set(Object.keys(TEMPLATES));

function validTimezone(value) { try { new Intl.DateTimeFormat('en-CA', { timeZone: value }); return true; } catch { return false; } }
function normalizeParticipants(value, actorId, existing) {
  const source = value === undefined ? (existing || [{ userId: actorId, role: 'owner' }]) : value;
  if (!Array.isArray(source) || source.length < 1 || source.length > 50) fail('Participants must contain 1–50 accounts.', 'invalid_participants', 400);
  const seen = new Set(); const result = source.map(entry => {
    const uid = typeof entry === 'string' ? entry : entry && entry.userId;
    const role = typeof entry === 'object' && entry.role === 'admin' ? 'admin' : (typeof entry === 'object' && entry.role === 'owner' ? 'owner' : 'member');
    if (!userId(uid) || seen.has(uid)) fail('Participants must be unique valid account IDs.', 'invalid_participants', 400);
    seen.add(uid); return { userId: uid, role };
  });
  if (!result.some(p => p.role === 'owner')) fail('A challenge requires an owner.', 'invalid_participants', 400);
  return result;
}
function normalizeSportRules(input, base, qualifyingActivities) {
  const source = input.sportRules === undefined ? base.sportRules : input.sportRules;
  if (source === undefined) return undefined;
  if (!Array.isArray(source) || !source.length || source.length > 20) fail('Sport rules are invalid.', 'invalid_rules', 400);
  const seen = new Set();
  const rules = source.map(entry => {
    if (!plainObject(entry)) fail('Sport rules are invalid.', 'invalid_rules', 400);
    const sportType = text(entry.sportType, 40);
    if (!sportType || seen.has(sportType) || !qualifyingActivities.includes(sportType)) fail('Sport rules are invalid.', 'invalid_rules', 400);
    seen.add(sportType);
    if (!plainObject(entry.minimum) || !['none', 'time', 'distance'].includes(entry.minimum.type)) fail('Sport minimums are invalid.', 'invalid_rules', 400);
    const type = entry.minimum.type;
    if (type === 'none') return { sportType, minimum: { type: 'none', value: null } };
    const value = number(entry.minimum.value, NaN);
    if (!Number.isFinite(value) || value <= 0 || value > 100000000) fail('Sport minimums are invalid.', 'invalid_rules', 400);
    return { sportType, minimum: { type, value } };
  });
  if (rules.length !== qualifyingActivities.length) fail('Sport rules must cover every qualifying activity.', 'invalid_rules', 400);
  return rules;
}
function normalizeRules(input = {}, base = {}, actorId) {
  const activities = input.qualifyingActivities === undefined ? (base.qualifyingActivities || []) : input.qualifyingActivities;
  if (!Array.isArray(activities) || activities.length > 20 || activities.some(x => !text(x, 40))) fail('Qualifying activities are invalid.', 'invalid_rules', 400);
  const qualifyingActivities = [...new Set(activities.map(x => text(x, 40)))];
  if (!qualifyingActivities.length) fail('At least one qualifying activity is required.', 'invalid_rules', 400);
  const sportRules = normalizeSportRules(input, base, qualifyingActivities);
  const rawThresholds = input.thresholds === undefined ? (base.thresholds || {}) : input.thresholds;
  if (!rawThresholds || typeof rawThresholds !== 'object' || Array.isArray(rawThresholds)) fail('Thresholds are invalid.', 'invalid_rules', 400);
  const thresholds = {};
  for (const key of ['distanceMeters', 'durationSeconds', 'elevationMeters', 'activityCount']) if (rawThresholds[key] !== undefined) {
    const n = number(rawThresholds[key], NaN); if (!Number.isFinite(n) || n < 0 || n > 100000000) fail('Threshold values are invalid.', 'invalid_rules', 400); thresholds[key] = n;
  }
  const rawScoring = { ...(base.scoring || {}), ...(input.scoring || {}) };
  const mode = rawScoring.mode || 'count';
  if (!['count', 'distance', 'duration', 'streak'].includes(mode)) fail('Scoring mode is invalid.', 'invalid_rules', 400);
  const pointsPerActivity = number(rawScoring.pointsPerActivity, 1);
  if (pointsPerActivity < 0 || pointsPerActivity > 10000) fail('Scoring is invalid.', 'invalid_rules', 400);
  const rawCadence = { ...(base.cadence || {}), ...(input.cadence || {}) }; const cadenceType = rawCadence.type || 'weekly';
  if (!['weekly', 'monthly', 'season'].includes(cadenceType)) fail('Cadence is invalid.', 'invalid_rules', 400);
  const timezone = input.timezone === undefined ? (base.timezone || 'America/Halifax') : input.timezone;
  if (typeof timezone !== 'string' || !validTimezone(timezone)) fail('Timezone is invalid.', 'invalid_rules', 400);
  return { qualifyingActivities, sportRules, thresholds, scoring: { mode, pointsPerActivity }, cadence: { type: cadenceType }, timezone, manualReview: input.manualReview === undefined ? !!base.manualReview : !!input.manualReview, participants: normalizeParticipants(input.participants, actorId, base.participants) };
}
function evaluate(activity, rules) {
  const type = text(activity.sportType || activity.type, 40) || ''; const t = rules.thresholds || {};
  const sportRule = Array.isArray(rules.sportRules) ? rules.sportRules.find(rule => rule.sportType === type) : null;
  const sportMinimum = sportRule && sportRule.minimum;
  const meetsSportMinimum = !sportMinimum || sportMinimum.type === 'none' ||
    (sportMinimum.type === 'distance' && number(activity.distanceMeters ?? activity.distance) >= sportMinimum.value) ||
    (sportMinimum.type === 'time' && number(activity.movingTime ?? activity.durationSeconds) >= sportMinimum.value);
  const meetsLegacyMinimum = sportRule ? true :
    (t.distanceMeters === undefined || number(activity.distanceMeters ?? activity.distance) >= t.distanceMeters) &&
    (t.durationSeconds === undefined || number(activity.movingTime ?? activity.durationSeconds) >= t.durationSeconds) &&
    (t.elevationMeters === undefined || number(activity.elevationMeters) >= t.elevationMeters);
  const base = rules.qualifyingActivities.includes(type) && meetsSportMinimum && meetsLegacyMinimum;
  return activity.manualQualification === true || (activity.manualQualification !== false && base);
}
function dayKey(value, timezone) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); return `${parts.find(x => x.type === 'year').value}-${parts.find(x => x.type === 'month').value}-${parts.find(x => x.type === 'day').value}`; }
function cadenceKey(value, cadence, timezone) {
  const day = dayKey(value, timezone);
  if (cadence === 'monthly') return day.slice(0, 7);
  if (cadence === 'weekly') { const date = new Date(`${day}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return date.toISOString().slice(0, 10); }
  return 'season';
}
function scoreFor(activities, rules) {
  const qualified = activities.filter(a => evaluate(a, rules)); const mode = rules.scoring.mode;
  let value = qualified.length;
  if (mode === 'distance') value = qualified.reduce((sum, a) => sum + number(a.distanceMeters ?? a.distance), 0) / 1000;
  if (mode === 'duration') value = qualified.reduce((sum, a) => sum + number(a.movingTime ?? a.durationSeconds), 0) / 60;
  if (mode === 'streak') { const days = new Set(qualified.map(a => dayKey(a.startDate, rules.timezone))); let best = 0, current = 0, previous = null; for (const day of [...days].sort()) { const d = Date.parse(`${day}T00:00:00Z`); current = previous === d - 86400000 ? current + 1 : 1; previous = d; best = Math.max(best, current); } value = best; }
  return Number((value * rules.scoring.pointsPerActivity).toFixed(3));
}
function safeActivity(a, rules) { return { id: a.id, sportType: text(a.sportType || a.type, 40) || null, name: text(a.name, 160), startDate: a.startDate, distanceMeters: number(a.distanceMeters ?? a.distance), movingTime: number(a.movingTime ?? a.durationSeconds), qualifies: evaluate(a, rules), reviewState: a.reviewState || null }; }
function member(challenge, uid) { return challenge.participants.find(p => p.userId === uid) || null; }
function roleCanManage(challenge, uid) { const p = member(challenge, uid); return !!p && (p.role === 'owner' || p.role === 'admin'); }
// Peer review is deliberately distinct from challenge management.  A two-person
// challenge has exactly one impartial peer; larger groups require a manager who
// is not the requester so that there is an accountable escalation path.
function canDecideReview(challenge, review, uid) {
  if (!member(challenge, uid) || review.requesterId === uid) return false;
  if (challenge.participants.length === 2) return true;
  return roleCanManage(challenge, uid);
}
function requireMember(challenge, user) { if (!challenge || !member(challenge, user.id)) fail('Challenge not found.', 'not_found', 404); }
function requireManager(challenge, user) { requireMember(challenge, user); if (!roleCanManage(challenge, user.id)) fail('Challenge settings require owner or admin access.', 'forbidden', 403); }
function requireOwner(challenge, user) { requireMember(challenge, user); if (member(challenge, user.id).role !== 'owner') fail('Only the challenge owner can delete it.', 'forbidden', 403); }
function publicChallenge(challenge, includeDetail = false, currentAt = new Date()) {
  const base = { id: challenge.id, name: challenge.name, template: challenge.template, createdAt: challenge.createdAt, updatedAt: challenge.updatedAt, participants: challenge.participants.map(p => ({ userId: p.userId, role: p.role })), rules: clone(challenge.rules) };
  if (!includeDetail) return base;
  const activities = Object.values(challenge.activities || {}).filter(a => !a.deletedAt).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)) || a.id.localeCompare(b.id));
  const byUser = Object.fromEntries(challenge.participants.map(p => [p.userId, activities.filter(a => a.userId === p.userId)]));
  const period = cadenceKey(currentAt, challenge.rules.cadence.type, challenge.rules.timezone);
  const currentList = list => list.filter(a => cadenceKey(a.startDate, challenge.rules.cadence.type, challenge.rules.timezone) === period);
  const current = Object.fromEntries(Object.entries(byUser).map(([uid, list]) => [uid, scoreFor(currentList(list), challenge.rules)]));
  const season = Object.fromEntries(Object.entries(byUser).map(([uid, list]) => [uid, scoreFor(list, challenge.rules)])); const tieOrder = Object.entries(byUser).map(([uid, list]) => ({ userId: uid, score: current[uid], durationSeconds: currentList(list).filter(a => evaluate(a, challenge.rules)).reduce((n, a) => n + number(a.movingTime ?? a.durationSeconds), 0), distanceMeters: currentList(list).filter(a => evaluate(a, challenge.rules)).reduce((n, a) => n + number(a.distanceMeters ?? a.distance), 0) })).sort((a,b) => b.score - a.score || b.durationSeconds - a.durationSeconds || b.distanceMeters - a.distanceMeters || a.userId.localeCompare(b.userId));
  const history = (challenge.history || []).slice().sort((a,b) => String(b.at).localeCompare(String(a.at))).map(x => ({ at: x.at, type: x.type, score: x.score || null }));
  return { ...base, currentScore: current, seasonScore: season, activities: activities.map(a => safeActivity(a, challenge.rules)), tiebreakers: tieOrder, history, reviewState: { pendingCount: Object.values(challenge.reviews || {}).filter(r => r.status === 'pending').length } };
}

function createChallengeAccounts({ dataDir, now = () => new Date(), notificationConfigured = false, getStravaStatus = () => ({ connected: false }), initialState, stateAdapter, encryptDeviceToken, decryptDeviceToken, sendPush, deviceTokenCipher, notificationSender } = {}) {
  if (!stateAdapter && !dataDir && !initialState) fail('A challenge account data directory is required.', 'invalid_configuration', 500);
  if (stateAdapter && (!stateAdapter || typeof stateAdapter.read !== 'function' || typeof stateAdapter.mutate !== 'function')) fail('Challenge account state is unavailable.', 'invalid_configuration', 500);
  const file = dataDir && path.join(dataDir, 'state.json'); let state; let chain = Promise.resolve();
  const encryptToken = encryptDeviceToken || deviceTokenCipher?.encrypt;
  const decryptToken = decryptDeviceToken || deviceTokenCipher?.decrypt;
  const pushSender = notificationSender || sendPush;
  const defaults = () => ({ version: 1, challenges: {}, devices: {}, notificationEvents: {}, challengeCreationRequests: {} });
  function load() { if (state) return state; if (initialState) state = { ...defaults(), ...clone(initialState), version: 1 }; else if (!fs.existsSync(file)) state = defaults(); else { try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version > 1) fail('Challenge account state is unavailable.', 'state_unavailable', 500); state = { ...defaults(), ...parsed, version: 1 }; } catch (error) { if (error instanceof ChallengeAccountsError) throw error; fail('Challenge account state is unavailable.', 'state_unavailable', 500); } } return state; }
  function write() { if (!file) return; fs.mkdirSync(dataDir, { recursive: true }); const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`; fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 }); fs.renameSync(temp, file); }
  function mutate(fn) { const run = chain.then(async () => {
    if (stateAdapter) return stateAdapter.mutate(async root => { root.challengeAccounts ||= defaults(); const result = await fn(root.challengeAccounts); root.challengeAccounts.version = 1; return clone(result); });
    const result = await fn(load()); write(); return clone(result);
  }); chain = run.catch(() => {}); return run; }
  const read = fn => stateAdapter ? clone(stateAdapter.read(root => fn(root.challengeAccounts || defaults()))) : clone(fn(load()));
  function actor(user) { if (!user || !userId(user.id)) fail('Authentication is required.', 'unauthenticated', 401); return { id: user.id, username: text(user.username, 80) || user.id }; }
  function recordEvent(s, challenge, type, recipientId, data = {}) { const event = { id: id('event'), challengeId: challenge.id, type, recipientId, reviewId: data.reviewId || null, createdAt: iso(now()), delivery: 'pending' }; s.notificationEvents[event.id] = event; return event; }
  async function deliverEvents(eventIds, messageFor) {
    if (!eventIds.length) return;
    // Events are written before delivery. A missing sender is a truthful failed
    // delivery, while the event remains visible in the in-app inbox.
    if (typeof pushSender !== 'function' || typeof decryptToken !== 'function') {
      await mutate(s => { for (const eventId of eventIds) if (s.notificationEvents[eventId]) s.notificationEvents[eventId].delivery = 'failed'; }); return;
    }
    const snapshot = read(s => eventIds.map(eventId => ({ event: s.notificationEvents[eventId], devices: Object.values(s.devices).filter(d => d.userId === s.notificationEvents[eventId]?.recipientId && !d.disabledAt) })).filter(x => x.event));
    for (const { event, devices } of snapshot) {
      let sent = false;
      for (const device of devices) {
        try {
          const token = await decryptToken(device.tokenEncrypted);
          if (!token) continue;
          const result = await pushSender({ token, platform: 'ios', event: { type: event.type, challengeId: event.challengeId, reviewId: event.reviewId, ...messageFor(event) } });
          if (result && (result.invalidToken || result.reason === 'invalid_token')) await mutate(s => { const d = s.devices[`${device.userId}:${device.fingerprint}`]; if (d) d.disabledAt = iso(now()); });
          else if (!result || result.sent !== false && result.delivery !== 'failed') sent = true;
        } catch { /* provider details and tokens are intentionally never surfaced */ }
      }
      await mutate(s => { if (s.notificationEvents[event.id]) s.notificationEvents[event.id].delivery = sent ? 'sent' : 'failed'; });
    }
  }
  async function getProfile(user) { const u = actor(user); let raw; try { raw = await getStravaStatus({ id: u.id, username: u.username }); } catch { raw = { connected: false }; } const status = raw && typeof raw === 'object' ? { connected: !!raw.connected, lastSyncAt: typeof raw.lastSyncAt === 'string' ? raw.lastSyncAt : null, athlete: raw.athlete && typeof raw.athlete === 'object' ? { id: String(raw.athlete.id || ''), firstname: text(raw.athlete.firstname, 80) } : null } : { connected: false, lastSyncAt: null, athlete: null };
    return { id: u.id, username: u.username, strava: status };
  }
  function invitationForToken(s, token) {
    if (!validInvitationToken(token)) fail('Invitation not found.', 'invite_not_found', 404);
    const digest = invitationDigest(token);
    for (const challenge of Object.values(s.challenges || {})) {
      const invite = challenge.invite;
      if (invite && sameDigest(invite.tokenHash, digest)) return { challenge, invite };
    }
    fail('Invitation not found.', 'invite_not_found', 404);
  }
  function assertUsableInvitation(challenge, invite, currentTime) {
    if (invite.revokedAt) fail('Invitation has been revoked.', 'invite_revoked', 410);
    const expiry = Date.parse(invite.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= currentTime.getTime()) fail('Invitation has expired.', 'invite_expired', 410);
    if (challenge.template === 'yannick-emma-default') fail('Invitation not found.', 'invite_not_found', 404);
  }
  async function createInvite(user, challengeId) {
    const u = actor(user);
    const token = invitationToken();
    const result = await mutate(s => {
      const c = s.challenges[challengeId];
      requireManager(c, u);
      if (c.template === 'yannick-emma-default') fail('This challenge cannot be invited to.', 'invite_forbidden', 403);
      const createdAt = iso(now());
      const expiresAt = iso(new Date(Date.parse(createdAt) + INVITE_LIFETIME_MS));
      c.invite = { tokenHash: invitationDigest(token), createdAt, expiresAt, createdBy: u.id, revokedAt: null };
      c.updatedAt = createdAt;
      c.audit ||= [];
      c.audit.push({ at: createdAt, type: 'invite_created', actorId: u.id });
      return { token, expiresAt };
    });
    return result;
  }
  async function revokeInvite(user, challengeId) {
    const u = actor(user);
    return mutate(s => {
      const c = s.challenges[challengeId];
      requireManager(c, u);
      if (c.template === 'yannick-emma-default') fail('This challenge cannot be invited to.', 'invite_forbidden', 403);
      const current = c.invite;
      if (current && !current.revokedAt) {
        current.revokedAt = iso(now());
        c.updatedAt = current.revokedAt;
        c.audit ||= [];
        c.audit.push({ at: current.revokedAt, type: 'invite_revoked', actorId: u.id });
      }
      return { revoked: true };
    });
  }
  async function previewInvite(input = {}) {
    if (!plainObject(input) || Object.keys(input).length !== 1 || !own(input, 'token')) fail('Invitation token is invalid.', 'invalid_invite', 400);
    const token = input.token;
    return read(s => {
      const { challenge, invite } = invitationForToken(s, token);
      assertUsableInvitation(challenge, invite, now());
      return { challengeId: challenge.id, name: challenge.name, participantCount: challenge.participants.length, expiresAt: invite.expiresAt };
    });
  }
  async function acceptInvite(user, input = {}) {
    const u = actor(user);
    if (!plainObject(input) || Object.keys(input).length !== 1 || !own(input, 'token')) fail('Invitation token is invalid.', 'invalid_invite', 400);
    const token = input.token;
    return mutate(s => {
      const { challenge: c, invite } = invitationForToken(s, token);
      assertUsableInvitation(c, invite, now());
      const existing = member(c, u.id);
      if (existing) return { challenge: publicChallenge(c, true, now()), alreadyMember: true };
      if (c.participants.length >= 50) fail('This challenge is full.', 'invite_full', 409);
      const joinedAt = iso(now());
      c.participants.push({ userId: u.id, role: 'member' });
      c.rules.participants = clone(c.participants);
      c.updatedAt = joinedAt;
      c.audit ||= [];
      c.history ||= [];
      c.audit.push({ at: joinedAt, type: 'invite_accepted', actorId: u.id });
      c.history.push({ at: joinedAt, type: 'participant_joined', score: Object.fromEntries(c.participants.map(p => [p.userId, scoreFor(Object.values(c.activities).filter(a => a.userId === p.userId), c.rules)])) });
      return { challenge: publicChallenge(c, true, now()), alreadyMember: false };
    });
  }
  async function listChallenges(user) { const u = actor(user); return read(s => Object.values(s.challenges).filter(c => member(c, u.id)).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(c => publicChallenge(c))); }
  async function createChallenge(user, input = {}) { const u = actor(user); if (!plainObject(input)) fail('Challenge input is invalid.', 'invalid_challenge', 400); const template = input.template || 'custom'; if (!TEMPLATE_NAMES.has(template)) fail('Challenge template is invalid.', 'invalid_template', 400); const requestKey = input.idempotencyKey === undefined ? null : text(input.idempotencyKey, 128); if (input.idempotencyKey !== undefined && (!requestKey || !/^[A-Za-z0-9_-]{16,128}$/.test(requestKey))) fail('Challenge creation key is invalid.', 'invalid_challenge', 400); const preset = clone(TEMPLATES[template]); const suppliedParticipants = input.participants;
    // Templates are configuration, never an authority grant to a hard-coded account.
    // The authenticated creator is always granted owner control of their new record.
    let participants = suppliedParticipants === undefined ? [] : clone(suppliedParticipants);
    if (suppliedParticipants === undefined && template === 'yannick-emma-default' && u.id !== 'emma') participants.push({ userId: 'emma', role: 'member' });
    const creatorIndex = participants.findIndex(p => (typeof p === 'string' ? p : p && p.userId) === u.id);
    if (creatorIndex >= 0) participants[creatorIndex] = { userId: u.id, role: 'owner' };
    else participants.unshift({ userId: u.id, role: 'owner' });
    const merged = { ...preset, ...input, participants, thresholds: { ...preset.thresholds, ...(input.thresholds || {}) }, scoring: { ...preset.scoring, ...(input.scoring || {}) }, cadence: { ...preset.cadence, ...(input.cadence || {}) } };
    return mutate(s => {
      s.challengeCreationRequests ||= {};
      const requestID = requestKey && `${u.id}:${requestKey}`;
      const existingID = requestID && s.challengeCreationRequests[requestID];
      if (existingID && s.challenges[existingID]) return publicChallenge(s.challenges[existingID]);
      const rules = normalizeRules(merged, preset, u.id); const name = text(merged.name, 120); if (!name) fail('Challenge name is required.', 'invalid_challenge', 400);
      const challenge = { id: id('challenge'), name, template, createdAt: iso(now()), updatedAt: iso(now()), participants: rules.participants, rules: { qualifyingActivities: rules.qualifyingActivities, sportRules: rules.sportRules, thresholds: rules.thresholds, scoring: rules.scoring, cadence: rules.cadence, timezone: rules.timezone, manualReview: rules.manualReview }, activities: {}, reviews: {}, audit: [{ at: iso(now()), type: 'challenge_created', actorId: u.id }], history: [] };
      s.challenges[challenge.id] = challenge;
      if (requestID) s.challengeCreationRequests[requestID] = challenge.id;
      return publicChallenge(challenge);
    }); }
  async function getChallenge(user, challengeId) { const u = actor(user); return read(s => { const c = s.challenges[challengeId]; requireMember(c, u); return publicChallenge(c, true, now()); }); }
  async function ingestActivities(user, challengeId, activities) {
    const u = actor(user);
    if (!Array.isArray(activities) || activities.length > 500) fail('Activities must contain at most 500 items.', 'invalid_activities', 400);
    return mutate(s => {
      const c = s.challenges[challengeId]; requireMember(c, u);
      const participantIds = new Set(c.participants.map(p => p.userId)); const saved = [];
      for (const raw of activities) {
        if (!raw || typeof raw !== 'object') fail('Activity is invalid.', 'invalid_activities', 400);
        const activityId = text(raw.id, 128), activityUserId = raw.userId;
        const sportType = text(raw.sportType || raw.type, 40);
        const startDate = typeof raw.startDate === 'string' && Number.isFinite(Date.parse(raw.startDate)) ? new Date(raw.startDate).toISOString() : null;
        const distanceMeters = raw.distanceMeters ?? raw.distance ?? 0, movingTime = raw.movingTime ?? raw.durationSeconds ?? 0;
        if (!activityId || !userId(activityUserId) || !participantIds.has(activityUserId) || !sportType || !startDate || !Number.isFinite(Number(distanceMeters)) || Number(distanceMeters) < 0 || !Number.isFinite(Number(movingTime)) || Number(movingTime) < 0) fail('Activity is invalid.', 'invalid_activities', 400);
        const prior = c.activities[activityId];
        if (prior && prior.userId !== activityUserId) fail('Activity identity conflicts with an existing participant.', 'activity_conflict', 409);
        const activity = { id: activityId, userId: activityUserId, sportType, name: text(raw.name, 160), startDate, distanceMeters: Number(distanceMeters), movingTime: Number(movingTime) };
        if (prior && prior.userId === activityUserId) {
          if (own(prior, 'manualQualification')) activity.manualQualification = prior.manualQualification;
          if (own(prior, 'reviewState')) activity.reviewState = prior.reviewState;
        }
        c.activities[activityId] = activity; saved.push(safeActivity(activity, c.rules));
      }
      c.updatedAt = iso(now());
      return saved;
    });
  }
  async function updateSettings(user, challengeId, input = {}) { const u = actor(user); if (!plainObject(input)) fail('Challenge settings are invalid.', 'invalid_challenge', 400); return mutate(s => { const c = s.challenges[challengeId]; requireManager(c, u); const normalized = normalizeRules(input, { ...c.rules, participants: c.participants }, u.id); c.participants = normalized.participants; c.rules = { qualifyingActivities: normalized.qualifyingActivities, sportRules: normalized.sportRules, thresholds: normalized.thresholds, scoring: normalized.scoring, cadence: normalized.cadence, timezone: normalized.timezone, manualReview: normalized.manualReview }; if (input.name !== undefined) { const name = text(input.name, 120); if (!name) fail('Challenge name is invalid.', 'invalid_challenge', 400); c.name = name; } c.updatedAt = iso(now()); c.audit.push({ at: c.updatedAt, type: 'settings_updated', actorId: u.id }); c.history.push({ at: c.updatedAt, type: 'settings_updated', score: Object.fromEntries(c.participants.map(p => [p.userId, scoreFor(Object.values(c.activities).filter(a => a.userId === p.userId), c.rules)])) }); return publicChallenge(c, true, now()); }); }
  async function deleteChallenge(user, challengeId) {
    const u = actor(user);
    return mutate(s => {
      const c = s.challenges[challengeId];
      requireOwner(c, u);
      delete s.challenges[challengeId];
      for (const [eventId, event] of Object.entries(s.notificationEvents || {})) if (event.challengeId === challengeId) delete s.notificationEvents[eventId];
      for (const [requestID, savedChallengeID] of Object.entries(s.challengeCreationRequests || {})) if (savedChallengeID === challengeId) delete s.challengeCreationRequests[requestID];
      return { deleted: true };
    });
  }
  async function leaveChallenge(user, challengeId) {
    const u = actor(user);
    return mutate(s => {
      const c = s.challenges[challengeId];
      if (!c) fail('Challenge not found.', 'not_found', 404);
      const index = c.participants.findIndex(p => p.userId === u.id);
      if (index === -1) fail('You are not a member of this challenge.', 'forbidden', 403);
      if (c.participants[index].role === 'owner') fail('The challenge owner cannot leave. Delete the challenge instead.', 'owner_leave_forbidden', 403);
      c.participants.splice(index, 1);
      
      for (const [activityId, activity] of Object.entries(c.activities || {})) {
        if (activity.userId === u.id) delete c.activities[activityId];
      }
      for (const [reviewId, review] of Object.entries(c.reviews || {})) {
        if (review.requesterId === u.id) delete c.reviews[reviewId];
      }
      for (const [eventId, event] of Object.entries(s.notificationEvents || {})) {
        if (event.challengeId === challengeId && (event.recipientId === u.id || event.requesterId === u.id)) delete s.notificationEvents[eventId];
      }
      
      c.updatedAt = iso(now());
      c.audit.push({ at: c.updatedAt, type: 'participant_left', actorId: u.id });
      return { left: true };
    });
  }
  async function createReviewRequest(user, challengeId, input = {}) { const u = actor(user); if (!plainObject(input)) fail('Review input is invalid.', 'invalid_review', 400); const eventIds = []; const result = await mutate(s => { const c = s.challenges[challengeId]; requireMember(c, u); if (!c.rules.manualReview) fail('Manual review is not enabled for this challenge.', 'manual_review_disabled', 400); const activityId = text(input.activityId, 128); const a = activityId && c.activities[activityId]; if (!a || a.userId !== u.id) fail('Activity not found.', 'not_found', 404); if (evaluate(a, c.rules)) fail('Only unqualified activities can be reviewed.', 'activity_qualified', 409); const pending = Object.values(c.reviews).find(r => r.activityId === a.id && r.status === 'pending'); if (pending) fail('A review is already pending for this activity.', 'review_pending', 409); const review = { id: id('review'), activityId: a.id, requesterId: u.id, requester: { id: u.id, username: u.username }, reason: text(input.reason, 500), status: 'pending', createdAt: iso(now()), decidedAt: null, decidedBy: null, decisionReason: null }; c.reviews[review.id] = review; a.reviewState = 'pending'; c.audit.push({ at: review.createdAt, type: 'review_requested', actorId: u.id, reviewId: review.id, activityId: a.id }); for (const p of c.participants) if (canDecideReview(c, review, p.userId)) eventIds.push(recordEvent(s, c, 'review_requested', p.userId, { reviewId: review.id }).id); c.updatedAt = review.createdAt; return safeReview(review); });
    await deliverEvents(eventIds, () => ({ title: 'Challenge review requested', body: 'A challenge activity needs your review.' })); return result; }
  function safeReview(review) { return { id: review.id, activityId: review.activityId, requester: clone(review.requester), reason: review.reason, status: review.status, createdAt: review.createdAt, decidedAt: review.decidedAt, decidedBy: review.decidedBy ? { id: review.decidedBy.id, username: review.decidedBy.username } : null, decisionReason: review.decisionReason }; }
  async function listReviewRequests(user, challengeId, options = {}) { const u = actor(user); if (!plainObject(options)) fail('Review filters are invalid.', 'invalid_review', 400); return read(s => { const c = s.challenges[challengeId]; requireManager(c, u); return Object.values(c.reviews).filter(r => !options.status || r.status === options.status).sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(safeReview); }); }
  async function listReviewInbox(user) { const u = actor(user); return read(s => Object.values(s.challenges).flatMap(c => Object.values(c.reviews || {}).filter(r => r.status === 'pending' && canDecideReview(c, r, u.id)).map(r => { const a = c.activities[r.activityId] || {}; return { challenge: { id: c.id, name: c.name }, review: { id: r.id, requesterDisplayName: r.requester?.username || r.requesterId, activity: safeActivity(a, c.rules), reason: r.reason || null, createdAt: r.createdAt } }; })).sort((a, b) => String(a.review.createdAt).localeCompare(String(b.review.createdAt)))); }
  async function decideReviewRequest(user, challengeId, reviewId, input = {}) { const u = actor(user); if (!plainObject(input)) fail('Review decision is invalid.', 'invalid_decision', 400); const decision = input.decision; if (!['approve', 'reject'].includes(decision)) fail('Review decision is invalid.', 'invalid_decision', 400); const eventIds = []; const result = await mutate(s => { const c = s.challenges[challengeId]; requireMember(c, u); const review = c.reviews[reviewId]; if (!review) fail('Review request not found.', 'not_found', 404); if (review.requesterId === u.id) fail('A requester cannot decide their own review.', 'self_approval_forbidden', 403); if (!canDecideReview(c, review, u.id)) fail('You are not eligible to decide this review.', 'forbidden', 403); if (review.status !== 'pending') { if ((review.status === 'approved') === (decision === 'approve')) return { review: safeReview(review), challenge: publicChallenge(c, true, now()), idempotent: true }; fail('Review request has already been decided.', 'review_decided', 409); }
    review.status = decision === 'approve' ? 'approved' : 'rejected'; review.decidedAt = iso(now()); review.decidedBy = { id: u.id, username: u.username }; review.decisionReason = text(input.reason, 500); const activity = c.activities[review.activityId]; if (activity) { activity.manualQualification = decision === 'approve'; activity.reviewState = review.status; } const scores = Object.fromEntries(c.participants.map(p => [p.userId, scoreFor(Object.values(c.activities).filter(a => a.userId === p.userId), c.rules)])); c.history.push({ at: review.decidedAt, type: `review_${review.status}`, score: scores }); c.audit.push({ at: review.decidedAt, type: `review_${review.status}`, actorId: u.id, reviewId: review.id, activityId: review.activityId }); c.updatedAt = review.decidedAt; eventIds.push(recordEvent(s, c, `review_${review.status}`, review.requesterId, { reviewId: review.id }).id); return { review: safeReview(review), challenge: publicChallenge(c, true, now()), idempotent: false }; });
    if (!result.idempotent) await deliverEvents(eventIds, event => ({ title: event.type === 'review_approved' ? 'Challenge review approved' : 'Challenge review rejected', body: event.type === 'review_approved' ? 'Your challenge activity was approved.' : 'Your challenge activity was rejected.' })); return result; }
  async function registerDevice(user, input = {}) { const u = actor(user); if (!plainObject(input)) fail('Device input is invalid.', 'invalid_device', 400); const token = text(input.token, 512); const platform = text(input.platform, 40); if (!token || platform !== 'ios' || !/^[A-Fa-f0-9]{32,512}$/.test(token)) fail('An iOS device token is required.', 'invalid_device', 400); if (typeof encryptToken !== 'function') fail('Push device registration is unavailable.', 'push_unavailable', 503); const fingerprint = crypto.createHash('sha256').update(token).digest('hex'); let tokenEncrypted; try { tokenEncrypted = await encryptToken(token); } catch { fail('Push device registration is unavailable.', 'push_unavailable', 503); } if (typeof tokenEncrypted !== 'string' || !tokenEncrypted || tokenEncrypted === token) fail('Push device registration is unavailable.', 'push_unavailable', 503); return mutate(s => { const key = `${u.id}:${fingerprint}`, existing = s.devices[key]; s.devices[key] = { id: existing?.id || id('device'), userId: u.id, fingerprint, tokenEncrypted, platform: 'ios', disabledAt: null, createdAt: existing?.createdAt || iso(now()), updatedAt: iso(now()) }; return { id: s.devices[key].id, platform: 'ios', registered: true }; }); }
  async function listNotificationEvents(user, challengeId) { const u = actor(user); return read(s => { const c = s.challenges[challengeId]; requireMember(c, u); return Object.values(s.notificationEvents).filter(e => e.challengeId === c.id && e.recipientId === u.id).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(e => ({ id: e.id, type: e.type, reviewId: e.reviewId, createdAt: e.createdAt, delivery: e.delivery })); }); }
  return { getProfile, listChallenges, createChallenge, getChallenge, deleteChallenge, leaveChallenge, ingestActivities, updateSettings, createReviewRequest, listReviewRequests, listReviewInbox, decideReviewRequest, registerDevice, listNotificationEvents, createInvite, revokeInvite, previewInvite, acceptInvite, file, _readState: () => read(x => x), _mutate: mutate, isMember: member, canManage: roleCanManage, canDecideReview, evaluateActivity: evaluate };
}

module.exports = { createChallengeAccounts, ChallengeAccountsError, TEMPLATES };
