const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

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

test('extracts common Brightspace due dates', () => {
  assert.match(_test.extractDueDate('Due date: June 15, 2026 at 11:59 PM'), /^2026-06-1[56]T/);
  assert.match(_test.extractDueDate('Due: 2026-06-15 23:59'), /^2026-06-1[56]T/);
});

test('detects submitted assignment statuses', () => {
  assert.equal(_test.looksSubmitted('Submission complete'), true);
  assert.equal(_test.looksSubmitted('No submission yet'), false);
  assert.equal(_test.looksSubmitted('Status: Not submitted'), false);
});

test('extracts clean assignment titles from row text', () => {
  assert.equal(_test.extractTitle('Research Essay Due: 2026-06-15 23:59 No submission yet', 'fallback'), 'Research Essay');
  assert.equal(_test.extractTitle('Lab Report due date June 15, 2026 Status not submitted', 'fallback'), 'Lab Report');
});

test('recognizes an expired saved Brightspace session', () => {
  assert.match(_test.loginPageReason({
    url: 'https://school.example/login',
    title: 'Sign In',
    bodyText: 'Enter your credentials',
    hasPassword: true,
  }), /saved session expired/i);
  assert.equal(_test.loginPageReason({
    url: 'https://school.example/d2l/home/123',
    title: 'Course Home',
    bodyText: 'Assignments and announcements',
  }), '');
});

test('replaces legacy clickable-node failures with saved-session instructions', () => {
  assert.match(
    _test.browserErrorMessage(new Error('Node is either not clickable or not an Element')),
    /automated clicking is disabled/i
  );
});

test('scrapes assignments rendered inside Brightspace-style shadow DOM', async t => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/course') {
      res.end(`<!doctype html><title>Biology 101</title><h1>Biology 101</h1>
        <d2l-card id="assignments"></d2l-card>
        <script>
          const root = document.querySelector('#assignments').attachShadow({mode:'open'});
          root.innerHTML = '<a href="/assignments">Assignments</a>';
        </script>`);
      return;
    }
    if (req.url === '/assignments') {
      res.end(`<!doctype html><title>Assignments</title>
        <d2l-list-item id="row"></d2l-list-item>
        <script>
          const root = document.querySelector('#row').attachShadow({mode:'open'});
          root.innerHTML = '<a href="/assignment/essay">Research Essay Due: 2026-06-10 23:59 No submission yet</a>';
        </script>`);
      return;
    }
    if (req.url === '/assignment/essay') {
      res.end('<!doctype html><h1>Research Essay</h1><p>Write a research essay with at least five cited sources and a clear argument.</p>');
      return;
    }
    res.end('<!doctype html><title>Brightspace Home</title><a href="/course">Biology 101 course</a>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'assignment-coach-test-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));

  const previous = {};
  const env = {
    BRIGHTSPACE_URL: `http://127.0.0.1:${server.address().port}/`,
    BRIGHTSPACE_USER_DATA_DIR: profile,
    BRIGHTSPACE_INITIAL_SETTLE_MS: '1',
    BRIGHTSPACE_SETTLE_MS: '1',
  };
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  t.after(() => {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  const result = await _test.scrapeBrightspace();
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].status, 'ok');
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].title, 'Research Essay');
  assert.equal(result.assignments[0].course, 'Biology 101');
  assert.match(result.assignments[0].instructions, /five cited sources/);
});
