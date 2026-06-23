'use strict';

// ───────────────────────────────────────────────────────────────────────────
// Multi-user Brightspace assignment coach.
//
// Every BIG TUNA user gets their own fully isolated workspace:
//
//   data/assignments/users/{userId}/config.json   (encrypted credentials)
//   data/assignments/users/{userId}/state.json    (tracked assignments + runs)
//   data/assignments/users/{userId}/profile/       (persistent browser profile)
//
// No user can read another user's data. There is no admin role: each request is
// scoped to the authenticated user's own id. The workflow logs into Brightspace
// with the user's stored credentials, scrapes the courses they chose, tracks
// assignments due soon with no detected submission, and emails a coaching digest
// every morning. It must remain an academic-support tool (outlines, work plans,
// checklists) — never a final-answer generator or auto-submission system.
// ───────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'assignments');
const USERS_DIR = path.join(DATA_DIR, 'users');
const SCHEDULER_FILE = path.join(DATA_DIR, 'scheduler.json');
const KEY_FILE = path.join(DATA_DIR, '.cryptokey');

const ACTION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // signed email links live 14 days
const DEFAULT_DUE_WINDOW_DAYS = 7;
const MAX_TEXT = 12000;
const MAX_COURSES = Number(process.env.BRIGHTSPACE_MAX_COURSES) || 30;
const DAILY_HOUR = clampHour(process.env.ASSIGNMENTS_DAILY_HOUR, 6);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let schedulerStarted = false;
const runningUsers = new Set();   // userIds with an in-flight check
let browserChain = Promise.resolve(); // serialises browser launches (one at a time)

// ── small utilities ─────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function clampHour(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function isValidUserId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

function settle(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── encryption (AES-256-GCM) for stored Brightspace passwords ────────────────

let cachedKey = null;
function cryptoKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.ASSIGNMENTS_CRYPTO_SECRET || process.env.MCP_SECRET || readOrCreateKeyFile();
  cachedKey = crypto.scryptSync(String(secret), 'big-tuna-assignments-v1', 32);
  return cachedKey;
}

function readOrCreateKeyFile() {
  try {
    const existing = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch {}
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    atomicWrite(KEY_FILE, generated);
    try { fs.chmodSync(KEY_FILE, 0o600); } catch {}
  } catch {}
  return generated;
}

function encryptSecret(plain) {
  const text = String(plain == null ? '' : plain);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
  };
}

function decryptSecret(blob) {
  if (!blob || typeof blob !== 'object' || !blob.iv || !blob.data || !blob.tag) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// ── per-user paths + config/state ────────────────────────────────────────────

function userDir(userId) {
  if (!isValidUserId(userId)) throw new Error('Invalid user id');
  return path.join(USERS_DIR, userId);
}
function userConfigFile(userId) { return path.join(userDir(userId), 'config.json'); }
function userStateFile(userId) { return path.join(userDir(userId), 'state.json'); }
function userProfileDir(userId) { return path.join(userDir(userId), 'profile'); }

function readConfig(userId) {
  try {
    const raw = JSON.parse(fs.readFileSync(userConfigFile(userId), 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function writeConfig(userId, config) {
  atomicWrite(userConfigFile(userId), { ...config, updatedAt: nowIso() });
}

function readState(userId) {
  try {
    const raw = JSON.parse(fs.readFileSync(userStateFile(userId), 'utf8'));
    return {
      assignments: raw && typeof raw.assignments === 'object' && raw.assignments ? raw.assignments : {},
      runs: Array.isArray(raw?.runs) ? raw.runs : [],
      updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch {
    return { assignments: {}, runs: [], updatedAt: '' };
  }
}

function writeState(userId, state) {
  atomicWrite(userStateFile(userId), { ...state, updatedAt: nowIso() });
}

function listUserIds() {
  try {
    return fs.readdirSync(USERS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && isValidUserId(d.name))
      .map(d => d.name);
  } catch {
    return [];
  }
}

function isConfigured(config) {
  return Boolean(
    config &&
    config.startUrl &&
    config.username &&
    config.credential &&
    config.email
  );
}

// Public view of a config — never leaks the encrypted password.
function publicConfig(config) {
  if (!config) return null;
  return {
    onboarded: true,
    enabled: config.enabled !== false,
    startUrl: config.startUrl || '',
    loginUrl: config.loginUrl || '',
    username: config.username || '',
    hasPassword: Boolean(config.credential),
    email: config.email || '',
    courseMode: config.courseMode || 'pinned',
    courses: Array.isArray(config.courses) ? config.courses.map(c => ({ name: c.name || '', url: c.url || '' })) : [],
    dueWindowDays: Number(config.dueWindowDays) || DEFAULT_DUE_WINDOW_DAYS,
    updatedAt: config.updatedAt || '',
    onboardedAt: config.onboardedAt || '',
  };
}

// ── validation + save ────────────────────────────────────────────────────────

function cleanUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function parseCourses(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of input) {
    if (!entry) continue;
    const url = cleanUrl(typeof entry === 'string' ? entry : entry.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const name = String((typeof entry === 'object' && entry.name) || '').trim().slice(0, 120);
    out.push({ name: name || hostnameLabel(url), url });
    if (out.length >= MAX_COURSES) break;
  }
  return out;
}

function hostnameLabel(url) {
  try { return new URL(url).hostname; } catch { return 'Course'; }
}

// Validate + persist onboarding/settings input. Returns { ok, error?, status?, config? }.
function saveConfig(userId, input = {}, defaults = {}) {
  if (!isValidUserId(userId)) return { ok: false, status: 400, error: 'Invalid user' };
  const existing = readConfig(userId) || {};

  const startUrl = cleanUrl(input.startUrl || input.brightspaceUrl);
  if (!startUrl) return { ok: false, status: 400, error: 'A valid Brightspace home/landing URL is required.' };

  const loginUrl = cleanUrl(input.loginUrl) || '';

  const username = String(input.username || '').trim().slice(0, 200);
  if (!username) return { ok: false, status: 400, error: 'Your Brightspace username is required.' };

  // Password: keep existing if not re-supplied during an edit.
  let credential = existing.credential || null;
  const password = typeof input.password === 'string' ? input.password : '';
  if (password) {
    credential = encryptSecret(password);
  }
  if (!credential) return { ok: false, status: 400, error: 'Your Brightspace password is required.' };

  const email = String(input.email || defaults.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, status: 400, error: 'A valid notification email is required.' };

  const courses = parseCourses(input.courses);
  const courseMode = input.courseMode === 'list' ? 'list' : 'pinned';
  if (courseMode === 'list' && !courses.length) {
    return { ok: false, status: 400, error: 'Add at least one course URL, or switch to pinned-course mode.' };
  }

  const dueWindowDays = Math.min(60, Math.max(1, Number(input.dueWindowDays) || DEFAULT_DUE_WINDOW_DAYS));

  const config = {
    enabled: input.enabled === false ? false : true,
    onboardedAt: existing.onboardedAt || nowIso(),
    startUrl,
    loginUrl,
    username,
    credential,
    email,
    courseMode,
    courses,
    dueWindowDays,
  };
  writeConfig(userId, config);
  return { ok: true, config: publicConfig(readConfig(userId)) };
}

function deleteUserData(userId) {
  if (!isValidUserId(userId)) return { ok: false, status: 400, error: 'Invalid user' };
  try {
    fs.rmSync(userDir(userId), { recursive: true, force: true });
  } catch {}
  return { ok: true };
}

// ── public dashboard payload ─────────────────────────────────────────────────

function publicAssignment(a) {
  const { actionSecret, rawHtml, instructions, ...rest } = a;
  const attempts = Array.isArray(a.attempts) ? a.attempts : [];
  const latest = attempts.length ? attempts[attempts.length - 1] : null;
  return {
    ...rest,
    instructions: typeof instructions === 'string' ? instructions.slice(0, 4000) : '',
    coaching: latest ? latest.coaching : '',
    scrapeError: a.scrapeError ? browserErrorMessage(a.scrapeError) : undefined,
    detailError: a.detailError ? browserErrorMessage(a.detailError) : undefined,
  };
}

function publicRun(run) {
  return {
    ...run,
    errors: Array.isArray(run.errors) ? run.errors.map(browserErrorMessage) : [],
    courses: Array.isArray(run.courses) ? run.courses.map(course => ({
      ...course,
      errors: Array.isArray(course.errors) ? course.errors.map(browserErrorMessage) : [],
    })) : undefined,
  };
}

function coachModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
}

function configStatus(config) {
  const emailReady = Boolean(process.env.RESEND_API_KEY && process.env.ASSIGNMENTS_FROM_EMAIL);
  return {
    onboarded: Boolean(config),
    configured: isConfigured(config),
    enabled: config ? config.enabled !== false : false,
    serverEmailReady: emailReady,
    aiReady: Boolean(process.env.ANTHROPIC_API_KEY),
    model: coachModel(),
    dailyHour: DAILY_HOUR,
  };
}

function listAssignments(userId) {
  const config = readConfig(userId);
  const state = readState(userId);
  return {
    status: configStatus(config),
    config: publicConfig(config),
    activity: { checking: runningUsers.has(userId) },
    updatedAt: state.updatedAt,
    runs: state.runs.slice(-10).reverse().map(publicRun),
    assignments: Object.values(state.assignments).map(publicAssignment).sort((a, b) => {
      const ad = Date.parse(a.dueAt || '') || Infinity;
      const bd = Date.parse(b.dueAt || '') || Infinity;
      return ad - bd || String(a.title).localeCompare(String(b.title));
    }),
  };
}

// ── parsing helpers (assignment text → structured data) ──────────────────────

function normalizeId(value) {
  const text = String(value || '').trim();
  if (!text) return crypto.randomUUID();
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);
}

function dueWithinWindow(dueAt, windowDays = DEFAULT_DUE_WINDOW_DAYS) {
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return false;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return due >= Date.now() - 6 * 60 * 60 * 1000 && due <= Date.now() + windowMs;
}

function htmlEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function markdownToHtml(text) {
  return htmlEscape(text).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
}

function extractDueDate(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ');
  const patterns = [
    /due(?: date)?(?: on)?:?\s*([A-Z][a-z]+ \d{1,2},? \d{4}(?:\s*(?:at)?\s*\d{1,2}:\d{2}\s*[AP]M)?)/i,
    /due(?: date)?(?: on)?:?\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?)/i,
    /due(?: date)?(?: on)?:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?: \d{1,2}:\d{2}\s*[AP]M)?)/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const ts = Date.parse(match[1].replace(/\s+at\s+/i, ' '));
    if (Number.isFinite(ts)) return new Date(ts).toISOString();
  }
  return '';
}

function looksSubmitted(text) {
  const value = String(text || '');
  if (/\b(?:0|no) submissions?\b|\bnot submitted\b|\bunsubmitted\b|\bsubmission required\b/i.test(value)) return false;
  return /\b[1-9]\d*\s+submissions?\b|\b(submitted|submission complete|turned in|graded|completed)\b/i.test(value);
}

function extractTitle(text, fallback) {
  const title = String(text || '')
    .split(/\b(?:due(?: date)?|status|submission)\b/i)[0]
    .replace(/\s+/g, ' ').trim().replace(/[:\-–]+$/, '').trim();
  return title.slice(0, 180) || fallback;
}

function hasUsableInstructions(item) {
  const text = [item.instructions, item.description, item.requirements, item.files?.map(f => f.name).join(' ')].filter(Boolean).join(' ');
  return text.trim().length >= 80 || (Array.isArray(item.files) && item.files.length > 0);
}

function sameOrigin(urlA, urlB) {
  try { return new URL(urlA).origin === new URL(urlB).origin; } catch { return false; }
}

function absoluteUrl(base, href) {
  try { return new URL(href, base).href; } catch { return ''; }
}

function parseConfiguredCourseUrls(value = process.env.BRIGHTSPACE_COURSE_URLS || '') {
  return Array.from(new Set(String(value).split(/[\n,]/).map(cleanUrl).filter(Boolean)));
}

// ── sign-in detection + messaging ────────────────────────────────────────────

function loginPageReason({ url = '', title = '', bodyText = '', hasPassword = false } = {}) {
  const pageIdentity = `${url} ${title}`;
  const bodySample = String(bodyText).slice(0, 3000);
  if (hasPassword
      || /\b(sign in|log in|login|single sign-on|authenticate|authentication required)\b/i.test(pageIdentity)
      || /\b(authentication required|session (?:has )?expired)\b/i.test(bodySample)) {
    return 'Brightspace sign-in is required.';
  }
  return '';
}

function mfaReason(bodyText = '') {
  if (/\b(verify your identity|two-factor|two-step|authenticator|enter the code|one-time (?:pass)?code|verification code|approve (?:the )?(?:sign-?in|request)|duo|mfa)\b/i.test(String(bodyText).slice(0, 4000))) {
    return 'Two-factor / MFA verification is required. Automated sign-in cannot complete it; complete a manual Brightspace sign-in on this device, or use an app that does not require interactive MFA.';
  }
  return '';
}

function browserErrorMessage(error) {
  const message = String(error?.message || error || 'Unknown browser error');
  if (/node is either not clickable or not an element/i.test(message)) {
    return 'Brightspace blocked automated interaction. Check your credentials and course URLs, then try again.';
  }
  return message;
}

function loginRequiredError(message) {
  const err = new Error(message);
  err.loginRequired = true;
  return err;
}

async function pageSnapshot(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title || '',
    bodyText: document.body?.innerText || '',
    hasPassword: Boolean(document.querySelector('input[type="password"]')),
  }));
}

async function isSignedIn(page) {
  try {
    const snap = await pageSnapshot(page);
    return !loginPageReason(snap);
  } catch {
    return false;
  }
}

async function assertSignedIn(page) {
  const snap = await pageSnapshot(page);
  const reason = loginPageReason(snap);
  if (reason) throw loginRequiredError(reason);
}

async function gotoBrightspace(page, url, timeout = 45000) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout });
  await settle(Number(process.env.BRIGHTSPACE_SETTLE_MS) || 1200);
  await assertSignedIn(page);
}

// ── credential-based login automation ────────────────────────────────────────

async function submitFrameForm(frame, field) {
  const clicked = await frame.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll(
      'button[type=submit], input[type=submit], button#next, #idSIButton9, button, [role=button]'
    ));
    const match = candidates.find(el => {
      const label = (el.value || el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
      return /\b(sign in|log ?in|next|continue|submit|verify)\b/i.test(label) || el.type === 'submit';
    });
    if (match) { match.click(); return true; }
    return false;
  }).catch(() => false);
  if (!clicked && field) {
    try { await field.press('Enter'); } catch {}
  }
}

// Fills whatever login step is visible. Returns 'password' | 'username' | ''.
async function fillLoginStep(page, username, password) {
  for (const frame of page.frames()) {
    let pw;
    try { pw = await frame.$('input[type=password]'); } catch { pw = null; }
    if (pw) {
      try {
        const userField = await frame.$('input[type=email], input[type=text]:not([type=hidden]), input[name*=user i], input[name*=email i], input[id*=user i], input[id*=email i]');
        if (userField) {
          await userField.click({ clickCount: 3 }).catch(() => {});
          await userField.type(username, { delay: 12 });
        }
        await pw.click({ clickCount: 3 }).catch(() => {});
        await pw.type(password, { delay: 12 });
        await submitFrameForm(frame, pw);
        return 'password';
      } catch {}
    }
  }
  for (const frame of page.frames()) {
    let userField;
    try {
      userField = await frame.$('input[type=email], input[name*=user i], input[name*=email i], input[id*=user i], input[id*=email i]');
    } catch { userField = null; }
    if (userField) {
      try {
        await userField.click({ clickCount: 3 }).catch(() => {});
        await userField.type(username, { delay: 12 });
        await submitFrameForm(frame, userField);
        return 'username';
      } catch {}
    }
  }
  return '';
}

async function performLogin(page, cfg) {
  const password = decryptSecret(cfg.credential);
  if (!cfg.username || !password) {
    throw loginRequiredError('No saved Brightspace credentials. Open the app and finish setup.');
  }
  const loginUrl = cfg.loginUrl || cfg.startUrl;
  await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await settle(Number(process.env.BRIGHTSPACE_SETTLE_MS) || 1500);

  for (let attempt = 0; attempt < 4; attempt++) {
    if (await isSignedIn(page)) break;
    const snap = await pageSnapshot(page).catch(() => ({}));
    const mfa = mfaReason(snap.bodyText);
    if (mfa) throw loginRequiredError(mfa);

    const step = await fillLoginStep(page, cfg.username, password);
    if (!step) break;
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await settle(Number(process.env.BRIGHTSPACE_SETTLE_MS) || 1500);
  }

  // Confirm against the real landing page.
  await page.goto(cfg.startUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await settle(Number(process.env.BRIGHTSPACE_SETTLE_MS) || 1200);
  if (await isSignedIn(page)) return true;

  const snap = await pageSnapshot(page).catch(() => ({}));
  const mfa = mfaReason(snap.bodyText);
  throw loginRequiredError(mfa || 'Automated Brightspace sign-in failed. Double-check your username, password, and login URL. If your school uses SSO/MFA, automated login may not be possible.');
}

// ── browser launch (serialised, one at a time) ───────────────────────────────

async function launchBrowser(profileDir, headless) {
  const puppeteer = require('puppeteer-extra');
  try {
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
  } catch {}
  return puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    userDataDir: profileDir,
  });
}

function runExclusive(fn) {
  const result = browserChain.then(fn);
  browserChain = result.then(() => {}, () => {});
  return result;
}

// ── Brightspace discovery (course + assignment scraping) ─────────────────────

async function deepLinks(page, { pinnedOnly = false } = {}) {
  return page.evaluate(() => {
    const roots = [document];
    const links = [];
    const pinnedCourseNames = [];
    const pinEvidence = node => {
      if (!node?.querySelectorAll) return false;
      const elements = [node, ...node.querySelectorAll('*')];
      return elements.some(element => {
        const label = [
          element.getAttribute?.('aria-label'),
          element.getAttribute?.('title'),
          element.getAttribute?.('data-pinned'),
          element.getAttribute?.('class'),
        ].filter(Boolean).join(' ');
        return /\b(unpin|pinned|remove(?: from)? pinned)\b/i.test(label)
          || (element.getAttribute?.('aria-pressed') === 'true' && /\bpin\b/i.test(label));
      });
    };
    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) roots.push(node.shadowRoot);
      }
    }
    for (const root of roots) {
      for (const element of root.querySelectorAll('*')) {
        const label = [element.getAttribute?.('aria-label'), element.getAttribute?.('title')].filter(Boolean).join(' ');
        const match = label.match(/^(.+?)\s+is pinned\b.*\bunpin course\b/i);
        if (match) pinnedCourseNames.push(match[1].replace(/\s+/g, ' ').trim().toLowerCase());
      }
    }
    for (const root of roots) {
      for (const anchor of root.querySelectorAll('a[href]')) {
        const itemSelector = 'd2l-card,d2l-list-item,d2l-menu-item,d2l-menu-item-link,tr,li,article,[role="menuitem"],[role="option"],[data-course-id]';
        const item = anchor.closest(itemSelector);
        const hostItem = root.host?.closest?.('d2l-card,d2l-list-item,d2l-menu-item,tr,li,article,[role="menuitem"],[role="option"],[data-course-id]');
        const hostText = item?.innerText || '';
        const text = (hostText || anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim();
        const href = anchor.href || '';
        const normalizedText = text.toLowerCase();
        const pinnedByLabel = /\/d2l\/home\/\d+(?:[/?#]|$)/i.test(href)
          && pinnedCourseNames.some(name => normalizedText.startsWith(name));
        const pinned = pinnedByLabel || [item, root.host, hostItem, anchor].some(pinEvidence);
        links.push({ text, href: anchor.href || '', pinned });
      }
    }
    return links;
  }).then(links => pinnedOnly ? links.filter(link => link.pinned) : links);
}

async function openCourseDropdown(page) {
  const opened = await page.evaluate(() => {
    const roots = [document];
    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) roots.push(node.shadowRoot);
      }
      for (const element of root.querySelectorAll('button,[role="button"],d2l-button-icon,d2l-dropdown-button')) {
        const identity = [
          element.getAttribute?.('aria-label'),
          element.getAttribute?.('title'),
          element.innerText,
          element.textContent,
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (/\b(select a course|course selector|course menu|my courses)\b/i.test(identity)) {
          element.click();
          return true;
        }
      }
    }
    return false;
  });
  if (opened) await settle(Number(process.env.BRIGHTSPACE_SETTLE_MS) || 1200);
}

async function discoverPinnedCourseLinks(page, startUrl) {
  const links = (await deepLinks(page, { pinnedOnly: true }))
    .map(link => ({ title: link.text.split(',')[0].trim(), href: link.href }))
    .filter(link => link.href && link.title);
  const include = new RegExp(process.env.BRIGHTSPACE_COURSE_LINK_PATTERN || '(course|d2l/home/\\d+|d2l/le/content|homepage|ou=)', 'i');
  const exclude = /(logout|profile|calendar|message|notification|help|settings|navbar|javascript:)/i;
  const byHref = new Map();
  for (const link of links) {
    if (!sameOrigin(startUrl, link.href)) continue;
    if (exclude.test(link.href) || exclude.test(link.title)) continue;
    if (!include.test(link.href + ' ' + link.title)) continue;
    byHref.set(link.href.split('#')[0], { title: link.title.slice(0, 120), href: link.href.split('#')[0] });
  }
  return Array.from(byHref.values());
}

async function discoverAssignmentPages(page, startUrl) {
  const current = page.url();
  const links = await deepLinks(page);
  const explicit = (process.env.BRIGHTSPACE_ASSIGNMENT_PATHS || '')
    .split(',').map(part => absoluteUrl(current, part.trim()))
    .filter(href => href && /\/d2l\/lms\/dropbox\/(?:dropbox|user\/folders_list)\.d2l/i.test(href));
  const byHref = new Map();
  for (const href of explicit) byHref.set(href, href);
  for (const link of links) {
    if (!sameOrigin(startUrl, link.href)) continue;
    if (/\/d2l\/lms\/dropbox\/(?:dropbox|user\/folders_list)\.d2l/i.test(link.href)) {
      byHref.set(link.href.split('#')[0], link.href.split('#')[0]);
    }
  }
  return Array.from(byHref.values());
}

async function scrapeAssignmentRows(page) {
  const listSelector = process.env.BRIGHTSPACE_ASSIGNMENT_SELECTOR || 'a, d2l-card, d2l-list-item, tr, li, article';
  const rows = await page.evaluate(selector => {
    const roots = [document];
    const results = [];
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
      const root = roots[rootIndex];
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) roots.push(node.shadowRoot);
      }
      for (const node of root.querySelectorAll(selector)) {
        const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        const link = node.href || node.querySelector?.('a[href]')?.href || location.href;
        results.push({ index: results.length, text, link });
      }
    }
    return results.filter(row => row.text && row.text.length > 20);
  }, listSelector);

  const byLink = new Map();
  for (const row of rows) {
    if (!/\/d2l\/lms\/dropbox\/user\/folder_submit_files\.d2l/i.test(row.link)) continue;
    const existing = byLink.get(row.link);
    if (!existing || row.text.length > existing.text.length) byLink.set(row.link, row);
  }
  return Array.from(byLink.values()).slice(0, 80);
}

function withDefaults(cfg = {}) {
  const courses = Array.isArray(cfg.courses) ? cfg.courses : [];
  return {
    startUrl: cfg.startUrl || cleanUrl(process.env.BRIGHTSPACE_ASSIGNMENTS_URL || process.env.BRIGHTSPACE_URL || parseConfiguredCourseUrls()[0]),
    loginUrl: cfg.loginUrl || '',
    username: cfg.username || '',
    credential: cfg.credential || null,
    courses,
    courseMode: cfg.courseMode || (courses.length ? 'list' : 'pinned'),
    profileDir: cfg.profileDir || process.env.BRIGHTSPACE_USER_DATA_DIR || path.join(DATA_DIR, 'browser-profile'),
    dueWindowDays: Number(cfg.dueWindowDays) || DEFAULT_DUE_WINDOW_DAYS,
    email: cfg.email || '',
  };
}

async function scrapeBrightspace(rawCfg = {}) {
  const cfg = withDefaults(rawCfg);
  const startUrl = cfg.startUrl;
  if (!startUrl) throw new Error('A Brightspace start URL is required.');

  const browser = await launchBrowser(cfg.profileDir, process.env.BRIGHTSPACE_HEADLESS !== '0');
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 900 });
    await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await settle(Number(process.env.BRIGHTSPACE_INITIAL_SETTLE_MS) || 2500);

    if (!(await isSignedIn(page))) {
      if (cfg.credential) {
        await performLogin(page, cfg);
      } else {
        await assertSignedIn(page);
      }
    }

    const currentUrl = page.url();
    let targets;
    if (cfg.courseMode === 'list' && cfg.courses.length) {
      targets = cfg.courses.map(c => ({ title: c.name || hostnameLabel(c.url), href: c.url }));
    } else {
      await openCourseDropdown(page);
      targets = await discoverPinnedCourseLinks(page, startUrl);
    }

    const candidates = [];
    const courses = [];
    if (!targets.length) {
      courses.push({
        title: cfg.courseMode === 'list' ? 'Configured courses' : 'Pinned Brightspace courses',
        url: currentUrl,
        status: 'none-found',
        assignments: 0,
        errors: [cfg.courseMode === 'list'
          ? 'No valid course URLs were configured.'
          : 'No pinned courses found in the Brightspace course dropdown. Pin a course (or switch to a course list), then try again.'],
      });
    }

    for (const course of targets.slice(0, MAX_COURSES)) {
      const result = { title: course.title, url: course.href, status: 'checking', assignments: 0, errors: [] };
      try {
        await gotoBrightspace(page, course.href);
        const pages = await discoverAssignmentPages(page, startUrl);
        if (!pages.length) result.errors.push('Assignments section not found for this course.');
        for (const assignmentPageUrl of pages.slice(0, 6)) {
          try {
            if (assignmentPageUrl !== page.url()) await gotoBrightspace(page, assignmentPageUrl);
            const rows = await scrapeAssignmentRows(page);
            for (const row of rows) {
              const title = extractTitle(row.text, `Assignment ${row.index + 1}`);
              candidates.push({
                brightspaceId: normalizeId(row.link + '|' + title),
                sourceUrl: row.link,
                title,
                course: result.title,
                dueAt: extractDueDate(row.text),
                submitted: looksSubmitted(row.text),
                instructions: row.text.slice(0, MAX_TEXT),
                files: [],
                scrapedAt: nowIso(),
              });
            }
          } catch (err) {
            result.errors.push(`Assignment page ${assignmentPageUrl}: ${browserErrorMessage(err)}`);
          }
        }
        result.status = result.errors.length ? 'partial' : 'ok';
      } catch (err) {
        const message = browserErrorMessage(err);
        result.status = err.loginRequired ? 'login-required' : 'failed';
        result.errors.push(message);
      }
      courses.push(result);
    }

    const byId = new Map();
    for (const item of candidates) byId.set(item.brightspaceId, item);
    const assignments = Array.from(byId.values());
    for (const result of courses) {
      result.assignments = assignments.filter(item => item.course === result.title).length;
    }

    for (const assignment of assignments.filter(a => !a.submitted).slice(0, 30)) {
      if (!assignment.sourceUrl || assignment.sourceUrl === page.url()) continue;
      try {
        await gotoBrightspace(page, assignment.sourceUrl);
        const detail = await page.evaluate(() => {
          const bodyText = (document.body?.innerText || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
          const files = Array.from(document.querySelectorAll('a[href]')).map(a => {
            const href = a.href || '';
            const name = (a.innerText || a.textContent || href.split('/').pop() || '').replace(/\s+/g, ' ').trim();
            return { name, href };
          }).filter(file => file.name && /\.(pdf|docx?|pptx?|xlsx?|txt|rtf|zip)$/i.test(file.name + ' ' + file.href));
          const heading = document.querySelector('h1,h2')?.innerText?.trim() || '';
          return { bodyText, files, heading };
        });
        if (detail.heading && !/^are you still there\??$/i.test(detail.heading) && assignment.title.length < 30) {
          assignment.title = detail.heading.slice(0, 180);
        }
        if (detail.bodyText && detail.bodyText.length > assignment.instructions.length) {
          assignment.instructions = detail.bodyText.slice(0, MAX_TEXT);
          assignment.dueAt = assignment.dueAt || extractDueDate(detail.bodyText);
          assignment.submitted = assignment.submitted || looksSubmitted(detail.bodyText);
        }
        assignment.files = detail.files.slice(0, 20);
      } catch (err) {
        const message = browserErrorMessage(err);
        assignment.detailError = message;
        const result = courses.find(course => course.title === assignment.course);
        if (result) { result.status = 'partial'; result.errors.push(`Assignment detail ${assignment.title}: ${message}`); }
      }
    }

    return { assignments, courses };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── coaching (OpenAI) ─────────────────────────────────────────────────────────

const COACH_SYSTEM_PROMPT = [
  'You are an academic coach helping a student understand and plan an assignment.',
  'Do not write a completed submission or final answer. Provide structure and guidance only —',
  'this is academic support, never coursework-completion.',
  'Return concise Markdown with these sections: Requirements, Deliverables, Suggested Outline,',
  'Work Plan, Questions To Resolve, Quality Checklist.',
  'If the assignment asks for an essay, lab, coding task, quiz, or problem set, give the student',
  'a plan and checklist — do not produce the answer itself.',
  'Respond only with the Markdown coaching notes. Do not include reasoning, preamble, or meta-commentary.',
].join(' ');

function buildCoachPrompt(assignment, extraInstructions) {
  return [
    extraInstructions ? `Additional student instructions: ${extraInstructions}` : '',
    `Title: ${assignment.title}`,
    `Course: ${assignment.course || 'Unknown'}`,
    `Due: ${assignment.dueAt || 'Unknown'}`,
    `Materials: ${(assignment.files || []).map(f => f.name).join(', ') || 'No files detected'}`,
    '',
    'Assignment text:',
    (assignment.instructions || '').slice(0, MAX_TEXT),
  ].filter(Boolean).join('\n');
}

// Coaching is generated with Anthropic's latest model (Claude Opus 4.8) via the
// Messages API. Raw HTTP keeps it consistent with the rest of this stdlib-only module
// and avoids adding an npm dependency to the no-build-step server.
async function createCoaching(assignment, extraInstructions = '') {
  if (!process.env.ANTHROPIC_API_KEY) {
    return 'AI coaching is not configured on the server. Set ANTHROPIC_API_KEY to enable coaching notes.';
  }
  const response = await httpJson('https://api.anthropic.com/v1/messages', {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: coachModel(),
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      system: COACH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildCoachPrompt(assignment, extraInstructions) }],
    },
    timeoutMs: 90000,
  });
  if (response.stop_reason === 'refusal') {
    return 'The coaching model declined to respond to this assignment. Try editing the assignment text or request a revision.';
  }
  const text = Array.isArray(response.content)
    ? response.content.filter(block => block.type === 'text').map(block => block.text || '').join('\n').trim()
    : '';
  return text || 'No coaching output returned.';
}

// ── email (Resend) ────────────────────────────────────────────────────────────

function httpJson(url, { method = 'POST', headers = {}, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search, port: u.port || 443,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.response = parsed;
          reject(err);
        } else resolve(parsed);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function sendEmail(to, { subject, text, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.ASSIGNMENTS_FROM_EMAIL) {
    return { skipped: true, reason: 'Server email (Resend) is not configured.' };
  }
  if (!EMAIL_RE.test(String(to || ''))) return { skipped: true, reason: 'No valid recipient email.' };
  return httpJson('https://api.resend.com/emails', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: { from: process.env.ASSIGNMENTS_FROM_EMAIL, to: [to], subject, text, html },
  });
}

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://yannickmorgans.ca').replace(/\/+$/, '');
}

function signingSecret() {
  return process.env.ASSIGNMENTS_ACTION_SECRET || process.env.MCP_SECRET || readOrCreateKeyFile();
}

function signAction(userId, id, action, expires) {
  return crypto.createHmac('sha256', signingSecret()).update(`${userId}:${id}:${action}:${expires}`).digest('hex');
}

function actionUrl(userId, id, action) {
  const expires = Date.now() + ACTION_TTL_MS;
  const sig = signAction(userId, id, action, expires);
  return `${baseUrl()}/assignments/?user=${encodeURIComponent(userId)}&assignment=${encodeURIComponent(id)}&action=${encodeURIComponent(action)}&expires=${expires}&sig=${sig}`;
}

function verifyAction({ userId, id, action, expires, sig }) {
  const exp = Number(expires);
  if (!userId || !id || !action || !sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = signAction(userId, id, action, exp);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function assignmentEmailSection(userId, assignment) {
  const yes = actionUrl(userId, assignment.id, 'yes');
  const no = actionUrl(userId, assignment.id, 'no');
  const never = actionUrl(userId, assignment.id, 'never');
  const attempts = Array.isArray(assignment.attempts) ? assignment.attempts : [];
  const coaching = attempts.length ? attempts[attempts.length - 1].coaching : '';
  const button = (href, label, color) => `<a href="${href}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 13px;border-radius:7px;background:${color};color:#fff;text-decoration:none;font-weight:700">${label}</a>`;
  return `
    <div style="border:1px solid #e2e2e2;border-radius:9px;padding:14px 16px;margin:0 0 16px">
      <h3 style="margin:0 0 4px">${htmlEscape(assignment.title)}</h3>
      <p style="margin:0 0 8px;color:#555">${htmlEscape(assignment.course || 'Brightspace')} · Due ${htmlEscape(assignment.dueAt || 'Unknown')} · ${htmlEscape(assignment.status || 'new')}</p>
      <p>${button(yes, 'YES', '#26734d')}${button(no, 'NO / revise', '#2457a6')}${button(never, 'NEVER', '#777')}</p>
      ${coaching ? `<details open><summary style="cursor:pointer;font-weight:700">Coaching Notes</summary><div style="margin-top:8px"><p>${markdownToHtml(coaching)}</p></div></details>` : ''}
    </div>`;
}

function digestHtml(userId, assignments, windowDays) {
  const sections = assignments.map(a => assignmentEmailSection(userId, a)).join('');
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.45;color:#111;max-width:680px;margin:0 auto;padding:8px">
    <h2 style="margin:0 0 4px">Your assignment coach</h2>
    <p style="color:#555;margin:0 0 18px">${assignments.length} assignment${assignments.length === 1 ? '' : 's'} due within ${windowDays} day${windowDays === 1 ? '' : 's'}. Reply to the buttons to mark reviewed, request a revision, or stop tracking.</p>
    ${sections}
  </body></html>`;
}

function digestText(assignments) {
  return assignments.map(a => {
    const attempts = Array.isArray(a.attempts) ? a.attempts : [];
    const coaching = attempts.length ? attempts[attempts.length - 1].coaching : '';
    return `${a.title}\n${a.course || 'Brightspace'} · Due ${a.dueAt || 'Unknown'} · ${a.status}\n\n${coaching || 'No coaching notes.'}\n`;
  }).join('\n----------------------------------------\n\n');
}

async function sendDigestEmail(userId, config, assignments) {
  if (!assignments.length) return { skipped: true, reason: 'Nothing due.' };
  const windowDays = Number(config.dueWindowDays) || DEFAULT_DUE_WINDOW_DAYS;
  return sendEmail(config.email, {
    subject: `Assignment coach: ${assignments.length} due in the next ${windowDays} day${windowDays === 1 ? '' : 's'}`,
    text: digestText(assignments),
    html: digestHtml(userId, assignments, windowDays),
  });
}

// ── per-user check + daily run ───────────────────────────────────────────────

// Runs a full check for one user. options: { manual, sendDigest }
async function runCheck(userId, { manual = false, sendDigest = false } = {}) {
  if (!isValidUserId(userId)) return { ok: false, error: 'Invalid user' };
  const config = readConfig(userId);
  if (!isConfigured(config)) return { ok: false, status: 400, error: 'Finish setup before running a check.' };
  if (config.enabled === false && !manual) return { ok: true, skipped: true, reason: 'Tracking disabled.' };
  if (runningUsers.has(userId)) return { ok: false, status: 409, error: 'A check is already running.' };

  runningUsers.add(userId);
  const run = { id: crypto.randomUUID(), startedAt: nowIso(), manual, found: 0, emailed: 0, errors: [] };
  try {
    const state = readState(userId);
    const scraped = await runExclusive(() => scrapeBrightspace({
      startUrl: config.startUrl,
      loginUrl: config.loginUrl,
      username: config.username,
      credential: config.credential,
      courses: config.courses,
      courseMode: config.courseMode,
      profileDir: userProfileDir(userId),
      dueWindowDays: config.dueWindowDays,
    }));

    const items = scraped.assignments;
    run.courses = scraped.courses;
    run.found = items.length;
    for (const course of scraped.courses) {
      for (const error of course.errors) run.errors.push(`${course.title}: ${error}`);
    }

    const windowDays = Number(config.dueWindowDays) || DEFAULT_DUE_WINDOW_DAYS;
    const actionable = [];

    for (const item of items) {
      const id = item.brightspaceId;
      const existing = state.assignments[id] || {};
      const assignment = {
        ...existing, ...item, id,
        status: existing.status || 'new',
        attempts: Array.isArray(existing.attempts) ? existing.attempts : [],
        firstSeenAt: existing.firstSeenAt || nowIso(),
        lastCheckedAt: nowIso(),
      };

      if (assignment.submitted) assignment.status = 'completed';
      if (existing.status === 'suppressed') { state.assignments[id] = assignment; continue; }
      if (assignment.submitted || !dueWithinWindow(assignment.dueAt, windowDays)) {
        state.assignments[id] = assignment;
        continue;
      }

      if (!hasUsableInstructions(assignment)) {
        assignment.status = assignment.status === 'reviewed' ? assignment.status : 'needs-info';
        state.assignments[id] = assignment;
        continue;
      }

      // Generate coaching once per assignment (or after a revision request).
      if (!assignment.attempts.length || assignment.status === 'new') {
        try {
          const coaching = await createCoaching(assignment);
          assignment.status = 'coached';
          assignment.attempts.push({ at: nowIso(), kind: 'initial', instructions: '', coaching });
        } catch (err) {
          run.errors.push(`${assignment.title}: ${err.message}`);
        }
      }

      state.assignments[id] = assignment;
      if (assignment.status !== 'suppressed') actionable.push(assignment);
    }

    if (sendDigest && actionable.length) {
      try {
        const result = await sendDigestEmail(userId, config, actionable);
        if (!result.skipped) {
          run.emailed = actionable.length;
          for (const a of actionable) state.assignments[a.id].lastEmailedAt = nowIso();
        } else {
          run.errors.push(`Email skipped: ${result.reason}`);
        }
      } catch (err) {
        run.errors.push(`Email failed: ${err.message}`);
      }
    }

    run.finishedAt = nowIso();
    state.runs = [...state.runs, run].slice(-50);
    writeState(userId, state);
    return { ok: true, run: publicRun(run) };
  } catch (err) {
    const state = readState(userId);
    run.finishedAt = nowIso();
    run.errors.push(browserErrorMessage(err));
    state.runs = [...state.runs, run].slice(-50);
    writeState(userId, state);
    return { ok: false, error: browserErrorMessage(err), run: publicRun(run) };
  } finally {
    runningUsers.delete(userId);
  }
}

// Send the morning digest from current state without re-scraping.
async function emailNow(userId) {
  if (!isValidUserId(userId)) return { ok: false, error: 'Invalid user' };
  const config = readConfig(userId);
  if (!isConfigured(config)) return { ok: false, status: 400, error: 'Finish setup first.' };
  const state = readState(userId);
  const windowDays = Number(config.dueWindowDays) || DEFAULT_DUE_WINDOW_DAYS;
  const actionable = Object.values(state.assignments).filter(a =>
    a.status !== 'suppressed' && a.status !== 'completed' && !a.submitted && dueWithinWindow(a.dueAt, windowDays));
  if (!actionable.length) return { ok: true, emailed: 0, reason: 'Nothing due within your window.' };
  const result = await sendDigestEmail(userId, config, actionable);
  if (result.skipped) return { ok: false, status: 400, error: result.reason };
  for (const a of actionable) state.assignments[a.id].lastEmailedAt = nowIso();
  writeState(userId, state);
  return { ok: true, emailed: actionable.length };
}

async function handleAction({ userId, id, action, instructions = '' }) {
  if (!isValidUserId(userId)) return { ok: false, status: 400, error: 'Invalid user' };
  const state = readState(userId);
  const assignment = state.assignments[id];
  if (!assignment) return { ok: false, status: 404, error: 'Assignment not found' };

  if (action === 'yes') {
    assignment.status = 'reviewed';
    assignment.reviewedAt = nowIso();
  } else if (action === 'never') {
    assignment.status = 'suppressed';
    assignment.suppressedAt = nowIso();
  } else if (action === 'no') {
    const note = String(instructions || '').trim().slice(0, 4000);
    if (!note) return { ok: false, status: 400, error: 'Add instructions for the revision.' };
    const config = readConfig(userId);
    const coaching = await createCoaching(assignment, note);
    assignment.status = 'coached';
    assignment.attempts = Array.isArray(assignment.attempts) ? assignment.attempts : [];
    assignment.attempts.push({ at: nowIso(), kind: 'revision', instructions: note, coaching });
    if (config && isConfigured(config)) {
      assignment.lastEmailedAt = nowIso();
      try { await sendDigestEmail(userId, config, [assignment]); } catch {}
    }
  } else {
    return { ok: false, status: 400, error: 'Invalid action' };
  }

  state.assignments[id] = assignment;
  writeState(userId, state);
  return { ok: true, assignment: publicAssignment(assignment) };
}

// ── morning scheduler ─────────────────────────────────────────────────────────

function readScheduler() {
  try { return JSON.parse(fs.readFileSync(SCHEDULER_FILE, 'utf8')); } catch { return { lastRunDate: '' }; }
}
function writeScheduler(data) { atomicWrite(SCHEDULER_FILE, data); }

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function runDailyForAllUsers() {
  for (const userId of listUserIds()) {
    const config = readConfig(userId);
    if (!isConfigured(config) || config.enabled === false) continue;
    try {
      await runCheck(userId, { manual: false, sendDigest: true });
    } catch (err) {
      console.error(`[assignments] daily check failed for ${userId}:`, err.message);
    }
  }
}

function maybeRunDaily() {
  const now = new Date();
  if (now.getHours() < DAILY_HOUR) return;
  const today = localDateKey(now);
  const sched = readScheduler();
  if (sched.lastRunDate === today) return;
  writeScheduler({ ...sched, lastRunDate: today, startedAt: nowIso() });
  runDailyForAllUsers()
    .then(() => writeScheduler({ ...readScheduler(), finishedAt: nowIso() }))
    .catch(err => console.error('[assignments] daily run failed:', err.message));
}

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(maybeRunDaily, 15 * 60 * 1000); // check every 15 minutes
  setTimeout(maybeRunDaily, 30 * 1000);        // and shortly after boot
}

module.exports = {
  // per-user config + dashboard
  readConfig,
  publicConfig,
  isConfigured,
  saveConfig,
  deleteUserData,
  listAssignments,
  // actions
  runCheck,
  emailNow,
  handleAction,
  verifyAction,
  // scheduler
  startScheduler,
  runDailyForAllUsers,
  // testing surface
  _test: {
    encryptSecret,
    decryptSecret,
    publicConfig,
    saveConfig,
    isConfigured,
    signAction,
    verifyAction,
    parseCourses,
    cleanUrl,
    extractDueDate,
    looksSubmitted,
    extractTitle,
    parseConfiguredCourseUrls,
    loginPageReason,
    mfaReason,
    browserErrorMessage,
    dueWithinWindow,
    scrapeBrightspace,
  },
};
