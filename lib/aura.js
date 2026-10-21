'use strict';

// AURA backend: pairing, counters, widgets, canvas inbox, scheduled notes.
// Pure Node stdlib. Everything it needs from the host server is injected.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREFIX = '/api/aura/v1';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
const DEVICE_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SIZES = ['small', 'medium', 'large'];
const KINDS = ['doodle', 'photo'];
const SOUNDS = { standard: 'default', none: null, chime: 'chime.caf', heartbeat: 'heartbeat.caf', kiss: 'kiss.caf' };
const INTERRUPTIONS = { passive: 'passive', active: 'active', timeSensitive: 'time-sensitive' };
const DAY = 24 * 3600_000;
const INVITE_TTL = 7 * DAY;
const SCHEDULER_INTERVAL = 20_000;
const MAX_LATE = DAY;
const RETRY_WINDOW = 6 * 3600_000;                 // keep trying an undelivered note this long
const RETRY_DELAYS = [15_000, 30_000, 60_000, 120_000, 300_000];
const RESPOND_WITHIN = 4000;                        // push delivery continues after this
const DEFAULT_BUNDLE = 'ca.yannickmorgans.aura';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function isoNow(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function parseDate(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function isJpeg(b) { return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; }
function isPng(b) { return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); }
function imageType(b) { return isJpeg(b) ? 'image/jpeg' : isPng(b) ? 'image/png' : null; }
function str(v) { return typeof v === 'string' ? v : ''; }

function createAura({ dataDir, getSessionUser, touchSession = null, readUsers, apns = null, now = () => Date.now(), logger = console, debounceMs = 5000, schedulerIntervalMs = SCHEDULER_INTERVAL } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const root = dataDir;
  const bundle = (apns && apns.bundleId) || DEFAULT_BUNDLE;
  const cipher = apns && apns.cipher;
  const warn = (...a) => { if (logger && typeof logger.warn === 'function') logger.warn('[aura]', ...a); };

  // ── filesystem helpers ──────────────────────────────────────────────────
  const p = (...parts) => path.join(root, ...parts);
  function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }
  function writeAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }
  function writeJson(file, value) { writeAtomic(file, JSON.stringify(value)); }
  function rm(target) { fs.rmSync(target, { recursive: true, force: true }); }

  // Serialize every mutation so concurrent requests cannot interleave.
  let chain = Promise.resolve();
  function locked(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }

  // ── rate limiting (in memory) ───────────────────────────────────────────
  const hits = new Map();
  function rateLimited(key, limit, windowMs) {
    const t = now();
    const list = (hits.get(key) || []).filter(x => t - x < windowMs);
    if (list.length >= limit) { hits.set(key, list); return true; }
    list.push(t);
    hits.set(key, list);
    return false;
  }

  // ── users / pairs ───────────────────────────────────────────────────────
  const userFile = id => p('users', `${id}.json`);
  const pairFile = id => p('pairs', `${id}.json`);
  function loadUser(id) {
    if (!ID_RE.test(id)) return null;
    const existing = readJson(userFile(id), null);
    if (existing) return existing;
    const account = (readUsers() || []).find(u => u && u.id === id);
    if (!account) return null;
    return { id, displayName: String(account.username || 'AURA').slice(0, 40), avatarVersion: 0, pairId: null, devices: [], widgets: { list: [], reportedAt: null } };
  }
  function ensureUser(sessionUser) {
    const existing = readJson(userFile(sessionUser.id), null);
    if (existing) return existing;
    const created = { id: sessionUser.id, displayName: String(sessionUser.username || 'AURA').slice(0, 40) || 'AURA', avatarVersion: 0, pairId: null, devices: [], widgets: { list: [], reportedAt: null } };
    writeJson(userFile(created.id), created);
    return created;
  }
  const saveUser = u => writeJson(userFile(u.id), u);
  const profile = u => ({ id: u.id, displayName: u.displayName, avatarVersion: u.avatarVersion || 0 });

  function pairContext(user) {
    if (!user.pairId || !ID_RE.test(user.pairId)) return null;
    const pair = readJson(pairFile(user.pairId), null);
    if (!pair || !Array.isArray(pair.members) || !pair.members.includes(user.id)) return null;
    const partnerId = pair.members.find(m => m !== user.id);
    const partner = loadUser(partnerId);
    if (!partner) return null;
    return { pair, partner };
  }
  function requirePair(user) {
    const ctx = pairContext(user);
    if (!ctx) throw new HttpError(409, 'not_paired');
    return ctx;
  }
  function meBody(user) {
    const ctx = pairContext(user);
    return { user: profile(user), partner: ctx ? profile(ctx.partner) : null, pairedAt: ctx ? ctx.pair.createdAt : null };
  }

  // Every device's widgets, de-duplicated. Accounts reported before per-device
  // reports existed fall back to their single list.
  function mergedWidgets(u) {
    const reports = u.widgetDevices && Object.keys(u.widgetDevices).length ? Object.values(u.widgetDevices) : [u.widgets || {}];
    const seen = new Set();
    const widgets = [];
    let reportedAt = null;
    for (const r of reports) {
      if (r.reportedAt && (!reportedAt || r.reportedAt > reportedAt)) reportedAt = r.reportedAt;
      for (const w of Array.isArray(r.list) ? r.list : []) {
        const key = JSON.stringify([w.kind, w.family, w.counterId || null, w.style || null]);
        if (!seen.has(key)) { seen.add(key); widgets.push(w); }
      }
    }
    return { widgets, reportedAt };
  }
  function removeDevicesElsewhere(ownerId, ids) {
    let names = [];
    try { names = fs.readdirSync(p('users')); } catch { return; }
    for (const name of names) {
      if (!name.endsWith('.json') || name === `${ownerId}.json`) continue;
      const other = readJson(p('users', name), null);
      if (!other || !Array.isArray(other.devices) || !other.devices.some(d => ids.includes(d.id))) continue;
      other.devices = other.devices.filter(d => !ids.includes(d.id));
      saveUser(other);
    }
  }

  // ── http helpers ────────────────────────────────────────────────────────
  function send(res, status, body, extraHeaders) {
    if (res.headersSent) return;
    const data = Buffer.from(JSON.stringify(body === undefined ? {} : body));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': data.length, ...(extraHeaders || {}) });
    res.end(data);
  }
  function sendBytes(res, contentType, bytes) {
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'Content-Length': bytes.length });
    res.end(bytes);
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > limit) { tooLarge = true; chunks.length = 0; return; }  // keep draining
        if (!tooLarge) chunks.push(chunk);
      });
      req.on('end', () => (tooLarge ? reject(new HttpError(413, 'Payload too large')) : resolve(Buffer.concat(chunks))));
      req.on('error', () => reject(new HttpError(400, 'Request failed')));
    });
  }
  async function readJsonBody(req, limit = 64 * 1024) {
    const buf = await readBody(req, limit);
    if (!buf.length) return {};
    try {
      const v = JSON.parse(buf.toString('utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape');
      return v;
    } catch { throw new HttpError(400, 'Invalid JSON body'); }
  }
  function clientIp(req) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || 'unknown';
  }
  function checkId(value) {
    if (!ID_RE.test(value || '')) throw new HttpError(400, 'Invalid id');
    return value;
  }
  function getBearer(req) {
    const auth = req.headers['authorization'] || '';
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  }

  // ── push helpers ────────────────────────────────────────────────────────
  async function pushToDevices(userId, channel, build) {
    if (!apns || typeof apns.send !== 'function' || !cipher || !cipher.configured) return [];
    const user = readJson(userFile(userId), null);
    if (!user) return [];
    const devices = (user.devices || []).filter(d => d.channel === channel);
    const dead = [];
    const results = await Promise.all(devices.map(async d => {
      let result;
      try {
        const token = cipher.decrypt(d.tokenEnc);
        result = await apns.send({ token, environment: d.environment, ...build(d) });
      } catch (error) { warn('push failed', error && error.message); result = { delivery: 'failed', reason: 'error' }; }
      if (result && result.reason === 'invalid_token') dead.push(d.id);
      return result;
    }));
    if (dead.length) {
      await locked(() => {
        const fresh = readJson(userFile(userId), null);
        if (!fresh) return;
        fresh.devices = (fresh.devices || []).filter(d => !dead.includes(d.id));
        saveUser(fresh);
      });
    }
    return results;
  }
  const widgetState = new Map();
  function sendWidgetsPush(recipientId) {
    return pushToDevices(recipientId, 'widgets', () => ({
      pushType: 'widgets', topic: `${bundle}.push-type.widgets`, priority: 10, payload: { aps: { 'content-changed': true } },
    }));
  }
  function pushWidgetsDebounced(recipientId) {
    const state = widgetState.get(recipientId) || { lastAt: -Infinity, timer: null };
    widgetState.set(recipientId, state);
    const t = now();
    if (debounceMs <= 0 || t - state.lastAt >= debounceMs) {
      state.lastAt = t;
      return sendWidgetsPush(recipientId);
    }
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        state.lastAt = now();
        sendWidgetsPush(recipientId).catch(() => {});
      }, Math.max(1, state.lastAt + debounceMs - t));
      if (state.timer.unref) state.timer.unref();
    }
    return Promise.resolve([]);
  }
  // The partner gets a visible "sent you a doodle/photo" alert; its notification
  // service extension attaches the image and reloads the widgets. Widgets also
  // get their own WidgetKit push.
  function pushCanvas(recipientId, kind, size, senderName) {
    const what = kind === 'photo' ? 'a photo' : 'a doodle';
    return Promise.all([
      pushWidgetsDebounced(recipientId),
      pushToDevices(recipientId, 'app', () => ({
        pushType: 'alert', topic: bundle, priority: 10,
        payload: {
          aps: { alert: { title: senderName || 'AURA', body: `Sent you ${what} 💙` }, sound: 'default', 'content-available': 1, 'mutable-content': 1, 'thread-id': `canvas-${kind}` },
          aura: { kind, size },
        },
      })),
    ]).catch(error => warn('canvas push error', error && error.message));
  }

  function notePayload(note, senderName, pairId) {
    const d = note.draft;
    const aps = { alert: { title: d.title || senderName, subtitle: d.subtitle, body: d.body } };
    const sound = SOUNDS[d.sound];
    if (sound) aps.sound = sound;
    aps['interruption-level'] = INTERRUPTIONS[d.interruption] || 'active';
    if (Number.isInteger(d.badge)) aps.badge = d.badge;
    aps['thread-id'] = pairId;
    aps['mutable-content'] = 1;
    const aura = { noteId: note.id };
    if (d.imageId) aura.imageId = d.imageId;
    return { aps, aura };
  }
  // Returns 'sent' if at least one device accepted the push, else 'retry'
  // (no device yet, or APNs unreachable) — the scheduler keeps trying.
  async function deliverNote(note) {
    const sender = loadUser(note.fromUserId);
    const results = await pushToDevices(note.toUserId, 'app', () => ({
      pushType: 'alert', topic: bundle, priority: note.draft.interruption === 'passive' ? 5 : 10,
      payload: notePayload(note, sender ? sender.displayName : 'AURA', note.pairId),
    }));
    return results.some(r => r && r.delivery === 'sent') ? 'sent' : 'retry';
  }
  // Applies a delivery result. Undelivered notes become 'sending' and are
  // retried with backoff until RETRY_WINDOW after they were due.
  function settleNote(note, result) {
    const t = now();
    note.attempts = (note.attempts || 0) + 1;
    if (result === 'sent') {
      note.status = 'sent';
      note.deliveredAt = isoNow(t);
      delete note.retryAt;
      return;
    }
    const dueAt = parseDate(note.draft && note.draft.sendAt) || parseDate(note.createdAt) || t;
    if (result === 'failed' || t - dueAt > RETRY_WINDOW) {
      note.status = 'failed';
      note.deliveredAt = isoNow(t);
      delete note.retryAt;
      warn('note undelivered', note.id);
      return;
    }
    note.status = 'sending';
    note.retryAt = isoNow(t + RETRY_DELAYS[Math.min(note.attempts - 1, RETRY_DELAYS.length - 1)]);
  }

  // ── notes storage ───────────────────────────────────────────────────────
  const notesFile = pairId => p('notes', `${pairId}.json`);
  const readNotes = pairId => { const v = readJson(notesFile(pairId), []); return Array.isArray(v) ? v : []; };
  function writeNotes(pairId, notes) {
    const trimmed = notes.length > 200 ? notes.slice(-200) : notes;
    writeJson(notesFile(pairId), trimmed);
  }
  const publicNote = n => ({ id: n.id, draft: n.draft, status: n.status, createdAt: n.createdAt });
  const inFlight = new Set();

  function validateDraft(raw, pairId) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Invalid note');
    const title = raw.title == null ? '' : raw.title;
    const subtitle = raw.subtitle == null ? '' : raw.subtitle;
    const body = raw.body == null ? '' : raw.body;
    if (typeof title !== 'string' || typeof subtitle !== 'string' || typeof body !== 'string') throw new HttpError(400, 'Invalid note text');
    if (title.length > 100) throw new HttpError(400, 'Title too long');
    if (subtitle.length > 100) throw new HttpError(400, 'Subtitle too long');
    if (body.length > 1000) throw new HttpError(400, 'Body too long');
    if (!title.trim() && !body.trim()) throw new HttpError(400, 'A title or body is required');
    const sound = raw.sound == null ? 'standard' : raw.sound;
    if (typeof sound !== 'string' || !Object.prototype.hasOwnProperty.call(SOUNDS, sound)) throw new HttpError(400, 'Invalid sound');
    const interruption = raw.interruption == null ? 'active' : raw.interruption;
    if (typeof interruption !== 'string' || !Object.prototype.hasOwnProperty.call(INTERRUPTIONS, interruption)) throw new HttpError(400, 'Invalid interruption');
    const draft = { title, subtitle, body, sound, interruption };
    if (raw.badge != null) {
      if (!Number.isInteger(raw.badge) || raw.badge < 0 || raw.badge > 99) throw new HttpError(400, 'Invalid badge');
      draft.badge = raw.badge;
    }
    if (raw.imageId != null) {
      if (typeof raw.imageId !== 'string' || !ID_RE.test(raw.imageId)) throw new HttpError(400, 'Invalid imageId');
      if (!fs.existsSync(p('note-images', pairId, `${raw.imageId}.jpg`))) throw new HttpError(400, 'Unknown imageId');
      draft.imageId = raw.imageId;
    }
    let sendAtMs = null;
    if (raw.sendAt != null) {
      sendAtMs = parseDate(raw.sendAt);
      if (sendAtMs === null) throw new HttpError(400, 'Invalid sendAt');
      if (sendAtMs > now() + 366 * DAY) throw new HttpError(400, 'sendAt is too far ahead');
      draft.sendAt = isoNow(sendAtMs);
    }
    return { draft, sendAtMs };
  }

  // ── counters ────────────────────────────────────────────────────────────
  const countersFile = id => p('counters', `${id}.json`);
  const readCounters = id => { const v = readJson(countersFile(id), []); return Array.isArray(v) ? v : []; };
  function validateCounter(raw, id) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Invalid counter');
    if (raw.id !== id) throw new HttpError(400, 'Counter id mismatch');
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name.length < 1 || name.length > 60) throw new HttpError(400, 'Invalid name');
    const dateMs = parseDate(raw.date);
    if (dateMs === null) throw new HttpError(400, 'Invalid date');
    if (raw.mode !== 'until' && raw.mode !== 'since') throw new HttpError(400, 'Invalid mode');
    const emoji = raw.emoji == null ? '' : raw.emoji;
    if (typeof emoji !== 'string' || [...emoji].length > 16) throw new HttpError(400, 'Invalid emoji');
    let createdMs = now();
    if (raw.createdAt != null) {
      createdMs = parseDate(raw.createdAt);
      if (createdMs === null) throw new HttpError(400, 'Invalid createdAt');
    }
    return { id, name, date: isoNow(dateMs), mode: raw.mode, emoji, createdAt: isoNow(createdMs) };
  }

  // ── canvas inbox ────────────────────────────────────────────────────────
  const inboxBase = (recipientId, kind, size) => p('inbox', recipientId, `${kind}-${size}`);
  function readCanvasMeta(recipientId, kind, size) {
    return readJson(`${inboxBase(recipientId, kind, size)}.json`, null);
  }
  const canvasPublic = m => ({ kind: m.kind, size: m.size, version: m.version, sentAt: m.sentAt, fromName: m.fromName });
  function querySize(req, fallback) {
    const q = new URL(req.url, 'http://x').searchParams.get('size');
    if (q == null || q === '') { if (fallback) return fallback; throw new HttpError(400, 'size is required'); }
    if (!SIZES.includes(q)) throw new HttpError(400, 'Invalid size');
    return q;
  }

  // ── history (every canvas either member sent, per pair and kind) ─────────
  const HISTORY_MAX = 300;
  const historyIndex = (pairId, kind) => p('history', pairId, `${kind}.json`);
  const historyBin = (pairId, kind, id) => p('history', pairId, kind, `${id}.bin`);
  function readHistory(pairId, kind) {
    const v = readJson(historyIndex(pairId, kind), null);
    return Array.isArray(v) ? v : null;
  }
  function writeHistory(pairId, kind, list) {
    const extra = list.length - HISTORY_MAX;
    if (extra > 0) for (const old of list.splice(0, extra)) rm(historyBin(pairId, kind, old.id));
    writeJson(historyIndex(pairId, kind), list);
  }
  function appendHistory(pairId, kind, entry, buf) {
    const list = readHistory(pairId, kind) || seedHistory(pairId, kind);
    writeAtomic(historyBin(pairId, kind, entry.id), buf);
    list.push(entry);
    writeHistory(pairId, kind, list);
  }
  // First use: start from the latest canvases already sitting in both inboxes.
  function seedHistory(pairId, kind) {
    const pair = readJson(pairFile(pairId), null);
    const list = [];
    for (const recipient of (pair && pair.members) || []) {
      const sender = pair.members.find(m => m !== recipient);
      for (const size of SIZES) {
        const meta = readCanvasMeta(recipient, kind, size);
        let bytes;
        try { bytes = fs.readFileSync(`${inboxBase(recipient, kind, size)}.bin`); } catch { continue; }
        if (!meta) continue;
        const id = crypto.randomBytes(12).toString('hex');
        writeAtomic(historyBin(pairId, kind, id), bytes);
        list.push({ id, kind, size, sentAt: meta.sentAt, fromUserId: sender, contentType: meta.contentType || imageType(bytes) });
      }
    }
    list.sort((x, y) => (x.sentAt < y.sentAt ? -1 : x.sentAt > y.sentAt ? 1 : 0));
    writeHistory(pairId, kind, list);
    return list;
  }
  const byNewest = key => (x, y) => (x[key] < y[key] ? 1 : x[key] > y[key] ? -1 : 0);

  function cleanInvites(store) {
    const t = now();
    for (const [hash, inv] of Object.entries(store.byHash)) {
      if (inv.expiresAt + DAY < t || (inv.usedAt && inv.usedAt + DAY < t)) delete store.byHash[hash];
    }
  }
  const invitesFile = () => p('invites.json');
  function readInvites() {
    const v = readJson(invitesFile(), null);
    return v && typeof v === 'object' && v.byHash && typeof v.byHash === 'object' ? v : { byHash: {} };
  }

  // ── route handlers ──────────────────────────────────────────────────────
  async function route(req, res, segs, method, sessionUser) {
    const [a, b, c] = segs;
    const user = () => ensureUser(sessionUser);

    if (a === 'me' && segs.length === 1 && method === 'GET') return send(res, 200, meBody(user()));

    if (a === 'profile' && segs.length === 1 && method === 'PUT') {
      const body = await readJsonBody(req);
      const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (name.length < 1 || name.length > 40) throw new HttpError(400, 'displayName must be 1-40 characters');
      return send(res, 200, await locked(() => { const u = user(); u.displayName = name; saveUser(u); return profile(u); }));
    }

    if (a === 'profile' && b === 'avatar' && segs.length === 2 && method === 'PUT') {
      const buf = await readBody(req, 1024 * 1024);
      if (!imageType(buf)) throw new HttpError(400, 'Avatar must be a JPEG or PNG image');
      return send(res, 200, await locked(() => {
        const u = user();
        writeAtomic(p('avatars', `${u.id}.jpg`), buf);
        u.avatarVersion = (u.avatarVersion || 0) + 1;
        saveUser(u);
        return profile(u);
      }));
    }

    if (a === 'avatar' && segs.length === 2 && method === 'GET') {
      const target = checkId(b);
      const u = user();
      const ctx = pairContext(u);
      if (target !== u.id && !(ctx && ctx.partner.id === target)) throw new HttpError(404, 'Not found');
      let bytes;
      try { bytes = fs.readFileSync(p('avatars', `${target}.jpg`)); } catch { throw new HttpError(404, 'Not found'); }
      return sendBytes(res, imageType(bytes) || 'image/jpeg', bytes);
    }

    if (a === 'invites' && segs.length === 1 && method === 'POST') {
      return send(res, 200, await locked(() => {
        const u = user();
        if (pairContext(u)) throw new HttpError(409, 'already_paired');
        const store = readInvites();
        cleanInvites(store);
        for (const [hash, inv] of Object.entries(store.byHash)) if (inv.fromUserId === u.id && !inv.usedAt) delete store.byHash[hash];
        const token = crypto.randomBytes(32).toString('base64url');
        const t = now();
        store.byHash[sha256(token)] = { fromUserId: u.id, createdAt: t, expiresAt: t + INVITE_TTL, usedAt: null };
        writeJson(invitesFile(), store);
        return { url: `https://yannickmorgans.ca/aura/invite#token=${token}`, expiresAt: isoNow(t + INVITE_TTL) };
      }));
    }

    if (a === 'invites' && b === 'accept' && segs.length === 2 && method === 'POST') {
      const body = await readJsonBody(req);
      return send(res, 200, await locked(() => {
        const u = user();
        const token = str(body.token);
        const store = readInvites();
        const inv = TOKEN_RE.test(token) ? store.byHash[sha256(token)] : null;
        if (!inv || inv.usedAt || inv.expiresAt <= now()) throw new HttpError(404, 'Invitation is unavailable.');
        if (inv.fromUserId === u.id) throw new HttpError(400, 'You cannot accept your own invitation.');
        const inviter = loadUser(inv.fromUserId);
        if (!inviter) throw new HttpError(404, 'Invitation is unavailable.');
        if (pairContext(u) || pairContext(inviter)) throw new HttpError(409, 'already_paired');
        const pair = { id: crypto.randomBytes(12).toString('hex'), members: [inviter.id, u.id], createdAt: isoNow(now()) };
        writeJson(pairFile(pair.id), pair);
        inviter.pairId = pair.id; u.pairId = pair.id;
        saveUser(inviter); saveUser(u);
        inv.usedAt = now();
        writeJson(invitesFile(), store);
        return meBody(u);
      }));
    }

    if (a === 'pair' && segs.length === 1 && method === 'DELETE') {
      return send(res, 200, await locked(() => {
        const u = user();
        const ctx = pairContext(u);
        if (!ctx) {
          if (u.pairId) { u.pairId = null; saveUser(u); }
          return {};
        }
        const pairId = ctx.pair.id;
        for (const member of ctx.pair.members) {
          const m = member === u.id ? u : loadUser(member);
          if (m) { m.pairId = null; saveUser(m); }
          rm(p('inbox', member));
        }
        rm(pairFile(pairId));
        rm(notesFile(pairId));
        rm(p('note-images', pairId));
        rm(p('history', pairId));
        return {};
      }));
    }

    if (a === 'devices' && segs.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      if (!cipher || !cipher.configured) throw new HttpError(503, 'Device registration is unavailable');
      const token = str(body.token);
      if (!DEVICE_TOKEN_RE.test(token)) throw new HttpError(400, 'Invalid token');
      if (body.channel !== 'app' && body.channel !== 'widgets') throw new HttpError(400, 'Invalid channel');
      if (body.environment !== 'sandbox' && body.environment !== 'production') throw new HttpError(400, 'Invalid environment');
      const normalized = token.toLowerCase();
      return send(res, 200, await locked(() => {
        const u = user();
        const id = sha256(`${body.channel}:${normalized}`).slice(0, 32);
        const entry = { id, channel: body.channel, environment: body.environment, tokenEnc: cipher.encrypt(normalized), updatedAt: isoNow(now()) };
        // A push token belongs to one account: after switching accounts on a
        // device, the previous account must stop receiving its pushes.
        removeDevicesElsewhere(u.id, [id]);
        u.devices = (u.devices || []).filter(d => d.id !== id);
        u.devices.push(entry);
        if (u.devices.length > 10) u.devices = u.devices.slice(-10);
        saveUser(u);
        if (body.channel === 'app' && u.pairId && ID_RE.test(u.pairId)) {
          const notes = readNotes(u.pairId);
          let waiting = false;
          for (const n of notes) if (n.status === 'sending' && n.toUserId === u.id) { n.retryAt = isoNow(now()); waiting = true; }
          if (waiting) { writeNotes(u.pairId, notes); setImmediate(() => { tick().catch(() => {}); }); }
        }
        return {};
      }));
    }

    // Sign-out from one device: drop its push tokens and widget report so the
    // account's other devices keep working and this device gets nothing more.
    if (a === 'devices' && b === 'remove' && segs.length === 2 && method === 'POST') {
      const body = await readJsonBody(req);
      const tokens = Array.isArray(body.tokens) ? body.tokens.slice(0, 10).map(str).filter(t => DEVICE_TOKEN_RE.test(t)) : [];
      const ids = [];
      for (const t of tokens) for (const ch of ['app', 'widgets']) ids.push(sha256(`${ch}:${t.toLowerCase()}`).slice(0, 32));
      const installId = typeof body.installId === 'string' && ID_RE.test(body.installId) ? body.installId : null;
      return send(res, 200, await locked(() => {
        const u = user();
        u.devices = (u.devices || []).filter(d => !ids.includes(d.id));
        if (installId && u.widgetDevices) delete u.widgetDevices[installId];
        saveUser(u);
        return {};
      }));
    }

    if (a === 'counters' && segs.length === 1 && method === 'GET') return send(res, 200, readCounters(user().id));
    if (a === 'counters' && segs.length === 2 && (method === 'PUT' || method === 'DELETE')) {
      const id = checkId(b);
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const counter = validateCounter(body, id);
        return send(res, 200, await locked(() => {
          const u = user();
          const list = readCounters(u.id);
          const idx = list.findIndex(x => x.id === id);
          if (idx === -1 && list.length >= 100) throw new HttpError(400, 'Too many counters');
          if (idx === -1) list.push(counter); else list[idx] = counter;
          writeJson(countersFile(u.id), list);
          return counter;
        }));
      }
      return send(res, 200, await locked(() => {
        const u = user();
        writeJson(countersFile(u.id), readCounters(u.id).filter(x => x.id !== id));
        return {};
      }));
    }
    if (a === 'partner' && b === 'counters' && segs.length === 2 && method === 'GET') return send(res, 200, readCounters(requirePair(user()).partner.id));

    if (a === 'widgets' && segs.length === 1 && method === 'PUT') {
      const body = await readJsonBody(req, 256 * 1024);
      if (!Array.isArray(body.widgets) || body.widgets.length > 50) throw new HttpError(400, 'widgets must be an array of at most 50');
      const list = body.widgets.map(w => {
        if (!w || typeof w !== 'object' || Array.isArray(w)) throw new HttpError(400, 'Invalid widget');
        if (typeof w.kind !== 'string' || !w.kind || w.kind.length > 64) throw new HttpError(400, 'Invalid widget kind');
        if (typeof w.family !== 'string' || w.family.length > 32) throw new HttpError(400, 'Invalid widget family');
        const out = { kind: w.kind, family: w.family };
        if (w.counterId != null) { if (typeof w.counterId !== 'string' || !ID_RE.test(w.counterId)) throw new HttpError(400, 'Invalid counterId'); out.counterId = w.counterId; }
        if (w.style != null) { if (typeof w.style !== 'string' || w.style.length > 64) throw new HttpError(400, 'Invalid style'); out.style = w.style; }
        return out;
      });
      const installId = typeof body.installId === 'string' && ID_RE.test(body.installId) ? body.installId : 'default';
      return send(res, 200, await locked(() => {
        const u = user();
        const reportedAt = isoNow(now());
        // Each device reports its own widgets; one device must not erase another's.
        const byDevice = { ...(u.widgetDevices || {}), [installId]: { list, reportedAt } };
        u.widgetDevices = Object.fromEntries(Object.entries(byDevice)
          .sort((x, y) => String(y[1].reportedAt).localeCompare(String(x[1].reportedAt))).slice(0, 8));
        u.widgets = { list, reportedAt };
        saveUser(u);
        return {};
      }));
    }
    if (a === 'partner' && b === 'widgets' && segs.length === 2 && method === 'GET') {
      return send(res, 200, mergedWidgets(requirePair(user()).partner));
    }

    if (a === 'canvas' && segs.length === 2 && method === 'PUT') {
      if (!KINDS.includes(b)) throw new HttpError(400, 'Invalid kind');
      const size = querySize(req, 'medium');
      const buf = await readBody(req, 2 * 1024 * 1024);
      const type = imageType(buf);
      if (!type) throw new HttpError(400, 'Canvas must be a JPEG or PNG image');
      const u0 = user();
      const ctx0 = requirePair(u0);
      if (rateLimited(`canvas:${u0.id}`, 30, 3600_000)) throw new HttpError(429, 'Too many canvas updates');
      const meta = await locked(() => {
        const u = user();
        const ctx = requirePair(u);
        const prev = readCanvasMeta(ctx.partner.id, b, size);
        const m = { kind: b, size, version: (prev && Number.isInteger(prev.version) ? prev.version : 0) + 1, sentAt: isoNow(now()), fromName: u.displayName, contentType: type };
        const base = inboxBase(ctx.partner.id, b, size);
        writeAtomic(`${base}.bin`, buf);
        writeJson(`${base}.json`, m);
        appendHistory(ctx.pair.id, b, { id: crypto.randomBytes(12).toString('hex'), kind: b, size, sentAt: m.sentAt, fromUserId: u.id, contentType: type }, buf);
        return m;
      });
      await Promise.race([pushCanvas(ctx0.partner.id, b, size, meta.fromName),
        new Promise(r => { const tm = setTimeout(r, RESPOND_WITHIN); if (tm.unref) tm.unref(); })]);
      return send(res, 200, canvasPublic(meta));
    }

    if (a === 'inbox' && segs.length >= 2 && method === 'GET') {
      if (!KINDS.includes(b)) throw new HttpError(400, 'Invalid kind');
      const u = user();
      if (segs.length === 2) {
        return send(res, 200, SIZES.map(s => readCanvasMeta(u.id, b, s)).filter(Boolean).map(canvasPublic));
      }
      if (segs.length === 3 && c === 'image') {
        const size = querySize(req, null);
        const meta = readCanvasMeta(u.id, b, size);
        let bytes;
        try { bytes = fs.readFileSync(`${inboxBase(u.id, b, size)}.bin`); } catch { bytes = null; }
        if (!meta || !bytes) throw new HttpError(404, 'Not found');
        return sendBytes(res, meta.contentType || imageType(bytes) || 'application/octet-stream', bytes);
      }
    }

    if (a === 'history' && b === 'notes' && segs.length === 2 && method === 'GET') {
      const u = user();
      const ctx = pairContext(u);
      if (!ctx) return send(res, 200, []);
      const visible = readNotes(ctx.pair.id).filter(n => n.fromUserId === u.id ? n.status !== 'cancelled' : n.status === 'sent');
      const items = visible.map(n => ({ ...publicNote(n), fromMe: n.fromUserId === u.id, sentAt: n.deliveredAt || n.draft.sendAt || n.createdAt }));
      return send(res, 200, items.sort(byNewest('sentAt')));
    }
    if (a === 'history' && KINDS.includes(b) && method === 'GET' && (segs.length === 2 || (segs.length === 4 && segs[3] === 'image'))) {
      const u = user();
      const ctx = pairContext(u);
      if (!ctx) { if (segs.length === 2) return send(res, 200, []); throw new HttpError(404, 'Not found'); }
      const list = readHistory(ctx.pair.id, b) || await locked(() => readHistory(ctx.pair.id, b) || seedHistory(ctx.pair.id, b));
      if (segs.length === 2) {
        const names = { [u.id]: u.displayName, [ctx.partner.id]: ctx.partner.displayName };
        return send(res, 200, list.map(e => ({ id: e.id, kind: e.kind, size: e.size, sentAt: e.sentAt, fromMe: e.fromUserId === u.id, fromName: names[e.fromUserId] || null })).sort(byNewest('sentAt')));
      }
      const id = checkId(c);
      const entry = list.find(e => e.id === id);
      let bytes;
      try { bytes = entry && fs.readFileSync(historyBin(ctx.pair.id, b, id)); } catch { bytes = null; }
      if (!bytes) throw new HttpError(404, 'Not found');
      return sendBytes(res, entry.contentType || imageType(bytes) || 'application/octet-stream', bytes);
    }

    // POST per the contract; PUT is what the 1.0 (1) app build sends.
    if (a === 'notes' && b === 'images' && segs.length === 2 && (method === 'POST' || method === 'PUT')) {
      const buf = await readBody(req, 1024 * 1024);
      if (!isJpeg(buf)) throw new HttpError(400, 'Image must be a JPEG');
      const ctx = requirePair(user());
      const imageId = crypto.randomBytes(16).toString('hex');
      writeAtomic(p('note-images', ctx.pair.id, `${imageId}.jpg`), buf);
      return send(res, 200, { imageId });
    }
    if (a === 'notes' && b === 'images' && segs.length === 3 && method === 'GET') {
      const imageId = checkId(c);
      const ctx = requirePair(user());
      let bytes;
      try { bytes = fs.readFileSync(p('note-images', ctx.pair.id, `${imageId}.jpg`)); } catch { throw new HttpError(404, 'Not found'); }
      return sendBytes(res, 'image/jpeg', bytes);
    }

    if (a === 'notes' && segs.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      const u = user();
      const ctx = requirePair(u);
      const { draft, sendAtMs } = validateDraft(body, ctx.pair.id);
      if (rateLimited(`notes:${u.id}`, 60, 3600_000)) throw new HttpError(429, 'Too many notes');
      const t = now();
      const note = {
        id: crypto.randomBytes(12).toString('hex'), draft, status: 'scheduled', createdAt: isoNow(t),
        fromUserId: u.id, toUserId: ctx.partner.id, pairId: ctx.pair.id,
      };
      const immediate = sendAtMs === null || sendAtMs <= t + 5000;
      if (immediate) { note.status = 'sending'; note.retryAt = isoNow(t); inFlight.add(note.id); }
      await locked(() => { const notes = readNotes(ctx.pair.id); notes.push(note); writeNotes(ctx.pair.id, notes); });
      if (immediate) {
        // Deliver now; if APNs is slow (retries), answer within a few seconds and
        // let delivery finish in the background so the app never times out.
        const attempt = (async () => {
          let result;
          try { result = await deliverNote(note); } catch (error) { warn('note delivery failed', error && error.message); result = 'retry'; }
          await locked(() => {
            inFlight.delete(note.id);
            const notes = readNotes(ctx.pair.id);
            const stored = notes.find(n => n.id === note.id);
            if (!stored || stored.status === 'cancelled') return;
            settleNote(stored, result);
            writeNotes(ctx.pair.id, notes);
            note.status = stored.status;
          });
        })();
        await Promise.race([attempt, new Promise(r => { const tm = setTimeout(r, RESPOND_WITHIN); if (tm.unref) tm.unref(); })]);
      }
      return send(res, 201, publicNote(note));
    }
    if (a === 'notes' && segs.length === 1 && method === 'GET') {
      const u = user();
      const ctx = pairContext(u);
      if (!ctx) return send(res, 200, []);
      const mine = readNotes(ctx.pair.id).filter(n => n.fromUserId === u.id).sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0));
      return send(res, 200, mine.slice(0, 100).map(publicNote));
    }
    if (a === 'notes' && segs.length === 2 && method === 'DELETE') {
      const id = checkId(b);
      return send(res, 200, await locked(() => {
        const u = user();
        const ctx = requirePair(u);
        const notes = readNotes(ctx.pair.id);
        const note = notes.find(n => n.id === id);
        if (!note) throw new HttpError(404, 'Not found');
        if (note.fromUserId !== u.id) throw new HttpError(403, 'Only the sender can cancel a note');
        if ((note.status !== 'scheduled' && note.status !== 'sending') || inFlight.has(id)) throw new HttpError(409, 'Only scheduled notes can be cancelled');
        note.status = 'cancelled';
        writeNotes(ctx.pair.id, notes);
        return {};
      }));
    }

    throw new HttpError(404, 'Not found');
  }

  async function handle(req, res, urlPath) {
    if (typeof urlPath !== 'string' || !urlPath.startsWith(`${PREFIX}/`)) return false;
    try {
      const segs = urlPath.slice(PREFIX.length + 1).split('/').filter((s, i, arr) => !(s === '' && i === arr.length - 1));
      const method = req.method;

      if (segs.length === 2 && segs[0] === 'invites' && segs[1] === 'preview' && method === 'POST') {
        if (rateLimited(`preview:${clientIp(req)}`, 30, 60_000)) throw new HttpError(429, 'Too many requests');
        const body = await readJsonBody(req);
        const token = str(body.token);
        const inv = TOKEN_RE.test(token) ? readInvites().byHash[sha256(token)] : null;
        const from = inv && !inv.usedAt && inv.expiresAt > now() ? loadUser(inv.fromUserId) : null;
        if (!from) throw new HttpError(404, 'Invitation is unavailable.');
        send(res, 200, { fromName: from.displayName, expiresAt: isoNow(inv.expiresAt) });
        return true;
      }

      const token = getBearer(req);
      const sessionUser = token ? getSessionUser(token) : null;
      if (!sessionUser || !sessionUser.id || !ID_RE.test(String(sessionUser.id))) throw new HttpError(401, 'Authentication required');
      if (touchSession) { try { touchSession(token); } catch (error) { warn('session renew failed', error && error.message); } }
      await route(req, res, segs, method, sessionUser);
    } catch (error) {
      if (error instanceof HttpError) send(res, error.status, { error: error.message });
      else { warn('request failed', error && error.message); send(res, 500, { error: 'Internal error' }); }
    }
    return true;
  }

  // ── scheduler ───────────────────────────────────────────────────────────
  let timer = null;
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      let files = [];
      try { files = fs.readdirSync(p('notes')).filter(f => f.endsWith('.json')); } catch {}
      for (const file of files) {
        const pairId = file.slice(0, -5);
        if (!ID_RE.test(pairId)) continue;
        const due = await locked(() => {
          const t = now();
          const dueAt = n => (n.status === 'sending' ? parseDate(n.retryAt) : parseDate(n.draft && n.draft.sendAt)) || 0;
          const picked = readNotes(pairId).filter(n => (n.status === 'scheduled' || n.status === 'sending') && !inFlight.has(n.id) && dueAt(n) <= t);
          picked.forEach(n => inFlight.add(n.id));
          return picked;
        });
        for (const note of due) {
          let result;
          try {
            const sendAt = parseDate(note.draft.sendAt) || 0;
            result = note.status === 'scheduled' && now() - sendAt > MAX_LATE ? 'failed' : await deliverNote(note);
          } catch (error) { warn('scheduled delivery failed', error && error.message); result = 'retry'; }
          await locked(() => {
            inFlight.delete(note.id);
            const notes = readNotes(pairId);
            const stored = notes.find(n => n.id === note.id);
            if (!stored || stored.status === 'cancelled') return;
            settleNote(stored, result);
            writeNotes(pairId, notes);
          });
        }
      }
    } catch (error) { warn('scheduler tick failed', error && error.message); }
    finally { ticking = false; }
  }
  function startScheduler() {
    if (timer) return;
    timer = setInterval(() => { tick(); }, schedulerIntervalMs);
    if (timer.unref) timer.unref();
  }
  function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
    for (const s of widgetState.values()) if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  }

  return { handle, startScheduler, stopScheduler, tick };
}

module.exports = { createAura, PREFIX };
