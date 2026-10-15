'use strict';

// PocketShift Live Activity relay. Live Activities can't compute money on their
// own and iOS suspends the app soon after it leaves the screen, so the app
// registers each activity's push token and shift state here and the server keeps
// the Dynamic Island / Lock Screen amount moving with ActivityKit pushes.
// Pure Node stdlib; the APNs transport (lib/aura-apns.js) is injected.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREFIX = '/api/pocketshift/v1';
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const DEVICE_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DEFAULT_TOPIC = 'ca.yannickmorgans.pocketshift.push-type.liveactivity';
// Swift's default Date coding counts seconds from 2001-01-01.
const APPLE_EPOCH_OFFSET = 978_307_200;
const TICK_MS = 5_000;
// Low-priority pushes don't spend the activity's update budget; a high-priority
// one at least once a minute keeps the amount from drifting when iOS defers them.
const HIGH_PRIORITY_EVERY_MS = 60_000;
// Live Activities live at most 8h active plus 4h on the Lock Screen.
const MAX_AGE_MS = 12 * 3600_000;
const MAX_ACTIVITIES = 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function finite(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function parseState(raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Invalid state');
  const hourlyRate = finite(raw.hourlyRate, 0, 100_000);
  const accumulatedSeconds = finite(raw.accumulatedSeconds, 0, 10 * 365 * 86_400);
  const currencyCode = typeof raw.currencyCode === 'string' && CURRENCY_RE.test(raw.currencyCode) ? raw.currencyCode : null;
  const runningSince = raw.runningSince == null ? null : finite(raw.runningSince, 0, 1e11);
  if (hourlyRate == null || accumulatedSeconds == null || !currencyCode || (raw.runningSince != null && runningSince == null)) {
    throw new HttpError(400, 'Invalid state');
  }
  return { hourlyRate, currencyCode, accumulatedSeconds, runningSince };
}

/// The ActivityKit content-state for `state` as of `nowMs`, matching
/// ShiftActivityAttributes.ContentState in the app.
function contentState(state, nowMs) {
  const live = state.runningSince == null ? 0 : Math.max(0, nowMs / 1000 - state.runningSince);
  return {
    hourlyRate: state.hourlyRate,
    currencyCode: state.currencyCode,
    accumulatedSeconds: state.accumulatedSeconds,
    ...(state.runningSince == null ? {} : { runningSince: state.runningSince - APPLE_EPOCH_OFFSET }),
    earned: state.hourlyRate * (state.accumulatedSeconds + live) / 3600,
  };
}

function createPocketShift({ dataDir, apns = null, now = () => Date.now(), logger = console, tickMs = TICK_MS, topic = DEFAULT_TOPIC } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const file = path.join(dataDir, 'activities.json');
  const cipher = apns && apns.cipher && apns.cipher.configured ? apns.cipher : null;
  const warn = (...a) => { if (logger && typeof logger.warn === 'function') logger.warn('[pocketshift]', ...a); };

  // id -> { token, environment, state, updatedAt, lastHighAt }
  const activities = new Map();
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [id, record] of Object.entries(stored || {})) {
      try { activities.set(id, { ...record, token: cipher ? cipher.decrypt(record.token) : record.token }); } catch {}
    }
  } catch {}

  function persist() {
    const out = {};
    for (const [id, r] of activities) out[id] = { ...r, token: cipher ? cipher.encrypt(r.token) : r.token };
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  const hits = new Map();
  function rateLimited(key, limit, windowMs) {
    const t = now();
    const list = (hits.get(key) || []).filter(x => t - x < windowMs);
    list.push(t);
    hits.set(key, list);
    return list.length > limit;
  }
  function clientIp(req) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
    return (req.socket && req.socket.remoteAddress) || 'unknown';
  }
  function readJsonBody(req, limit = 8 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => { size += chunk.length; if (size <= limit) chunks.push(chunk); });
      req.on('end', () => {
        if (size > limit) return reject(new HttpError(413, 'Payload too large'));
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape');
          resolve(v);
        } catch { reject(new HttpError(400, 'Invalid JSON body')); }
      });
      req.on('error', () => reject(new HttpError(400, 'Request failed')));
    });
  }
  function send(res, status, body) {
    const data = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(data);
  }

  async function push(id, record) {
    if (!apns || !apns.configured) return;
    const t = now();
    const high = t - (record.lastHighAt || 0) >= HIGH_PRIORITY_EVERY_MS;
    if (high) record.lastHighAt = t;
    const result = await apns.send({
      token: record.token,
      environment: record.environment,
      pushType: 'liveactivity',
      topic,
      priority: high ? 10 : 5,
      payload: {
        aps: {
          timestamp: Math.floor(t / 1000),
          event: 'update',
          'content-state': contentState(record.state, t),
        },
      },
    });
    if (result && result.reason === 'invalid_token' && activities.get(id) === record) {
      activities.delete(id);
      persist();
    } else if (result && result.delivery === 'failed') {
      warn(`push failed: ${result.reason}`);
    }
  }

  async function handle(req, res, urlPath) {
    if (typeof urlPath !== 'string' || !urlPath.startsWith(`${PREFIX}/`)) return false;
    try {
      const segs = urlPath.slice(PREFIX.length + 1).split('/').filter(Boolean);
      if (segs.length !== 2 || segs[0] !== 'activities' || !ID_RE.test(segs[1])) throw new HttpError(404, 'Not found');
      if (rateLimited(clientIp(req), 120, 60_000)) throw new HttpError(429, 'Too many requests');
      const id = segs[1];
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const token = typeof body.pushToken === 'string' && DEVICE_TOKEN_RE.test(body.pushToken) ? body.pushToken.toLowerCase() : null;
        if (!token) throw new HttpError(400, 'Invalid push token');
        const environment = body.environment === 'sandbox' ? 'sandbox' : 'production';
        if (!activities.has(id) && activities.size >= MAX_ACTIVITIES) throw new HttpError(503, 'Unavailable');
        const previous = activities.get(id);
        activities.set(id, { token, environment, state: parseState(body.state), updatedAt: now(), lastHighAt: previous ? previous.lastHighAt : 0 });
        persist();
        send(res, 200, { ok: true, intervalSeconds: tickMs / 1000 });
        return true;
      }
      if (req.method === 'DELETE') {
        if (activities.delete(id)) persist();
        send(res, 200, { ok: true });
        return true;
      }
      throw new HttpError(405, 'Method not allowed');
    } catch (error) {
      if (error instanceof HttpError) send(res, error.status, { error: error.message });
      else { warn('request failed', error && error.message); send(res, 500, { error: 'Internal error' }); }
    }
    return true;
  }

  let timer = null;
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const t = now();
      let expired = false;
      const due = [];
      for (const [id, record] of activities) {
        if (t - record.updatedAt > MAX_AGE_MS) { activities.delete(id); expired = true; continue; }
        if (record.state.runningSince != null) due.push([id, record]);
      }
      if (expired) persist();
      await Promise.all(due.map(([id, record]) => push(id, record).catch(error => warn('push failed', error && error.message))));
    } finally { ticking = false; }
  }
  function startScheduler() {
    if (timer) return;
    timer = setInterval(() => { tick(); }, tickMs);
    if (timer.unref) timer.unref();
  }
  function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { handle, tick, startScheduler, stopScheduler, activities };
}

module.exports = { createPocketShift, contentState, PREFIX, APPLE_EPOCH_OFFSET };
