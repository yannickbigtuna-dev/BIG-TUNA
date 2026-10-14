'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { encrypt } = require('./crypto.cjs');
const { hash, safePath, validateArchive, validateDirectory } = require('./validate.cjs');
const BULK = new Set(['node_modules', '.next', '.build', 'DerivedData', '.gradle', '.cache', '__pycache__', '.venv', 'venv']);
function appEnvironmentSnapshot(environment) {
  const result = {};
  for (const key of Object.keys(environment).sort()) {
    if (/^(?:OPENAI_|ANTHROPIC_|RESEND_|ASSIGNMENTS_|STRAVA_|CHALLENGE_|APNS_|LIGHTS_|LAMP_|HOMEKIT_|OLLAMA_|APPLE_APP_FACTORY_|BRIGHTSPACE_|BIG_TUNA_)/.test(key) || ['PUBLIC_BASE_URL', 'MCP_SECRET'].includes(key)) {
      if (typeof environment[key] === 'string') result[key] = environment[key];
    }
  }
  return result;
}
function contained(root, file) { const r = path.relative(root, file); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); }
function exclusion(rel, name) {
  if (rel.split('/').includes('.git')) return null; // Reflogs and all Git metadata preserve unfinished work.
  if (BULK.has(name)) return 'Rebuildable dependencies or build cache';
  if (/^(Cache|Code Cache|GPUCache|ShaderCache|Crashpad|CacheStorage)$/i.test(name)) return 'Browser cache';
  if (/\.(exe|dll|sys|pdb|log)$/i.test(name) || name === 'logs') return 'Windows executable, driver, or runtime log';
  if (/^blobs$/i.test(name) && /ollama/i.test(rel)) return 'Large optional local model weights';
  return null;
}
function privatePermissions(target) {
  if (process.platform === 'win32') {
    const identity = spawnSync('whoami.exe', [], { encoding: 'utf8' });
    if (identity.status !== 0) throw new Error('Cannot determine Windows owner for private output permissions');
    const r = spawnSync('icacls.exe', [target, '/inheritance:r', '/grant:r', identity.stdout.trim() + ':' + (fs.statSync(target).isDirectory() ? '(OI)(CI)F' : 'F')], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('Cannot restrict private output permissions');
  } else fs.chmodSync(target, fs.statSync(target).isDirectory() ? 0o700 : 0o600);
}
async function discover(server, apps, home, appEnvironment = process.env) {
  const roots = [{ source: server, archivePath: 'SERVER' }, { source: apps, archivePath: 'APPS' }];
  const selected = [['.cloudflared', 'cloudflared'], ['.ssh', 'ssh'], ['.gitconfig', 'developer/gitconfig'], ['.npmrc', 'developer/npmrc'], ['.pm2/dump.pm2', 'runtime/pm2-dump.json'], ...['config.toml', 'auth.json', 'skills', 'rules', 'automations'].map(p => ['.codex/' + p, 'developer/codex/' + p]), ['.ollama/models/manifests', 'developer/ollama-model-manifests']];
  for (const [rel, archive] of selected) { const p = path.join(home, rel); if (fs.existsSync(p)) roots.push({ source: p, archivePath: 'PRIVATE/' + archive }); }
  const external = new Set();
  function inspect(value) { if (typeof value === 'string' && (process.platform === 'win32' ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) : path.isAbsolute(value)) && !roots.some(r => contained(r.source, value))) external.add(path.resolve(value)); else if (value && typeof value === 'object') for (const v of Object.values(value)) inspect(v); }
  inspect(appEnvironmentSnapshot(appEnvironment));
  async function configs(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name); if (e.isSymbolicLink()) throw new Error('Linked config requires explicit migration handling: ' + full);
      if (e.isDirectory()) await configs(full);
      else if (e.name.endsWith('.json')) { const text = await fs.promises.readFile(full, 'utf8'); let parsed; try { parsed = JSON.parse(text); } catch { continue; } inspect(parsed); }
    }
  }
  await configs(path.join(server, 'config')); await configs(path.join(server, 'data', 'settings'));
  const pm2Dump = path.join(home, '.pm2', 'dump.pm2');
  if (fs.existsSync(pm2Dump)) {
    const text = await fs.promises.readFile(pm2Dump, 'utf8');
    let processes; try { processes = JSON.parse(text); } catch { throw new Error('Saved PM2 state is invalid; repair or explicitly account for it before migration'); }
    if (!Array.isArray(processes)) throw new Error('Saved PM2 state has an unsupported format');
    for (const processEntry of processes) {
      const env = processEntry && (processEntry.pm2_env || processEntry);
      if (env && typeof env === 'object') { inspect(appEnvironmentSnapshot(env)); inspect(appEnvironmentSnapshot(env.env || {})); }
    }
  }
  for (const full of [path.join(server, 'server.env'), path.join(server, 'cloudflared-config.yml'), path.join(home, '.gitconfig'), path.join(home, '.npmrc')]) {
    if (!fs.existsSync(full)) continue;
    for (const line of (await fs.promises.readFile(full, 'utf8')).split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*[\w-]+\s*[:=]\s*["']?([A-Za-z]:[\\/][^"'\r\n]+|\/[^"'\r\n]+?)["']?\s*$/);
      if (m) inspect(m[1].trim());
    }
  }
  let n = 0;
  for (const source of [...external].sort((a, b) => a.length - b.length)) {
    if (roots.some(r => contained(r.source, source))) continue;
    if (!fs.existsSync(source)) throw new Error('Configured external path missing; fix or explicitly account for it: ' + source);
    roots.push({ source, archivePath: 'PRIVATE/external-' + (++n) });
  }
  return roots;
}
async function exportBundle({ server = 'C:\\SERVER', apps = 'C:\\APPS', home = os.homedir(), output, final = false, confirmStopped = false, includeCodexHistory = false, appEnvironment = process.env, roots: customRoots }) {
  if (!output) throw new Error('Output directory required');
  if (final && !confirmStopped) throw new Error('Final export requires --confirm-stopped after stopping all writers, update jobs, tunnel and development tools');
  if (includeCodexHistory && !final) throw new Error('Codex history requires final stopped-writer export after closing Codex');
  server = path.resolve(server); apps = path.resolve(apps); output = path.resolve(output);
  output = path.join(await fs.promises.realpath(path.dirname(output)), path.basename(output));
  const roots = customRoots || await discover(server, apps, home, appEnvironment);
  if (includeCodexHistory) {
    const codex = path.join(home, '.codex');
    for (const name of await fs.promises.readdir(codex)) if (['sessions', 'archived_sessions', 'session_index.jsonl', 'history.jsonl'].includes(name) || /\.sqlite(?:-wal|-shm)?$/.test(name)) roots.push({ source: path.join(codex, name), archivePath: 'PRIVATE/developer/codex-history/' + name });
  }
  for (const r of roots) {
    safePath(r.archivePath);
    if ((await fs.promises.lstat(r.source)).isSymbolicLink()) throw new Error('Source root is a link requiring explicit migration handling: ' + r.source);
    const resolvedRoot = await fs.promises.realpath(r.source);
    const canonicalRoot = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    if (canonicalRoot(r.source) !== canonicalRoot(resolvedRoot)) throw new Error('Source root has a linked ancestor requiring explicit migration handling: ' + r.source);
    r.source = resolvedRoot;
    if (contained(r.source, output) || contained(output, r.source)) throw new Error('Output must be outside every source root');
  }
  // Existing output directories may be publicly served; require a fresh private one.
  await fs.promises.mkdir(output, { mode: 0o700 }); privatePermissions(output);
  const stage = path.join(output, '.staging'); await fs.promises.mkdir(stage, { mode: 0o700 });
  const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), consistency: final ? 'final-stopped-writers' : 'preliminary', roots, files: [], directories: [], exclusions: [], changedSources: [], warnings: ['Windows browser profiles preserved; Mac reauthentication may be necessary', 'Large optional Ollama weights are not included; model names retained', includeCodexHistory ? 'Codex history preserved as private recovery files; automatic cross-platform restoration is not guaranteed' : 'Codex conversation histories and unrelated home folders are outside this developer-config export'] };
  const directorySnapshots = [];
  async function walk(source, relative) {
    const stat = await fs.promises.lstat(source);
    if (stat.isSymbolicLink()) throw new Error('Link requires explicit migration handling; no target followed: ' + source);
    const resolvedSource = await fs.promises.realpath(source);
    const canonical = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    if (canonical(resolvedSource) !== canonical(source)) throw new Error('Linked ancestor requires explicit migration handling: ' + source);
    const reason = exclusion(relative, path.basename(source));
    if (reason) { manifest.exclusions.push({ source, path: relative, reason }); return; }
    const destination = path.join(stage, ...relative.split('/'));
    if (stat.isDirectory()) {
      await fs.promises.mkdir(destination, { recursive: true, mode: 0o700 }); manifest.directories.push(relative);
      const names = (await fs.promises.readdir(source)).sort(); directorySnapshots.push({ source, path: relative, names });
      for (const name of names) await walk(path.join(source, name), relative + '/' + name);
    } else if (stat.isFile()) {
      if (path.basename(source) === '.git') throw new Error('Linked Git worktree detected; include its common Git directory explicitly before migration: ' + source);
      if (/\/.git\/objects\/info\/alternates$/.test(relative) && (await fs.promises.readFile(source, 'utf8')).trim()) throw new Error('Git external object store detected; include linked metadata explicitly before migration: ' + source);
      if (/\/.git\/worktrees\//.test(relative) && ['gitdir', 'commondir'].includes(path.basename(source))) throw new Error('Git worktree metadata requires explicit relocation before migration: ' + source);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      let copied = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await fs.promises.stat(source); await fs.promises.copyFile(source, destination);
        const digest = await hash(destination), after = await fs.promises.lstat(source);
        if (after.isSymbolicLink()) throw new Error('Source became a link during export: ' + source);
        if (before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && digest === await hash(source)) {
          await fs.promises.chmod(destination, stat.mode & 0o777 || 0o600);
          manifest.files.push({ path: relative, size: after.size, sha256: digest, source }); copied = true; break;
        }
      }
      if (!copied) throw new Error('File changed repeatedly during snapshot; stop writers and retry: ' + source);
    } else throw new Error('Unsupported source file type: ' + source);
  }
  const tar = path.join(output, '.snapshot.tar');
  try {
    for (const r of roots) await walk(r.source, r.archivePath);
    for (const d of directorySnapshots) {
      let names;
      try {
        if ((await fs.promises.lstat(d.source)).isSymbolicLink()) throw new Error('Source directory became a link during export: ' + d.source);
        names = (await fs.promises.readdir(d.source)).sort();
      } catch (e) { if (e.code !== 'ENOENT' || final) throw e; names = []; }
      if (JSON.stringify(names) !== JSON.stringify(d.names)) {
        if (final) throw new Error('Directory changed during final export; stop writers and retry: ' + d.source);
        manifest.changedSources.push({ source: d.source, path: d.path, kind: 'directory-membership', added: names.filter(n => !d.names.includes(n)), removed: d.names.filter(n => !names.includes(n)) });
      }
    }
    for (const f of manifest.files) {
      let changed = false, kind = 'content-changed';
      try {
        if ((await fs.promises.lstat(f.source)).isSymbolicLink()) throw new Error('Source became a link after copying: ' + f.source);
        changed = await hash(f.source) !== f.sha256;
      } catch (e) { if (e.code !== 'ENOENT' || final) throw e; changed = true; kind = 'deleted'; }
      if (changed) {
        if (final) throw new Error('Source changed after copying; retry final export after stopping all writers: ' + f.source);
        manifest.changedSources.push({ source: f.source, path: f.path, kind });
      }
    }
    if (!final) manifest.warnings.push('Online preliminary snapshot is not transactionally consistent; a stopped-writer final export is required. Post-copy source changes: ' + manifest.changedSources.length);
    const runtimeRelative = 'PRIVATE/runtime-environment.json', runtimeFile = path.join(stage, 'PRIVATE', 'runtime-environment.json');
    await fs.promises.mkdir(path.dirname(runtimeFile), { recursive: true, mode: 0o700 });
    const runtimeSnapshot = { schemaVersion: 1, capturedAt: new Date().toISOString(), environment: appEnvironmentSnapshot(appEnvironment) };
    await fs.promises.writeFile(runtimeFile, JSON.stringify(runtimeSnapshot, null, 2), { flag: 'wx', mode: 0o600 });
    manifest.files.push({ path: runtimeRelative, size: (await fs.promises.stat(runtimeFile)).size, sha256: await hash(runtimeFile), source: 'generated:allowlisted-process-environment', generated: true });
    manifest.totalBytes = manifest.files.reduce((n, f) => n + f.size, 0);
    await fs.promises.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await validateDirectory(stage);
    const entries = [...new Set([...roots.map(r => r.archivePath.split('/')[0]), 'PRIVATE']), 'manifest.json'];
    const result = spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['--format', 'pax', '-cf', tar, '-C', stage, ...entries], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Archive creation failed; check disk space and tar availability');
    await validateArchive(tar);
    const key = crypto.randomBytes(32).toString('hex'), bundle = path.join(output, 'migration.btm');
    const keyFile = path.join(output, 'RECOVERY-KEY.txt');
    await fs.promises.writeFile(keyFile, key + '\n', { flag: 'wx', mode: 0o600 }); privatePermissions(keyFile);
    await encrypt(tar, bundle, key);
    const sha256 = await hash(bundle);
    await fs.promises.writeFile(path.join(output, 'migration.btm.sha256'), sha256 + '  migration.btm\n', { mode: 0o600 });
    // Plain inventory contains counts and categories only, never paths or configuration values.
    const inventory = { schemaVersion: 1, createdAt: manifest.createdAt, consistency: manifest.consistency, fileCount: manifest.files.length, totalBytes: manifest.totalBytes, bundleBytes: (await fs.promises.stat(bundle)).size, sha256, changedSourceCount: manifest.changedSources.length, warningCount: manifest.warnings.length, exclusionCounts: manifest.exclusions.reduce((a, e) => { a[e.reason] = (a[e.reason] || 0) + 1; return a; }, {}), recoveryKey: 'Separate RECOVERY-KEY.txt; never include in kit or publish' };
    await fs.promises.writeFile(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2), { mode: 0o600 });
    return inventory;
  } finally { await fs.promises.rm(stage, { recursive: true, force: true }); await fs.promises.rm(tar, { force: true }); }
}
module.exports = { exportBundle, discover, contained, appEnvironmentSnapshot };
if (require.main === module) {
  const args = process.argv.slice(2); const options = {};
  for (let i = 0; i < args.length; i++) { if (args[i] === '--output') options.output = args[++i]; else if (args[i] === '--final') options.final = true; else if (args[i] === '--confirm-stopped') options.confirmStopped = true; else if (args[i] === '--include-codex-history') options.includeCodexHistory = true; else throw new Error('Unknown option'); }
  exportBundle(options).then(x => console.log(JSON.stringify(x, null, 2))).catch(e => { console.error('Export failed: ' + e.message); process.exitCode = 1; });
}
