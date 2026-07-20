'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const LIGHTS_HTML = path.join(ROOT, 'apps', 'lights', 'index.html');
const TOKENS_CSS = path.join(ROOT, 'apps', 'styles', 'tokens.css');
const VALID_TOKEN = 'fixture-yannick-token';
const YANNICK = { username: 'yannick', id: 'fixture-yannick' };

let browser;
let fixtureServer;
let fixtureBaseUrl;
let servedLightsHtml;
let servedTokensCss;
let fixture;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function resetFixture(overrides = {}) {
  fixture = {
    apiOn: true,
    updatedAt: '2026-07-19T12:00:00.000Z',
    updateNumber: 0,
    authStatus: 200,
    authUser: { ...YANNICK },
    authGate: null,
    lightsGate: null,
    postOutcome: 'success',
    authRequests: [],
    authResponses: 0,
    lightsGetRequests: [],
    postRequests: [],
    requestSequence: 0,
    ...overrides,
  };
}

function jsonResponse(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function textResponse(res, contentType, value) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(value),
    'Cache-Control': 'no-store',
  });
  res.end(value);
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function nextUpdatedAt() {
  fixture.updateNumber++;
  const currentTime = Date.parse(fixture.updatedAt);
  if (Number.isFinite(currentTime)) return new Date(currentTime + 1000).toISOString();
  return `2026-07-19T12:00:${String(fixture.updateNumber).padStart(2, '0')}.000Z`;
}

async function fixtureHandler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/lights/') {
    return textResponse(res, 'text/html; charset=utf-8', servedLightsHtml);
  }
  if (req.method === 'GET' && url.pathname === '/styles/tokens.css') {
    return textResponse(res, 'text/css; charset=utf-8', servedTokensCss);
  }
  if (req.method === 'GET' && url.pathname === '/topbar.js') {
    return textResponse(res, 'text/javascript; charset=utf-8', [
      'globalThis.Topbar = {',
      '  setTitle() {},',
      '  addLeft() {},',
      '  identify() {},',
      '};',
    ].join('\n'));
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const request = {
      sequence: ++fixture.requestSequence,
      authorization: req.headers.authorization || '',
    };
    fixture.authRequests.push(request);
    if (fixture.authGate) await fixture.authGate.promise;
    fixture.authResponses++;
    if (request.authorization !== `Bearer ${VALID_TOKEN}` || fixture.authStatus !== 200) {
      return jsonResponse(res, fixture.authStatus === 200 ? 401 : fixture.authStatus, {
        error: 'Not authenticated',
      });
    }
    return jsonResponse(res, 200, fixture.authUser);
  }
  if (req.method === 'GET' && url.pathname === '/api/lights') {
    const responseSnapshot = { on: fixture.apiOn, updatedAt: fixture.updatedAt };
    const request = {
      sequence: ++fixture.requestSequence,
      responseSnapshot,
    };
    fixture.lightsGetRequests.push(request);
    if (fixture.lightsGate) await fixture.lightsGate.promise;
    return jsonResponse(res, 200, responseSnapshot);
  }
  if (req.method === 'POST' && url.pathname === '/api/lights') {
    const body = await readJsonBody(req);
    const request = {
      sequence: ++fixture.requestSequence,
      authorization: req.headers.authorization || '',
      body,
    };
    fixture.postRequests.push(request);

    if (request.authorization !== `Bearer ${VALID_TOKEN}` || fixture.postOutcome === 'unauthorized') {
      return jsonResponse(res, 401, { error: 'Not authenticated' });
    }
    if (fixture.postOutcome === 'server-error') {
      return jsonResponse(res, 500, { error: 'Temporary fixture failure' });
    }

    fixture.apiOn = body.on;
    fixture.updatedAt = nextUpdatedAt();
    return jsonResponse(res, 200, { on: fixture.apiOn, updatedAt: fixture.updatedAt });
  }
  if (req.method === 'GET' && url.pathname === '/api/lights/device/status') {
    return jsonResponse(res, 200, { recentlyPolled: false });
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  res.writeHead(404);
  res.end('Not found');
}

function waitForFixture(predicate, label, timeoutMs = 8000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(new Error(`Timed out waiting for ${label}`));
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function releaseFixtureGates() {
  fixture?.authGate?.resolve();
  fixture?.lightsGate?.resolve();
}

async function openLightsPage({ token = VALID_TOKEN, user = YANNICK } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors = [];
  const externalRequests = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => pageErrors.push(error));

  await page.evaluateOnNewDocument(({ storedToken, storedUser }) => {
    if (storedToken === null) localStorage.removeItem('auth_token');
    else localStorage.setItem('auth_token', storedToken);
    if (storedUser === null) localStorage.removeItem('auth_user');
    else localStorage.setItem('auth_user', JSON.stringify(storedUser));

    class FixtureEventSource {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.listeners = new Map();
        window.__fixtureEventSources.push(this);
        setTimeout(() => {
          this.onopen?.({ type: 'open' });
          for (const listener of this.listeners.get('open') || []) listener({ type: 'open' });
        }, 0);
      }

      addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
      }

      removeEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
      }

      close() {
        this.readyState = 2;
      }
    }

    window.__fixtureEventSources = [];
    window.__emitFixtureLightsEvent = payload => {
      const event = { type: 'message', data: JSON.stringify(payload) };
      for (const source of window.__fixtureEventSources) {
        source.onmessage?.(event);
        for (const listener of source.listeners.get('message') || []) listener(event);
      }
    };

    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      writable: true,
      value: FixtureEventSource,
    });
  }, { storedToken: token, storedUser: user });

  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith(`${fixtureBaseUrl}/`)) request.continue();
    else {
      externalRequests.push(request.url());
      request.abort();
    }
  });

  await page.goto(`${fixtureBaseUrl}/lights/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#switch');
  return { context, page, pageErrors, externalRequests };
}

async function closeLightsPage(opened) {
  releaseFixtureGates();
  try {
    assert.deepEqual(opened.pageErrors.map(error => error.message), []);
    assert.deepEqual(opened.externalRequests, []);
  } finally {
    await opened.context.close();
  }
}

async function switchSnapshot(page) {
  return page.$eval('#switch', button => ({
    disabled: button.disabled,
    ariaChecked: button.getAttribute('aria-checked'),
    busy: button.getAttribute('aria-busy') === 'true',
    bodyOn: document.body.classList.contains('is-on'),
    bodyAuthed: document.body.classList.contains('is-authed'),
  }));
}

async function waitForVisual(page, websiteOn) {
  await page.waitForFunction(expected => {
    const button = document.querySelector('#switch');
    return button
      && button.getAttribute('aria-checked') === String(expected)
      && document.body.classList.contains('is-on') === expected;
  }, {}, websiteOn);
}

async function waitForEnabled(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('#switch');
    return button && !button.disabled && button.getAttribute('aria-busy') !== 'true';
  });
}

async function pointerPress(page) {
  const point = await page.$eval('#switch', button => {
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function storageSnapshot(page) {
  return page.evaluate(() => ({
    token: localStorage.getItem('auth_token'),
    user: localStorage.getItem('auth_user'),
  }));
}

before(async () => {
  servedLightsHtml = fs.readFileSync(LIGHTS_HTML, 'utf8');
  servedTokensCss = fs.readFileSync(TOKENS_CSS, 'utf8')
    .replace(/^\s*@import\b[^\r\n]*\r?\n/gm, '');
  resetFixture();

  fixtureServer = http.createServer((req, res) => {
    fixtureHandler(req, res).catch(error => {
      if (!res.headersSent) jsonResponse(res, 500, { error: `Fixture failure: ${error.message}` });
      else res.destroy(error);
    });
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  const address = fixtureServer.address();
  fixtureBaseUrl = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling'],
  });
});

after(async () => {
  releaseFixtureGates();
  if (browser) await browser.close();
  if (fixtureServer) {
    fixtureServer.closeAllConnections?.();
    await new Promise(resolve => fixtureServer.close(resolve));
  }
});

test('verified yannick presses alternate authoritative API state exactly once per pointer press', { timeout: 30000 }, async () => {
  resetFixture({ apiOn: true });
  const opened = await openLightsPage();
  const { page } = opened;
  try {
    await waitForEnabled(page);
    await waitForVisual(page, false);
    assert.deepEqual(await switchSnapshot(page), {
      disabled: false,
      ariaChecked: 'false',
      busy: false,
      bodyOn: false,
      bodyAuthed: true,
    });
    assert.equal(fixture.authRequests.length, 1);
    assert.equal(fixture.authRequests[0].authorization, `Bearer ${VALID_TOKEN}`);

    await pointerPress(page);
    await waitForFixture(() => fixture.postRequests.length === 1, 'the first Lights POST');
    await waitForVisual(page, true);
    await waitForEnabled(page);
    assert.equal(fixture.apiOn, false);
    assert.deepEqual(fixture.postRequests.map(request => request.body.on), [false]);

    await pointerPress(page);
    await waitForFixture(() => fixture.postRequests.length === 2, 'the second Lights POST');
    await waitForVisual(page, false);
    await waitForEnabled(page);
    assert.equal(fixture.apiOn, true);
    assert.deepEqual(fixture.postRequests.map(request => request.body.on), [false, true]);
    assert.deepEqual(
      fixture.postRequests.map(request => request.authorization),
      [`Bearer ${VALID_TOKEN}`, `Bearer ${VALID_TOKEN}`]
    );
  } finally {
    await closeLightsPage(opened);
  }
});

test('cached owner identity never authorizes a missing or rejected token', { timeout: 30000 }, async t => {
  await t.test('missing token stays disabled and a pointer press cannot animate or POST', async () => {
    resetFixture({ apiOn: false });
    const opened = await openLightsPage({ token: null, user: YANNICK });
    const { page } = opened;
    try {
      await waitForFixture(() => fixture.lightsGetRequests.length >= 1, 'the initial Lights GET');
      await waitForVisual(page, true);
      const before = await switchSnapshot(page);
      assert.equal(before.disabled, true);
      assert.equal(before.bodyAuthed, false);

      await pointerPress(page);
      await new Promise(resolve => setTimeout(resolve, 120));
      assert.equal(fixture.postRequests.length, 0);
      assert.deepEqual(await switchSnapshot(page), before);
    } finally {
      await closeLightsPage(opened);
    }
  });

  await t.test('an explicit auth 401 clears stale storage and stays visually unchanged', async () => {
    resetFixture({ apiOn: false, authStatus: 401 });
    const opened = await openLightsPage({ token: 'stale-token', user: YANNICK });
    const { page } = opened;
    try {
      await waitForVisual(page, true);
      await page.waitForFunction(() => (
        localStorage.getItem('auth_token') === null
        && localStorage.getItem('auth_user') === null
      ));
      const before = await switchSnapshot(page);
      assert.equal(before.disabled, true);
      assert.equal(before.bodyAuthed, false);
      assert.equal(fixture.authRequests[0].authorization, 'Bearer stale-token');

      await pointerPress(page);
      await new Promise(resolve => setTimeout(resolve, 120));
      assert.equal(fixture.postRequests.length, 0);
      assert.deepEqual(await switchSnapshot(page), before);
    } finally {
      await closeLightsPage(opened);
    }
  });
});

test('a verified non-owner stays cached but cannot control the Lights switch', { timeout: 30000 }, async () => {
  resetFixture({
    apiOn: true,
    authUser: { username: 'emma', id: 'fixture-emma' },
  });
  const opened = await openLightsPage({ token: VALID_TOKEN, user: YANNICK });
  const { page } = opened;
  try {
    await waitForFixture(() => fixture.authResponses === 1, 'the non-owner auth response');
    await waitForVisual(page, false);
    await new Promise(resolve => setTimeout(resolve, 120));

    const before = await switchSnapshot(page);
    const storage = await storageSnapshot(page);
    assert.equal(before.disabled, true);
    assert.equal(before.bodyAuthed, false);
    assert.equal(storage.token, VALID_TOKEN);
    assert.ok(storage.user);
    assert.equal(JSON.parse(storage.user).username, 'emma');

    await pointerPress(page);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(fixture.postRequests.length, 0);
    assert.deepEqual(await switchSnapshot(page), before);
  } finally {
    await closeLightsPage(opened);
  }
});

test('the switch remains disabled until both auth and initial server state are authoritative', { timeout: 30000 }, async t => {
  await t.test('a delayed state load cannot use the default visual as the first command', async () => {
    const lightsGate = deferred();
    resetFixture({ apiOn: false, lightsGate });
    const opened = await openLightsPage();
    const { page } = opened;
    try {
      await waitForFixture(() => fixture.authResponses === 1, 'the auth response');
      await waitForFixture(() => fixture.lightsGetRequests.length === 1, 'the delayed Lights GET');
      await page.waitForFunction(() => document.body.classList.contains('is-authed'));
      assert.equal((await switchSnapshot(page)).disabled, true);

      lightsGate.resolve();
      await waitForVisual(page, true);
      await waitForEnabled(page);
      await pointerPress(page);
      await waitForFixture(() => fixture.postRequests.length === 1, 'the first post-load Lights POST');
      await waitForVisual(page, false);
      assert.equal(fixture.postRequests[0].body.on, true);
      assert.equal(fixture.apiOn, true);
    } finally {
      await closeLightsPage(opened);
    }
  });

  await t.test('a delayed auth response cannot authorize an already loaded state', async () => {
    const authGate = deferred();
    resetFixture({ apiOn: false, authGate });
    const opened = await openLightsPage();
    const { page } = opened;
    try {
      await waitForFixture(() => fixture.authRequests.length === 1, 'the delayed auth request');
      await waitForVisual(page, true);
      assert.equal((await switchSnapshot(page)).disabled, true);

      authGate.resolve();
      await waitForEnabled(page);
      await pointerPress(page);
      await waitForFixture(() => fixture.postRequests.length === 1, 'the authenticated Lights POST');
      await waitForVisual(page, false);
      assert.equal(fixture.postRequests[0].body.on, true);
      assert.equal(fixture.apiOn, true);
    } finally {
      await closeLightsPage(opened);
    }
  });
});

test('a POST 401 clears auth, disables control, and reconciles authoritative state', { timeout: 30000 }, async () => {
  resetFixture({ apiOn: true, postOutcome: 'unauthorized' });
  const opened = await openLightsPage();
  const { page } = opened;
  try {
    await waitForEnabled(page);
    await waitForVisual(page, false);
    await pointerPress(page);
    await waitForFixture(() => fixture.postRequests.length === 1, 'the rejected Lights POST');
    const postSequence = fixture.postRequests[0].sequence;
    await waitForFixture(
      () => fixture.lightsGetRequests.some(request => request.sequence > postSequence),
      'a post-401 authoritative state reconciliation'
    );
    await page.waitForFunction(() => {
      const button = document.querySelector('#switch');
      return button.disabled
        && button.getAttribute('aria-busy') !== 'true'
        && localStorage.getItem('auth_token') === null
        && localStorage.getItem('auth_user') === null;
    });
    await waitForVisual(page, false);
    assert.equal(fixture.apiOn, true);
    assert.deepEqual(fixture.postRequests[0].body, { on: false });
    assert.deepEqual(await storageSnapshot(page), { token: null, user: null });
    assert.equal((await switchSnapshot(page)).bodyAuthed, false);

    await pointerPress(page);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(fixture.postRequests.length, 1);
  } finally {
    await closeLightsPage(opened);
  }
});

test('a transient POST failure preserves valid auth and does not commit a visual flip', { timeout: 30000 }, async () => {
  resetFixture({ apiOn: false, postOutcome: 'server-error' });
  const opened = await openLightsPage();
  const { page } = opened;
  try {
    await waitForEnabled(page);
    await waitForVisual(page, true);
    const before = await switchSnapshot(page);
    await pointerPress(page);
    await waitForFixture(() => fixture.postRequests.length === 1, 'the failed Lights POST');
    const postSequence = fixture.postRequests[0].sequence;
    await waitForFixture(
      () => fixture.lightsGetRequests.some(request => request.sequence > postSequence),
      'a post-failure authoritative state reconciliation'
    );
    await waitForVisual(page, true);
    await waitForEnabled(page);

    assert.equal(fixture.apiOn, false);
    assert.deepEqual(fixture.postRequests[0].body, { on: true });
    const storage = await storageSnapshot(page);
    assert.equal(storage.token, VALID_TOKEN);
    assert.equal(JSON.parse(storage.user).username, YANNICK.username);
    assert.deepEqual(await switchSnapshot(page), before);
  } finally {
    await closeLightsPage(opened);
  }
});

test('a stale preflight GET cannot overwrite a newer SSE state or choose the wrong toggle', { timeout: 30000 }, async () => {
  resetFixture({
    apiOn: true,
    updatedAt: '2026-07-19T12:00:00.000Z',
  });
  const opened = await openLightsPage();
  const { page } = opened;
  try {
    await waitForEnabled(page);
    await waitForVisual(page, false);

    const preflightGate = deferred();
    fixture.lightsGate = preflightGate;
    await pointerPress(page);
    await waitForFixture(
      () => fixture.lightsGetRequests.length >= 2,
      'the gated per-press state preflight'
    );
    const gatedRequest = fixture.lightsGetRequests.at(-1);
    assert.deepEqual(gatedRequest.responseSnapshot, {
      on: true,
      updatedAt: '2026-07-19T12:00:00.000Z',
    });

    fixture.apiOn = false;
    fixture.updatedAt = '2026-07-19T12:00:30.000Z';
    await page.evaluate(state => window.__emitFixtureLightsEvent(state), {
      on: false,
      updatedAt: fixture.updatedAt,
    });
    await waitForVisual(page, true);

    preflightGate.resolve();
    await waitForFixture(() => fixture.postRequests.length === 1, 'the race-safe Lights POST');
    await waitForVisual(page, false);
    await waitForEnabled(page);

    assert.equal(fixture.postRequests.length, 1);
    assert.deepEqual(fixture.postRequests[0].body, { on: true });
    assert.equal(fixture.apiOn, true);
  } finally {
    await closeLightsPage(opened);
  }
});
