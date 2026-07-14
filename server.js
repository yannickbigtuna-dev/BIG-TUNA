const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { fork }            = require('child_process');
const { WebSocketServer } = require('ws');

const PORT        = 3000;
const ROOT        = path.join(__dirname, 'apps');
const DATA        = path.join(__dirname, 'data');
const CLIMBS_DIR  = path.join(DATA, 'climbs');
const SETTINGS_DIR = path.join(DATA, 'settings');
const APPDATA_DIR = path.join(DATA, 'appdata');
const MEETS_DIR    = path.join(DATA, 'meets');
const CLIMBV2_DIR  = path.join(DATA, 'climb-tracker');
const QUIZZES_DIR       = path.join(DATA, 'quizzes');
const SHARED_LISTS_DIR  = path.join(DATA, 'shared-lists');
const LIGHTS_DIR        = path.join(DATA, 'lights');
const RADAR_DIR         = path.join(DATA, 'radar');
const ASSIGNMENTS_DIR   = path.join(DATA, 'assignments');
const ANALYTICS_DIR         = path.join(DATA, 'analytics');
const ANALYTICS_EVENTS_DIR  = path.join(ANALYTICS_DIR, 'events');
const EMAIL_DIR              = path.join(DATA, 'email');
const EMAIL_TEMPLATES_DIR    = path.join(EMAIL_DIR, 'templates');
const EMAIL_CAMPAIGNS_DIR    = path.join(EMAIL_DIR, 'campaigns');
const USERS_FILE    = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const PASSWORD_RESETS_FILE = path.join(DATA, 'password-resets.json');
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const ACCOUNT_EMAIL_FROM = 'no-reply@yannickmorgans.ca'; // sender for reset/test emails (Assignment Coach keeps its own ASSIGNMENTS_FROM_EMAIL)
// 1x1 transparent GIF served by the email open-tracking pixel — always returned
// regardless of signature validity so a recipient's email client never shows a
// broken image icon.
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const LIGHTS_STATE_FILE = path.join(LIGHTS_DIR, 'state.json');
const LIGHTS_DEVICE_STATUS_FILE = path.join(LIGHTS_DIR, 'device-status.json');
const LIGHTS_DEVICE_POLL_MS = 250;
const LIGHTS_DEVICE_RECENT_MS = 5000;
const LIGHTS_DEVICE_INVERT_OUTPUT = true;
// Auto-schedule: lights ON at sunset, OFF at sunrise and at 22:00 local.
const LIGHTS_LAT = 44.6488;            // Halifax, NS
const LIGHTS_LON = -63.5752;
const LIGHTS_TZ = 'America/Halifax';
const LIGHTS_OFF_HOUR = 22;            // 10 PM local
// Mirror INVERT_WEBSITE_STATE in apps/lights: a website "On" is stored as on=false.
const LIGHTS_WEBSITE_INVERT = true;
const LIGHTS_SCHEDULE_INTERVAL_MS = 30000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const ECO_AI_STATUS_TIMEOUT_MS = 4000;
const ECO_AI_CHAT_TIMEOUT_MS = 10 * 60 * 1000;
const ECO_AI_MAX_MESSAGES = 24;
const ECO_AI_MAX_MESSAGE_CHARS = 16_000;
const ECO_AI_MAX_FILE_COUNT = 6;
const ECO_AI_MAX_FILE_CHARS = 80_000;
const ECO_AI_MAX_TOTAL_FILE_CHARS = 240_000;
const ECO_AI_DEFAULT_OPTIONS = Object.freeze({
  temperature: 0.5,
  num_ctx: 8192,
});
// Trivia generator (Lumina Trivia app): uses the same local Ollama install as
// Eco AI to produce multiple-choice questions. Higher temperature + a random
// seed per request keeps banks varied; generation is bounded so a slow local
// model can't hang a request forever.
const TRIVIA_GEN_TIMEOUT_MS = 90 * 1000;
const TRIVIA_MAX_COUNT = 10;
const TRIVIA_MAX_TOPIC_LEN = 100;
// Kept small on purpose: this list is re-sent in full on every single-question
// request, so a long list directly slows down every generation in a long run.
// Server-side dedupe (validateTriviaQuestions) still catches anything the
// model repeats that fell outside this hint window.
const TRIVIA_MAX_EXCLUDE = 18;
const TRIVIA_EXCLUDE_ITEM_MAX_LEN = 140;
const YHZ_RADAR_CENTER = Object.freeze({ name: 'YHZ', lat: 44.6392425, lon: -63.5944923, radiusKm: 100 });
const YHZ_RADAR_UPSTREAM = 'https://api.adsb.lol/v2/lat/44.6392425/lon/-63.5944923/dist/55';
const YHZ_RADAR_CACHE_MS = 12000;
const YHZ_RADAR_TIMEOUT_MS = 8000;
const assignmentCoach = require('./lib/assignment-coach');
const emailCampaigns = require('./lib/email-campaigns');
const geoip = require('geoip-lite');

// ── Boot: ensure directories and files exist ──────────────────────────────────
for (const dir of [DATA, CLIMBS_DIR, SETTINGS_DIR, APPDATA_DIR, MEETS_DIR, CLIMBV2_DIR, QUIZZES_DIR, SHARED_LISTS_DIR, LIGHTS_DIR, RADAR_DIR, ASSIGNMENTS_DIR, ANALYTICS_EVENTS_DIR, EMAIL_TEMPLATES_DIR, EMAIL_CAMPAIGNS_DIR])
  fs.mkdirSync(dir, { recursive: true });

if (!fs.existsSync(USERS_FILE))    fs.writeFileSync(USERS_FILE,    '[]');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]');
if (!fs.existsSync(PASSWORD_RESETS_FILE)) fs.writeFileSync(PASSWORD_RESETS_FILE, '[]');
if (!fs.existsSync(LIGHTS_STATE_FILE)) {
  fs.writeFileSync(LIGHTS_STATE_FILE, JSON.stringify({
    on: false,
    updatedAt: new Date().toISOString(),
    updatedBy: 'device',
  }, null, 2));
}

// ── Migrate settings.json → per-user-per-app files ───────────────────────────
(function migrateSettings() {
  const oldPath = path.join(DATA, 'settings.json');
  if (!fs.existsSync(oldPath)) return;
  try {
    const all = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    if (!Array.isArray(all)) { fs.renameSync(oldPath, oldPath + '.migrated'); return; }
    let count = 0;
    for (const entry of all) {
      if (!entry.userId || !entry.appId || entry.data === undefined) continue;
      const userDir = path.join(SETTINGS_DIR, entry.userId);
      const dest    = path.join(userDir, entry.appId + '.json');
      if (fs.existsSync(dest)) continue;               // never overwrite live data
      fs.mkdirSync(userDir, { recursive: true });
      atomicWrite(dest, entry.data);
      count++;
    }
    fs.renameSync(oldPath, oldPath + '.migrated');
    if (count) console.log(`[migrate] Moved ${count} settings entries to per-file storage.`);
  } catch (err) {
    console.error('[migrate] settings.json migration failed:', err.message);
    // Leave settings.json untouched if migration fails — data is safe
  }
})();

// ── Atomic write (crash-safe) ─────────────────────────────────────────────────
function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function readLightsState() {
  try {
    const raw = JSON.parse(fs.readFileSync(LIGHTS_STATE_FILE, 'utf8'));
    return {
      on: raw.on === true,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
      updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : 'device',
    };
  } catch {
    return { on: false, updatedAt: new Date(0).toISOString(), updatedBy: 'device' };
  }
}

function writeLightsState(on, updatedBy) {
  const state = {
    on: on === true,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'device',
  };
  atomicWrite(LIGHTS_STATE_FILE, state);
  broadcastLightsState(state);
  return state;
}

function writeLightsDeviceStatus(status) {
  atomicWrite(LIGHTS_DEVICE_STATUS_FILE, status);
}

function readLightsDeviceStatus() {
  try {
    const raw = JSON.parse(fs.readFileSync(LIGHTS_DEVICE_STATUS_FILE, 'utf8'));
    return {
      on: raw.on === true,
      receivedAt: typeof raw.receivedAt === 'string' ? raw.receivedAt : '',
      polledAt: typeof raw.polledAt === 'string' ? raw.polledAt : '',
    };
  } catch {
    return { on: false, receivedAt: '', polledAt: '' };
  }
}

function markLightsDevicePolled() {
  const status = readLightsDeviceStatus();
  const now = Date.now();
  const lastPoll = Date.parse(status.polledAt) || 0;
  if (now - lastPoll < 1000) return status;

  const updated = { ...status, polledAt: new Date(now).toISOString() };
  writeLightsDeviceStatus(updated);
  return updated;
}

function getLightsDeviceStatusPayload() {
  const status = readLightsDeviceStatus();
  const lastPoll = Date.parse(status.polledAt) || 0;
  return {
    on: status.on,
    receivedAt: status.receivedAt,
    polledAt: status.polledAt,
    recentlyPolled: lastPoll > 0 && Date.now() - lastPoll <= LIGHTS_DEVICE_RECENT_MS,
    recentWindowMs: LIGHTS_DEVICE_RECENT_MS,
  };
}

// ── Lights auto-schedule (sunset → on, sunrise & 22:00 → off) ─────────────────
// SunCalc-derived sunrise/sunset (UTC). Comparing epoch ms is timezone-agnostic.
let lightsScheduleLastMs = 0;
let lightsScheduleLastMinute = -1;

function sunTimesUTC(date, lat, lng) {
  const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
  const toJulian = d => d.valueOf() / dayMs - 0.5 + J1970;
  const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
  const toDays = d => toJulian(d) - J2000;
  const e = rad * 23.4397, lw = rad * -lng, phi = rad * lat;
  const d = toDays(date);
  const M = rad * (357.5291 + 0.98560028 * d);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(e));
  const J0 = 0.0009;
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const Jnoon = J2000 + (J0 + lw / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW <= -1 || cosW >= 1) return {};   // polar day / night — no transition
  const w0 = Math.acos(cosW);
  const Jset = J2000 + (J0 + (w0 + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { sunrise: fromJulian(2 * Jnoon - Jset), sunset: fromJulian(Jset) };
}

function localMinuteOfDay(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10);
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  if (h === 24) h = 0;
  return h * 60 + m;
}

function applyScheduledLights(desiredOn, reason) {
  // A website "On" maps to stored on=false when LIGHTS_WEBSITE_INVERT is set.
  const storedOn = LIGHTS_WEBSITE_INVERT ? desiredOn !== true : desiredOn === true;
  if (readLightsState().on === storedOn) return;
  writeLightsState(storedOn, 'schedule');
  console.log(`[lights] auto ${desiredOn ? 'ON' : 'OFF'} (${reason})`);
}

function tickLightsSchedule() {
  const now = Date.now();
  const minute = localMinuteOfDay(now, LIGHTS_TZ);
  // First tick after start: seed only, never fire retroactively (respects manual state).
  if (lightsScheduleLastMs === 0) {
    lightsScheduleLastMs = now;
    lightsScheduleLastMinute = minute;
    return;
  }
  const { sunrise, sunset } = sunTimesUTC(new Date(now), LIGHTS_LAT, LIGHTS_LON);
  const crossed = t => t && lightsScheduleLastMs < t.getTime() && t.getTime() <= now;

  if (crossed(sunset))  applyScheduledLights(true, 'sunset');
  if (crossed(sunrise)) applyScheduledLights(false, 'sunrise');
  const off = LIGHTS_OFF_HOUR * 60;
  if (lightsScheduleLastMinute < off && minute >= off) applyScheduledLights(false, '22:00');

  lightsScheduleLastMs = now;
  lightsScheduleLastMinute = minute;
}

function startLightsScheduler() {
  tickLightsSchedule();
  setInterval(tickLightsSchedule, LIGHTS_SCHEDULE_INTERVAL_MS);
}

// ── Input validation ──────────────────────────────────────────────────────────
// appId comes from URL — validate before using as a filename component
function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Users ─────────────────────────────────────────────────────────────────────
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function writeUsers(users) { atomicWrite(USERS_FILE, users); }

// ── Sessions ──────────────────────────────────────────────────────────────────
function readSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); }
  catch { return []; }
}
function writeSessions(sessions) {
  // Prune expired sessions every time we write — file never grows unboundedly
  const now = Date.now();
  atomicWrite(SESSIONS_FILE, sessions.filter(s => new Date(s.expiresAt).getTime() > now));
}

function getSessionUser(token) {
  if (!token) return null;
  const sessions = readSessions();
  const session  = sessions.find(s => s.token === token && new Date(s.expiresAt) > new Date());
  if (!session) return null;
  return readUsers().find(u => u.id === session.userId) || null;
}

// ── Password resets ──────────────────────────────────────────────────────────
function readPasswordResets() {
  try { return JSON.parse(fs.readFileSync(PASSWORD_RESETS_FILE, 'utf8')); }
  catch { return []; }
}
function writePasswordResets(resets) {
  const now = Date.now();
  atomicWrite(PASSWORD_RESETS_FILE, resets.filter(r => new Date(r.expiresAt).getTime() > now));
}

// ── Settings (per-user, per-app files) ───────────────────────────────────────
function settingsFilePath(userId, appId) {
  return path.join(SETTINGS_DIR, userId, appId + '.json');
}
function readSettings(userId, appId) {
  try { return JSON.parse(fs.readFileSync(settingsFilePath(userId, appId), 'utf8')); }
  catch { return null; }
}
function writeSettings(userId, appId, data) {
  const userDir = path.join(SETTINGS_DIR, userId);
  fs.mkdirSync(userDir, { recursive: true });
  atomicWrite(settingsFilePath(userId, appId), data);
}

// ── Climbs: per-user folder, one file per climb/session ──────────────────────
//
// Layout:
//   data/climbs/{userId}/c_{id}.json   — individual climb
//   data/climbs/{userId}/s_{id}.json   — individual session
//
// Internal fields (stripped before returning to client):
//   _savedAt   — epoch ms of last write (for lastModified computation)
//   _deleted   — true when soft-deleted
//   _deletedAt — epoch ms of soft-delete
//
// Nothing is ever hard-deleted from disk. Soft-deletes are permanent
// markers; a subsequent upsert of the same ID is ignored.

function userClimbsDir(userId)   { return path.join(CLIMBS_DIR, userId); }
function climbFile(userId, id)   { return path.join(userClimbsDir(userId), 'c_' + id + '.json'); }
function sessionFile(userId, id) { return path.join(userClimbsDir(userId), 's_' + id + '.json'); }

function ensureUserClimbsDir(userId) {
  fs.mkdirSync(userClimbsDir(userId), { recursive: true });
}

// One-time migration from legacy single-file format
function migrateClimbsIfNeeded(userId) {
  const legacyPath = path.join(CLIMBS_DIR, userId + '.json');
  if (!fs.existsSync(legacyPath)) return;
  try {
    const d  = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    const ts = typeof d.lastModified === 'number' ? d.lastModified : Date.now();
    ensureUserClimbsDir(userId);
    for (const c of (Array.isArray(d.climbs)   ? d.climbs   : [])) {
      if (!c?.id) continue;
      const fp = climbFile(userId, c.id);
      if (!fs.existsSync(fp)) atomicWrite(fp, { ...c, _savedAt: ts });
    }
    for (const s of (Array.isArray(d.sessions) ? d.sessions : [])) {
      if (!s?.id) continue;
      const fp = sessionFile(userId, s.id);
      if (!fs.existsSync(fp)) atomicWrite(fp, { ...s, _savedAt: ts });
    }
    fs.renameSync(legacyPath, legacyPath + '.migrated');
    console.log(`[migrate] climbs for ${userId} → per-item files`);
  } catch (err) {
    console.error(`[migrate] climbs migration failed for ${userId}:`, err.message);
  }
}

// Read all non-deleted climbs and sessions for a user
function readAllClimbData(userId) {
  migrateClimbsIfNeeded(userId);
  ensureUserClimbsDir(userId);
  const climbs = [], sessions = [];
  let lastModified = 0;
  for (const fname of fs.readdirSync(userClimbsDir(userId))) {
    if (!fname.endsWith('.json')) continue;
    try {
      const raw  = JSON.parse(fs.readFileSync(path.join(userClimbsDir(userId), fname), 'utf8'));
      if (raw._deleted) continue;
      const { _savedAt, _deleted, _deletedAt, ...item } = raw;
      if ((_savedAt || 0) > lastModified) lastModified = _savedAt || 0;
      if      (fname.startsWith('c_')) climbs.push(item);
      else if (fname.startsWith('s_')) sessions.push(item);
    } catch {}
  }
  return { climbs, sessions, lastModified };
}

// Upsert a climb file — ignored if the item was already soft-deleted
function writeClimbFile(userId, climb) {
  if (!climb?.id) return;
  const fp = climbFile(userId, climb.id);
  if (fs.existsSync(fp)) {
    try { if (JSON.parse(fs.readFileSync(fp, 'utf8'))._deleted) return; } catch {}
  }
  atomicWrite(fp, { ...climb, _savedAt: Date.now() });
}

// Upsert a session file — ignored if the session was already soft-deleted
function writeSessionFile(userId, session) {
  if (!session?.id) return;
  const fp = sessionFile(userId, session.id);
  if (fs.existsSync(fp)) {
    try { if (JSON.parse(fs.readFileSync(fp, 'utf8'))._deleted) return; } catch {}
  }
  atomicWrite(fp, { ...session, _savedAt: Date.now() });
}

// Soft-delete: mark the file as deleted without removing it from disk
function softDeleteClimb(userId, id) {
  if (!id) return;
  const fp = climbFile(userId, id);
  if (!fs.existsSync(fp)) {
    // Item never written yet — write a tombstone so future upserts are blocked
    atomicWrite(fp, { id, _deleted: true, _deletedAt: Date.now(), _savedAt: Date.now() });
    return;
  }
  try {
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!d._deleted) atomicWrite(fp, { ...d, _deleted: true, _deletedAt: Date.now() });
  } catch {}
}

function softDeleteSession(userId, id) {
  if (!id) return;
  const fp = sessionFile(userId, id);
  if (!fs.existsSync(fp)) {
    atomicWrite(fp, { id, _deleted: true, _deletedAt: Date.now(), _savedAt: Date.now() });
    return;
  }
  try {
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!d._deleted) atomicWrite(fp, { ...d, _deleted: true, _deletedAt: Date.now() });
  } catch {}
}

// ── Generic app data (per-app, per-user files) ────────────────────────────────
function appDataFilePath(appId, userId) {
  return path.join(APPDATA_DIR, appId, userId + '.json');
}
function readAppData(appId, userId) {
  try { return JSON.parse(fs.readFileSync(appDataFilePath(appId, userId), 'utf8')); }
  catch { return null; }
}
function writeAppData(appId, userId, data) {
  fs.mkdirSync(path.join(APPDATA_DIR, appId), { recursive: true });
  atomicWrite(appDataFilePath(appId, userId), data);
}

// ── Shared lists ──────────────────────────────────────────────────────────────
function sharedListFile(id) { return path.join(SHARED_LISTS_DIR, id + '.json'); }
function readSharedList(id) {
  try { return JSON.parse(fs.readFileSync(sharedListFile(id), 'utf8')); }
  catch { return null; }
}
function writeSharedList(id, listData) {
  atomicWrite(sharedListFile(id), listData);
}

// SSE client registry: listId -> Set of { res, userId }
const sseClients  = new Map();
const lightsSseClients = new Set();
const termSessions = new Map(); // sessionId -> { ws, shell, userId }

function broadcastSharedList(listId, list) {
  const clients = sseClients.get(listId);
  if (!clients || !clients.size) return;
  const msg = `data: ${JSON.stringify(list)}\n\n`;
  for (const client of [...clients]) {
    try { client.res.write(msg); } catch {}
  }
}

function sendLightsSse(res, state) {
  const { on, updatedAt } = state;
  res.write(`data: ${JSON.stringify({ on, updatedAt })}\n\n`);
}

function broadcastLightsState(state) {
  if (!lightsSseClients.size) return;
  for (const client of [...lightsSseClients]) {
    try { sendLightsSse(client.res, state); } catch {}
  }
}

// ── Meets (per-user file, psych-sheet app) ────────────────────────────────────
const MAX_MEETS      = 20;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;  // 2 MB raw text per meet
const VALID_PRESETS  = ['swim-nsw', 'aus', 'usport', 'custom'];

function meetsFilePath(userId) { return path.join(MEETS_DIR, userId + '.json'); }
function readMeets(userId) {
  try { return JSON.parse(fs.readFileSync(meetsFilePath(userId), 'utf8')); }
  catch { return []; }
}
function writeMeets(userId, data) { atomicWrite(meetsFilePath(userId), data); }

// ── Quizzes (per-user folder, one file per quiz) ──────────────────────────────
// Layout: data/quizzes/{userId}/{quizId}.json

const MAX_QUIZZES   = 50;
const MAX_QUESTIONS = 200;

function quizzesDir(userId)        { return path.join(QUIZZES_DIR, userId); }
function quizFile(userId, quizId)  { return path.join(quizzesDir(userId), quizId + '.json'); }

function ensureQuizzesDir(userId) {
  fs.mkdirSync(quizzesDir(userId), { recursive: true });
}

function readAllQuizzes(userId) {
  ensureQuizzesDir(userId);
  const quizzes = [];
  try {
    for (const f of fs.readdirSync(quizzesDir(userId))) {
      if (!f.endsWith('.json')) continue;
      try {
        const q = JSON.parse(fs.readFileSync(path.join(quizzesDir(userId), f), 'utf8'));
        if (q.id) quizzes.push(q);
      } catch {}
    }
  } catch {}
  return quizzes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function sanitizeQuiz(raw) {
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim().slice(0, 100) : 'Untitled Quiz';
  const questions = Array.isArray(raw.questions)
    ? raw.questions.slice(0, MAX_QUESTIONS).map(q => ({
        id:       (typeof q.id === 'string' && isValidId(q.id)) ? q.id : crypto.randomUUID(),
        question: typeof q.question === 'string' ? q.question.slice(0, 1000) : '',
        answer:   typeof q.answer   === 'string' ? q.answer.slice(0, 1000)   : '',
      }))
    : [];
  return { title, questions };
}

// ── Request helpers ───────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 20_000_000) body = ''; });
    req.on('end',  () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function jsonRes(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function radarJsonRes(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(JSON.stringify(data));
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

// ── Analytics: IP / geo / device resolution ──────────────────────────────────
// No raw IP is ever logged or persisted — resolved geo (country/region/city)
// is computed at ingest time and the IP itself is discarded immediately after.
function resolveClientIp(req) {
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';
}

function resolveGeo(ip) {
  try {
    const geo = ip ? geoip.lookup(ip) : null;
    if (!geo) return { country: null, region: null, city: null };
    return {
      country: geo.country || null,
      region: geo.region || null,
      city: geo.city || null,
    };
  } catch {
    return { country: null, region: null, city: null };
  }
}

function resolveDevice(userAgent) {
  const ua = String(userAgent || '');
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  if (/mobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

// ── Analytics: naive in-memory per-IP rate limit for the public beacon ──────
// Fixed 60s windows per IP, capped at ~60 events/minute. The map is bounded by
// periodically sweeping expired windows so it can't grow unboundedly under a
// flood of distinct IPs.
const ANALYTICS_RATE_LIMIT_MAX_PER_MIN = 60;
const ANALYTICS_RATE_LIMIT_WINDOW_MS   = 60_000;
const ANALYTICS_RATE_LIMIT_MAP_CAP     = 5000;
const analyticsRateLimitMap = new Map(); // ip -> { count, windowStart }

function analyticsRateLimitAllows(ip) {
  const now = Date.now();
  let entry = analyticsRateLimitMap.get(ip);
  if (!entry || now - entry.windowStart >= ANALYTICS_RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    analyticsRateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (analyticsRateLimitMap.size > ANALYTICS_RATE_LIMIT_MAP_CAP) {
    for (const [k, v] of analyticsRateLimitMap) {
      if (now - v.windowStart >= ANALYTICS_RATE_LIMIT_WINDOW_MS) analyticsRateLimitMap.delete(k);
    }
  }
  return entry.count <= ANALYTICS_RATE_LIMIT_MAX_PER_MIN;
}

// ── Analytics: event log helpers (append-only NDJSON, one file per day) ────
function analyticsEventFile(dateStr) {
  return path.join(ANALYTICS_EVENTS_DIR, dateStr + '.ndjson');
}

function analyticsDateRange(days) {
  const dates = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    dates.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

// Reads and parses all events within the last `days` days. Corrupt/partial
// lines are skipped rather than aborting the whole read.
function readAnalyticsEvents(days) {
  const events = [];
  for (const dateStr of analyticsDateRange(days)) {
    const file = analyticsEventFile(dateStr);
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
    }
  }
  return events;
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

const ECO_AI_SKILLS = Object.freeze({
  general: 'You are Eco AI, a local-first assistant running on BIG TUNA through Ollama. Be direct, accurate, and honest about uncertainty.',
  coding: 'You are Eco AI in coding mode. Prioritize correct code, concrete debugging, minimal diffs, and explicit tradeoffs.',
  writing: 'You are Eco AI in writing mode. Improve clarity, tone, and structure while preserving the user intent.',
  study: 'You are Eco AI in study mode. Teach clearly, break concepts into steps, and prefer guidance over giving away answers.',
  summarize: 'You are Eco AI in summarize mode. Extract the essential points, structure them cleanly, and avoid filler.',
  'file-analyst': 'You are Eco AI in file analyst mode. Read the provided file context carefully, cite which file section you are using, and identify ambiguities explicitly.',
});

function withTimeout(ms, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), ms);

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function ecoAiFriendlyError(error) {
  if (!error) return 'Unknown Ollama error';
  if (error.name === 'AbortError') return 'Request aborted';
  if (typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}

async function ollamaFetchJson(pathname, body, opts = {}) {
  const upstream = new URL(pathname, OLLAMA_BASE_URL);
  const timeout = withTimeout(opts.timeoutMs || ECO_AI_STATUS_TIMEOUT_MS, opts.signal);
  try {
    const response = await fetch(upstream, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: timeout.signal,
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    return { ok: response.ok, status: response.status, data, text };
  } finally {
    timeout.clear();
  }
}

function summarizeOllamaModels(payload) {
  const rawModels = Array.isArray(payload?.models) ? payload.models : [];
  return rawModels
    .map(model => ({
      name: typeof model?.name === 'string' ? model.name : '',
      size: Number.isFinite(model?.size) ? model.size : 0,
      modifiedAt: typeof model?.modified_at === 'string' ? model.modified_at : '',
      digest: typeof model?.digest === 'string' ? model.digest : '',
      family: typeof model?.details?.family === 'string' ? model.details.family : '',
      parameterSize: typeof model?.details?.parameter_size === 'string' ? model.details.parameter_size : '',
      quantizationLevel: typeof model?.details?.quantization_level === 'string' ? model.details.quantization_level : '',
    }))
    .filter(model => model.name);
}

function pickEcoAiRecommendedModel(models) {
  if (!Array.isArray(models) || !models.length) return null;
  const preferences = [
    /qwen.*coder.*(7b|8b)/i,
    /qwen.*(7b|8b)/i,
    /llama.*(7b|8b)/i,
    /gemma.*(7b|8b|9b)/i,
    /phi.*(3|4)/i,
  ];

  for (const pattern of preferences) {
    const match = models.find(model => pattern.test(model.name));
    if (match) return match.name;
  }
  return models[0].name;
}

async function getEcoAiStatus(signal) {
  try {
    const result = await ollamaFetchJson('/api/tags', null, {
      timeoutMs: ECO_AI_STATUS_TIMEOUT_MS,
      signal,
    });
    const models = summarizeOllamaModels(result.data);
    return {
      ok: result.ok,
      available: result.ok,
      status: result.status,
      models,
      recommendedModel: pickEcoAiRecommendedModel(models),
      setupMessage: result.ok
        ? (models.length ? '' : 'Ollama is running but no models are installed yet.')
        : (result.data?.error || result.text || 'Ollama returned an error.'),
    };
  } catch (error) {
    return {
      ok: false,
      available: false,
      status: 0,
      models: [],
      recommendedModel: null,
      setupMessage: `Ollama is not reachable at ${OLLAMA_BASE_URL}. Start Ollama on the website machine and install a local model.`,
      error: ecoAiFriendlyError(error),
    };
  }
}

function sanitizeEcoAiFiles(files) {
  if (!Array.isArray(files)) return [];
  const cleaned = [];
  let totalChars = 0;

  for (const file of files.slice(0, ECO_AI_MAX_FILE_COUNT)) {
    const name = typeof file?.name === 'string' ? file.name.trim().slice(0, 200) : '';
    const type = typeof file?.type === 'string' ? file.type.trim().slice(0, 120) : '';
    const text = typeof file?.text === 'string' ? file.text : '';
    if (!name || !text) continue;

    const clipped = text.slice(0, ECO_AI_MAX_FILE_CHARS);
    totalChars += clipped.length;
    if (totalChars > ECO_AI_MAX_TOTAL_FILE_CHARS) break;

    cleaned.push({
      name,
      type,
      text: clipped,
    });
  }

  return cleaned;
}

function sanitizeEcoAiMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-ECO_AI_MAX_MESSAGES)
    .map(message => {
      const role = message?.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof message?.content === 'string'
        ? message.content.slice(0, ECO_AI_MAX_MESSAGE_CHARS)
        : '';
      const attachments = sanitizeEcoAiFiles(message?.attachments);
      return { role, content, attachments };
    })
    .filter(message => message.content || message.attachments.length);
}

function ecoAiFilesToPrompt(files) {
  if (!files.length) return '';
  return '\n\nAttached file context:\n' + files.map(file => [
    `--- FILE: ${file.name}${file.type ? ` (${file.type})` : ''} ---`,
    file.text,
    `--- END FILE: ${file.name} ---`,
  ].join('\n')).join('\n\n');
}

function buildEcoAiOllamaMessages(messages, skillId) {
  const skillPrompt = ECO_AI_SKILLS[skillId] || ECO_AI_SKILLS.general;
  const systemPrompt = [
    skillPrompt,
    'You run locally through Ollama. Never claim to have used a cloud model or external tools unless the user explicitly provided that output.',
    'If attached files are present, use them as first-class context and say when the answer depends on them.',
  ].join(' ');

  const out = [{ role: 'system', content: systemPrompt }];
  for (const message of messages) {
    out.push({
      role: message.role,
      content: message.content + ecoAiFilesToPrompt(message.attachments),
    });
  }
  return out;
}

// ── Trivia question generation (Lumina Trivia) ────────────────────────────────

// Build the chat messages sent to Ollama. `topic` may be empty (=> random,
// varied general-knowledge questions) or any user-supplied subject. The prompt
// is engineered so the model MUST return strict JSON we can parse and validate.
function buildTriviaMessages(topic, count, difficulty, exclude) {
  const subject = topic
    ? `about the topic: "${topic}"`
    : 'spanning a wide, random mix of general-knowledge categories (history, science, geography, sport, music, film, art, literature, technology, nature, food, and pop culture)';

  const DIFF = {
    easy:   'Make EVERY question EASY: well-known, commonly-taught facts that most casual players would recognise.',
    medium: 'Make EVERY question MEDIUM difficulty: moderately challenging, requiring some specific knowledge beyond the obvious.',
    hard:   'Make EVERY question HARD: obscure, expert-level, or highly specific facts that are genuinely difficult, with tempting near-miss wrong answers.',
  };
  const difficultyClause = DIFF[difficulty]
    ? `${DIFF[difficulty]} Set each question's "difficulty" field to "${difficulty}".`
    : 'Use a natural mix of easy, medium, and hard questions.';

  const system = [
    'You are a trivia question generator for a fast-paced quiz game.',
    'You output ONLY a single JSON object. No prose, no markdown, no code fences.',
    'The JSON must match exactly: {"questions":[{"question":string,"answers":[string,string,string,string],"correct":number,"category":string,"difficulty":string,"explanation":string}]}.',
    'Rules for every question:',
    '- "answers" MUST contain EXACTLY four distinct options.',
    '- Exactly ONE answer is correct; "correct" is its 0-based index (0,1,2,3).',
    '- The three wrong answers must be plausible but clearly incorrect.',
    '- "question" is a single self-contained sentence ending in a question mark.',
    '- "explanation" is ONE short sentence (max ~160 chars) that explains why the correct answer is right and gives a memorable hook or fact to help the player remember it.',
    '- "difficulty" is one of "easy","medium","hard". "category" is a short label.',
    '- NEVER repeat, reuse, or paraphrase a question the player has already been asked. Every question must be brand new and distinct. Vary the position of the correct answer.',
    '- Keep every string concise and factually accurate.',
  ].join('\n');

  // The client remembers every question already served this session and passes
  // them here so the model can avoid duplicates (it is otherwise stateless).
  const avoid = Array.isArray(exclude) ? exclude.filter(s => typeof s === 'string' && s.trim()) : [];
  const avoidClause = avoid.length
    ? ` Do NOT repeat or rephrase any of these ${avoid.length} already-asked questions:\n${avoid.map(q => '- ' + q).join('\n')}\nGenerate completely different question(s).`
    : '';

  const user = `Generate ${count} multiple-choice trivia question${count === 1 ? '' : 's'} ${subject}. ${difficultyClause}${avoidClause} Return the JSON object now.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pull a questions array out of whatever shape the model returned (object with
// `.questions`, a bare array, or an object of numbered keys).
function extractTriviaArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed);
    if (values.length && values.every(v => v && typeof v === 'object' && 'question' in v)) {
      return values;
    }
  }
  return [];
}

// Validate + normalise raw model output into safe trivia records. Any malformed
// item is dropped rather than aborting the batch. Answers are shuffled so the
// correct option's position is randomised regardless of what the model chose.
function normalizeQuestionText(q) {
  return String(q || '').toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '').trim();
}

function validateTriviaQuestions(rawList, limit, excludeSet) {
  const out = [];
  // Seed the dedupe set with the questions the player has already seen so any
  // duplicate the model slips through is dropped server-side too.
  const seen = new Set(excludeSet instanceof Set ? excludeSet : []);
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    if (out.length >= limit) break;
    if (!raw || typeof raw !== 'object') continue;

    const question = typeof raw.question === 'string' ? raw.question.trim().slice(0, 500) : '';
    if (!question) continue;

    const answersRaw = Array.isArray(raw.answers) ? raw.answers
      : Array.isArray(raw.options) ? raw.options : [];
    const answers = answersRaw
      .map(a => (typeof a === 'string' ? a.trim().slice(0, 240) : (a == null ? '' : String(a).trim().slice(0, 240))))
      .filter(a => a.length > 0);
    if (answers.length !== 4) continue;
    if (new Set(answers.map(a => a.toLowerCase())).size !== 4) continue; // must be distinct

    let correct = Number(raw.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
      // Some models return the correct answer text instead of an index.
      const byText = answers.findIndex(a => a.toLowerCase() === String(raw.answer || raw.correctAnswer || '').trim().toLowerCase());
      if (byText < 0) continue;
      correct = byText;
    }

    const dedupeKey = normalizeQuestionText(question);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Shuffle answer order and track where the correct one lands.
    const correctText = answers[correct];
    shuffleInPlace(answers);
    const newCorrect = answers.indexOf(correctText);

    const difficulty = ['easy', 'medium', 'hard'].includes(String(raw.difficulty || '').toLowerCase())
      ? String(raw.difficulty).toLowerCase() : 'medium';
    const category = typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim().slice(0, 40) : 'General';
    const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim().slice(0, 300)
      : (typeof raw.explain === 'string' ? raw.explain.trim().slice(0, 300) : '');

    out.push({
      id: crypto.randomUUID(),
      question,
      answers,
      correct: newCorrect,
      category,
      difficulty,
      explanation,
    });
  }
  return out;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Public YHZ radar feed for small ESP8266 clients.
let yhzRadarCache = null;

function httpsGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BIG-TUNA-YHZ-Radar/1.0',
      },
    }, r => {
      let buf = '';
      r.on('data', c => {
        buf += c;
        if (buf.length > 2_000_000) {
          req.destroy(new Error('Response too large'));
        }
      });
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          reject(new Error(`HTTP ${r.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(buf)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
  });
}

function getHalifaxParts(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Halifax',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).reduce((out, part) => {
    out[part.type] = part.value;
    return out;
  }, {});

  const timeParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Halifax',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now).reduce((out, part) => {
    out[part.type] = part.value;
    return out;
  }, {});

  return {
    dateKey: `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
    time: `${timeParts.hour === '24' ? '00' : timeParts.hour}:${timeParts.minute}`,
  };
}

function degreesToRadians(deg) {
  return deg * Math.PI / 180;
}

function normalizeDegrees(deg) {
  return ((deg % 360) + 360) % 360;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const earthKm = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2))
    * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = degreesToRadians(lat1);
  const p2 = degreesToRadians(lat2);
  const dLon = degreesToRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return Math.round(normalizeDegrees(Math.atan2(y, x) * 180 / Math.PI));
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function integerOrZero(value) {
  return Math.round(numberOrZero(value));
}

function destinationFromAircraft(ac) {
  for (const key of ['destination', 'dest', 'to', 'airport_destination', 'airportDest']) {
    if (typeof ac[key] === 'string' && ac[key].trim()) return ac[key].trim().slice(0, 8);
  }
  return 'UNK';
}

function readYhzRadarIds(dateKey) {
  const file = path.join(RADAR_DIR, `yhz-${dateKey}.json`);
  try {
    const ids = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(ids) ? new Set(ids.filter(id => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeYhzRadarIds(dateKey, ids) {
  atomicWrite(path.join(RADAR_DIR, `yhz-${dateKey}.json`), Array.from(ids).sort());
}

function emptyYhzRadarPayload(status, now = new Date()) {
  const halifax = getHalifaxParts(now);
  return {
    schema: 'halifax-radar-v1',
    api: 'ADSB',
    status,
    message: 'api not working',
    serverTime: halifax.time,
    planesTracked: 0,
    planesToday: 0,
    closest: { callsign: 'UNK', speedKmh: 0, altitudeFt: 0, destination: 'UNK' },
    fastest: { callsign: 'UNK', speedKmh: 0 },
    highest: { callsign: 'UNK', altitudeFt: 0 },
    aircraft: [],
  };
}

function withRadarStatusAndTime(payload, status) {
  return {
    ...payload,
    status,
    message: status === 'online' ? 'data ok' : 'api not working',
    serverTime: getHalifaxParts().time,
  };
}

function normalizeYhzRadarPayload(upstream, now = new Date()) {
  const aircraft = Array.isArray(upstream && upstream.ac) ? upstream.ac : [];
  const normalized = [];

  for (const ac of aircraft) {
    const lat = Number(ac.lat);
    const lon = Number(ac.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const rangeKm = Math.round(distanceKm(YHZ_RADAR_CENTER.lat, YHZ_RADAR_CENTER.lon, lat, lon));
    if (rangeKm > YHZ_RADAR_CENTER.radiusKm) continue;

    const id = (typeof ac.hex === 'string' && ac.hex.trim())
      ? ac.hex.trim().toLowerCase()
      : (typeof ac.r === 'string' && ac.r.trim() ? ac.r.trim() : 'UNK');
    const rawCallsign = typeof ac.flight === 'string' && ac.flight.trim()
      ? ac.flight.trim()
      : id;

    normalized.push({
      id,
      callsign: rawCallsign || 'UNK',
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      bearingDeg: bearingDeg(YHZ_RADAR_CENTER.lat, YHZ_RADAR_CENTER.lon, lat, lon),
      rangeKm,
      speedKmh: Math.round(numberOrZero(ac.gs) * 1.852),
      altitudeFt: integerOrZero(ac.alt_baro),
      trackDeg: Math.round(normalizeDegrees(numberOrZero(ac.track))),
      destination: destinationFromAircraft(ac),
      seenSec: integerOrZero(ac.seen),
    });
  }

  normalized.sort((a, b) => a.rangeKm - b.rangeKm);

  const halifax = getHalifaxParts(now);
  const todayIds = readYhzRadarIds(halifax.dateKey);
  for (const ac of normalized) if (ac.id && ac.id !== 'UNK') todayIds.add(ac.id);
  writeYhzRadarIds(halifax.dateKey, todayIds);

  const closest = normalized[0]
    ? {
        callsign: normalized[0].callsign,
        speedKmh: normalized[0].speedKmh,
        altitudeFt: normalized[0].altitudeFt,
        destination: normalized[0].destination,
      }
    : { callsign: 'UNK', speedKmh: 0, altitudeFt: 0, destination: 'UNK' };
  const fastest = normalized.reduce((best, ac) => ac.speedKmh > best.speedKmh ? ac : best, { callsign: 'UNK', speedKmh: 0 });
  const highest = normalized.reduce((best, ac) => ac.altitudeFt > best.altitudeFt ? ac : best, { callsign: 'UNK', altitudeFt: 0 });

  return {
    schema: 'halifax-radar-v1',
    api: 'ADSB',
    status: 'online',
    message: 'data ok',
    serverTime: halifax.time,
    planesTracked: normalized.length,
    planesToday: todayIds.size,
    closest,
    fastest: { callsign: fastest.callsign, speedKmh: fastest.speedKmh },
    highest: { callsign: highest.callsign, altitudeFt: highest.altitudeFt },
    aircraft: normalized.slice(0, 8).map(ac => ({
      id: ac.id,
      callsign: ac.callsign,
      bearingDeg: ac.bearingDeg,
      rangeKm: ac.rangeKm,
      speedKmh: ac.speedKmh,
      altitudeFt: ac.altitudeFt,
      destination: ac.destination,
    })),
  };
}

async function getYhzRadarPayload() {
  const now = Date.now();
  if (yhzRadarCache && now - yhzRadarCache.fetchedAt <= YHZ_RADAR_CACHE_MS) {
    return withRadarStatusAndTime(yhzRadarCache.payload, 'online');
  }

  try {
    const upstream = await httpsGetJson(YHZ_RADAR_UPSTREAM, YHZ_RADAR_TIMEOUT_MS);
    const payload = normalizeYhzRadarPayload(upstream, new Date());
    yhzRadarCache = { fetchedAt: Date.now(), payload };
    return withRadarStatusAndTime(payload, 'online');
  } catch (err) {
    return emptyYhzRadarPayload('error');
  }
}

// ── Climb Tracker v2 — file-based storage ─────────────────────────────────────
// Layout:
//   data/climb-tracker/{userId}/climbs/{id}.txt   — one text file per climb
//   data/climb-tracker/{userId}/sessions.txt      — JSON array of session metadata
//   data/climb-tracker/{userId}/photos/{id}.jpg   — photo files (decoded from base64)

function cv2ClimbsDir(u)  { return path.join(CLIMBV2_DIR, u, 'climbs'); }
function cv2PhotosDir(u)  { return path.join(CLIMBV2_DIR, u, 'photos'); }
function cv2SessFile(u)   { return path.join(CLIMBV2_DIR, u, 'sessions.txt'); }
function cv2ClimbFile(u, id) { return path.join(cv2ClimbsDir(u), id + '.txt'); }
function cv2PhotoFile(u, id) { return path.join(cv2PhotosDir(u), id + '.jpg'); }

function cv2EnsureDirs(u) {
  fs.mkdirSync(cv2ClimbsDir(u), { recursive: true });
  fs.mkdirSync(cv2PhotosDir(u), { recursive: true });
}

// Serialize a climb object to a key=value text file
function cv2Serialize(c) {
  return [
    'id='         + (c.id         || ''),
    'date='       + (c.date       || new Date().toISOString()),
    'grade='      + (c.grade      || ''),
    'holdsColor=' + (c.holdsColor || ''),
    'status='     + (c.status     || 'complete'),
    'tries='      + (Number(c.tries)  || 1),
    'rating='     + (Number(c.rating) || 0),
    'flash='      + (c.flash      ? 'true' : 'false'),
    'styles='     + (Array.isArray(c.styles) ? c.styles.join(',') : ''),
    'notes='      + String(c.notes || '').replace(/\r?\n/g, '\\n'),
    'sessionId='  + (c.sessionId  || ''),
    'hasPhoto='   + (c.hasPhoto   ? 'true' : 'false'),
  ].join('\n');
}

// Parse key=value text back into a climb object
function cv2Parse(txt) {
  const m = {};
  for (const line of txt.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    m[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return {
    id:         m.id         || '',
    date:       m.date       || '',
    grade:      m.grade      || '',
    holdsColor: m.holdsColor || '',
    status:     m.status     || 'complete',
    tries:      parseInt(m.tries)  || 1,
    rating:     parseInt(m.rating) || 0,
    flash:      m.flash      === 'true',
    styles:     m.styles ? m.styles.split(',').filter(Boolean) : [],
    notes:      (m.notes || '').replace(/\\n/g, '\n'),
    sessionId:  m.sessionId  || '',
    hasPhoto:   m.hasPhoto   === 'true',
  };
}

function cv2ReadAllClimbs(userId) {
  cv2EnsureDirs(userId);
  const climbs = [];
  try {
    for (const f of fs.readdirSync(cv2ClimbsDir(userId))) {
      if (!f.endsWith('.txt')) continue;
      try {
        const c = cv2Parse(fs.readFileSync(path.join(cv2ClimbsDir(userId), f), 'utf8'));
        if (c.id) climbs.push(c);
      } catch {}
    }
  } catch {}
  return climbs;
}

function cv2ReadSessions(userId) {
  try {
    const arr = JSON.parse(fs.readFileSync(cv2SessFile(userId), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function cv2WriteSessions(userId, sessions) {
  cv2EnsureDirs(userId);
  const tmp = cv2SessFile(userId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sessions, null, 2));
  fs.renameSync(tmp, cv2SessFile(userId));
}

// ── World Aquatics helpers ─────────────────────────────────────────────────
function waFetch(path) {
  return new Promise((resolve, reject) => {
    const url = 'https://api.worldaquatics.com/fina' + path;
    const opts = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } };
    const req = https.get(url, opts, r => {
      let buf = '';
      r.on('data', c => buf += c);
      r.on('end', () => resolve({ status: r.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── SwimRankings pbest PDF parser ─────────────────────────────────────────────
function parsePbestPDF(buf) {
  const zlib = require('zlib');
  const binary = buf.toString('binary');
  const lines = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let sm;
  while ((sm = streamRe.exec(binary)) !== null) {
    const raw = Buffer.from(sm[1], 'binary');
    try {
      const inflated = zlib.inflateSync(raw);
      const text = inflated.toString('utf8');
      const tjRe = /\(([^)]*)\)\s*Tj/g;
      let tm;
      while ((tm = tjRe.exec(text)) !== null) {
        const l = tm[1].trim();
        if (l) lines.push(l);
      }
    } catch(e) {}
  }

  function toSecs(s) {
    if (!s) return null;
    s = s.trim();
    const m = s.match(/^(?:(\d+):)?(\d{1,2})\.(\d{2})$/);
    if (!m) return null;
    return +((+m[1]||0)*60 + +m[2] + +m[3]/100).toFixed(2);
  }
  function isTime(s) { return /^\d{1,2}(?::\d{2})?\.\d{2}$/.test((s||'').trim()); }

  // Athlete name + club
  let name = '', club = '';
  for (let i = 0; i < Math.min(14, lines.length); i++) {
    if (/^[A-Z]{2,},\s+[A-Z]/.test(lines[i])) {
      name = lines[i].replace(/\s{2,}.*/, '').trim();
      const nxt = lines[i+1]||'';
      if (!/^(Page|All|Season|Freestyle|Back|Breast|Butt|Medley)/.test(nxt)) club = nxt.trim();
      break;
    }
  }

  const STROKES = {Freestyle:'FR',Backstroke:'BK',Breaststroke:'BR',Butterfly:'FL',Medley:'IM'};
  const VALID_DISTS = new Set([50,100,200,400,800,1500]);
  const events = [];
  let course = 'LCM', stroke = null, i = 0;

  while (i < lines.length) {
    const l = lines[i];
    if (l === 'Page 2 of 2') { course = 'SCM'; i++; continue; }
    if (STROKES[l]) { stroke = STROKES[l]; i++; continue; }

    const dm = l.match(/^(\d+)m$/);
    if (dm && stroke && VALID_DISTS.has(+dm[1])) {
      const dist = +dm[1];
      i++;
      // Find PB time (first time-like line)
      let j = i;
      while (j < lines.length && !isTime(lines[j]) && !lines[j].match(/^\d+m$/) && !STROKES[lines[j]]) j++;
      if (j >= lines.length || !isTime(lines[j])) { i = j; continue; }
      const timeStr = lines[j], time = toSecs(timeStr);
      if (!time) { i = j+1; continue; }
      j++;
      // Skip date + location (up to 4 lines, stop if we hit a | or reaction or time)
      let skipped = 0;
      while (j < lines.length && skipped < 5) {
        const sl = lines[j];
        if (sl.includes('|') || /^\+\d/.test(sl) || isTime(sl) || sl.match(/^\d+m$/) || STROKES[sl]) break;
        j++; skipped++;
      }
      // Skip reaction time (+0.63)
      if (j < lines.length && /^\+\d+\.\d+$/.test(lines[j])) j++;

      // Collect splits for 100m–400m events
      let splits50m = [];
      if (dist > 50 && dist <= 400) {
        const splitBlock = [];
        while (j < lines.length) {
          const sl = lines[j].trim();
          if (!sl) { j++; continue; }
          if (sl.match(/^\d+m$/) || STROKES[sl] || /^Page \d/.test(sl) || /^\d+\.\d+%$/.test(sl)) break;
          // Stop at a time >= 90% of PB (season best for this event)
          const t = toSecs(sl.replace(/\s*\|.*/,'').trim()) || toSecs(sl.replace(/.*\|\s*/,'').trim());
          if (t !== null && t >= time * 0.9 && !sl.includes('|')) break;
          if (sl.includes('|') || sl === '|' || isTime(sl)) { splitBlock.push(sl); j++; }
          else break;
        }
        // Extract all time tokens and filter to 50m splits only
        const raw = splitBlock.join(' ');
        const tokens = raw.split(/[\s|]+/).map(s => s.trim()).filter(Boolean);
        const allTimes = tokens.map(toSecs).filter(t => t !== null);
        const numSplits = dist / 50;
        const threshold = (time / numSplits) * 1.6; // 50m splits are shorter; cumulatives exceed this
        splits50m = allTimes.filter(t => t < threshold).slice(0, numSplits);
      }

      // Compute pacing profile for this event
      let pacingProfile = null;
      if (splits50m.length >= 2) {
        const n = splits50m.length;
        const half = Math.floor(n / 2);
        const fh = splits50m.slice(0, half).reduce((a,b)=>a+b,0);
        const sh = splits50m.slice(n - half).reduce((a,b)=>a+b,0);
        const ratio = fh / sh;
        const profile = ratio < 0.97 ? 'aggressive' : ratio > 1.03 ? 'negative' : 'even';
        const pct = Math.abs((ratio-1)*100).toFixed(1);
        pacingProfile = { ratio, firstHalfTime: fh, secondHalfTime: sh, profile, pct };
      }

      events.push({ stroke, dist, course, time, timeStr, splits50m, pacingProfile, date: null, record: null });
      i = j;
      continue;
    }
    i++;
  }

  return { name, club, source: 'pdf', times: events };
}

// ── API router ────────────────────────────────────────────────────────────────
async function handleAPI(req, res, urlPath) {

  if (req.method === 'OPTIONS' && urlPath === '/api/radar/yhz') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  // GET /api/radar/yhz - public compact aircraft feed for ESP8266 radar display
  if (req.method === 'GET' && urlPath === '/api/radar/yhz') {
    return radarJsonRes(res, await getYhzRadarPayload());
  }

  // GET /api/lights/events - public live desired light state stream
  if (req.method === 'GET' && urlPath === '/api/lights/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client = { res };
    lightsSseClients.add(client);
    sendLightsSse(res, readLightsState());

    const ping = setInterval(() => {
      try { res.write(':\n\n'); } catch { clearInterval(ping); }
    }, 15000);

    req.on('close', () => {
      clearInterval(ping);
      lightsSseClients.delete(client);
    });
    return;
  }

  // GET /api/lights - public desired light state
  if (req.method === 'GET' && urlPath === '/api/lights') {
    const { on, updatedAt } = readLightsState();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    return res.end(JSON.stringify({ on, updatedAt }));
  }

  // POST /api/lights - only yannick can change the desired light state
  if (req.method === 'POST' && urlPath === '/api/lights') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const body = await parseBody(req);
    if (!body || typeof body.on !== 'boolean') {
      return jsonRes(res, 400, { error: 'on must be boolean' });
    }

    const { on, updatedAt } = writeLightsState(body.on, user.username);
    return jsonRes(res, 200, { on, updatedAt });
  }

  // GET /api/lights/device - ESP8266 polling endpoint for desired state
  if (req.method === 'GET' && urlPath === '/api/lights/device') {
    markLightsDevicePolled();
    const { on, updatedAt } = readLightsState();
    const deviceOn = LIGHTS_DEVICE_INVERT_OUTPUT ? !on : on;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    return res.end(JSON.stringify({ on: deviceOn, updatedAt, pollAfterMs: LIGHTS_DEVICE_POLL_MS }));
  }

  // GET /api/lights/device/status - public ESP8266 polling heartbeat
  if (req.method === 'GET' && urlPath === '/api/lights/device/status') {
    return jsonRes(res, 200, getLightsDeviceStatusPayload());
  }

  // POST /api/lights/device/status - optional relay heartbeat/status
  if (req.method === 'POST' && urlPath === '/api/lights/device/status') {
    const body = await parseBody(req);
    if (!body || typeof body.on !== 'boolean') {
      return jsonRes(res, 400, { error: 'on must be boolean' });
    }

    const status = {
      ...readLightsDeviceStatus(),
      on: body.on,
      receivedAt: new Date().toISOString(),
    };
    writeLightsDeviceStatus(status);
    return jsonRes(res, 200, { ok: true });
  }

  // POST /api/auth/register
  if (req.method === 'POST' && urlPath === '/api/auth/register') {
    const { username, password } = await parseBody(req);
    if (!username || !password)
      return jsonRes(res, 400, { error: 'Username and password required' });
    const u = String(username).trim();
    if (u.length < 2 || u.length > 32)
      return jsonRes(res, 400, { error: 'Username must be 2–32 characters' });
    if (!/^[a-zA-Z0-9_-]+$/.test(u))
      return jsonRes(res, 400, { error: 'Username: letters, numbers, _ and - only' });
    if (String(password).length < 4)
      return jsonRes(res, 400, { error: 'Password must be at least 4 characters' });

    const users = readUsers();
    if (users.find(x => x.username.toLowerCase() === u.toLowerCase()))
      return jsonRes(res, 409, { error: 'Username already taken' });

    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomUUID(),
      username: u,
      passwordHash: hashPassword(String(password), salt),
      salt,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);

    const token    = generateToken();
    const sessions = readSessions();
    sessions.push({ token, userId: user.id, createdAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
    writeSessions(sessions);
    return jsonRes(res, 200, { token, username: user.username, id: user.id, email: user.email || null });
  }

  // POST /api/auth/login
  if (req.method === 'POST' && urlPath === '/api/auth/login') {
    const { username, password } = await parseBody(req);
    if (!username || !password)
      return jsonRes(res, 400, { error: 'Username and password required' });

    const users = readUsers();
    const user  = users.find(x => x.username.toLowerCase() === String(username).toLowerCase().trim());
    if (!user || hashPassword(String(password), user.salt) !== user.passwordHash)
      return jsonRes(res, 401, { error: 'Invalid username or password' });

    const token    = generateToken();
    const sessions = readSessions();
    sessions.push({ token, userId: user.id, createdAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
    writeSessions(sessions);   // prunes expired automatically
    return jsonRes(res, 200, { token, username: user.username, id: user.id, email: user.email || null });
  }

  // POST /api/auth/logout
  if (req.method === 'POST' && urlPath === '/api/auth/logout') {
    const token = getToken(req);
    if (token) writeSessions(readSessions().filter(s => s.token !== token));
    return jsonRes(res, 200, { ok: true });
  }

  // GET /api/auth/me
  if (req.method === 'GET' && urlPath === '/api/auth/me') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    return jsonRes(res, 200, { username: user.username, id: user.id, email: user.email || null });
  }

  // POST /api/auth/set-email — set/update the current user's recovery email
  if (req.method === 'POST' && urlPath === '/api/auth/set-email') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });

    const { email } = await parseBody(req);
    const trimmed = String(email || '').trim().toLowerCase();
    if (trimmed && !EMAIL_RE.test(trimmed))
      return jsonRes(res, 400, { error: 'Enter a valid email address' });

    const users = readUsers();
    const target = users.find(u => u.id === user.id);
    target.email = trimmed || null;
    writeUsers(users);
    return jsonRes(res, 200, { ok: true, email: target.email });
  }

  // POST /api/auth/forgot-password — email a reset link if the username has a recovery email on file
  if (req.method === 'POST' && urlPath === '/api/auth/forgot-password') {
    const { username } = await parseBody(req);
    const uname = String(username || '').trim().toLowerCase();
    const user = uname ? readUsers().find(u => u.username.toLowerCase() === uname) : null;

    if (user && user.email) {
      const token = generateToken();
      const resets = readPasswordResets();
      resets.push({
        token, userId: user.id, createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString(),
      });
      writePasswordResets(resets);

      const resetUrl = `${(process.env.PUBLIC_BASE_URL || 'https://yannickmorgans.ca').replace(/\/+$/, '')}/?resetToken=${token}`;
      assignmentCoach.sendEmail(user.email, {
        from: ACCOUNT_EMAIL_FROM,
        subject: 'BIG TUNA password reset',
        text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
        html: `<p>Reset your BIG TUNA password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
      }).catch(() => {});
    }

    // Always the same response, whether or not the account/email exists — avoids username enumeration.
    return jsonRes(res, 200, { ok: true });
  }

  // POST /api/auth/reset-password — consume a reset token and set a new password
  if (req.method === 'POST' && urlPath === '/api/auth/reset-password') {
    const { token, password } = await parseBody(req);
    if (!token || !password)
      return jsonRes(res, 400, { error: 'Token and new password required' });
    if (String(password).length < 4)
      return jsonRes(res, 400, { error: 'Password must be at least 4 characters' });

    const resets = readPasswordResets();
    const reset = resets.find(r => r.token === token && new Date(r.expiresAt) > new Date());
    if (!reset) return jsonRes(res, 400, { error: 'Invalid or expired reset link' });

    const users = readUsers();
    const user = users.find(u => u.id === reset.userId);
    if (!user) return jsonRes(res, 400, { error: 'Invalid or expired reset link' });

    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.passwordHash = hashPassword(String(password), salt);
    writeUsers(users);

    // Token is single-use; also drop any other outstanding reset tokens for this user.
    writePasswordResets(resets.filter(r => r.token !== token && r.userId !== user.id));
    // A password reset invalidates existing sessions — force re-login everywhere.
    writeSessions(readSessions().filter(s => s.userId !== user.id));

    return jsonRes(res, 200, { ok: true });
  }

  // POST /api/account/test-email — TEMP: confirms Resend delivery works; remove once verified.
  if (req.method === 'POST' && urlPath === '/api/account/test-email') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });
    if (!user.email) return jsonRes(res, 400, { error: 'Set a recovery email first' });

    const result = await assignmentCoach.sendEmail(user.email, {
      from: ACCOUNT_EMAIL_FROM,
      subject: 'BIG TUNA test email',
      text: 'This is a test email from BIG TUNA to confirm outgoing mail is working.',
      html: '<p>This is a test email from BIG TUNA to confirm outgoing mail is working.</p>',
    });
    if (result && result.skipped) return jsonRes(res, 503, { error: result.reason || 'Email not sent' });
    return jsonRes(res, 200, { ok: true });
  }

  // ── Analytics: public tracking beacon ─────────────────────────────────────

  // POST /api/analytics/event - public, unauthenticated tracking beacon.
  // Body capped to 4KB, naive per-IP rate limit, geo/device resolved server-side.
  if (req.method === 'POST' && urlPath === '/api/analytics/event') {
    const ip = resolveClientIp(req);
    if (!analyticsRateLimitAllows(ip)) {
      res.writeHead(429); return res.end();
    }

    const body = await new Promise(resolve => {
      let raw = '';
      let tooBig = false;
      req.on('data', chunk => {
        if (tooBig) return;
        raw += chunk;
        if (raw.length > 4096) tooBig = true;
      });
      req.on('end', () => {
        if (tooBig) return resolve(null);
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
      req.on('error', () => resolve(null));
    });
    if (body === null) return jsonRes(res, 413, { error: 'Payload too large' });

    const VALID_EVENT_TYPES = ['pageview', 'heartbeat', 'click'];
    if (!VALID_EVENT_TYPES.includes(body.type)) {
      return jsonRes(res, 400, { error: 'Invalid event type' });
    }

    // navigator.sendBeacon can't set an Authorization header, so the tracking
    // beacon carries the bearer token in the JSON body instead — fall back to
    // that when the header isn't present, so events still attribute to a
    // logged-in user regardless of transport (sendBeacon vs fetch keepalive).
    const bodyToken = typeof body.token === 'string' ? body.token : null;
    const sessionUser = getSessionUser(getToken(req) || bodyToken);
    const geo    = resolveGeo(ip);
    const device = resolveDevice(req.headers['user-agent']);

    const event = {
      ts: new Date().toISOString(),
      type: body.type,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 100) : null,
      userId: sessionUser ? sessionUser.id : null,
      path: typeof body.path === 'string' ? body.path.slice(0, 500) : null,
      referrer: typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : '',
      device,
      country: geo.country,
      region: geo.region,
      city: geo.city,
    };

    if (isFiniteNumber(body.lat) && body.lat >= -90 && body.lat <= 90 &&
        isFiniteNumber(body.lon) && body.lon >= -180 && body.lon <= 180) {
      event.lat = body.lat;
      event.lon = body.lon;
    }

    if (body.type === 'click') {
      const t = body.target && typeof body.target === 'object' ? body.target : {};
      event.target = {
        tag:  typeof t.tag  === 'string' ? t.tag.slice(0, 30)   : '',
        id:   typeof t.id   === 'string' ? t.id.slice(0, 100)   : '',
        cls:  typeof t.cls  === 'string' ? t.cls.slice(0, 100)  : '',
        text: typeof t.text === 'string' ? t.text.slice(0, 40)  : '',
      };
      if (isFiniteNumber(body.xPct)) event.xPct = Math.max(0, Math.min(100, body.xPct));
      if (isFiniteNumber(body.yPct)) event.yPct = Math.max(0, Math.min(100, body.yPct));
    }

    try {
      const dateStr = event.ts.slice(0, 10);
      fs.appendFileSync(analyticsEventFile(dateStr), JSON.stringify(event) + '\n');
    } catch (err) {
      console.error('[analytics] failed to append event:', err.message);
    }

    res.writeHead(204);
    return res.end();
  }

  // ── Analytics: admin-only read endpoints (yannick only) ───────────────────

  // GET /api/admin/overview?range=7|30|90
  if (req.method === 'GET' && urlPath === '/api/admin/overview') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const qs = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');
    const range = [7, 30, 90].includes(Number(qs.get('range'))) ? Number(qs.get('range')) : 30;

    const events = readAnalyticsEvents(range);
    const users  = readUsers();
    const usersById = new Map(users.map(u => [u.id, u]));

    const sessionIds = new Set();
    const dailyMap = new Map(); // date -> { pageviews, sessions: Set }
    const geoCounts = new Map();
    const deviceBreakdown = { mobile: 0, desktop: 0, tablet: 0 };
    let totalPageviews = 0;

    for (const ev of events) {
      if (ev.sessionId) sessionIds.add(ev.sessionId);
      const day = typeof ev.ts === 'string' ? ev.ts.slice(0, 10) : null;
      if (day) {
        if (!dailyMap.has(day)) dailyMap.set(day, { pageviews: 0, sessions: new Set() });
        const d = dailyMap.get(day);
        if (ev.type === 'pageview') d.pageviews++;
        if (ev.sessionId) d.sessions.add(ev.sessionId);
      }
      if (ev.type === 'pageview') totalPageviews++;
      if (ev.country) geoCounts.set(ev.country, (geoCounts.get(ev.country) || 0) + 1);
      if (ev.device && deviceBreakdown[ev.device] !== undefined) deviceBreakdown[ev.device]++;
    }

    const dailySeries = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, pageviews: d.pageviews, sessions: d.sessions.size }));

    const geoDistribution = [...geoCounts.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const recentActivity = events
      .slice()
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 20)
      .map(ev => ({
        ts: ev.ts,
        type: ev.type,
        path: ev.path,
        userId: ev.userId && usersById.has(ev.userId) ? usersById.get(ev.userId).username : (ev.userId || null),
      }));

    return jsonRes(res, 200, {
      totalUsers: users.length,
      activeSessions: sessionIds.size,
      totalPageviews,
      dailySeries,
      recentActivity,
      geoDistribution,
      deviceBreakdown,
    });
  }

  // GET /api/admin/users - per-user aggregate stats over the last 30 days
  if (req.method === 'GET' && urlPath === '/api/admin/users') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const events = readAnalyticsEvents(30); // last 30 days of activity — documented default
    const users  = readUsers();

    const result = users.map(u => {
      const userEvents = events.filter(ev => ev.userId === u.id);
      const sessionIds = new Set(userEvents.map(ev => ev.sessionId).filter(Boolean));
      const pageviews  = userEvents.filter(ev => ev.type === 'pageview').length;

      let lastSeen = null;
      for (const ev of userEvents) {
        if (!ev.ts) continue;
        if (!lastSeen || new Date(ev.ts) > new Date(lastSeen)) lastSeen = ev.ts;
      }

      // Mean of (max ts - min ts) per session
      const sessionSpans = [];
      for (const sid of sessionIds) {
        const evs = userEvents.filter(ev => ev.sessionId === sid && ev.ts);
        if (!evs.length) continue;
        const times = evs.map(ev => new Date(ev.ts).getTime());
        sessionSpans.push(Math.max(...times) - Math.min(...times));
      }
      const avgSessionDurationMs = sessionSpans.length
        ? Math.round(sessionSpans.reduce((a, b) => a + b, 0) / sessionSpans.length)
        : 0;

      // Most-visited path prefix (first path segment)
      const pathCounts = new Map();
      for (const ev of userEvents) {
        if (!ev.path) continue;
        const prefix = '/' + ev.path.split('/').filter(Boolean)[0] || '/';
        pathCounts.set(prefix, (pathCounts.get(prefix) || 0) + 1);
      }
      let topApp = null, topAppCount = 0;
      for (const [prefix, count] of pathCounts) {
        if (count > topAppCount) { topApp = prefix; topAppCount = count; }
      }

      return {
        id: u.id,
        username: u.username,
        email: u.email || null,
        createdAt: u.createdAt || null,
        lastSeen,
        sessionCount: sessionIds.size,
        totalPageviews: pageviews,
        avgSessionDurationMs,
        topApp,
      };
    });

    return jsonRes(res, 200, result);
  }

  // GET /api/admin/users/:id - single-user deep-dive
  if (req.method === 'GET' && urlPath.startsWith('/api/admin/users/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const targetId = urlPath.slice('/api/admin/users/'.length);
    if (!isValidId(targetId)) return jsonRes(res, 400, { error: 'Invalid user ID' });

    const targetUser = readUsers().find(u => u.id === targetId);
    if (!targetUser) return jsonRes(res, 404, { error: 'User not found' });

    const events = readAnalyticsEvents(30).filter(ev => ev.userId === targetId);
    const sessionIds = new Set(events.map(ev => ev.sessionId).filter(Boolean));
    const pageviews  = events.filter(ev => ev.type === 'pageview').length;

    let lastSeen = null;
    for (const ev of events) {
      if (!ev.ts) continue;
      if (!lastSeen || new Date(ev.ts) > new Date(lastSeen)) lastSeen = ev.ts;
    }

    const sessionSpans = [];
    for (const sid of sessionIds) {
      const evs = events.filter(ev => ev.sessionId === sid && ev.ts);
      if (!evs.length) continue;
      const times = evs.map(ev => new Date(ev.ts).getTime());
      sessionSpans.push(Math.max(...times) - Math.min(...times));
    }
    const avgSessionDurationMs = sessionSpans.length
      ? Math.round(sessionSpans.reduce((a, b) => a + b, 0) / sessionSpans.length)
      : 0;

    const pathCounts = new Map();
    for (const ev of events) {
      if (!ev.path) continue;
      const prefix = '/' + ev.path.split('/').filter(Boolean)[0] || '/';
      pathCounts.set(prefix, (pathCounts.get(prefix) || 0) + 1);
    }
    let topApp = null, topAppCount = 0;
    for (const [prefix, count] of pathCounts) {
      if (count > topAppCount) { topApp = prefix; topAppCount = count; }
    }

    const deviceBreakdown = { mobile: 0, desktop: 0, tablet: 0 };
    const geoSeen = new Map(); // "country|region|city" -> count
    const points = [];
    for (const ev of events) {
      if (ev.device && deviceBreakdown[ev.device] !== undefined) deviceBreakdown[ev.device]++;
      if (ev.country) {
        const key = [ev.country, ev.region, ev.city].filter(Boolean).join('|');
        geoSeen.set(key, (geoSeen.get(key) || 0) + 1);
      }
      if (isFiniteNumber(ev.lat) && isFiniteNumber(ev.lon)) points.push({ lat: ev.lat, lon: ev.lon });
    }

    const recentEvents = events
      .slice()
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 50);

    const geoLocations = [...geoSeen.entries()].map(([key, count]) => {
      const [country, region, city] = key.split('|');
      return { country: country || null, region: region || null, city: city || null, count };
    }).sort((a, b) => b.count - a.count);

    return jsonRes(res, 200, {
      id: targetUser.id,
      username: targetUser.username,
      email: targetUser.email || null,
      createdAt: targetUser.createdAt || null,
      lastSeen,
      sessionCount: sessionIds.size,
      totalPageviews: pageviews,
      avgSessionDurationMs,
      topApp,
      recentEvents,
      deviceBreakdown,
      geoLocations,
      points,
    });
  }

  // GET /api/admin/clicks?path=&range=
  if (req.method === 'GET' && urlPath === '/api/admin/clicks') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const qs = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');
    const pathFilter = qs.get('path') || '';
    const range = [7, 30, 90].includes(Number(qs.get('range'))) ? Number(qs.get('range')) : 30;

    let clicks = readAnalyticsEvents(range).filter(ev => ev.type === 'click');
    if (pathFilter) clicks = clicks.filter(ev => typeof ev.path === 'string' && ev.path.startsWith(pathFilter));

    const targetCounts = new Map(); // "tag|id|cls|text" -> count
    for (const ev of clicks) {
      const t = ev.target || {};
      const key = [t.tag || '', t.id || '', t.cls || '', t.text || ''].join('|');
      targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    }
    const topTargets = [...targetCounts.entries()]
      .map(([key, count]) => {
        const [tag, id, cls, text] = key.split('|');
        return { tag: tag || null, id: id || null, cls: cls || null, text: text || null, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Cap to the most recent few thousand points to keep the payload bounded
    const points = clicks
      .slice()
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 3000)
      .filter(ev => isFiniteNumber(ev.xPct) && isFiniteNumber(ev.yPct))
      .map(ev => ({ xPct: ev.xPct, yPct: ev.yPct }));

    return jsonRes(res, 200, { topTargets, points });
  }

  // ── Email campaigns: templates CRUD (admin-only) ──────────────────────────

  // GET /api/admin/email/templates
  if (req.method === 'GET' && urlPath === '/api/admin/email/templates') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    let files = [];
    try { files = fs.readdirSync(EMAIL_TEMPLATES_DIR); } catch { /* dir empty/missing */ }
    const templates = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try { templates.push(JSON.parse(fs.readFileSync(path.join(EMAIL_TEMPLATES_DIR, f), 'utf8'))); }
      catch { /* skip corrupt file */ }
    }
    return jsonRes(res, 200, templates);
  }

  // POST /api/admin/email/templates
  if (req.method === 'POST' && urlPath === '/api/admin/email/templates') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const body = await parseBody(req);
    const now = new Date().toISOString();
    const template = {
      id: crypto.randomUUID(),
      name: typeof body.name === 'string' ? body.name : 'Untitled template',
      description: typeof body.description === 'string' ? body.description : '',
      category: typeof body.category === 'string' ? body.category : '',
      blocks: Array.isArray(body.blocks) ? body.blocks : [],
      subject: typeof body.subject === 'string' ? body.subject : '',
      createdAt: now,
      updatedAt: now,
    };
    atomicWrite(path.join(EMAIL_TEMPLATES_DIR, template.id + '.json'), template);
    return jsonRes(res, 200, template);
  }

  // GET /api/admin/email/templates/:id
  if (req.method === 'GET' && urlPath.startsWith('/api/admin/email/templates/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const id = urlPath.slice('/api/admin/email/templates/'.length);
    if (!isValidId(id)) return jsonRes(res, 400, { error: 'Invalid template ID' });
    const file = path.join(EMAIL_TEMPLATES_DIR, id + '.json');
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Template not found' });
    try { return jsonRes(res, 200, JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { return jsonRes(res, 500, { error: 'Failed to read template' }); }
  }

  // PUT /api/admin/email/templates/:id
  if (req.method === 'PUT' && urlPath.startsWith('/api/admin/email/templates/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const id = urlPath.slice('/api/admin/email/templates/'.length);
    if (!isValidId(id)) return jsonRes(res, 400, { error: 'Invalid template ID' });
    const file = path.join(EMAIL_TEMPLATES_DIR, id + '.json');
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Template not found' });
    let existing;
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return jsonRes(res, 500, { error: 'Failed to read template' }); }

    const body = await parseBody(req);
    const updated = {
      ...existing,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.category === 'string' ? { category: body.category } : {}),
      ...(Array.isArray(body.blocks) ? { blocks: body.blocks } : {}),
      ...(typeof body.subject === 'string' ? { subject: body.subject } : {}),
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(file, updated);
    return jsonRes(res, 200, updated);
  }

  // DELETE /api/admin/email/templates/:id
  if (req.method === 'DELETE' && urlPath.startsWith('/api/admin/email/templates/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const id = urlPath.slice('/api/admin/email/templates/'.length);
    if (!isValidId(id)) return jsonRes(res, 400, { error: 'Invalid template ID' });
    try { fs.unlinkSync(path.join(EMAIL_TEMPLATES_DIR, id + '.json')); }
    catch { return jsonRes(res, 404, { error: 'Template not found' }); }
    return jsonRes(res, 200, { ok: true });
  }

  // ── Email campaigns: campaigns CRUD + send/test (admin-only) ─────────────
  // ── plus open/click tracking endpoints (public, hit by email clients) ────

  // GET /api/admin/email/campaigns
  if (req.method === 'GET' && urlPath === '/api/admin/email/campaigns') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    let files = [];
    try { files = fs.readdirSync(EMAIL_CAMPAIGNS_DIR); } catch { /* dir empty/missing */ }
    const campaigns = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try { campaigns.push(JSON.parse(fs.readFileSync(path.join(EMAIL_CAMPAIGNS_DIR, f), 'utf8'))); }
      catch { /* skip corrupt file */ }
    }
    return jsonRes(res, 200, campaigns);
  }

  // POST /api/admin/email/campaigns
  if (req.method === 'POST' && urlPath === '/api/admin/email/campaigns') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const body = await parseBody(req);
    let fromEmail = (typeof body.fromEmail === 'string' && body.fromEmail.trim()) ? body.fromEmail.trim() : ACCOUNT_EMAIL_FROM;
    if (!EMAIL_RE.test(fromEmail) || !fromEmail.toLowerCase().endsWith('@yannickmorgans.ca')) {
      return jsonRes(res, 400, { error: 'fromEmail must be a valid @yannickmorgans.ca address (the only verified sending domain)' });
    }

    const now = new Date().toISOString();
    const campaign = {
      id: crypto.randomUUID(),
      name: typeof body.name === 'string' ? body.name : 'Untitled campaign',
      subject: typeof body.subject === 'string' ? body.subject : '',
      fromEmail,
      blocks: Array.isArray(body.blocks) ? body.blocks : [],
      templateId: typeof body.templateId === 'string' ? body.templateId : null,
      recipientIds: Array.isArray(body.recipientIds) ? body.recipientIds.filter(id => typeof id === 'string') : [],
      status: 'draft',
      scheduledAt: typeof body.scheduledAt === 'string' ? body.scheduledAt : null,
      createdAt: now,
      updatedAt: now,
      sentAt: null,
      sendResults: [],
    };
    atomicWrite(path.join(EMAIL_CAMPAIGNS_DIR, campaign.id + '.json'), campaign);
    return jsonRes(res, 200, campaign);
  }

  // GET /api/admin/email/campaigns/:id/open?u=&t= — public, unauthenticated (email open pixel)
  if (req.method === 'GET' && urlPath.startsWith('/api/admin/email/campaigns/') && urlPath.endsWith('/open')) {
    const id = urlPath.slice('/api/admin/email/campaigns/'.length, -'/open'.length);
    const qs = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');
    const recipientId = qs.get('u') || '';
    const token = qs.get('t') || '';

    if (isValidId(id) && isValidId(recipientId) && emailCampaigns.verifyTrackingToken(recipientId, id, 'campaign-open', token)) {
      try {
        const file = path.join(EMAIL_CAMPAIGNS_DIR, id + '.json');
        const campaign = JSON.parse(fs.readFileSync(file, 'utf8'));
        const entry = Array.isArray(campaign.sendResults) ? campaign.sendResults.find(r => r.userId === recipientId) : null;
        if (entry && !entry.opened) {
          entry.opened = true;
          entry.openedAt = new Date().toISOString();
          atomicWrite(file, campaign);
        }
      } catch { /* invalid/missing campaign — still return the pixel below */ }
    }

    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': TRANSPARENT_GIF.length,
      'Cache-Control': 'no-store',
    });
    return res.end(TRANSPARENT_GIF);
  }

  // GET /api/admin/email/campaigns/:id/click?u=&t=&url= — public, unauthenticated (email link redirect)
  if (req.method === 'GET' && urlPath.startsWith('/api/admin/email/campaigns/') && urlPath.endsWith('/click')) {
    const id = urlPath.slice('/api/admin/email/campaigns/'.length, -'/click'.length);
    const qs = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');
    const recipientId = qs.get('u') || '';
    const token = qs.get('t') || '';
    const rawUrl = qs.get('url') || '';

    // Only http(s) targets are ever redirected to — no javascript:/data: schemes.
    const redirectTo = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://yannickmorgans.ca/';

    if (isValidId(id) && isValidId(recipientId) && emailCampaigns.verifyTrackingToken(recipientId, id, 'campaign-click', token)) {
      try {
        const file = path.join(EMAIL_CAMPAIGNS_DIR, id + '.json');
        const campaign = JSON.parse(fs.readFileSync(file, 'utf8'));
        const entry = Array.isArray(campaign.sendResults) ? campaign.sendResults.find(r => r.userId === recipientId) : null;
        if (entry) {
          if (!Array.isArray(entry.clicks)) entry.clicks = [];
          entry.clicks.push({ ts: new Date().toISOString(), url: redirectTo });
          atomicWrite(file, campaign);
        }
      } catch { /* invalid/missing campaign — still redirect below */ }
    }

    res.writeHead(302, { Location: redirectTo });
    return res.end();
  }

  // POST /api/admin/email/campaigns/:id/send
  if (req.method === 'POST' && urlPath.startsWith('/api/admin/email/campaigns/') && urlPath.endsWith('/send')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const id = urlPath.slice('/api/admin/email/campaigns/'.length, -'/send'.length);
    if (!isValidId(id)) return jsonRes(res, 400, { error: 'Invalid campaign ID' });
    if (!fs.existsSync(path.join(EMAIL_CAMPAIGNS_DIR, id + '.json'))) return jsonRes(res, 404, { error: 'Campaign not found' });

    try {
      const updated = await emailCampaigns.sendCampaign(id);
      return jsonRes(res, 200, updated);
    } catch (err) {
      return jsonRes(res, 500, { error: err.message || 'Failed to send campaign' });
    }
  }

  // POST /api/admin/email/campaigns/:id/test — ALWAYS sends only to the caller's
  // own recovery email, ignoring campaign.recipientIds. Safety valve so campaigns
  // can be validated without ever emailing a real user.
  if (req.method === 'POST' && urlPath.startsWith('/api/admin/email/campaigns/') && urlPath.endsWith('/test')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });
    if (!user.email) return jsonRes(res, 400, { error: 'Set a recovery email first' });

    const id = urlPath.slice('/api/admin/email/campaigns/'.length, -'/test'.length);
    if (!isValidId(id)) return jsonRes(res, 400, { error: 'Invalid campaign ID' });
    const file = path.join(EMAIL_CAMPAIGNS_DIR, id + '.json');
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Campaign not found' });

    let campaign;
    try { campaign = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return jsonRes(res, 500, { error: 'Failed to read campaign' }); }

    const recipient = { id: user.id, email: user.email };
    const html = emailCampaigns.renderCampaignHtml(campaign, recipient);
    const text = emailCampaigns.campaignPlainText(campaign);
    const result = await assignmentCoach.sendEmail(user.email, {
      subject: `[TEST] ${campaign.subject || campaign.name || 'Campaign'}`,
      text,
      html,
      from: campaign.fromEmail || ACCOUNT_EMAIL_FROM,
    });
    if (result && result.skipped) return jsonRes(res, 503, { error: result.reason || 'Email not sent' });
    return jsonRes(res, 200, { ok: true });
  }

  // GET /api/admin/email/campaigns/:id
  if (req.method === 'GET' && urlPath.startsWith('/api/admin/email/campaigns/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const id = urlPath.slice('/api/admin/email/campaigns/'.length);
    if (!isValidId(id)) return jsonRes(res, 400, { error: 'Invalid campaign ID' });
    const file = path.join(EMAIL_CAMPAIGNS_DIR, id + '.json');
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Campaign not found' });
    try { return jsonRes(res, 200, JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { return jsonRes(res, 500, { error: 'Failed to read campaign' }); }
  }

  // PUT /api/admin/email/campaigns/:id
  if (req.method === 'PUT' && urlPath.startsWith('/api/admin/email/campaigns/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const id = urlPath.slice('/api/admin/email/campaigns/'.length);
    if (!isValidId(id)) return jsonRes(res, 400, { error: 'Invalid campaign ID' });
    const file = path.join(EMAIL_CAMPAIGNS_DIR, id + '.json');
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Campaign not found' });
    let existing;
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return jsonRes(res, 500, { error: 'Failed to read campaign' }); }

    const body = await parseBody(req);

    let fromEmail = existing.fromEmail;
    if (typeof body.fromEmail === 'string' && body.fromEmail.trim()) {
      const candidate = body.fromEmail.trim();
      if (!EMAIL_RE.test(candidate) || !candidate.toLowerCase().endsWith('@yannickmorgans.ca')) {
        return jsonRes(res, 400, { error: 'fromEmail must be a valid @yannickmorgans.ca address (the only verified sending domain)' });
      }
      fromEmail = candidate;
    }

    const updated = {
      ...existing,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.subject === 'string' ? { subject: body.subject } : {}),
      fromEmail,
      ...(Array.isArray(body.blocks) ? { blocks: body.blocks } : {}),
      ...((typeof body.templateId === 'string' || body.templateId === null) ? { templateId: body.templateId } : {}),
      ...(Array.isArray(body.recipientIds) ? { recipientIds: body.recipientIds.filter(x => typeof x === 'string') } : {}),
      ...(typeof body.status === 'string' ? { status: body.status } : {}),
      ...((typeof body.scheduledAt === 'string' || body.scheduledAt === null) ? { scheduledAt: body.scheduledAt } : {}),
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(file, updated);
    return jsonRes(res, 200, updated);
  }

  // DELETE /api/admin/email/campaigns/:id
  if (req.method === 'DELETE' && urlPath.startsWith('/api/admin/email/campaigns/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    if (user.username.toLowerCase() !== 'yannick') return jsonRes(res, 403, { error: 'Forbidden' });

    const id = urlPath.slice('/api/admin/email/campaigns/'.length);
    if (!isValidId(id)) return jsonRes(res, 400, { error: 'Invalid campaign ID' });
    try { fs.unlinkSync(path.join(EMAIL_CAMPAIGNS_DIR, id + '.json')); }
    catch { return jsonRes(res, 404, { error: 'Campaign not found' }); }
    return jsonRes(res, 200, { ok: true });
  }

  // GET /api/eco-ai/status - authenticated Ollama availability and model list
  if (req.method === 'GET' && urlPath === '/api/eco-ai/status') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });

    const status = await getEcoAiStatus();
    return jsonRes(res, 200, {
      available: status.available,
      models: status.models,
      recommendedModel: status.recommendedModel,
      setupMessage: status.setupMessage || '',
      error: status.error || '',
      ollamaBaseUrl: OLLAMA_BASE_URL,
      skills: Object.keys(ECO_AI_SKILLS),
      limits: {
        maxMessages: ECO_AI_MAX_MESSAGES,
        maxFileCount: ECO_AI_MAX_FILE_COUNT,
        maxFileChars: ECO_AI_MAX_FILE_CHARS,
        maxTotalFileChars: ECO_AI_MAX_TOTAL_FILE_CHARS,
      },
      suggestions: [
        'Prefer quantized 7B-class instruct or coder models on a 6 GB GPU.',
        'If you install multiple models, Eco AI will let you switch between them per chat.',
      ],
    });
  }

  // POST /api/eco-ai/chat - authenticated streaming Ollama chat proxy
  if (req.method === 'POST' && urlPath === '/api/eco-ai/chat') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });

    const body = await parseBody(req);
    const messages = sanitizeEcoAiMessages(body?.messages);
    const skill = typeof body?.skill === 'string' ? body.skill : 'general';

    if (!messages.length) {
      return jsonRes(res, 400, { error: 'At least one message is required' });
    }
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') {
      return jsonRes(res, 400, { error: 'Last message must be from the user' });
    }

    const status = await getEcoAiStatus();
    if (!status.available) {
      return jsonRes(res, 503, {
        error: status.setupMessage || 'Ollama is unavailable',
        details: status.error || '',
      });
    }

    const requestedModel = typeof body?.model === 'string' ? body.model.trim() : '';
    const modelNames = new Set(status.models.map(model => model.name));
    const model = requestedModel && modelNames.has(requestedModel)
      ? requestedModel
      : (status.recommendedModel || status.models[0]?.name || '');

    if (!model) {
      return jsonRes(res, 503, { error: 'No local Ollama models are installed yet' });
    }

    const upstreamController = new AbortController();
    req.on('close', () => upstreamController.abort(new Error('Client disconnected')));

    const timeout = withTimeout(ECO_AI_CHAT_TIMEOUT_MS, upstreamController.signal);
    let upstream;
    try {
      upstream = await fetch(new URL('/api/chat', OLLAMA_BASE_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: true,
          messages: buildEcoAiOllamaMessages(messages, skill),
          options: ECO_AI_DEFAULT_OPTIONS,
        }),
        signal: timeout.signal,
      });
    } catch (error) {
      timeout.clear();
      return jsonRes(res, 503, {
        error: 'Could not connect to Ollama',
        details: ecoAiFriendlyError(error),
      });
    }

    if (!upstream.ok || !upstream.body) {
      timeout.clear();
      const text = await upstream.text().catch(() => '');
      return jsonRes(res, 502, {
        error: 'Ollama chat request failed',
        details: text || `HTTP ${upstream.status}`,
      });
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(JSON.stringify({ type: 'meta', model }) + '\n');

    // Keepalive heartbeat: long prompt processing on old/large chats can leave a
    // big gap before the first token. Without periodic bytes, the Cloudflare
    // Tunnel idle-times-out and the browser sees "load failed". Pings are ignored
    // by the client and stop as soon as the stream ends.
    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      try { res.write(JSON.stringify({ type: 'ping', t: Date.now() }) + '\n'); } catch {}
    }, 15000);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamedContent = false;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const rawLine = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf('\n');
          if (!rawLine) continue;

          let line;
          try { line = JSON.parse(rawLine); } catch { continue; }

          const delta = typeof line?.message?.content === 'string' ? line.message.content : '';
          if (delta) {
            streamedContent = true;
            res.write(JSON.stringify({ type: 'delta', content: delta }) + '\n');
          }

          if (line?.error) {
            res.write(JSON.stringify({
              type: 'error',
              error: String(line.error),
            }) + '\n');
            res.end();
            timeout.clear();
            return;
          }

          if (line?.done) {
            res.write(JSON.stringify({
              type: 'done',
              doneReason: line.done_reason || '',
              totalDuration: line.total_duration || 0,
              evalCount: line.eval_count || 0,
              empty: !streamedContent,
            }) + '\n');
            res.end();
            timeout.clear();
            return;
          }
        }
      }

      const finalChunk = buffer.trim();
      if (finalChunk) {
        try {
          const line = JSON.parse(finalChunk);
          const delta = typeof line?.message?.content === 'string' ? line.message.content : '';
          if (delta) {
            streamedContent = true;
            res.write(JSON.stringify({ type: 'delta', content: delta }) + '\n');
          }
          if (line?.error) {
            res.write(JSON.stringify({
              type: 'error',
              error: String(line.error),
            }) + '\n');
          }
          if (line?.done) {
            res.write(JSON.stringify({
              type: 'done',
              doneReason: line.done_reason || '',
              totalDuration: line.total_duration || 0,
              evalCount: line.eval_count || 0,
              empty: !streamedContent,
            }) + '\n');
          }
        } catch {}
      }

      if (!res.writableEnded) {
        res.write(JSON.stringify({
          type: 'done',
          doneReason: 'stream-end',
          empty: !streamedContent,
        }) + '\n');
        res.end();
      }
    } catch (error) {
      if (!res.writableEnded) {
        res.write(JSON.stringify({
          type: 'error',
          error: ecoAiFriendlyError(error),
        }) + '\n');
        res.end();
      }
    } finally {
      clearInterval(heartbeat);
      timeout.clear();
      try { reader.releaseLock(); } catch {}
    }
    return;
  }

  // POST /api/trivia/generate - authenticated local-Ollama trivia generator.
  // Body: { topic?, count?, model?, difficulty?, exclude?: string[] }. `exclude`
  // is the list of already-asked questions so the (stateless) model avoids
  // duplicates. Returns validated multiple-choice questions for the Trivia app.
  if (req.method === 'POST' && urlPath === '/api/trivia/generate') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });

    const body = await parseBody(req);
    const topic = typeof body?.topic === 'string'
      ? body.topic.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TRIVIA_MAX_TOPIC_LEN)
      : '';
    let count = parseInt(body?.count, 10);
    if (!Number.isInteger(count) || count < 1) count = 5;
    count = Math.min(count, TRIVIA_MAX_COUNT);

    // 'easy' | 'medium' | 'hard' pin the whole batch; anything else = mixed.
    const reqDifficulty = typeof body?.difficulty === 'string' ? body.difficulty.toLowerCase() : '';
    const difficulty = ['easy', 'medium', 'hard'].includes(reqDifficulty) ? reqDifficulty : 'any';

    // Already-asked questions to avoid repeating (capped to bound the prompt).
    const exclude = Array.isArray(body?.exclude)
      ? body.exclude
          .filter(s => typeof s === 'string' && s.trim())
          .map(s => s.replace(/\s+/g, ' ').trim().slice(0, TRIVIA_EXCLUDE_ITEM_MAX_LEN))
          .slice(0, TRIVIA_MAX_EXCLUDE)
      : [];
    const excludeSet = new Set(exclude.map(normalizeQuestionText));

    const status = await getEcoAiStatus();
    if (!status.available) {
      return jsonRes(res, 503, {
        error: status.setupMessage || 'The local AI model is unavailable',
        details: status.error || '',
      });
    }

    const requestedModel = typeof body?.model === 'string' ? body.model.trim() : '';
    const modelNames = new Set(status.models.map(m => m.name));
    const model = requestedModel && modelNames.has(requestedModel)
      ? requestedModel
      : (status.recommendedModel || status.models[0]?.name || '');
    if (!model) return jsonRes(res, 503, { error: 'No local AI models are installed yet' });

    let result;
    try {
      result = await ollamaFetchJson('/api/chat', {
        model,
        stream: false,
        format: 'json',
        keep_alive: '30m', // avoid a cold-model reload the next time a run starts
        messages: buildTriviaMessages(topic, count, difficulty, exclude),
        options: {
          temperature: 0.9,
          top_p: 0.95,
          num_ctx: 8192,
          // Each question is a small JSON record (~150-250 tokens); cap output
          // so a degenerating generation can't run away and blow out latency.
          num_predict: Math.min(4000, 220 + count * 260),
          seed: crypto.randomInt(2 ** 31),
        },
      }, { timeoutMs: TRIVIA_GEN_TIMEOUT_MS });
    } catch (error) {
      return jsonRes(res, 503, { error: 'Could not reach the local AI model', details: ecoAiFriendlyError(error) });
    }

    if (!result.ok) {
      return jsonRes(res, 502, { error: 'The local AI model failed to generate questions', details: result.data?.error || result.text || `HTTP ${result.status}` });
    }

    const content = typeof result.data?.message?.content === 'string' ? result.data.message.content : '';
    let parsed = null;
    try { parsed = JSON.parse(content); } catch {
      // Best-effort: pull the first {...} block if the model wrapped it in text.
      const match = content.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    }

    const questions = validateTriviaQuestions(extractTriviaArray(parsed), count, excludeSet);
    if (!questions.length) {
      return jsonRes(res, 502, { error: 'The local AI model returned no usable questions. Try again.' });
    }

    return jsonRes(res, 200, { ok: true, model, topic, difficulty, questions });
  }

  // GET /api/assignments - per-user assignment coach dashboard data
  if (req.method === 'GET' && urlPath === '/api/assignments') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    return jsonRes(res, 200, assignmentCoach.listAssignments(user.id));
  }

  // GET /api/assignments/config - this user's setup status (no secrets)
  if (req.method === 'GET' && urlPath === '/api/assignments/config') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    return jsonRes(res, 200, {
      config: assignmentCoach.publicConfig(assignmentCoach.readConfig(user.id)),
      status: assignmentCoach.listAssignments(user.id).status,
    });
  }

  // POST /api/assignments/config - save onboarding / settings for this user
  if (req.method === 'POST' && urlPath === '/api/assignments/config') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const body = await parseBody(req);
    const result = assignmentCoach.saveConfig(user.id, body, {});
    return jsonRes(res, result.ok ? 200 : (result.status || 400), result);
  }

  // DELETE /api/assignments/config - wipe this user's assignment data
  if (req.method === 'DELETE' && urlPath === '/api/assignments/config') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    return jsonRes(res, 200, assignmentCoach.deleteUserData(user.id));
  }

  // POST /api/assignments/check-now - manual check for this user (optionally emails the digest)
  if (req.method === 'POST' && urlPath === '/api/assignments/check-now') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const body = await parseBody(req);
    const result = await assignmentCoach.runCheck(user.id, { manual: true, sendDigest: Boolean(body.email) });
    return jsonRes(res, result.ok ? 200 : (result.status || 500), result);
  }

  // POST /api/assignments/email-now - send the coaching digest to this user from current state
  if (req.method === 'POST' && urlPath === '/api/assignments/email-now') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const result = await assignmentCoach.emailNow(user.id);
    return jsonRes(res, result.ok ? 200 : (result.status || 500), result);
  }

  // POST /api/assignments/action - signed email-link action endpoint (bound to a userId)
  if (req.method === 'POST' && urlPath === '/api/assignments/action') {
    const body = await parseBody(req);
    const userId = typeof body.user === 'string' ? body.user : '';
    const id = typeof body.id === 'string' ? body.id : '';
    const action = typeof body.action === 'string' ? body.action : '';
    const expires = typeof body.expires === 'string' || typeof body.expires === 'number' ? body.expires : '';
    const sig = typeof body.sig === 'string' ? body.sig : '';
    if (!assignmentCoach.verifyAction({ userId, id, action, expires, sig })) {
      return jsonRes(res, 403, { error: 'Invalid or expired action link' });
    }
    const result = await assignmentCoach.handleAction({ userId, id, action, instructions: body.instructions });
    return jsonRes(res, result.ok ? 200 : (result.status || 400), result);
  }

  // GET /api/settings/:appId
  if (req.method === 'GET' && urlPath.startsWith('/api/settings/')) {
    const user  = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const appId = urlPath.slice('/api/settings/'.length);
    if (!isValidId(appId)) return jsonRes(res, 400, { error: 'Invalid appId' });
    return jsonRes(res, 200, readSettings(user.id, appId));
  }

  // POST /api/settings/:appId
  if (req.method === 'POST' && urlPath.startsWith('/api/settings/')) {
    const user  = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const appId = urlPath.slice('/api/settings/'.length);
    if (!isValidId(appId)) return jsonRes(res, 400, { error: 'Invalid appId' });
    const data  = await parseBody(req);
    writeSettings(user.id, appId, data);
    return jsonRes(res, 200, { ok: true });
  }

  // POST /api/parse-pbest — parse a SwimRankings personal best PDF
  if (req.method === 'POST' && urlPath === '/api/parse-pbest') {
    const body = await parseBody(req);
    if (!body || !body.pdf) return jsonRes(res, 400, { error: 'pdf (base64) required' });
    try {
      const buf = Buffer.from(body.pdf, 'base64');
      const result = parsePbestPDF(buf);
      return jsonRes(res, 200, result);
    } catch(e) {
      return jsonRes(res, 400, { error: 'PDF parse failed: ' + e.message });
    }
  }

  // GET /api/waquatics/search?name=...
  if (req.method === 'GET' && urlPath === '/api/waquatics/search') {
    const qs = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?')+1) : '');
    const name = (qs.get('name') || '').trim();
    if (!name || name.length < 2) return jsonRes(res, 400, { error: 'Name required' });
    try {
      const r = await waFetch('/athletes?name=' + encodeURIComponent(name) + '&limit=8');
      if (r.status !== 200) return jsonRes(res, 502, { error: 'World Aquatics search failed' });
      const data = JSON.parse(r.body);
      // Filter to swimmers only, return lightweight list
      const swimmers = (data.content || [])
        .filter(a => a.disciplines && a.disciplines.includes('SW'))
        .map(a => ({ id: a.id, name: a.fullName, nationality: a.nationality, gender: a.gender, dob: a.dateOfBirth }));
      return jsonRes(res, 200, swimmers);
    } catch(e) {
      return jsonRes(res, 502, { error: e.message });
    }
  }

  // GET /api/waquatics/athlete?id=1000785
  if (req.method === 'GET' && urlPath === '/api/waquatics/athlete') {
    const qs = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?')+1) : '');
    const id = (qs.get('id') || '').replace(/\D/g, '');
    if (!id) return jsonRes(res, 400, { error: 'Athlete ID required' });
    try {
      const [rAth, rBest] = await Promise.all([
        waFetch('/athletes/' + id),
        waFetch('/athletes/' + id + '/best/results'),
      ]);
      if (rAth.status !== 200) return jsonRes(res, 404, { error: 'Athlete not found' });
      const ath = JSON.parse(rAth.body);
      const bests = JSON.parse(rBest.body);

      // Extract individual swimming events (no relays)
      const swData = bests.find(b => b.SportCode === 'SW');
      const times = [];
      if (swData) {
        for (const b of swData.Bests) {
          // Skip relays
          if (b.DisciplineFullName.includes('x') || b.DisciplineFullName.includes('Relay')) continue;
          // Parse: "Men's 100m Breaststroke" → dist=100, stroke=BR
          const distM = b.DisciplineFullName.match(/(\d+)m/);
          const strokeMap = { Free:'FR', Breast:'BR', Back:'BK', Butterfly:'FL', Medley:'IM' };
          let stroke = null;
          for (const [k,v] of Object.entries(strokeMap)) {
            if (b.DisciplineFullName.includes(k)) { stroke=v; break; }
          }
          if (!distM || !stroke) continue;
          const dist = parseInt(distM[1]);
          if (![50,100,200,400,800,1500].includes(dist)) continue;
          // Parse time string: "56.88" or "02:08.34"
          const tm = b.Result.match(/^(?:(\d+):)?(\d+)\.(\d+)$/);
          if (!tm) continue;
          const secs = (parseInt(tm[1]||0)*60) + parseInt(tm[2]) + parseInt(tm[3])/100;
          times.push({ dist, stroke, course: b.Pool==='50m'?'LCM':'SCM', time: secs, timeStr: b.Result, date: b.Date, record: b.Record||null });
        }
      }
      // Deduplicate: prefer LCM, keep best per dist+stroke+course
      const best = {};
      for (const t of times) {
        const key = `${t.dist}-${t.stroke}-${t.course}`;
        if (!best[key] || t.time < best[key].time) best[key] = t;
      }
      const strokeOrder = { FR:0, BK:1, BR:2, FL:3, IM:4 };
      const sorted = Object.values(best).sort((a,b) => {
        if (a.stroke !== b.stroke) return (strokeOrder[a.stroke]||5)-(strokeOrder[b.stroke]||5);
        return a.dist - b.dist;
      });

      return jsonRes(res, 200, {
        id: ath.id,
        name: ath.fullName,
        nationality: ath.nationality,
        gender: ath.gender,
        dob: ath.dateOfBirth,
        times: sorted,
      });
    } catch(e) {
      return jsonRes(res, 502, { error: e.message });
    }
  }

  // GET /api/climbs
  if (req.method === 'GET' && urlPath === '/api/climbs') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    return jsonRes(res, 200, readAllClimbData(user.id));
  }

  // POST /api/climbs
  if (req.method === 'POST' && urlPath === '/api/climbs') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const data = await parseBody(req);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return jsonRes(res, 400, { error: 'Invalid data' });
    migrateClimbsIfNeeded(user.id);
    ensureUserClimbsDir(user.id);
    for (const c of (Array.isArray(data.climbs)   ? data.climbs   : [])) {
      if (c?.id) writeClimbFile(user.id, c);
    }
    for (const s of (Array.isArray(data.sessions) ? data.sessions : [])) {
      if (s?.id) writeSessionFile(user.id, s);
    }
    for (const id of (Array.isArray(data.deletedClimbIds)   ? data.deletedClimbIds   : [])) {
      if (typeof id === 'string') softDeleteClimb(user.id, id);
    }
    for (const id of (Array.isArray(data.deletedSessionIds) ? data.deletedSessionIds : [])) {
      if (typeof id === 'string') softDeleteSession(user.id, id);
    }
    return jsonRes(res, 200, { ok: true });
  }

  // GET /api/data/:appId  — generic per-user app data store for future apps
  if (req.method === 'GET' && urlPath.startsWith('/api/data/')) {
    const user  = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const appId = urlPath.slice('/api/data/'.length);
    if (!isValidId(appId)) return jsonRes(res, 400, { error: 'Invalid appId' });
    return jsonRes(res, 200, readAppData(appId, user.id));
  }

  // POST /api/data/:appId  — generic per-user app data store for future apps
  if (req.method === 'POST' && urlPath.startsWith('/api/data/')) {
    const user  = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const appId = urlPath.slice('/api/data/'.length);
    if (!isValidId(appId)) return jsonRes(res, 400, { error: 'Invalid appId' });
    const data  = await parseBody(req);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return jsonRes(res, 400, { error: 'Invalid data' });
    writeAppData(appId, user.id, data);
    return jsonRes(res, 200, { ok: true });
  }

  // ── Psych-sheet meets ─────────────────────────────────────────────────────
  const MP = '/api/meets/psych-sheet';

  // GET /api/meets/psych-sheet  → list meets (metadata, no rawText)
  if (req.method === 'GET' && urlPath === MP) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const list = readMeets(user.id).map(({ rawText, ...m }) => m);
    return jsonRes(res, 200, list);
  }

  // GET /api/meets/psych-sheet/:id  → full meet with rawText
  if (req.method === 'GET' && urlPath.startsWith(MP + '/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const meetId = urlPath.slice(MP.length + 1);
    if (!isValidId(meetId)) return jsonRes(res, 400, { error: 'Invalid meet ID' });
    const meet = readMeets(user.id).find(m => m.id === meetId);
    if (!meet) return jsonRes(res, 404, { error: 'Meet not found' });
    return jsonRes(res, 200, meet);
  }

  // POST /api/meets/psych-sheet  → create meet
  if (req.method === 'POST' && urlPath === MP) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const body = await parseBody(req);
    if (!body || typeof body.rawText !== 'string')
      return jsonRes(res, 400, { error: 'rawText is required' });
    if (Buffer.byteLength(body.rawText, 'utf8') > MAX_TEXT_BYTES)
      return jsonRes(res, 413, { error: 'Psych sheet text exceeds the 2 MB limit' });
    const meets = readMeets(user.id);
    if (meets.length >= MAX_MEETS)
      return jsonRes(res, 429, { error: `Saved meets limit reached (${MAX_MEETS}). Delete a meet to save a new one.` });
    const now    = new Date().toISOString();
    const preset = VALID_PRESETS.includes(body.settings?.preset) ? body.settings.preset : 'swim-nsw';
    const meet   = {
      id:        crypto.randomUUID(),
      name:      (typeof body.name === 'string' && body.name.trim()) ? body.name.trim().slice(0, 100) : 'Untitled Meet',
      fileName:  typeof body.fileName === 'string' ? body.fileName.slice(0, 200) : '',
      createdAt: now,
      updatedAt: now,
      settings:  {
        preset,
        customPts: Array.isArray(body.settings?.customPts)
          ? body.settings.customPts.filter(n => typeof n === 'number' && n >= 0).slice(0, 100)
          : [],
      },
      rawText: body.rawText,
    };
    meets.push(meet);
    writeMeets(user.id, meets);
    const { rawText, ...meta } = meet;
    return jsonRes(res, 200, meta);
  }

  // PATCH /api/meets/psych-sheet/:id  → rename or update settings
  if (req.method === 'PATCH' && urlPath.startsWith(MP + '/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const meetId = urlPath.slice(MP.length + 1);
    if (!isValidId(meetId)) return jsonRes(res, 400, { error: 'Invalid meet ID' });
    const body  = await parseBody(req);
    const meets = readMeets(user.id);
    const idx   = meets.findIndex(m => m.id === meetId);
    if (idx === -1) return jsonRes(res, 404, { error: 'Meet not found' });
    if (typeof body.name === 'string' && body.name.trim())
      meets[idx].name = body.name.trim().slice(0, 100);
    if (body.settings && typeof body.settings === 'object') {
      if (VALID_PRESETS.includes(body.settings.preset))
        meets[idx].settings.preset = body.settings.preset;
      if (Array.isArray(body.settings.customPts))
        meets[idx].settings.customPts = body.settings.customPts
          .filter(n => typeof n === 'number' && n >= 0).slice(0, 100);
    }
    meets[idx].updatedAt = new Date().toISOString();
    writeMeets(user.id, meets);
    const { rawText, ...meta } = meets[idx];
    return jsonRes(res, 200, meta);
  }

  // DELETE /api/meets/psych-sheet/:id
  if (req.method === 'DELETE' && urlPath.startsWith(MP + '/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const meetId = urlPath.slice(MP.length + 1);
    if (!isValidId(meetId)) return jsonRes(res, 400, { error: 'Invalid meet ID' });
    const meets = readMeets(user.id);
    const idx   = meets.findIndex(m => m.id === meetId);
    if (idx === -1) return jsonRes(res, 404, { error: 'Meet not found' });
    meets.splice(idx, 1);
    writeMeets(user.id, meets);
    return jsonRes(res, 200, { ok: true });
  }

  // ── Climb Tracker v2 ──────────────────────────────────────────────────────

  // GET /api/climbs2/photo/:id?t=token  (no auth header — token in query)
  if (req.method === 'GET' && urlPath.startsWith('/api/climbs2/photo/')) {
    const qs     = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const token  = new URLSearchParams(qs).get('t');
    const user   = getSessionUser(token);
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const photoId = urlPath.slice('/api/climbs2/photo/'.length);
    if (!isValidId(photoId)) return jsonRes(res, 400, { error: 'Invalid id' });
    const file = cv2PhotoFile(user.id, photoId);
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Photo not found' });
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length,
                         'Cache-Control': 'private, max-age=86400' });
    return res.end(data);
  }

  // GET /api/climbs2
  if (req.method === 'GET' && urlPath === '/api/climbs2') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    return jsonRes(res, 200, {
      climbs:   cv2ReadAllClimbs(user.id),
      sessions: cv2ReadSessions(user.id),
    });
  }

  // POST /api/climbs2/photo/:id
  if (req.method === 'POST' && urlPath.startsWith('/api/climbs2/photo/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const photoId = urlPath.slice('/api/climbs2/photo/'.length);
    if (!isValidId(photoId)) return jsonRes(res, 400, { error: 'Invalid id' });
    cv2EnsureDirs(user.id);
    const body = await parseBody(req);
    const b64  = (body.photo || '').replace(/^data:image\/\w+;base64,/, '');
    if (!b64) return jsonRes(res, 400, { error: 'No photo data' });
    const buf  = Buffer.from(b64, 'base64');
    const tmp  = cv2PhotoFile(user.id, photoId) + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, cv2PhotoFile(user.id, photoId));
    return jsonRes(res, 200, { ok: true });
  }

  // POST /api/climbs2  — upsert climbs, delete climbs, sync sessions
  if (req.method === 'POST' && urlPath === '/api/climbs2') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    cv2EnsureDirs(user.id);
    const body = await parseBody(req);

    let saved = 0, skipped = 0, deleted = 0;

    // Upsert climbs. Each climb is its own atomically-written file, so a bad
    // record can never corrupt or drop the others — isolate every write.
    if (Array.isArray(body.climbs)) {
      for (const c of body.climbs) {
        if (!c || !c.id || !isValidId(c.id)) { skipped++; continue; }
        try {
          const dest = cv2ClimbFile(user.id, c.id);
          const tmp  = dest + '.tmp';
          fs.writeFileSync(tmp, cv2Serialize(c));
          fs.renameSync(tmp, dest);
          saved++;
        } catch (err) {
          skipped++;
          console.error('climbs2 upsert failed for', c.id, err.message);
        }
      }
    }
    // Delete climbs (explicit, id-validated only)
    if (Array.isArray(body.deletedClimbIds)) {
      for (const id of body.deletedClimbIds) {
        if (!isValidId(id)) continue;
        try { fs.unlinkSync(cv2ClimbFile(user.id, id)); } catch {}
        try { fs.unlinkSync(cv2PhotoFile(user.id, id)); } catch {}
        deleted++;
      }
    }
    // Sync sessions via merge-by-id (upsert), never wholesale replace. The app
    // has no delete-session action, so merging means a stale or second device
    // can update/add sessions but can never silently drop ones it didn't send.
    if (Array.isArray(body.sessions)) {
      const existing = cv2ReadSessions(user.id);
      const byId = new Map();
      for (const s of existing) { if (s && s.id) byId.set(s.id, s); }
      for (const s of body.sessions) {
        if (!s || !s.id) continue;
        byId.set(s.id, { ...(byId.get(s.id) || {}), ...s });
      }
      const merged = Array.from(byId.values())
        .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
      cv2WriteSessions(user.id, merged);
    }
    return jsonRes(res, 200, { ok: true, saved, skipped, deleted });
  }

  // DELETE /api/climbs2/photo/:id
  if (req.method === 'DELETE' && urlPath.startsWith('/api/climbs2/photo/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const photoId = urlPath.slice('/api/climbs2/photo/'.length);
    if (!isValidId(photoId)) return jsonRes(res, 400, { error: 'Invalid id' });
    try { fs.unlinkSync(cv2PhotoFile(user.id, photoId)); } catch {}
    return jsonRes(res, 200, { ok: true });
  }

  // ── Quizzes ────────────────────────────────────────────────────────────────

  // GET /api/quizzes  — list all quizzes (metadata only, no questions)
  if (req.method === 'GET' && urlPath === '/api/quizzes') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const list = readAllQuizzes(user.id).map(({ questions, ...meta }) => ({
      ...meta,
      questionCount: Array.isArray(questions) ? questions.length : 0,
    }));
    return jsonRes(res, 200, list);
  }

  // GET /api/quizzes/:id  — full quiz with questions
  if (req.method === 'GET' && urlPath.startsWith('/api/quizzes/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const quizId = urlPath.slice('/api/quizzes/'.length);
    if (!isValidId(quizId)) return jsonRes(res, 400, { error: 'Invalid quiz ID' });
    const file = quizFile(user.id, quizId);
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Quiz not found' });
    try { return jsonRes(res, 200, JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { return jsonRes(res, 500, { error: 'Failed to read quiz' }); }
  }

  // POST /api/quizzes  — create quiz
  if (req.method === 'POST' && urlPath === '/api/quizzes') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const body = await parseBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return jsonRes(res, 400, { error: 'Invalid data' });
    ensureQuizzesDir(user.id);
    if (readAllQuizzes(user.id).length >= MAX_QUIZZES)
      return jsonRes(res, 429, { error: `Quiz limit reached (${MAX_QUIZZES}). Delete a quiz first.` });
    const now = new Date().toISOString();
    const { title, questions } = sanitizeQuiz(body);
    const quiz = { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now, questions };
    atomicWrite(quizFile(user.id, quiz.id), quiz);
    const { questions: qs, ...meta } = quiz;
    return jsonRes(res, 200, { ...meta, questionCount: qs.length });
  }

  // PUT /api/quizzes/:id  — update quiz
  if (req.method === 'PUT' && urlPath.startsWith('/api/quizzes/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const quizId = urlPath.slice('/api/quizzes/'.length);
    if (!isValidId(quizId)) return jsonRes(res, 400, { error: 'Invalid quiz ID' });
    const file = quizFile(user.id, quizId);
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Quiz not found' });
    const body = await parseBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return jsonRes(res, 400, { error: 'Invalid data' });
    let existing;
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return jsonRes(res, 500, { error: 'Failed to read quiz' }); }
    const { title, questions } = sanitizeQuiz(body);
    const updated = { ...existing, title, questions, updatedAt: new Date().toISOString() };
    atomicWrite(file, updated);
    const { questions: qs, ...meta } = updated;
    return jsonRes(res, 200, { ...meta, questionCount: qs.length });
  }

  // DELETE /api/quizzes/:id
  if (req.method === 'DELETE' && urlPath.startsWith('/api/quizzes/')) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const quizId = urlPath.slice('/api/quizzes/'.length);
    if (!isValidId(quizId)) return jsonRes(res, 400, { error: 'Invalid quiz ID' });
    const file = quizFile(user.id, quizId);
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Quiz not found' });
    fs.unlinkSync(file);
    return jsonRes(res, 200, { ok: true });
  }

  // ── Shared Lists ─────────────────────────────────────────────────────────

  // GET /api/users/lookup?username=...
  if (req.method === 'GET' && urlPath === '/api/users/lookup') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const username = new URLSearchParams(qs).get('username');
    if (!username) return jsonRes(res, 400, { error: 'username required' });
    const found = readUsers().find(u => u.username.toLowerCase() === String(username).toLowerCase().trim());
    if (!found) return jsonRes(res, 404, { error: 'User not found' });
    if (found.id === user.id) return jsonRes(res, 400, { error: 'Cannot add yourself' });
    return jsonRes(res, 200, { id: found.id, username: found.username });
  }

  // GET /api/shared-lists
  if (req.method === 'GET' && urlPath === '/api/shared-lists') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const lists = [];
    try {
      for (const f of fs.readdirSync(SHARED_LISTS_DIR)) {
        if (!f.endsWith('.json')) continue;
        try {
          const l = JSON.parse(fs.readFileSync(path.join(SHARED_LISTS_DIR, f), 'utf8'));
          if (l && Array.isArray(l.members) && l.members.includes(user.id)) lists.push(l);
        } catch {}
      }
    } catch {}
    return jsonRes(res, 200, lists);
  }

  // POST /api/shared-lists  — create
  if (req.method === 'POST' && urlPath === '/api/shared-lists') {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const body = await parseBody(req);
    if (!body || typeof body.name !== 'string' || !body.name.trim())
      return jsonRes(res, 400, { error: 'name required' });

    const members = [user.id];
    const memberUsernames = { [user.id]: user.username };

    if (Array.isArray(body.memberUsernames)) {
      const allUsers = readUsers();
      for (const uname of body.memberUsernames) {
        if (typeof uname !== 'string') continue;
        const found = allUsers.find(u => u.username.toLowerCase() === uname.toLowerCase().trim());
        if (found && !members.includes(found.id)) {
          members.push(found.id);
          memberUsernames[found.id] = found.username;
        }
      }
    }

    const now = new Date().toISOString();
    const list = {
      id: crypto.randomUUID(),
      ownerId: user.id,
      members,
      memberUsernames,
      name: body.name.trim().slice(0, 60),
      emoji: typeof body.emoji === 'string' ? body.emoji : '📋',
      color: typeof body.color === 'string' ? body.color : 'none',
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      filter: 'active',
      sortBy: 'manual',
      items: [],
    };
    writeSharedList(list.id, list);
    return jsonRes(res, 200, list);
  }

  // GET /api/shared-lists/:id/events  — SSE (must be before GET /:id)
  if (req.method === 'GET' && /^\/api\/shared-lists\/[^/]+\/events$/.test(urlPath)) {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const token = new URLSearchParams(qs).get('t') || getToken(req);
    const user = getSessionUser(token);
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const listId = urlPath.slice('/api/shared-lists/'.length).replace('/events', '');
    if (!isValidId(listId)) return jsonRes(res, 400, { error: 'Invalid id' });
    const list = readSharedList(listId);
    if (!list || !list.members.includes(user.id)) return jsonRes(res, 403, { error: 'Forbidden' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':\n\n');

    const client = { res, userId: user.id };
    if (!sseClients.has(listId)) sseClients.set(listId, new Set());
    sseClients.get(listId).add(client);

    const ping = setInterval(() => {
      try { res.write(':\n\n'); } catch { clearInterval(ping); }
    }, 25000);

    req.on('close', () => {
      clearInterval(ping);
      const clients = sseClients.get(listId);
      if (clients) {
        clients.delete(client);
        if (!clients.size) sseClients.delete(listId);
      }
    });
    return;
  }

  // GET /api/shared-lists/:id
  if (req.method === 'GET' && /^\/api\/shared-lists\/[^/]+$/.test(urlPath)) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const listId = urlPath.slice('/api/shared-lists/'.length);
    if (!isValidId(listId)) return jsonRes(res, 400, { error: 'Invalid id' });
    const list = readSharedList(listId);
    if (!list || !list.members.includes(user.id)) return jsonRes(res, 404, { error: 'Not found' });
    return jsonRes(res, 200, list);
  }

  // POST /api/shared-lists/:id  — update
  if (req.method === 'POST' && /^\/api\/shared-lists\/[^/]+$/.test(urlPath)) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const listId = urlPath.slice('/api/shared-lists/'.length);
    if (!isValidId(listId)) return jsonRes(res, 400, { error: 'Invalid id' });
    const existing = readSharedList(listId);
    if (!existing || !existing.members.includes(user.id)) return jsonRes(res, 403, { error: 'Forbidden' });
    const body = await parseBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return jsonRes(res, 400, { error: 'Invalid data' });
    const updated = {
      ...existing,
      name:    typeof body.name    === 'string'  ? body.name.trim().slice(0, 60) : existing.name,
      emoji:   typeof body.emoji   === 'string'  ? body.emoji   : existing.emoji,
      color:   typeof body.color   === 'string'  ? body.color   : existing.color,
      pinned:  typeof body.pinned  === 'boolean' ? body.pinned  : existing.pinned,
      archived:typeof body.archived=== 'boolean' ? body.archived: existing.archived,
      filter:  typeof body.filter  === 'string'  ? body.filter  : existing.filter,
      sortBy:  typeof body.sortBy  === 'string'  ? body.sortBy  : existing.sortBy,
      items:   Array.isArray(body.items)          ? body.items   : existing.items,
      updatedAt: new Date().toISOString(),
    };
    writeSharedList(listId, updated);
    broadcastSharedList(listId, updated);
    return jsonRes(res, 200, updated);
  }

  // DELETE /api/shared-lists/:id  — owner deletes, member leaves
  if (req.method === 'DELETE' && /^\/api\/shared-lists\/[^/]+$/.test(urlPath)) {
    const user = getSessionUser(getToken(req));
    if (!user) return jsonRes(res, 401, { error: 'Not authenticated' });
    const listId = urlPath.slice('/api/shared-lists/'.length);
    if (!isValidId(listId)) return jsonRes(res, 400, { error: 'Invalid id' });
    const existing = readSharedList(listId);
    if (!existing || !existing.members.includes(user.id)) return jsonRes(res, 403, { error: 'Forbidden' });
    if (existing.ownerId === user.id) {
      try { fs.unlinkSync(sharedListFile(listId)); } catch {}
      broadcastSharedList(listId, null); // null signals deletion
    } else {
      const updated = {
        ...existing,
        members: existing.members.filter(id => id !== user.id),
        updatedAt: new Date().toISOString(),
      };
      delete updated.memberUsernames[user.id];
      writeSharedList(listId, updated);
      broadcastSharedList(listId, updated);
    }
    return jsonRes(res, 200, { ok: true });
  }

  jsonRes(res, 404, { error: 'API route not found' });
}

// ── Static file server ────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mp3':  'audio/mpeg',
};

function buildAutoIndex(dir, urlPath) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders = entries.filter(e => e.isDirectory());
  const files   = entries.filter(e => !e.isDirectory());

  const folderLinks = folders.map(f =>
    `<li><a href="${urlPath}${f.name}/">${f.name}/</a></li>`
  ).join('\n');

  const fileLinks = files.map(f =>
    `<li><a href="${urlPath}${f.name}">${f.name}</a></li>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>My Apps Server</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0f0f0f; color: #eee; min-height: 100vh; padding: 40px 20px; }
  h1 { font-size: 2rem; margin-bottom: 8px; color: #fff; }
  p.sub { color: #888; margin-bottom: 32px; }
  h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 1px;
       color: #555; margin-bottom: 12px; }
  ul { list-style: none; margin-bottom: 32px; }
  li { margin-bottom: 8px; }
  a { color: #4f9eff; text-decoration: none; font-size: 1.1rem;
      padding: 10px 16px; display: inline-block; border-radius: 8px;
      background: #1a1a1a; transition: background .2s; }
  a:hover { background: #252525; color: #7fb8ff; }
  .empty { color: #555; font-style: italic; }
</style>
</head>
<body>
<h1>My Apps</h1>
<p class="sub">Drop folders into <code>C:\\SERVER\\apps\\</code> to add apps.</p>
${folders.length ? `<h2>Apps</h2><ul>${folderLinks}</ul>` : ''}
${files.length   ? `<h2>Files</h2><ul>${fileLinks}</ul>`   : ''}
${!folders.length && !files.length ? '<p class="empty">No apps yet. Add folders to C:\\SERVER\\apps\\</p>' : ''}
</body>
</html>`;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;

  if (urlPath === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
    res.end();
    return;
  }

  if (urlPath.startsWith('/api/')) {
    await handleAPI(req, res, urlPath);
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    return;
  }

  let filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const indexFile = path.join(filePath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
        res.end(fs.readFileSync(indexFile));
      } else {
        const listing = buildAutoIndex(filePath, urlPath.endsWith('/') ? urlPath : urlPath + '/');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(listing);
      }
    } else {
      const ext  = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const hdrs = { 'Content-Type': mime };
      if (ext === '.html' || ext === '.js' || ext === '.css') hdrs['Cache-Control'] = 'no-cache';
      res.writeHead(200, hdrs);
      res.end(fs.readFileSync(filePath));
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px;background:#0a0a0a;color:#ededed">
      <h1>404 — Not Found</h1><p style="color:#9a9a9a">${urlPath}</p>
      <a href="/" style="color:#ff453a">← Home</a></body></html>`);
  }

  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
});

// ── WebSocket terminal ────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req, user, cols, rows) => {
  const sessionId = crypto.randomUUID();

  // Fork an isolated child process for the PTY.
  // If the native PTY code crashes, only the child dies — not the server.
  const worker = fork(path.join(__dirname, 'pty-worker.js'));
  worker.send({ type: 'start', cols: cols || 220, rows: rows || 50 });

  termSessions.set(sessionId, { ws, worker, userId: user.id });
  console.log(`[terminal] opened for ${user.username} (${sessionId})`);

  const keepAlive = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping(); }, 30000);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(keepAlive);
    termSessions.delete(sessionId);
    try { worker.send({ type: 'kill' }); } catch {}
    try { worker.kill(); } catch {}
    try { ws.close(); } catch {}
  };

  worker.on('message', msg => {
    if (msg.type === 'data') {
      try { if (ws.readyState === ws.OPEN) ws.send(msg.data); } catch {}
    } else if (msg.type === 'exit' || msg.type === 'error') {
      cleanup();
    }
  });

  worker.on('exit', cleanup);
  worker.on('error', cleanup);

  ws.on('message', raw => {
    try {
      const obj = JSON.parse(raw.toString());
      if (obj.type === 'resize') { worker.send({ type: 'resize', cols: obj.cols, rows: obj.rows }); return; }
    } catch {}
    try { worker.send({ type: 'input', data: raw.toString() }); } catch {}
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/terminal/ws') { socket.destroy(); return; }

  const token = url.searchParams.get('t');
  const user  = getSessionUser(token);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (user.username.toLowerCase() !== 'yannick') {
    socket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (termSessions.size >= 5) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const params = url.searchParams;
  const cols = parseInt(params.get('cols'), 10) || 220;
  const rows = parseInt(params.get('rows'), 10) || 50;
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, user, cols, rows));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n Server running at http://localhost:${PORT}`);
  console.log(` Apps folder: C:\\SERVER\\apps\\`);
  console.log(` Data folder: C:\\SERVER\\data\\\n`);
  assignmentCoach.startScheduler();
  startLightsScheduler();
  emailCampaigns.startCampaignScheduler();
});

server.on('error', err => {
  if (err.code === 'EACCES')    console.error('\n ERROR: Port requires admin rights.\n');
  else if (err.code === 'EADDRINUSE') console.error('\n ERROR: Port already in use.\n');
  else console.error(err);
  process.exit(1);
});

process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err.stack || err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
