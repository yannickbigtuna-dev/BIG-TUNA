'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const TRIVIA_HTML = path.join(ROOT, 'apps', 'trivia', 'index.html');
const TOKENS_CSS = path.join(ROOT, 'apps', 'styles', 'tokens.css');

let browser;
let fixtureServer;
let fixtureBaseUrl;
let servedTriviaHtml;
let servedTokensCss;
let fixture;

function resetFixture(overrides = {}) {
  fixture = {
    blankQuestionNumber: 1,
    topicQuestionNumber: 1,
    topicRequests: 0,
    topicFailures: 0,
    partialTopicRun: false,
    initialTopicBatchSent: false,
    recoverTopicGeneration: true,
    ...overrides,
  };
}

function normalizeQuestion(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '').trim();
}

function makeQuestion(number, prefix) {
  return {
    id: `${prefix}-${number}`,
    question: `${prefix} fixture question ${number}?`,
    answers: [`Correct ${number}`, `Wrong ${number}A`, `Wrong ${number}B`, `Wrong ${number}C`],
    correct: 0,
    category: 'Fixture',
    difficulty: 'medium',
    explanation: `Correct ${number} is the fixture answer.`,
  };
}

function makeUnusedQuestions({ count, exclude, prefix, counterKey }) {
  const excluded = new Set((exclude || []).map(normalizeQuestion));
  const questions = [];
  while (questions.length < count) {
    const number = fixture[counterKey]++;
    const question = makeQuestion(number, prefix);
    if (!excluded.has(normalizeQuestion(question.question))) questions.push(question);
  }
  return questions;
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

async function handleGenerate(req, res) {
  const body = await readJsonBody(req);
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const count = Math.max(1, Math.min(10, Number.parseInt(body.count, 10) || 1));
  const exclude = Array.isArray(body.exclude) ? body.exclude : [];

  if (topic && fixture.partialTopicRun) {
    fixture.topicRequests++;
    if (!fixture.initialTopicBatchSent) {
      fixture.initialTopicBatchSent = true;
      const questions = makeUnusedQuestions({
        count: 2,
        exclude,
        prefix: 'Topic',
        counterKey: 'topicQuestionNumber',
      });
      return jsonResponse(res, 200, {
        ok: true,
        provider: 'openai',
        model: 'gpt-5.6-luna',
        source: 'openai-topic',
        questions,
      });
    }
    if (!fixture.recoverTopicGeneration) {
      fixture.topicFailures++;
      return jsonResponse(res, 503, {
        error: 'Fixture topic generation is temporarily unavailable. Please retry.',
        provider: 'openai',
        model: 'gpt-5.6-luna',
        source: 'openai-topic',
        questions: [],
      });
    }
  }

  const questions = makeUnusedQuestions({
    count,
    exclude,
    prefix: topic ? 'Topic' : 'Bank',
    counterKey: topic ? 'topicQuestionNumber' : 'blankQuestionNumber',
  });
  return jsonResponse(res, 200, {
    ok: true,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    source: topic ? 'openai-topic' : 'luna-bank',
    ...(topic ? {} : { bankSize: 1000 }),
    questions,
  });
}

async function fixtureHandler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/trivia/') {
      return textResponse(res, 'text/html; charset=utf-8', servedTriviaHtml);
    }
    if (req.method === 'GET' && url.pathname === '/styles/tokens.css') {
      return textResponse(res, 'text/css; charset=utf-8', servedTokensCss);
    }
    if (req.method === 'GET' && url.pathname === '/topbar.js') {
      return textResponse(res, 'text/javascript; charset=utf-8', [
        'window.Topbar = {',
        '  setTitle() {},',
        '  addLeft() {},',
        '  identify() {},',
        '};',
      ].join('\n'));
    }
    if (req.method === 'GET' && url.pathname === '/auth.js') {
      return textResponse(res, 'text/javascript; charset=utf-8', [
        'window.Auth = {',
        "  token: 'fixture-token',",
        "  user: { username: 'Fixture Player', id: 'fixture-user' },",
        '  onReady(callback) { queueMicrotask(() => callback(this.user)); },',
        '  async loadSettings() { return null; },',
        '  saveSettings(_appId, data) { window.__savedTriviaSettings = JSON.parse(JSON.stringify(data)); },',
        '};',
      ].join('\n'));
    }
    if (req.method === 'GET' && url.pathname === '/api/trivia/status') {
      return jsonResponse(res, 200, {
        available: true,
        topicGenerationAvailable: true,
        provider: 'openai',
        model: 'gpt-5.6-luna',
        bankReady: true,
        bankSize: 1000,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/trivia/generate') {
      return await handleGenerate(req, res);
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    jsonResponse(res, 500, { error: `Fixture failure: ${error.message}` });
  }
}

function waitForFixture(predicate, timeoutMs = 8000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(new Error('Timed out waiting for the Trivia fixture state'));
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function openTriviaPage() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => pageErrors.push(error));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith(fixtureBaseUrl)) request.continue();
    else request.abort();
  });
  await page.goto(`${fixtureBaseUrl}/trivia/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#start-btn');
  return { context, page, pageErrors };
}

async function closeTriviaPage(opened) {
  try {
    assert.deepEqual(opened.pageErrors.map(error => error.message), []);
  } finally {
    await opened.context.close();
  }
}

async function setQuestionTime(page, value) {
  await page.$eval('#question-time', (input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function startBlankRun(page) {
  await page.click('#start-btn');
  await page.waitForFunction(() => {
    const body = document.querySelector('#q-body');
    return document.querySelector('#view-game').classList.contains('active')
      && body.style.display !== 'none'
      && document.querySelector('#answers .answer:not(:disabled)');
  });
}

async function answerAndAdvance(page) {
  await page.waitForFunction(() => {
    const body = document.querySelector('#q-body');
    return body.style.display !== 'none' && document.querySelector('#answers .answer:not(:disabled)');
  });
  await page.click('#answers .answer');
  await page.waitForFunction(() => !document.querySelector('#explain').hidden);
  await page.click('#next-btn');
}

before(async () => {
  const originalHtml = fs.readFileSync(TRIVIA_HTML, 'utf8');
  assert.match(originalHtml, /const COOLDOWN_RETRY_MS = 15000;/);
  assert.match(originalHtml, /Math\.min\(4000, 500 \* activeRun\.genFails\)/);
  servedTriviaHtml = originalHtml
    .replace('const COOLDOWN_RETRY_MS = 15000;', 'const COOLDOWN_RETRY_MS = 40;')
    .replace('Math.min(4000, 500 * activeRun.genFails)', 'Math.min(40, 5 * activeRun.genFails)');
  servedTokensCss = fs.readFileSync(TOKENS_CSS, 'utf8').replace(/^@import[^\r\n]+\r?\n/m, '');
  resetFixture();

  fixtureServer = http.createServer((req, res) => {
    fixtureHandler(req, res).catch(error => jsonResponse(res, 500, { error: error.message }));
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
  if (browser) await browser.close();
  if (fixtureServer) {
    fixtureServer.closeAllConnections?.();
    await new Promise(resolve => fixtureServer.close(resolve));
  }
});

test('fixed topic runs wait through repeated failures and still complete the selected ten questions', { timeout: 30000 }, async () => {
  resetFixture({
    partialTopicRun: true,
    recoverTopicGeneration: false,
  });
  const opened = await openTriviaPage();
  const { page } = opened;
  try {
    await page.click('[data-count="10"]');
    await setQuestionTime(page, 61);
    await page.$eval('#topic-input', input => {
      input.value = 'deterministic topic';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#start-btn');
    await page.waitForFunction(() => document.querySelector('#q-counter').textContent.trim() === 'Question 1/10');

    await answerAndAdvance(page);
    await answerAndAdvance(page);

    await waitForFixture(() => fixture.topicFailures > 8);
    await page.waitForFunction(() => /Still preparing question 3\/10/.test(
      document.querySelector('#q-loading-text').textContent
    ));
    const waitingState = await page.evaluate(() => ({
      gameActive: document.querySelector('#view-game').classList.contains('active'),
      resultsActive: document.querySelector('#view-results').classList.contains('active'),
      games: document.querySelector('#stat-games').textContent.trim(),
      loading: document.querySelector('#q-loading').style.display,
    }));
    assert.deepEqual(waitingState, {
      gameActive: true,
      resultsActive: false,
      games: '0',
      loading: 'flex',
    });

    fixture.recoverTopicGeneration = true;
    await page.waitForFunction(() => document.querySelector('#q-counter').textContent.trim() === 'Question 3/10');
    for (let index = 2; index < 10; index++) await answerAndAdvance(page);

    await page.waitForFunction(() => document.querySelector('#view-results').classList.contains('active'));
    const completed = await page.evaluate(() => ({
      total: document.querySelector('#res-total').textContent.trim(),
      correct: document.querySelector('#res-correct').textContent.trim(),
      games: document.querySelector('#stat-games').textContent.trim(),
      savedTotal: window.__savedTriviaSettings?.history?.[0]?.total,
    }));
    assert.deepEqual(completed, { total: '10', correct: '10', games: '1', savedTotal: 10 });
  } finally {
    await closeTriviaPage(opened);
  }
});

test('question-time slider exposes its endpoints and enforces finite or unlimited timing', { timeout: 30000 }, async t => {
  await t.test('defaults to 20 seconds and exposes accessible 1-second and unlimited endpoints', async () => {
    resetFixture();
    const opened = await openTriviaPage();
    const { page } = opened;
    try {
      assert.deepEqual(await page.$eval('#question-time', input => ({
        value: input.value,
        min: input.min,
        max: input.max,
        step: input.step,
        valueText: input.getAttribute('aria-valuetext'),
        output: document.querySelector('#question-time-value').textContent.trim(),
      })), {
        value: '20', min: '1', max: '61', step: '1', valueText: '20 seconds', output: '20s',
      });

      await page.focus('#question-time');
      await page.keyboard.press('Home');
      await page.waitForFunction(() => document.querySelector('#question-time-value').textContent.trim() === '1s');
      assert.deepEqual(await page.$eval('#question-time', input => ({
        value: input.value,
        valueText: input.getAttribute('aria-valuetext'),
      })), { value: '1', valueText: '1 second' });

      await page.keyboard.press('End');
      await page.waitForFunction(() => document.querySelector('#question-time-value').textContent.trim() === 'Infinite');
      assert.deepEqual(await page.$eval('#question-time', input => ({
        value: input.value,
        valueText: input.getAttribute('aria-valuetext'),
      })), { value: '61', valueText: 'Infinite (no time limit)' });
    } finally {
      await closeTriviaPage(opened);
    }
  });

  await t.test('one second times out and sixty seconds renders as one minute', async () => {
    resetFixture();
    let opened = await openTriviaPage();
    try {
      await setQuestionTime(opened.page, 1);
      await startBlankRun(opened.page);
      assert.equal(await opened.page.$eval('#timer-val', value => value.textContent.trim()), '0:01');
      await opened.page.waitForFunction(() => !document.querySelector('#explain').hidden, { timeout: 3000 });
      assert.match(
        await opened.page.$eval('#explain-label', value => value.textContent),
        /Time.s up/i
      );
    } finally {
      await closeTriviaPage(opened);
    }

    resetFixture();
    opened = await openTriviaPage();
    try {
      await setQuestionTime(opened.page, 60);
      assert.equal(await opened.page.$eval('#question-time-value', value => value.textContent.trim()), '1:00');
      await startBlankRun(opened.page);
      assert.equal(await opened.page.$eval('#timer-val', value => value.textContent.trim()), '1:00');
    } finally {
      await closeTriviaPage(opened);
    }
  });

  await t.test('unlimited mode creates no countdown interval and does not auto-answer', async () => {
    resetFixture();
    const opened = await openTriviaPage();
    const { page } = opened;
    try {
      await setQuestionTime(page, 61);
      await page.evaluate(() => {
        const nativeSetInterval = window.setInterval.bind(window);
        window.__questionIntervalCalls = 0;
        window.setInterval = (...args) => {
          window.__questionIntervalCalls++;
          return nativeSetInterval(...args);
        };
      });
      await startBlankRun(page);
      assert.equal(await page.$eval('#timer-val', value => value.textContent.trim()), '∞');
      await new Promise(resolve => setTimeout(resolve, 1200));
      assert.deepEqual(await page.evaluate(() => ({
        intervalCalls: window.__questionIntervalCalls,
        explanationHidden: document.querySelector('#explain').hidden,
        enabledAnswers: document.querySelectorAll('#answers .answer:not(:disabled)').length,
        gameActive: document.querySelector('#view-game').classList.contains('active'),
      })), {
        intervalCalls: 0,
        explanationHidden: true,
        enabledAnswers: 4,
        gameActive: true,
      });
    } finally {
      await closeTriviaPage(opened);
    }
  });
});
