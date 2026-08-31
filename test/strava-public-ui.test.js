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

test('manual activity refresh is auth-gated, bearer-authenticated, and refreshes the public dashboard', () => {
  assert.match(html, /<script src="\/auth\.js"><\/script>\s*<script src="\/strava-challenge\.js"><\/script>/);
  assert.match(js, /new Set\(\['yannick', 'fishyemma'\]\)/);
  assert.match(js, /String\(user && user\.username \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(js, /Auth\.onReady\(user =>/);
  assert.match(js, /\/api\/strava-challenge\/refresh/);
  assert.match(js, /Authorization:`Bearer \$\{Auth\.token\}`/);
  assert.match(js, /refresh\.busy=true/);
  assert.match(js, /disabled aria-busy="true"/);
  assert.match(js, /await loadPublicDashboard\(\)/);
  assert.match(js, /response\.status === 429/);
  assert.match(js, /result\.status === 'cooldown'/);
  assert.match(js, /result\.status === 'in_progress'/);
  assert.match(js, /result\.status === 'partial'/);
  assert.match(js, /result\.status === 'failed'/);
  assert.match(js, /Connected activities refreshed, but one account could not update or is not connected\./);
  assert.match(js, /Retry-After/);
  assert.match(js, /role="status" aria-live="polite"/);
});

test('manual refresh control uses existing scoreboard tokens with a 44px accessible target', () => {
  assert.match(css, /\.sc-refresh-button \{ min-width:44px; min-height:44px;/);
  assert.match(css, /var\(--accent\)/);
  assert.match(css, /\.sc-refresh-status--success \{ color:var\(--success\); \}/);
  assert.match(css, /\.sc-refresh-status--cooldown,\.sc-refresh-status--warning \{ color:var\(--warning\); \}/);
  assert.match(css, /\.sc-refresh-status--error \{ color:var\(--danger\); \}/);
});

test('activity previews and detailed feeds contain qualifying activities only, without check or x status markers', () => {
  assert.match(js, /function qualifyingActivities\(items\) \{ return \(items \|\| \[\]\)\.filter\(a => a\.qualifies === true\)/);
  assert.match(js, /qualifyingActivities\(w\.activities\)\.map\(activity\)/);
  assert.match(js, /const activities = qualifyingActivities\(w\.activities \|\| Object\.values/);
  const activitySource = js.match(/function activity[\s\S]*?function recap/)[0];
  assert.doesNotMatch(activitySource, /sc-yes|sc-no|sc-qual|✓|✕|NOT QUALIFIED/);
  assert.match(activitySource, /sc-activity--\$\{p\.klass\}/);
});

test('qualifying activity cards use Yannick and Emma tinted backgrounds rather than success or failure treatments', () => {
  assert.match(css, /\.sc-activity--y\{background:color-mix\(in srgb,var\(--c-red\) 9%,transparent\)\}/);
  assert.match(css, /\.sc-activity--e\{background:color-mix\(in srgb,var\(--c-blue\) 9%,transparent\)\}/);
  assert.doesNotMatch(css, /\.sc-yes|\.sc-no|\.sc-qual/);
});

test('authorised refresh is visibly placed immediately below the scoreboard with clear action copy', () => {
  assert.match(js, /<section class="sc-refresh" aria-label="Strava activity refresh">/);
  assert.match(js, /Update both Strava accounts/);
  assert.match(js, /Sync Yannick \+ Emma now/);
  assert.match(js, /Pulls the latest qualifying activities\. Available every 5 minutes\./);
  assert.match(js, /<\/div>\$\{refreshControl\(\)\}<button class="btn btn-ghost sc-more"/);
  assert.match(css, /\.sc-refresh \{ display:grid;[\s\S]*background:linear-gradient/);
  assert.match(css, /\.sc-refresh-label \{ margin:0;/);
});

test('manual refresh is never offered or enabled in the challenge demo preview', () => {
  assert.match(js, /refresh\.preview=demoMode/);
  assert.match(js, /if \(!refresh\.allowed \|\| refresh\.preview\) return ''/);
  assert.match(js, /if \(!refresh\.allowed \|\| refresh\.preview \|\| refresh\.busy \|\| !Auth\.token\) return/);
});
