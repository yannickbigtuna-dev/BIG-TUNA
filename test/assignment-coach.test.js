const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.ASSIGNMENTS_CRYPTO_SECRET = process.env.ASSIGNMENTS_CRYPTO_SECRET || 'test-crypto-secret';
process.env.ASSIGNMENTS_ACTION_SECRET = process.env.ASSIGNMENTS_ACTION_SECRET || 'test-action-secret';
process.env.BRIGHTSPACE_INITIAL_SETTLE_MS = process.env.BRIGHTSPACE_INITIAL_SETTLE_MS || '1';
process.env.BRIGHTSPACE_SETTLE_MS = process.env.BRIGHTSPACE_SETTLE_MS || '1';

const { _test } = require('../lib/assignment-coach');

test('configured course URLs are validated and deduplicated', () => {
  assert.deepEqual(_test.parseConfiguredCourseUrls(`
    https://school.example/d2l/home/123,
    javascript:alert(1),
    https://school.example/d2l/home/123#content
    https://school.example/d2l/home/456
  `), [
    'https://school.example/d2l/home/123',
    'https://school.example/d2l/home/456',
  ]);
});

test('parseCourses validates, dedupes, and labels course entries', () => {
  const courses = _test.parseCourses([
    'https://school.example/d2l/home/123',
    { name: 'Chem', url: 'https://school.example/d2l/home/456' },
    'javascript:alert(1)',
    'https://school.example/d2l/home/123',
  ]);
  assert.equal(courses.length, 2);
  assert.equal(courses[0].url, 'https://school.example/d2l/home/123');
  assert.equal(courses[1].name, 'Chem');
});

test('encrypts and decrypts a stored secret', () => {
  const blob = _test.encryptSecret('hunter2');
  assert.notEqual(blob.data, 'hunter2');
  assert.ok(blob.iv && blob.tag && blob.data);
  assert.equal(_test.decryptSecret(blob), 'hunter2');
  assert.equal(_test.decryptSecret(null), '');
  assert.equal(_test.decryptSecret({ iv: 'x', tag: 'y', data: 'z' }), '');
});

test('public config never leaks the encrypted credential', () => {
  const cfg = {
    enabled: true, startUrl: 'https://s.example/d2l/home', username: 'me',
    credential: _test.encryptSecret('secret'), email: 'me@example.com',
    courseMode: 'pinned', courses: [], dueWindowDays: 7,
  };
  const pub = _test.publicConfig(cfg);
  assert.equal(pub.hasPassword, true);
  assert.equal(pub.credential, undefined);
  assert.equal(JSON.stringify(pub).includes('secret'), false);
});

test('action links are signed per user and reject cross-user use', () => {
  const expires = Date.now() + 60000;
  const sig = _test.signAction('userA', 'assign1', 'yes', expires);
  assert.equal(_test.verifyAction({ userId: 'userA', id: 'assign1', action: 'yes', expires, sig }), true);
  assert.equal(_test.verifyAction({ userId: 'userB', id: 'assign1', action: 'yes', expires, sig }), false);
  assert.equal(_test.verifyAction({ userId: 'userA', id: 'assign1', action: 'never', expires, sig }), false);
  assert.equal(_test.verifyAction({ userId: 'userA', id: 'assign1', action: 'yes', expires: Date.now() - 1, sig }), false);
});

test('extracts common Brightspace due dates', () => {
  assert.match(_test.extractDueDate('Due date: June 15, 2026 at 11:59 PM'), /^2026-06-1[56]T/);
  assert.match(_test.extractDueDate('Due: 2026-06-15 23:59'), /^2026-06-1[56]T/);
});

test('detects submitted assignment statuses', () => {
  assert.equal(_test.looksSubmitted('Submission complete'), true);
  assert.equal(_test.looksSubmitted('1 Submission, 1 File'), true);
  assert.equal(_test.looksSubmitted('No submission yet'), false);
  assert.equal(_test.looksSubmitted('0 Submissions'), false);
  assert.equal(_test.looksSubmitted('Status: Not submitted'), false);
});

test('extracts clean assignment titles from row text', () => {
  assert.equal(_test.extractTitle('Research Essay Due: 2026-06-15 23:59 No submission yet', 'fallback'), 'Research Essay');
  assert.equal(_test.extractTitle('Lab Report due date June 15, 2026 Status not submitted', 'fallback'), 'Lab Report');
});

test('recognizes a Brightspace sign-in page', () => {
  assert.match(_test.loginPageReason({
    url: 'https://school.example/login',
    title: 'Sign In',
    bodyText: 'Enter your credentials',
    hasPassword: true,
  }), /sign[- ]?in is required/i);
  assert.equal(_test.loginPageReason({
    url: 'https://school.example/d2l/home/123',
    title: 'Course Home',
    bodyText: 'Assignments and announcements',
  }), '');
});

test('detects MFA / two-factor pages', () => {
  assert.match(_test.mfaReason('Enter the verification code we sent to your phone'), /two-factor|mfa/i);
  assert.equal(_test.mfaReason('Course home page'), '');
});

test('reports blocked automated interaction clearly', () => {
  assert.match(
    _test.browserErrorMessage(new Error('Node is either not clickable or not an Element')),
    /blocked automated interaction/i
  );
});

test('checks only pinned courses and their assignment sections', async t => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/d2l/home/123') {
      res.end(`<!doctype html><title>Biology 101</title><h1>Biology 101</h1>
        <d2l-card id="assignments"></d2l-card>
        <script>
          const root = document.querySelector('#assignments').attachShadow({mode:'open'});
          root.innerHTML = '<a href="/d2l/lms/dropbox/dropbox.d2l?ou=123">Assignments</a>';
        </script>`);
      return;
    }
    if (req.url === '/d2l/home/456') {
      res.end(`<!doctype html><title>Chemistry 101</title><h1>Chemistry 101</h1>
        <a href="/d2l/lms/dropbox/dropbox.d2l?ou=456">Assignments</a>`);
      return;
    }
    if (req.url === '/d2l/lms/dropbox/dropbox.d2l?ou=123') {
      res.end(`<!doctype html><title>Assignments</title>
        <d2l-list-item id="row"></d2l-list-item>
        <script>
          const root = document.querySelector('#row').attachShadow({mode:'open'});
          root.innerHTML = '<a href="/d2l/lms/dropbox/user/folder_submit_files.d2l?db=1&ou=123">Research Essay Due: 2026-06-10 23:59 No submission yet</a>';
        </script>`);
      return;
    }
    if (req.url === '/d2l/lms/dropbox/user/folder_submit_files.d2l?db=1&ou=123') {
      res.end('<!doctype html><h1>Are You Still There?</h1><p>Write a research essay with at least five cited sources and a clear argument.</p>');
      return;
    }
    if (req.url === '/d2l/lms/dropbox/dropbox.d2l?ou=456') {
      res.end('<!doctype html><a href="/assignment/lab">Chemistry Lab Due: 2026-06-10 23:59 No submission yet</a>');
      return;
    }
    res.end(`<!doctype html><title>Brightspace Home</title>
      <button aria-label="Select a course" id="open-courses">Courses</button>
      <div id="menu"></div>
      <script>
        document.querySelector('#open-courses').addEventListener('click', () => {
          const menu = document.querySelector('#menu');
          if (menu.childElementCount) return;
          const courses = document.createElement('d2l-course-menu');
          menu.appendChild(courses);
          const root = courses.attachShadow({mode:'open'});
          root.innerHTML = '<d2l-card id="biology"></d2l-card><d2l-card id="chemistry"></d2l-card>';
          const biology = root.querySelector('#biology').attachShadow({mode:'open'});
          biology.innerHTML = '<a href="/d2l/home/123">Biology 101</a><d2l-button-icon id="biology-pin"></d2l-button-icon>';
          biology.querySelector('#biology-pin').attachShadow({mode:'open'}).innerHTML =
            '<button aria-label="Biology 101 is pinned. Unpin course"></button>';
          const chemistry = root.querySelector('#chemistry').attachShadow({mode:'open'});
          chemistry.innerHTML = '<a href="/d2l/home/456">Chemistry 101</a><d2l-button-icon id="chemistry-pin"></d2l-button-icon>';
          chemistry.querySelector('#chemistry-pin').attachShadow({mode:'open'}).innerHTML =
            '<button aria-label="Pin Chemistry 101 course"></button>';
        });
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'assignment-coach-test-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));

  const result = await _test.scrapeBrightspace({
    startUrl: `http://127.0.0.1:${server.address().port}/`,
    profileDir: profile,
    courseMode: 'pinned',
  });
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].status, 'ok');
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].title, 'Research Essay');
  assert.equal(result.assignments[0].course, 'Biology 101');
  assert.match(result.assignments[0].instructions, /five cited sources/);
});
