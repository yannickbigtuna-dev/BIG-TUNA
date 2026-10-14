'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { terminalOptions } = require('../pty-worker');
const loadPlatform = () => import(pathToFileURL(path.join(__dirname, '../mcp-server/platform.js')).href);

test('terminal preserves Windows PowerShell and selects POSIX login shells', () => {
  assert.match(terminalOptions({}, 'win32').executable, /powershell\.exe$/);
  assert.deepEqual(terminalOptions({}, 'win32').args, ['-NoLogo']);
  assert.equal(terminalOptions({}, 'win32').useConpty, false);
  assert.equal(terminalOptions({}, 'darwin').executable, '/bin/zsh');
  assert.deepEqual(terminalOptions({}, 'darwin').args, ['-l']);
  assert.equal('useConpty' in terminalOptions({}, 'darwin'), false);
  assert.equal(terminalOptions({ BIG_TUNA_ROOT: '/Users/owner/BigTuna/SERVER' }, 'darwin').cwd, '/Users/owner/BigTuna/SERVER');
});

test('MCP runtime uses platform shell, explicit root, and enforced staging loopback', async () => {
  const { runtimeConfig, isWithinRoot } = await loadPlatform();
  assert.equal(runtimeConfig({}, 'win32').shell, 'cmd.exe');
  assert.equal(runtimeConfig({}, 'darwin').shell, '/bin/sh');
  assert.equal(runtimeConfig({ MCP_ROOT: os.tmpdir(), BIG_TUNA_STAGING: '1' }, 'darwin').host, '127.0.0.1');
  assert.equal(runtimeConfig({}, 'darwin').host, '0.0.0.0');
  assert.equal(runtimeConfig({ MCP_ROOT: os.tmpdir() }).root, path.resolve(os.tmpdir()));
  for (const api of [path.win32, path.posix]) {
    const root = api === path.win32 ? 'C:\\SERVER' : '/Users/owner/SERVER';
    assert.equal(isWithinRoot(root, api.join(root, 'data', 'a.json'), api), true);
    assert.equal(isWithinRoot(root, `${root}-other`, api), false);
    assert.equal(isWithinRoot(root, api.resolve(root, '..', 'secret'), api), false);
  }
});

test('MCP safe paths reject traversal, sibling prefixes and junction/symlink escapes', async () => {
  const { createSafePath } = await loadPlatform();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuna-path-'));
  try {
    const root = path.join(temp, 'SERVER');
    const outside = path.join(temp, 'SERVER-private');
    fs.mkdirSync(root); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret'), 'synthetic');
    const safe = createSafePath(root);
    assert.equal(safe('new/nested/file'), path.join(root, 'new/nested/file'));
    assert.throws(() => safe('../SERVER-private/secret'), /outside/);
    assert.throws(() => safe(path.join(outside, 'secret')), /outside/);
    fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => safe('escape/secret'), /Links/);
    assert.throws(() => safe('escape/new/file'), /Links/);
    fs.symlinkSync(root, path.join(root, 'inside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => safe('inside-link/new'), /Links/);
    assert.throws(() => safe('\0'), /Invalid/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('staging suppresses all boot integrations; production defaults keep them enabled', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuna-staging-'));
  try {
    for (const staging of ['1', '0']) {
      const script = `
        const Module = require('node:module');
        const realLoad = Module._load; const calls = [];
        Module._load = function(name, ...args) {
          if (name === './lib/assignment-coach') return { startScheduler: () => calls.push('assignment') };
          if (name === './lib/email-campaigns') return { startCampaignScheduler: () => calls.push('email') };
          if (name === './lib/homekit-light-bridge') return { createHomeKitLightBridge: () => { calls.push('homekit'); return { start: async () => {}, update: () => {} }; } };
          if (name === './lib/challenge-notification-scheduler') return { createChallengeNotificationScheduler: () => ({ start: () => calls.push('challenge') }) };
          return realLoad.call(this, name, ...args);
        };
        const { _test } = require(${JSON.stringify(path.join(__dirname, '../server.js'))});
        _test.setStravaChallenge({ startScheduler: () => calls.push('strava') });
        _test.startBackgroundServices();
        console.log('RESULT:' + JSON.stringify({ calls, staging: _test.staging, host: _test.bindHost, interval: _test.hasCustomNotificationsScheduler }));
        process.exit(0);
      `;
      const run = spawnSync(process.execPath, ['-e', script], {
        env: { ...process.env, BIG_TUNA_DATA_DIR: path.join(temp, staging), BIG_TUNA_STAGING: staging, BIG_TUNA_BIND_HOST: '0.0.0.0' },
        encoding: 'utf8', timeout: 30_000,
      });
      assert.equal(run.status, 0, run.stderr);
      const match = run.stdout.match(/RESULT:(.*)/);
      assert.ok(match, run.stdout);
      const result = JSON.parse(match[1]);
      assert.equal(result.staging, staging === '1');
      assert.equal(result.interval, staging !== '1');
      assert.equal(result.host, staging === '1' ? '127.0.0.1' : '0.0.0.0');
      assert.deepEqual(result.calls.sort(), staging === '1' ? [] : ['assignment', 'challenge', 'email', 'homekit', 'strava']);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
