'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { exportBundle, discover } = require('../scripts/migration/export.cjs');
const { decrypt } = require('../scripts/migration/crypto.cjs');
const { validateDirectory, validateArchive, safePath, hash } = require('../scripts/migration/validate.cjs');
test('encrypted round trip preserves hidden secrets, Git metadata, ignored and dirty work', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigtuna-export-test-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const server = path.join(temp, 'server'), apps = path.join(temp, 'apps'); fs.mkdirSync(server); fs.mkdirSync(apps);
  for (const [rel, data] of [['.cryptokey', 'SECRET-DO-NOT-PRINT'], ['.git/HEAD', 'ref: refs/heads/main'], ['ignored/data.json', '{"secret":"token"}'], ['dirty.txt', 'unfinished changes'], ['node_modules/rebuild.js', 'bulk']]) { const p = path.join(server, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
  fs.writeFileSync(path.join(apps, 'project.swift'), 'source'); const output = path.join(temp, 'export');
  const report = await exportBundle({ server, apps, output, appEnvironment: { OPENAI_API_KEY: 'RUNTIME-SECRET', ASSIGNMENTS_ACTION_SECRET: 'ACTION-SECRET', BRIGHTSPACE_PASSWORD: 'LOGIN-SECRET', PUBLIC_BASE_URL: 'https://example.test', AWS_SECRET_ACCESS_KEY: 'EXCLUDED-SECRET', HOME: 'EXCLUDED-HOME' }, roots: [{ source: server, archivePath: 'SERVER' }, { source: apps, archivePath: 'APPS' }] });
  assert.equal(report.consistency, 'preliminary'); assert.equal(report.fileCount, 6); assert.equal(JSON.stringify(report).includes('SECRET'), false);
  const key = fs.readFileSync(path.join(output, 'RECOVERY-KEY.txt'), 'utf8'); const bundle = path.join(output, 'migration.btm');
  assert.equal(await hash(bundle), report.sha256);
  await assert.rejects(decrypt(bundle, path.join(temp, 'wrong.tar'), '0'.repeat(64))); assert.equal(fs.existsSync(path.join(temp, 'wrong.tar')), false);
  const bad = fs.readFileSync(bundle); bad[40] ^= 1; fs.writeFileSync(path.join(temp, 'bad.btm'), bad); await assert.rejects(decrypt(path.join(temp, 'bad.btm'), path.join(temp, 'bad.tar'), key));
  const tar = path.join(temp, 'good.tar'); await decrypt(bundle, tar, key); await validateArchive(tar);
  const extracted = path.join(temp, 'restored'); fs.mkdirSync(extracted); const r = spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', tar, '-C', extracted]); assert.equal(r.status, 0);
  const manifest = await validateDirectory(extracted); assert.equal(manifest.files.length, 6); assert.equal(fs.readFileSync(path.join(extracted, 'SERVER/.cryptokey'), 'utf8'), 'SECRET-DO-NOT-PRINT');
  const runtime = JSON.parse(fs.readFileSync(path.join(extracted, 'PRIVATE/runtime-environment.json'), 'utf8')); assert.equal(runtime.schemaVersion, 1); assert.equal(runtime.environment.OPENAI_API_KEY, 'RUNTIME-SECRET'); assert.equal(runtime.environment.ASSIGNMENTS_ACTION_SECRET, 'ACTION-SECRET'); assert.equal(runtime.environment.BRIGHTSPACE_PASSWORD, 'LOGIN-SECRET'); assert.equal(runtime.environment.HOME, undefined); assert.equal(runtime.environment.AWS_SECRET_ACCESS_KEY, undefined);
  fs.writeFileSync(path.join(extracted, 'SERVER/dirty.txt'), 'corrupted'); await assert.rejects(validateDirectory(extracted), /Manifest mismatch/);
  await assert.rejects(exportBundle({ server, apps, output: path.join(temp, 'final'), final: true }), /confirm-stopped/);
  const final = await exportBundle({ server, apps, output: path.join(temp, 'final-ok'), final: true, confirmStopped: true, roots: [{ source: server, archivePath: 'SERVER' }, { source: apps, archivePath: 'APPS' }] }); assert.equal(final.consistency, 'final-stopped-writers');
});
test('tar link entries are rejected before extraction', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigtuna-tar-test-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const header = Buffer.alloc(512); header.write('SERVER/escape'); header.write('0000777\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116); header.write('00000000000\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write('2', 156); header.write('../../outside', 157); header.write('ustar\0', 257); header.write('00', 263);
  const sum = header.reduce((a, b) => a + b, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148); const tar = path.join(temp, 'unsafe.tar'); fs.writeFileSync(tar, Buffer.concat([header, Buffer.alloc(1024)]));
  await assert.rejects(validateArchive(tar), /link or unsupported/);
});
test('unsafe archive paths and linked metadata fail explicitly', async t => {
  for (const p of ['../escape', 'SERVER/../escape', '/SERVER/a', 'C:/SERVER/a', 'SERVER\\a', 'OTHER/a']) assert.throws(() => safePath(p));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigtuna-link-test-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, '.git'), 'gitdir: ../external/.git');
  await assert.rejects(exportBundle({ output: path.join(temp, 'export'), roots: [{ source, archivePath: 'SERVER' }] }), /Linked Git worktree/);
  fs.unlinkSync(path.join(source, '.git')); fs.mkdirSync(path.join(temp, 'outside')); fs.symlinkSync(path.join(temp, 'outside'), path.join(source, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(exportBundle({ output: path.join(temp, 'export2'), roots: [{ source, archivePath: 'SERVER' }] }), /Link requires/);
  const selectedThroughLink = path.join(source, 'link', 'selected'); fs.mkdirSync(path.join(temp, 'outside', 'selected'));
  await assert.rejects(exportBundle({ output: path.join(temp, 'export3'), roots: [{ source: selectedThroughLink, archivePath: 'SERVER' }] }), /linked ancestor/);
});
test('preliminary keeps captured files and reports drift while final rejects drift', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigtuna-drift-test-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source'); fs.mkdirSync(source); const file = path.join(source, 'state.json');
  const originalReadDir = fs.promises.readdir;
  async function run(final) {
    fs.writeFileSync(file, '{"version":1}'); fs.rmSync(path.join(source, 'new.txt'), { force: true }); let scans = 0;
    fs.promises.readdir = async function (dir, ...args) { if (path.resolve(dir) === source && ++scans === 2) { fs.writeFileSync(file, '{"version":2}'); fs.writeFileSync(path.join(source, 'new.txt'), 'new member'); } return originalReadDir.call(this, dir, ...args); };
    const output = path.join(temp, final ? 'final' : 'preliminary');
    try { return { report: await exportBundle({ output, final, confirmStopped: final, roots: [{ source, archivePath: 'SERVER' }] }), output }; }
    finally { fs.promises.readdir = originalReadDir; }
  }
  const { report, output } = await run(false); assert.equal(report.changedSourceCount, 2);
  const tar = path.join(temp, 'snapshot.tar'); await decrypt(path.join(output, 'migration.btm'), tar, fs.readFileSync(path.join(output, 'RECOVERY-KEY.txt'), 'utf8'));
  const extracted = path.join(temp, 'restored'); fs.mkdirSync(extracted); assert.equal(spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', tar, '-C', extracted]).status, 0);
  const manifest = await validateDirectory(extracted); assert.equal(manifest.changedSources.length, 2); assert.equal(fs.readFileSync(path.join(extracted, 'SERVER/state.json'), 'utf8'), '{"version":1}');
  await assert.rejects(run(true), /Directory changed during final export/);
});
test('discovery propagates unreadable config errors', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigtuna-config-test-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const server = path.join(temp, 'server'); fs.mkdirSync(path.join(server, 'config'), { recursive: true }); const config = path.join(server, 'config', 'private.json'); fs.writeFileSync(config, '{}');
  const original = fs.promises.readFile; fs.promises.readFile = async function (file, ...args) { if (file === config) { const error = new Error('Unreadable config'); error.code = 'EACCES'; throw error; } return original.call(this, file, ...args); };
  try { await assert.rejects(discover(server, path.join(temp, 'apps'), path.join(temp, 'home')), /Unreadable config/); } finally { fs.promises.readFile = original; }
});
test('saved PM2 runtime state is included and external configured release roots discovered', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigtuna-pm2-test-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const server = path.join(temp, 'server'), apps = path.join(temp, 'apps'), home = path.join(temp, 'home'), external = path.join(temp, 'private-releases');
  for (const dir of [server, apps, path.join(home, '.pm2'), external]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(home, '.pm2', 'dump.pm2'), JSON.stringify([{ name: 'apps-server', env: { OPENAI_API_KEY: 'SAVED-PM2-SECRET', APPLE_APP_FACTORY_RELEASE_ROOT: external } }]));
  const roots = await discover(server, apps, home); assert.ok(roots.some(r => r.archivePath === 'PRIVATE/runtime/pm2-dump.json')); assert.ok(roots.some(r => r.source === external && r.archivePath.startsWith('PRIVATE/external-')));
});
