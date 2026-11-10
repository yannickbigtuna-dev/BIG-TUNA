'use strict';

// Pushes Yannick Lights widget/control refreshes to the owner's iPhone whenever
// the Lights or Lamp state changes (app, website, HomeKit or the lamp bridge's
// presence rules). The push carries no state: iOS reloads the widgets/controls,
// which then read the authoritative native endpoint.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUNDLE_ID = 'ca.yannickmorgans.bigtuna.lights';
const CHANNELS = new Set(['widgets', 'controls']);
const TOKEN_RE = /^[0-9a-f]{64,200}$/i;
const MAX_DEVICES = 16;

function createLightsPush({ file, apns, logger = console, debounceMs = 150 } = {}) {
  const cipher = apns && apns.cipher;
  const warn = message => { if (logger && typeof logger.warn === 'function') logger.warn(`[lights push] ${message}`); };
  let timer = null;

  function read() {
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function write(devices) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(devices, null, 2));
    fs.renameSync(tmp, file);
  }
  const idFor = (channel, token) => crypto.createHash('sha256').update(`${channel}:${token.toLowerCase()}`).digest('hex').slice(0, 32);

  function validate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Invalid body';
    if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) return 'Invalid token';
    if (!CHANNELS.has(body.channel)) return 'Invalid channel';
    if (body.environment !== undefined && body.environment !== 'sandbox' && body.environment !== 'production') return 'Invalid environment';
    return null;
  }

  function register({ token, channel, environment }) {
    if (!cipher || !cipher.configured) { const e = new Error('Push registration is unavailable'); e.code = 'UNAVAILABLE'; throw e; }
    const id = idFor(channel, token);
    const devices = read().filter(d => d.id !== id);
    devices.push({ id, channel, environment: environment || 'production', tokenEnc: cipher.encrypt(token.toLowerCase()), updatedAt: new Date().toISOString() });
    write(devices.slice(-MAX_DEVICES));
  }

  function unregister(tokens) {
    const ids = new Set();
    for (const t of tokens) if (typeof t === 'string' && TOKEN_RE.test(t)) for (const c of CHANNELS) ids.add(idFor(c, t));
    if (ids.size) write(read().filter(d => !ids.has(d.id)));
  }

  async function sendNow() {
    if (!apns || typeof apns.send !== 'function' || !cipher || !cipher.configured) return [];
    const devices = read();
    const dead = [];
    const results = await Promise.all(devices.map(async d => {
      let result;
      try {
        result = await apns.send({
          token: cipher.decrypt(d.tokenEnc),
          environment: d.environment,
          pushType: d.channel,
          topic: `${BUNDLE_ID}.push-type.${d.channel}`,
          priority: 10,
          payload: { aps: { 'content-changed': true } },
        });
      } catch (error) { warn(`push failed: ${error && error.message}`); result = { delivery: 'failed', reason: 'error' }; }
      if (result && result.reason === 'invalid_token') dead.push(d.id);
      return result;
    }));
    if (dead.length) write(read().filter(d => !dead.includes(d.id)));
    return results;
  }

  // Lights and Lamp writes can land together (e.g. a bridge correction right
  // after a command); one push covers both.
  function notifyChanged() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; sendNow().catch(error => warn(error && error.message)); }, debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return { validate, register, unregister, notifyChanged, sendNow, devices: read };
}

module.exports = { createLightsPush, BUNDLE_ID };
