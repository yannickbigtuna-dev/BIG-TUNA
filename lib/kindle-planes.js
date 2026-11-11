'use strict';

// Kindle plane dashboard: renders the aircraft around home as a greyscale PNG
// sized for an e-ink Kindle. The jailbroken Kindle fetches it every minute and
// draws it full-screen with `eips -g`.
//
// Routes (all GET):
//   /api/kindle/planes.png?w=600&h=800   greyscale PNG for the Kindle
//   /api/kindle/planes.html?w=600&h=800  the same dashboard as a web page
//   /api/kindle/planes.json              the raw nearby-aircraft list
//
// Requests from the home LAN are allowed; anything else (Cloudflare tunnel)
// must pass ?key=<KINDLE_PLANES_KEY>.
//
// server.env settings:
//   KINDLE_PLANES_LAT / KINDLE_PLANES_LON   home position (default: Halifax)
//   KINDLE_PLANES_RADIUS_NM                 search radius (default 20)
//   KINDLE_PLANES_LABEL                     header label (default "Home")
//   KINDLE_PLANES_KEY                       key for off-LAN access

const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

const DATA_TTL_MS = 15_000;
const IMAGE_TTL_MS = 20_000;
const BROWSER_IDLE_MS = 10 * 60_000;

const AIRLINES = {
  ACA: 'Air Canada', ROU: 'Air Canada Rouge', JZA: 'Air Canada Jazz', WJA: 'WestJet', WEN: 'WestJet Encore',
  SWG: 'Sunwing', TSC: 'Air Transat', POE: 'Porter', FLE: 'Flair', PVL: 'PAL Airlines', CRQ: 'Air Creebec',
  MAL: 'Morningstar', FDX: 'FedEx', UPS: 'UPS', PUR: 'Purolator', CJT: 'Cargojet', DAL: 'Delta', AAL: 'American',
  UAL: 'United', JBU: 'JetBlue', BAW: 'British Airways', VIR: 'Virgin Atlantic', DLH: 'Lufthansa', AFR: 'Air France',
  KLM: 'KLM', ICE: 'Icelandair', EIN: 'Aer Lingus', TAP: 'TAP Portugal', IBE: 'Iberia', SWR: 'Swiss', CFC: 'Canadian Forces',
  RCH: 'US Air Force', CGU: 'Coast Guard', ENY: 'Envoy', RPA: 'Republic', SKW: 'SkyWest', NKS: 'Spirit', AAY: 'Allegiant',
  QTR: 'Qatar', UAE: 'Emirates', THY: 'Turkish', ETD: 'Etihad', SAS: 'SAS', FIN: 'Finnair', AZA: 'ITA', CLX: 'Cargolux',
  GTI: 'Atlas Air', ABX: 'ABX Air', EXS: 'Jet2', TOM: 'TUI', CXB: 'Condor', CFG: 'Condor', LZB: 'Air Inuit',
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function numEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function config() {
  return {
    lat: numEnv('KINDLE_PLANES_LAT', 44.6488),
    lon: numEnv('KINDLE_PLANES_LON', -63.5752),
    radiusNm: Math.min(Math.max(numEnv('KINDLE_PLANES_RADIUS_NM', 20), 2), 100),
    label: String(process.env.KINDLE_PLANES_LABEL || 'Home').slice(0, 40),
    key: String(process.env.KINDLE_PLANES_KEY || ''),
    timeZone: process.env.KINDLE_PLANES_TZ || 'America/Halifax',
  };
}

// ── data ─────────────────────────────────────────────────────────────────────

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'bigtuna-kindle-planes/1.0', Accept: 'application/json' }, timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 5_000_000) req.destroy(new Error('response too large')); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function toRad(d) { return d * Math.PI / 180; }

function distanceBearing(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // nautical miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(a));
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return { dist, bearing };
}

function normalizeAircraft(raw, cfg) {
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  const { dist, bearing } = distanceBearing(cfg.lat, cfg.lon, raw.lat, raw.lon);
  if (dist > cfg.radiusNm) return null;
  const callsign = String(raw.flight || '').trim();
  const prefix = /^[A-Z]{3}\d/.test(callsign) ? callsign.slice(0, 3) : '';
  const onGround = raw.alt_baro === 'ground';
  const alt = onGround ? 0 : (Number.isFinite(raw.alt_baro) ? raw.alt_baro : (Number.isFinite(raw.alt_geom) ? raw.alt_geom : null));
  return {
    hex: String(raw.hex || ''),
    callsign: callsign || String(raw.r || raw.hex || '?').toUpperCase(),
    registration: String(raw.r || ''),
    type: String(raw.t || ''),
    airline: AIRLINES[prefix] || '',
    altitude: alt,
    onGround,
    speed: Number.isFinite(raw.gs) ? Math.round(raw.gs) : null,
    track: Number.isFinite(raw.track) ? raw.track : (Number.isFinite(raw.true_heading) ? raw.true_heading : null),
    verticalRate: Number.isFinite(raw.baro_rate) ? raw.baro_rate : (Number.isFinite(raw.geom_rate) ? raw.geom_rate : 0),
    distance: dist,
    bearing,
    lat: raw.lat,
    lon: raw.lon,
  };
}

function createKindlePlanes() {
  let dataCache = null; // { at, cfgKey, promise }
  const imageCache = new Map(); // `${w}x${h}` -> { at, png }
  let browserPromise = null;
  let browserIdleTimer = null;
  let renderChain = Promise.resolve();

  async function getAircraft() {
    const cfg = config();
    const cfgKey = `${cfg.lat},${cfg.lon},${cfg.radiusNm}`;
    if (dataCache && dataCache.cfgKey === cfgKey && Date.now() - dataCache.at < DATA_TTL_MS) return dataCache.promise;
    const promise = (async () => {
      const url = `https://api.adsb.lol/v2/point/${cfg.lat.toFixed(4)}/${cfg.lon.toFixed(4)}/${Math.ceil(cfg.radiusNm)}`;
      const json = await fetchJson(url);
      const list = (Array.isArray(json.ac) ? json.ac : []).map(a => normalizeAircraft(a, cfg)).filter(Boolean);
      list.sort((a, b) => a.distance - b.distance);
      return { cfg, aircraft: list, fetchedAt: Date.now(), error: null };
    })();
    dataCache = { at: Date.now(), cfgKey, promise };
    try {
      return await promise;
    } catch (err) {
      dataCache = null;
      return { cfg, aircraft: [], fetchedAt: Date.now(), error: err.message || String(err) };
    }
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  function esc(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatAlt(ac) {
    if (ac.onGround) return 'GND';
    if (ac.altitude == null) return '—';
    return ac.altitude >= 18000 ? `FL${Math.round(ac.altitude / 100)}` : `${ac.altitude.toLocaleString('en-US')} ft`;
  }

  function trend(ac) {
    if (ac.onGround) return '';
    if (ac.verticalRate > 300) return '▲';
    if (ac.verticalRate < -300) return '▼';
    return '';
  }

  function renderHtml(data, w, h, battery = null) {
    const { cfg, aircraft, error } = data;
    const now = new Date(data.fetchedAt);
    const time = now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: cfg.timeZone });
    const date = now.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: cfg.timeZone });

    const headerH = Math.round(h * 0.075);
    const radarSize = Math.min(w, Math.round(h * 0.5));
    const cx = radarSize / 2;
    const cy = radarSize / 2;
    const rMax = radarSize / 2 - 14;
    const scale = rMax / cfg.radiusNm;
    const ringStep = cfg.radiusNm <= 10 ? 2.5 : cfg.radiusNm <= 25 ? 5 : cfg.radiusNm <= 50 ? 10 : 25;

    let rings = '';
    for (let r = ringStep; r <= cfg.radiusNm + 0.01; r += ringStep) {
      const rr = r * scale;
      rings += `<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(1)}" fill="none" stroke="#888" stroke-width="1.2" ${r < cfg.radiusNm - 0.01 ? 'stroke-dasharray="4 5"' : ''}/>`;
      rings += `<text x="${(cx + 4).toFixed(1)}" y="${(cy - rr + 15).toFixed(1)}" font-size="13" fill="#555">${r} nm</text>`;
    }
    const axes = `<line x1="${cx}" y1="${cy - rMax}" x2="${cx}" y2="${cy + rMax}" stroke="#bbb" stroke-width="1"/>`
      + `<line x1="${cx - rMax}" y1="${cy}" x2="${cx + rMax}" y2="${cy}" stroke="#bbb" stroke-width="1"/>`
      + `<text x="${cx}" y="12" font-size="14" font-weight="700" text-anchor="middle">N</text>`;
    const home = `<circle cx="${cx}" cy="${cy}" r="6" fill="#000"/><circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="#000" stroke-width="2"/>`;

    const plotted = aircraft.slice(0, 30);
    let planes = '';
    plotted.forEach((ac, i) => {
      const angle = toRad(ac.bearing);
      const px = cx + Math.sin(angle) * ac.distance * scale;
      const py = cy - Math.cos(angle) * ac.distance * scale;
      const rot = ac.track == null ? 0 : ac.track;
      const near = i < 8;
      const size = near ? 1.25 : 0.9;
      planes += `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${size})">`
        + `<path d="M0,-11 L2,-4 L10,1 L10,3.5 L2,1 L1.5,7 L4.5,9.5 L4.5,11 L0,9.8 L-4.5,11 L-4.5,9.5 L-1.5,7 L-2,1 L-10,3.5 L-10,1 L-2,-4 Z" fill="${ac.onGround ? '#777' : '#000'}" stroke="#fff" stroke-width="1"/></g>`;
      if (near) {
        const right = px < w - 110;
        const lx = right ? px + 14 : px - 14;
        planes += `<text x="${lx.toFixed(1)}" y="${(py - 2).toFixed(1)}" font-size="15" font-weight="700" text-anchor="${right ? 'start' : 'end'}" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(ac.callsign)}</text>`
          + `<text x="${lx.toFixed(1)}" y="${(py + 14).toFixed(1)}" font-size="13" text-anchor="${right ? 'start' : 'end'}" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(formatAlt(ac))}</text>`;
      }
    });

    const rowsAvailable = Math.max(1, Math.floor((h - headerH - radarSize - 64) / 46));
    const rows = aircraft.slice(0, rowsAvailable).map(ac => {
      const who = [ac.airline, ac.type].filter(Boolean).join(' · ') || ac.registration || '';
      return `<tr>
        <td class="cs"><div>${esc(ac.callsign)}</div><small>${esc(who)}</small></td>
        <td class="num">${esc(formatAlt(ac))} ${trend(ac)}</td>
        <td class="num">${ac.speed == null ? '—' : ac.speed + ' kt'}</td>
        <td class="num">${ac.distance.toFixed(1)} nm <small>${COMPASS[Math.round(ac.bearing / 45) % 8]}</small></td>
      </tr>`;
    }).join('');

    let body;
    if (error) body = `<div class="empty">Plane data unavailable<br><small>${esc(error)}</small></div>`;
    else if (!aircraft.length) body = `<div class="empty">Clear skies<br><small>No aircraft within ${cfg.radiusNm} nm</small></div>`;
    else body = `<table>${rows}</table>`;

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${w}">
<title>Planes overhead</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: #fff; color: #000;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  header { height: ${headerH}px; background: #000; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; }
  header h1 { font-size: ${Math.round(headerH * 0.42)}px; letter-spacing: .02em; }
  header .meta { text-align: right; font-size: ${Math.round(headerH * 0.26)}px; line-height: 1.2; }
  header .meta b { font-size: ${Math.round(headerH * 0.4)}px; }
  .radar { display: block; margin: 0 auto; }
  .count { text-align: center; font-size: 16px; padding: 2px 0 8px; border-bottom: 2px solid #000; margin: 0 14px; }
  table { width: calc(100% - 28px); margin: 4px 14px 0; border-collapse: collapse; }
  td { padding: 5px 4px; border-bottom: 1px solid #aaa; font-size: 19px; vertical-align: middle; height: 46px; }
  td.cs div { font-weight: 700; font-size: 20px; }
  td small { font-size: 13px; color: #444; }
  td.num { text-align: right; white-space: nowrap; }
  .empty { text-align: center; font-size: 30px; font-weight: 700; padding-top: 40px; }
  .empty small { font-size: 16px; font-weight: 400; }
  footer { position: absolute; bottom: 0; left: 0; right: 0; font-size: 12px; color: #555; text-align: center; padding: 6px; }
</style></head><body>
<header><h1>✈ Planes · ${esc(cfg.label)}</h1><div class="meta"><b>${esc(time)}</b><br>${esc(date)}${battery == null ? '' : ` · ${battery}%`}</div></header>
<svg class="radar" width="${radarSize}" height="${radarSize}" viewBox="0 0 ${radarSize} ${radarSize}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">${rings}${axes}${home}${planes}</svg>
<div class="count">${aircraft.length} aircraft within ${cfg.radiusNm} nm</div>
${body}
<footer>Updated ${esc(time)} · data: adsb.lol</footer>
</body></html>`;
  }

  // ── headless browser → greyscale PNG ───────────────────────────────────────

  function scheduleBrowserClose() {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = setTimeout(async () => {
      const pending = browserPromise;
      browserPromise = null;
      if (pending) try { (await pending).close(); } catch {}
    }, BROWSER_IDLE_MS);
    if (browserIdleTimer.unref) browserIdleTimer.unref();
  }

  async function getBrowser() {
    if (!browserPromise) {
      const puppeteer = require('puppeteer');
      const fs = require('fs');
      // Prefer puppeteer's chrome-headless-shell (`npx puppeteer browsers install
      // chrome-headless-shell`); the desktop Chrome app won't start headless here.
      // KINDLE_PLANES_CHROME can point at another Chrome binary instead.
      const path = require('path');
      const os = require('os');
      const custom = process.env.KINDLE_PLANES_CHROME;
      const executablePath = custom && fs.existsSync(custom) ? custom : findHeadlessShell(fs, path, os);
      const headless = custom && executablePath === custom ? true : 'shell';
      const userDataDir = path.join(os.tmpdir(), 'bigtuna-kindle-planes-chrome');
      console.log(`[kindle-planes] launching ${executablePath || '(puppeteer default)'}`);
      browserPromise = puppeteer.launch({
        headless, executablePath: executablePath || undefined, userDataDir,
        args: ['--no-sandbox', '--font-render-hinting=none'],
      });
      browserPromise.then(b => b.on('disconnected', () => { browserPromise = null; }), () => { browserPromise = null; });
    }
    return browserPromise;
  }

  function renderPng(html, w, h) {
    const job = renderChain.then(async () => {
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
        const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
        return toGreyscalePng(Buffer.from(shot));
      } finally {
        await page.close().catch(() => {});
        scheduleBrowserClose();
      }
    });
    renderChain = job.then(() => {}, () => {});
    return job;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  function isLanAddress(addr) {
    const a = String(addr || '').replace(/^::ffff:/, '');
    return a === '127.0.0.1' || a === '::1' || /^10\./.test(a) || /^192\.168\./.test(a)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
  }

  function authorized(req, query) {
    // Cloudflare-tunnelled requests arrive on loopback with cf-connecting-ip set;
    // only direct LAN connections without that header count as "home".
    const viaTunnel = typeof req.headers['cf-connecting-ip'] === 'string';
    const remote = req.socket && req.socket.remoteAddress;
    if (!viaTunnel && isLanAddress(remote)) return true;
    const cfg = config();
    const given = String(query.get('key') || '');
    if (!cfg.key || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(cfg.key);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function dims(query) {
    const w = Math.round(Number(query.get('w')) || 600);
    const h = Math.round(Number(query.get('h')) || 800);
    const bat = Number(query.get('bat'));
    const battery = query.has('bat') && Number.isFinite(bat) ? Math.min(Math.max(Math.round(bat), 0), 100) : null;
    return { w: Math.min(Math.max(w, 300), 2000), h: Math.min(Math.max(h, 400), 2000), battery };
  }

  async function handle(req, res, urlPath) {
    if (!['/api/kindle/planes.png', '/api/kindle/planes.html', '/api/kindle/planes.json'].includes(urlPath)) return false;
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return true;
    }
    const query = new URL(req.url, 'http://local').searchParams;
    if (!authorized(req, query)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Forbidden');
      return true;
    }
    try {
      if (urlPath.endsWith('.json')) {
        const data = await getAircraft();
        const payload = { center: { lat: data.cfg.lat, lon: data.cfg.lon, radiusNm: data.cfg.radiusNm }, fetchedAt: data.fetchedAt, error: data.error, aircraft: data.aircraft };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(payload));
        return true;
      }
      const { w, h, battery } = dims(query);
      if (urlPath.endsWith('.html')) {
        const html = renderHtml(await getAircraft(), w, h, battery);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : html);
        return true;
      }
      const cacheKey = `${w}x${h}x${battery}`;
      let entry = imageCache.get(cacheKey);
      if (!entry || Date.now() - entry.at > IMAGE_TTL_MS) {
        const png = await renderPng(renderHtml(await getAircraft(), w, h, battery), w, h);
        entry = { at: Date.now(), png };
        imageCache.set(cacheKey, entry);
        if (imageCache.size > 6) imageCache.delete(imageCache.keys().next().value);
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': entry.png.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : entry.png);
    } catch (err) {
      console.error('[kindle-planes]', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Render failed');
    }
    return true;
  }

  async function close() {
    clearTimeout(browserIdleTimer);
    const pending = browserPromise;
    browserPromise = null;
    if (pending) try { (await pending).close(); } catch {}
  }

  return { handle, close, _test: { renderHtml, normalizeAircraft, isLanAddress, authorized } };
}

// Newest chrome-headless-shell in puppeteer's cache, if installed.
function findHeadlessShell(fs, path, os) {
  const root = path.join(process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer'), 'chrome-headless-shell');
  try {
    const versions = fs.readdirSync(root).sort().reverse();
    for (const version of versions) {
      for (const sub of fs.readdirSync(path.join(root, version))) {
        const bin = path.join(root, version, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
        if (fs.existsSync(bin)) return bin;
      }
    }
  } catch {}
  return '';
}

// ── PNG: decode Chrome's RGB(A) screenshot, re-encode as 8-bit greyscale ─────
// The Kindle's eips handles 8-bit greyscale PNGs most reliably.

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function toGreyscalePng(png) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (bitDepth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${bitDepth}, type ${colorType}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let prev = Buffer.alloc(stride);
  const out = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) line[i] = (line[i] + paeth(a, b, c)) & 255;
    }
    const rowOut = y * (width + 1);
    out[rowOut] = 0;
    for (let x = 0; x < width; x++) {
      let grey;
      if (channels >= 3) {
        const p = x * channels;
        grey = (line[p] * 299 + line[p + 1] * 587 + line[p + 2] * 114) / 1000;
        if (channels === 4) grey = grey * line[p + 3] / 255 + 255 * (1 - line[p + 3] / 255);
      } else {
        grey = line[x * channels];
      }
      // Snap to the panel's 16 grey levels so e-ink dithering stays clean.
      out[rowOut + 1 + x] = Math.round(Math.round(grey / 17) * 17);
    }
    prev = line;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { createKindlePlanes, toGreyscalePng, distanceBearing };
