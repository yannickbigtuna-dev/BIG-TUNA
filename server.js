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
const USERS_FILE    = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const LIGHTS_STATE_FILE = path.join(LIGHTS_DIR, 'state.json');
const LIGHTS_DEVICE_STATUS_FILE = path.join(LIGHTS_DIR, 'device-status.json');
const LIGHTS_DEVICE_POLL_MS = 250;

// ── Boot: ensure directories and files exist ──────────────────────────────────
for (const dir of [DATA, CLIMBS_DIR, SETTINGS_DIR, APPDATA_DIR, MEETS_DIR, CLIMBV2_DIR, QUIZZES_DIR, SHARED_LISTS_DIR, LIGHTS_DIR])
  fs.mkdirSync(dir, { recursive: true });

if (!fs.existsSync(USERS_FILE))    fs.writeFileSync(USERS_FILE,    '[]');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]');
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

// ── Input validation ──────────────────────────────────────────────────────────
// appId comes from URL — validate before using as a filename component
function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

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

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
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
    const { on, updatedAt } = readLightsState();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    return res.end(JSON.stringify({ on, updatedAt, pollAfterMs: LIGHTS_DEVICE_POLL_MS }));
  }

  // POST /api/lights/device/status - optional relay heartbeat/status
  if (req.method === 'POST' && urlPath === '/api/lights/device/status') {
    const body = await parseBody(req);
    if (!body || typeof body.on !== 'boolean') {
      return jsonRes(res, 400, { error: 'on must be boolean' });
    }

    const status = {
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
    return jsonRes(res, 200, { token, username: user.username, id: user.id });
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
    return jsonRes(res, 200, { token, username: user.username, id: user.id });
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
    return jsonRes(res, 200, { username: user.username, id: user.id });
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

    // Upsert climbs
    if (Array.isArray(body.climbs)) {
      for (const c of body.climbs) {
        if (!c.id || !isValidId(c.id)) continue;
        const tmp = cv2ClimbFile(user.id, c.id) + '.tmp';
        fs.writeFileSync(tmp, cv2Serialize(c));
        fs.renameSync(tmp, cv2ClimbFile(user.id, c.id));
      }
    }
    // Delete climbs
    if (Array.isArray(body.deletedClimbIds)) {
      for (const id of body.deletedClimbIds) {
        if (!isValidId(id)) continue;
        try { fs.unlinkSync(cv2ClimbFile(user.id, id)); } catch {}
        try { fs.unlinkSync(cv2PhotoFile(user.id, id)); } catch {}
      }
    }
    // Sync sessions
    if (Array.isArray(body.sessions)) {
      cv2WriteSessions(user.id, body.sessions);
    }
    return jsonRes(res, 200, { ok: true });
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
      if (ext === '.html' || ext === '.js') hdrs['Cache-Control'] = 'no-cache';
      res.writeHead(200, hdrs);
      res.end(fs.readFileSync(filePath));
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#0f0f0f;color:#eee">
      <h1>404 — Not Found</h1><p>${urlPath}</p>
      <a href="/" style="color:#4f9eff">← Home</a></body></html>`);
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
