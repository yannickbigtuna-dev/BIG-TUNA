const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'apps', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'apps', 'strava-challenge.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'apps', 'strava-challenge.css'), 'utf8');

test('homepage replaces the clock with the public Strava Cup mount without removing existing tools', () => {
  assert.match(html, /strava-challenge\.css/);
  assert.match(html, /id="strava-challenge"/);
  assert.doesNotMatch(html, /id="clock"/);
  assert.match(html, /id="ask-emma"/);
  assert.match(html, /id="downloads-btn"/);
  assert.match(html, /id="admin-dashboard-btn"/);
});

test('public interface keeps secondary content behind More while retaining public routes, demo and deep links', () => {
  assert.match(js, /\/api\/strava-challenge\/public/);
  assert.match(js, /public\/weeks/);
  assert.match(js, /challengeDemo/);
  assert.match(js, /\?week=/);
  assert.match(js, /Yannick/);
  assert.match(js, /Emma/);
  assert.match(js, /NOT QUALIFIED/);
  assert.match(js, /TIME TIEBREAKER/);
  assert.match(js, /sc-more-content/);
  assert.match(js, /expanded = false/);
  assert.match(js, /expanded=Boolean\(params\.get\('week'\)\)/);
  assert.match(js, /sc-recap/);
});

test('arena board fixes Yannick red, Emma blue, has mobile three-track layout and no page horizontal scroll', () => {
  assert.match(css, /--c-red/);
  assert.match(css, /--c-blue/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) 48px minmax\(0,1fr\)/);
  assert.match(html, /overflow-x: hidden/);
  assert.match(css, /max-width: 360px/);
  assert.match(css, /\.sc-recap-line/);
  assert.match(css, /text-overflow:ellipsis/);
});

test('compact recaps show only qualifying activities as semantic, expandable bullet lists', () => {
  assert.match(js, /a\.qualifies === true/);
  assert.match(js, /qualifying\.slice\(0,5\)/);
  assert.match(js, /Math\.max\(0,qualifying\.length-5\)/);
  assert.match(js, /<ul class="sc-recap-list"/);
  assert.match(js, /<li class="sc-recap-line"/);
  assert.match(js, /No qualifying activities yet/);
  assert.match(js, /\+\$\{remaining\} more/);
  assert.match(js, /Show latest 5/);
  assert.match(js, /aria-expanded="false"/);
  assert.match(js, /aria-controls="\$\{listId\}"/);
});

test('compact recap expansion state is independent per athlete and its construction has no status markers', () => {
  assert.match(js, /const recapExpanded = \{ yannick:false, emma:false \}/);
  assert.match(js, /recapExpanded\[id\]=!recapExpanded\[id\]/);
  const recapSource = js.match(/function recap[\s\S]*?function stats/)[0];
  assert.doesNotMatch(recapSource, /sc-yes|sc-no|✓|✕/);
  assert.match(js, /data-recap-toggle/);
});

test('compact recap bullets are explicit and preserve Yannick red and Emma blue with muted metrics', () => {
  assert.match(css, /\.sc-recap-list \{ margin:0; padding:0; list-style:none; \}/);
  assert.match(css, /\.sc-recap-line::before \{ content:'•'; \}/);
  assert.match(css, /\.sc-recap--y \.sc-recap-line::before \{ color:var\(--c-red\); \}/);
  assert.match(css, /\.sc-recap--e \.sc-recap-line::before \{ color:var\(--c-blue\); \}/);
  assert.match(css, /\.sc-recap-metric \{ color:var\(--text-muted\); \}/);
});
