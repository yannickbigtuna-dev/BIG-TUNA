const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'assignments');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const RUN_LOCK_MS = 20 * 60 * 1000;
const DAILY_CHECK_MS = 23 * 60 * 60 * 1000;
const DEFAULT_DUE_WINDOW_DAYS = 7;
const ACTION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 12000;

let running = false;
let schedulerStarted = false;
let loginBrowser = null;
let loginOpenedAt = '';

function nowIso() {
  return new Date().toISOString();
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      assignments: raw && typeof raw === 'object' && raw.assignments && typeof raw.assignments === 'object' ? raw.assignments : {},
      runs: Array.isArray(raw?.runs) ? raw.runs : [],
      updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch {
    return { assignments: {}, runs: [], updatedAt: '' };
  }
}

function writeState(state) {
  atomicWrite(STATE_FILE, { ...state, updatedAt: nowIso() });
}

function publicAssignment(a) {
  const { actionSecret, rawHtml, ...safe } = a;
  if (safe.scrapeError) safe.scrapeError = browserErrorMessage(safe.scrapeError);
  if (safe.detailError) safe.detailError = browserErrorMessage(safe.detailError);
  return safe;
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

function listAssignments() {
  const state = readState();
  return {
    configured: getConfigStatus(),
    activity: {
      checking: running,
      loginBrowserOpen: Boolean(loginBrowser),
      loginOpenedAt,
    },
    updatedAt: state.updatedAt,
    runs: state.runs.slice(-10).reverse().map(publicRun),
    assignments: Object.values(state.assignments).map(publicAssignment).sort((a, b) => {
      const ad = Date.parse(a.dueAt || '') || Infinity;
      const bd = Date.parse(b.dueAt || '') || Infinity;
      return ad - bd || String(a.title).localeCompare(String(b.title));
    }),
  };
}

function getConfigStatus() {
  const configuredCourseUrls = parseConfiguredCourseUrls();
  return {
    enabled: process.env.ASSIGNMENTS_ENABLED === '1',
    brightspace: Boolean(configuredCourseUrls.length || process.env.BRIGHTSPACE_ASSIGNMENTS_URL || process.env.BRIGHTSPACE_URL),
    configuredCourses: configuredCourseUrls.length,
    email: Boolean(process.env.RESEND_API_KEY && process.env.ASSIGNMENTS_TO_EMAIL && process.env.ASSIGNMENTS_FROM_EMAIL),
    openai: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || 'gpt-5.2',
    dueWindowDays: Number(process.env.ASSIGNMENTS_DUE_WINDOW_DAYS) || DEFAULT_DUE_WINDOW_DAYS,
  };
}

function isAdmin(user) {
  if (!user) return false;
  const allowed = (process.env.ASSIGNMENTS_ADMIN_USER || 'yannick').toLowerCase();
  return String(user.username || '').toLowerCase() === allowed;
}

function normalizeId(value) {
  const text = String(value || '').trim();
  if (!text) return crypto.randomUUID();
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);
}

function dueWithinWindow(dueAt) {
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return false;
  const windowMs = (Number(process.env.ASSIGNMENTS_DUE_WINDOW_DAYS) || DEFAULT_DUE_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  return due >= Date.now() - 6 * 60 * 60 * 1000 && due <= Date.now() + windowMs;
}

function htmlEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToHtml(text) {
  return htmlEscape(text)
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function httpJson(url, { method = 'POST', headers = {}, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
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
        } else {
          resolve(parsed);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function sendEmail({ subject, text, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.ASSIGNMENTS_TO_EMAIL || !process.env.ASSIGNMENTS_FROM_EMAIL) {
    return { skipped: true, reason: 'Email is not configured' };
  }
  return httpJson('https://api.resend.com/emails', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: {
      from: process.env.ASSIGNMENTS_FROM_EMAIL,
      to: [process.env.ASSIGNMENTS_TO_EMAIL],
      subject,
      text,
      html,
    },
  });
}

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://yannickmorgans.ca').replace(/\/+$/, '');
}

function signingSecret() {
  return process.env.ASSIGNMENTS_ACTION_SECRET || process.env.MCP_SECRET || process.env.OPENAI_API_KEY || '';
}

function signAction(id, action, expires) {
  const secret = signingSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(`${id}:${action}:${expires}`).digest('hex');
}

function actionUrl(id, action) {
  const expires = Date.now() + ACTION_TTL_MS;
  const sig = signAction(id, action, expires);
  return `${baseUrl()}/assignments/?assignment=${encodeURIComponent(id)}&action=${encodeURIComponent(action)}&expires=${expires}&sig=${sig}`;
}

function verifyAction({ id, action, expires, sig }) {
  const exp = Number(expires);
  if (!id || !action || !sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = signAction(id, action, exp);
  if (!expected) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
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
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:\-–]+$/, '')
    .trim();
  return title.slice(0, 180) || fallback;
}

function hasUsableInstructions(item) {
  const text = [item.instructions, item.description, item.requirements, item.files?.map(f => f.name).join(' ')].filter(Boolean).join(' ');
  return text.trim().length >= 80 || (Array.isArray(item.files) && item.files.length > 0);
}

function sameOrigin(urlA, urlB) {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
}

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

function parseConfiguredCourseUrls(value = process.env.BRIGHTSPACE_COURSE_URLS || '') {
  return Array.from(new Set(String(value)
    .split(/[\n,]/)
    .map(cleanUrl)
    .filter(Boolean)));
}

function loginPageReason({ url = '', title = '', bodyText = '', hasPassword = false } = {}) {
  const pageIdentity = `${url} ${title}`;
  const bodySample = String(bodyText).slice(0, 3000);
  if (hasPassword
      || /\b(sign in|log in|login|single sign-on|authenticate|authentication required)\b/i.test(pageIdentity)
      || /\b(authentication required|session (?:has )?expired)\b/i.test(bodySample)) {
    return 'Brightspace saved session expired. Sign in once using the configured browser profile, then run Check Now again.';
  }
  return '';
}

function browserErrorMessage(error) {
  const message = String(error?.message || error || 'Unknown browser error');
  if (/node is either not clickable or not an element/i.test(message)) {
    return 'Brightspace login requires a saved browser session. Automated clicking is disabled; sign in once using the configured browser profile, then run Check Now again.';
  }
  return message;
}

async function assertSignedIn(page) {
  const snapshot = await page.evaluate(() => ({
    url: location.href,
    title: document.title || '',
    bodyText: document.body?.innerText || '',
    hasPassword: Boolean(document.querySelector('input[type="password"]')),
  }));
  const reason = loginPageReason(snapshot);
  if (reason) throw new Error(reason);
}

async function gotoBrightspace(page, url, timeout = 45000) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout });
  await new Promise(resolve => setTimeout(resolve, Number(process.env.BRIGHTSPACE_SETTLE_MS) || 1200));
  await assertSignedIn(page);
}

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
  if (opened) {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.BRIGHTSPACE_SETTLE_MS) || 1200));
  }
}

async function scrapeBrightspace() {
  const configuredCourseUrls = parseConfiguredCourseUrls();
  const startUrl = process.env.BRIGHTSPACE_ASSIGNMENTS_URL || process.env.BRIGHTSPACE_URL || configuredCourseUrls[0];
  if (!startUrl) throw new Error('Set BRIGHTSPACE_COURSE_URLS, BRIGHTSPACE_ASSIGNMENTS_URL, or BRIGHTSPACE_URL');

  const browser = await launchBrightspaceBrowser(process.env.BRIGHTSPACE_HEADLESS !== '0');

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 900 });
    await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    await new Promise(resolve => setTimeout(resolve, Number(process.env.BRIGHTSPACE_INITIAL_SETTLE_MS) || 2500));
    await assertSignedIn(page);
    const currentUrl = page.url();
    await openCourseDropdown(page);
    const courseLinks = await discoverPinnedCourseLinks(page, startUrl);
    const targets = courseLinks;
    const candidates = [];
    const courses = [];

    if (!targets.length) {
      courses.push({
        title: 'Pinned Brightspace courses',
        url: currentUrl,
        status: 'none-pinned',
        assignments: 0,
        errors: ['No pinned courses were found in the Brightspace course dropdown. Pin a course, then run Check Now again.'],
      });
    }

    for (const course of targets.slice(0, Number(process.env.BRIGHTSPACE_MAX_COURSES) || 30)) {
      const result = { title: course.title, url: course.href, status: 'checking', assignments: 0, errors: [] };
      try {
        await gotoBrightspace(page, course.href);
        const assignmentUrls = await discoverAssignmentPages(page, startUrl);
        const pages = assignmentUrls;
        if (!pages.length) {
          result.errors.push('Assignments section not found for this pinned course.');
        }

        for (const assignmentPageUrl of pages.slice(0, 6)) {
          try {
            if (assignmentPageUrl !== page.url()) {
              await gotoBrightspace(page, assignmentPageUrl);
            }
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
        result.status = /saved browser session|saved session expired/i.test(message) ? 'login-required' : 'failed';
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
        if (result) {
          result.status = 'partial';
          result.errors.push(`Assignment detail ${assignment.title}: ${message}`);
        }
      }
    }
    return { assignments, courses };
  } finally {
    await browser.close();
  }
}

function brightspaceStartUrl() {
  return cleanUrl(process.env.BRIGHTSPACE_ASSIGNMENTS_URL || process.env.BRIGHTSPACE_URL || parseConfiguredCourseUrls()[0]);
}

function brightspaceProfileDir() {
  return process.env.BRIGHTSPACE_USER_DATA_DIR || path.join(DATA_DIR, 'browser-profile');
}

async function launchBrightspaceBrowser(headless) {
  const puppeteer = require('puppeteer-extra');
  try {
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
  } catch {}
  return puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    userDataDir: brightspaceProfileDir(),
  });
}

async function openLoginBrowser() {
  if (running) return { ok: false, status: 409, error: 'Wait for the current assignment check to finish.' };
  if (loginBrowser) return { ok: true, alreadyOpen: true, openedAt: loginOpenedAt };
  const startUrl = brightspaceStartUrl();
  if (!startUrl) return { ok: false, status: 400, error: 'Brightspace is not configured.' };

  let browser;
  try {
    browser = await launchBrightspaceBrowser(false);
    loginBrowser = browser;
    loginOpenedAt = nowIso();
    browser.once('disconnected', () => {
      loginBrowser = null;
      loginOpenedAt = '';
    });
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return { ok: true, openedAt: loginOpenedAt };
  } catch (err) {
    loginBrowser = null;
    loginOpenedAt = '';
    if (browser) {
      try { await browser.close(); } catch {}
    }
    return { ok: false, status: 500, error: browserErrorMessage(err) };
  }
}

async function closeLoginBrowser() {
  if (!loginBrowser) return { ok: true, alreadyClosed: true };
  const browser = loginBrowser;
  loginBrowser = null;
  loginOpenedAt = '';
  try {
    await browser.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, status: 500, error: browserErrorMessage(err) };
  }
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
    byHref.set(link.href.split('#')[0], {
      title: link.title.slice(0, 120),
      href: link.href.split('#')[0],
    });
  }
  return Array.from(byHref.values());
}

async function discoverAssignmentPages(page, startUrl) {
  const current = page.url();
  const links = await deepLinks(page);

  const explicit = (process.env.BRIGHTSPACE_ASSIGNMENT_PATHS || '')
    .split(',')
    .map(part => absoluteUrl(current, part.trim()))
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

function buildCoachPrompt(assignment, extraInstructions) {
  return [
    'You are an academic coach. Do not write a completed submission or final answer.',
    'Help the student understand and plan the assignment.',
    'Return concise Markdown with these sections: Requirements, Deliverables, Suggested Outline, Work Plan, Questions To Resolve, Quality Checklist.',
    'If the assignment asks for an essay, lab, coding task, quiz, or problem set, provide structure and guidance only.',
    extraInstructions ? `Additional student instructions: ${extraInstructions}` : '',
    '',
    `Title: ${assignment.title}`,
    `Course: ${assignment.course || 'Unknown'}`,
    `Due: ${assignment.dueAt || 'Unknown'}`,
    `Materials: ${(assignment.files || []).map(f => f.name).join(', ') || 'No files detected'}`,
    '',
    'Assignment text:',
    (assignment.instructions || '').slice(0, MAX_TEXT),
  ].filter(Boolean).join('\n');
}

async function createCoaching(assignment, extraInstructions = '') {
  if (!process.env.OPENAI_API_KEY) {
    return 'OpenAI is not configured. Set OPENAI_API_KEY and OPENAI_MODEL to enable coaching output.';
  }
  const model = process.env.OPENAI_MODEL || 'gpt-5.2';
  const body = {
    model,
    input: buildCoachPrompt(assignment, extraInstructions),
    max_output_tokens: 1800,
  };
  const response = await httpJson('https://api.openai.com/v1/responses', {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body,
    timeoutMs: 60000,
  });
  const text = response.output_text || response.output?.flatMap(o => o.content || []).map(c => c.text || '').join('\n') || '';
  return text.trim() || 'No coaching output returned.';
}

function emailHtml(title, intro, assignment, coaching) {
  const yes = actionUrl(assignment.id, 'yes');
  const no = actionUrl(assignment.id, 'no');
  const never = actionUrl(assignment.id, 'never');
  const button = (href, label, color) => `<a href="${href}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 14px;border-radius:7px;background:${color};color:#fff;text-decoration:none;font-weight:700">${label}</a>`;
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.45;color:#111">
    <h2>${htmlEscape(title)}</h2>
    <p>${htmlEscape(intro)}</p>
    <p><strong>${htmlEscape(assignment.title)}</strong><br>
    Due: ${htmlEscape(assignment.dueAt || 'Unknown')}<br>
    Status: ${htmlEscape(assignment.status || 'new')}</p>
    <p>${button(yes, 'YES', '#26734d')}${button(no, 'NO / revise', '#2457a6')}${button(never, 'NEVER', '#777')}</p>
    <h3>Assignment Prompt</h3>
    <p>${markdownToHtml(assignment.instructions || 'No assignment text detected.')}</p>
    <h3>Coaching Notes</h3>
    <p>${markdownToHtml(coaching)}</p>
  </body></html>`;
}

async function sendAssignmentEmail(assignment, coaching, intro = 'A Brightspace assignment needs attention.') {
  return sendEmail({
    subject: `Assignment coach: ${assignment.title}`,
    text: `${intro}\n\n${assignment.title}\nDue: ${assignment.dueAt || 'Unknown'}\n\nAssignment Prompt:\n${assignment.instructions || 'No text detected.'}\n\nCoaching Notes:\n${coaching}`,
    html: emailHtml('Assignment Coach', intro, assignment, coaching),
  });
}

async function sendMissingInfoEmail(assignment) {
  return sendEmail({
    subject: `Assignment needs info: ${assignment.title}`,
    text: `This assignment appears due soon, but no useful instructions or files were detected.\n\n${assignment.title}\nDue: ${assignment.dueAt || 'Unknown'}\n${assignment.sourceUrl || ''}`,
    html: emailHtml('Assignment Needs Info', 'This assignment appears due soon, but no useful instructions or files were detected.', assignment, 'Open Brightspace and add instructions or files before requesting coaching.'),
  });
}

async function runCheck({ manual = false } = {}) {
  if (running) return { ok: false, error: 'Assignment check already running' };
  if (loginBrowser) return { ok: false, error: 'Finish Brightspace Login before running an assignment check' };
  const status = getConfigStatus();
  if (!status.enabled && !manual) return { ok: true, skipped: true, reason: 'Assignments workflow disabled' };
  running = true;
  const run = { id: crypto.randomUUID(), startedAt: nowIso(), manual, found: 0, emailed: 0, errors: [] };
  try {
    const state = readState();
    const scraped = await scrapeBrightspace();
    const items = scraped.assignments;
    run.courses = scraped.courses;
    run.found = items.length;
    for (const course of scraped.courses) {
      for (const error of course.errors) run.errors.push(`${course.title}: ${error}`);
    }

    for (const item of items) {
      const id = item.brightspaceId;
      const existing = state.assignments[id] || {};
      const assignment = {
        ...existing,
        ...item,
        id,
        status: existing.status || 'new',
        attempts: Array.isArray(existing.attempts) ? existing.attempts : [],
        firstSeenAt: existing.firstSeenAt || nowIso(),
        lastCheckedAt: nowIso(),
      };

      if (assignment.submitted) assignment.status = 'completed';
      if (existing.status === 'suppressed') {
        state.assignments[id] = assignment;
        continue;
      }
      if (assignment.submitted || !dueWithinWindow(assignment.dueAt)) {
        state.assignments[id] = assignment;
        continue;
      }

      if (!hasUsableInstructions(assignment)) {
        if (assignment.status !== 'needs-info') {
          assignment.status = 'needs-info';
          assignment.lastEmailedAt = nowIso();
          await sendMissingInfoEmail(assignment);
          run.emailed++;
        }
        state.assignments[id] = assignment;
        continue;
      }

      if (assignment.status === 'new') {
        try {
          const coaching = await createCoaching(assignment);
          assignment.status = 'coached';
          assignment.lastEmailedAt = nowIso();
          assignment.attempts.push({ at: nowIso(), kind: 'initial', instructions: '', coaching });
          await sendAssignmentEmail(assignment, coaching);
          run.emailed++;
        } catch (err) {
          run.errors.push(`${assignment.title}: ${err.message}`);
        }
      }

      state.assignments[id] = assignment;
    }

    run.finishedAt = nowIso();
    const staleRuns = state.runs.filter(r => Date.now() - (Date.parse(r.startedAt) || 0) < 30 * 24 * 60 * 60 * 1000);
    state.runs = [...staleRuns, run].slice(-50);
    writeState(state);
    return { ok: true, run };
  } catch (err) {
    const state = readState();
    run.finishedAt = nowIso();
    run.errors.push(err.message);
    state.runs = [...state.runs, run].slice(-50);
    writeState(state);
    return { ok: false, error: err.message, run };
  } finally {
    running = false;
  }
}

async function handleAction({ id, action, instructions = '' }) {
  const state = readState();
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
    if (!note) return { ok: false, status: 400, error: 'Instructions required for a revision' };
    const coaching = await createCoaching(assignment, note);
    assignment.status = 'coached';
    assignment.lastEmailedAt = nowIso();
    assignment.attempts = Array.isArray(assignment.attempts) ? assignment.attempts : [];
    assignment.attempts.push({ at: nowIso(), kind: 'revision', instructions: note, coaching });
    await sendAssignmentEmail(assignment, coaching, 'Here is a revised coaching pass using your extra instructions.');
  } else {
    return { ok: false, status: 400, error: 'Invalid action' };
  }

  state.assignments[id] = assignment;
  writeState(state);
  return { ok: true, assignment: publicAssignment(assignment) };
}

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const scheduledCheck = () => {
    const state = readState();
    const last = state.runs[state.runs.length - 1];
    if (last && Date.now() - (Date.parse(last.startedAt) || 0) < RUN_LOCK_MS) return;
    if (last && Date.now() - (Date.parse(last.startedAt) || 0) < DAILY_CHECK_MS) return;
    runCheck().catch(err => console.error('[assignments] scheduled check failed:', err.message));
  };
  setInterval(scheduledCheck, 60 * 60 * 1000);
  setTimeout(scheduledCheck, 15000);
}

module.exports = {
  isAdmin,
  listAssignments,
  runCheck,
  handleAction,
  openLoginBrowser,
  closeLoginBrowser,
  verifyAction,
  getConfigStatus,
  startScheduler,
  _test: {
    extractDueDate,
    looksSubmitted,
    extractTitle,
    parseConfiguredCourseUrls,
    loginPageReason,
    browserErrorMessage,
    scrapeBrightspace,
  },
};
