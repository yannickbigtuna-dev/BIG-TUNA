'use strict';

const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
class ChallengeStoreError extends Error { constructor(message) { super(message); this.name = 'ChallengeStoreError'; } }
const PARTICIPANTS = Object.freeze({ yannick: Object.freeze({ id: 'yannick', name: 'Yannick', color: 'red' }), emma: Object.freeze({ id: 'emma', name: 'Emma', color: 'blue' }) });
function cleanEmail(value) { const v = String(value || '').trim().toLowerCase(); return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v || null : null; }
function defaults(env, now) {
  const year = Number(env.STRAVA_CHALLENGE_YEAR) || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Halifax', year: 'numeric' }).format(now());
  return { version: 1, config: { challengeYear: +year, challengeStart: env.STRAVA_CHALLENGE_START_DATE || env.STRAVA_CHALLENGE_START || `${year}-01-01`, baseUrl: (env.CHALLENGE_BASE_URL || env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''), inviteTtlHours: Number.isFinite(Number(env.STRAVA_CHALLENGE_INVITE_TTL_HOURS)) ? Math.max(0, Number(env.STRAVA_CHALLENGE_INVITE_TTL_HOURS)) : 168, syncIntervalMinutes: Number(env.STRAVA_CHALLENGE_SYNC_INTERVAL_MINUTES) || 15, finalizeHour: Number(env.STRAVA_CHALLENGE_FINALIZE_HOUR) || 8 }, participants: Object.fromEntries(Object.values(PARTICIPANTS).map(p => [p.id, { ...p, email: cleanEmail(env[`STRAVA_CHALLENGE_${p.id.toUpperCase()}_EMAIL`]), connected: false, lastSyncAt: null, connection: null, initialSync: null }])), invites: {}, oauthStates: {}, activities: {}, weeks: {}, scheduler: { lastRunAt: null }, emailState: {} };
}
function mergeState(saved, base) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.version > 1) throw new ChallengeStoreError('Strava challenge state is corrupt or uses an unsupported version.');
  const merged = { ...base, ...saved, version: 1, config: { ...base.config, ...(saved.config || {}) }, participants: {} };
  for (const p of Object.values(PARTICIPANTS)) merged.participants[p.id] = { ...base.participants[p.id], ...(saved.participants && saved.participants[p.id]), ...p }; // fixed identity
  for (const key of ['invites', 'oauthStates', 'activities', 'weeks', 'scheduler', 'emailState']) if (!merged[key] || typeof merged[key] !== 'object') merged[key] = base[key];
  return merged;
}
function createStore({ dataDir, env = process.env, now = () => new Date() } = {}) {
  if (!dataDir) throw new ChallengeStoreError('A challenge data directory is required.');
  const file = path.join(dataDir, 'state.json'), backup = path.join(dataDir, 'state.last-good.json'); let state; let chain = Promise.resolve();
  function load() { if (state) return state; const base = defaults(env, now); if (!fs.existsSync(file)) { state = base; return state; } try { state = mergeState(JSON.parse(fs.readFileSync(file, 'utf8')), base); } catch (error) { throw error instanceof ChallengeStoreError ? error : new ChallengeStoreError('Strava challenge state is corrupt; refusing to overwrite it.'); } return state; }
  function write() { fs.mkdirSync(dataDir, { recursive: true }); const text = JSON.stringify(state, null, 2); if (fs.existsSync(file)) fs.copyFileSync(file, backup); const temp = path.join(dataDir, `.state-${process.pid}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.tmp`); fs.writeFileSync(temp, text, { mode: 0o600 }); fs.renameSync(temp, file); }
  async function mutate(fn) { const run = chain.then(async () => { const value = await fn(load()); write(); return value; }); chain = run.catch(() => {}); return run; }
  function read(fn = x => x) { return fn(load()); }
  return { file, read, mutate, _load: load };
}
module.exports = { createStore, ChallengeStoreError, PARTICIPANTS };
