'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function hash(file) { const h = crypto.createHash('sha256'); for await (const b of fs.createReadStream(file)) h.update(b); return h.digest('hex'); }
function safePath(name) {
  const p = name.replace(/\/$/, '');
  if (!p || p.includes('\\') || p.includes('\0') || p.includes(':') || p.startsWith('/') || p.split('/').some(x => !x || x === '.' || x === '..')) throw new Error('Unsafe archive path');
  if (p !== 'manifest.json' && !['SERVER', 'APPS', 'PRIVATE'].includes(p.split('/')[0])) throw new Error('Unexpected archive root');
  return p;
}
function validateArchiveListing(text) { for (const line of text.trim().split(/\r?\n/)) safePath(line); }
async function validateArchive(file) {
  const fd = await fs.promises.open(file, 'r'); const size = (await fd.stat()).size;
  let pos = 0, pax = {}, global = {}; const seen = new Set();
  try {
    while (pos + 512 <= size) {
      const b = Buffer.alloc(512); await fd.read(b, 0, 512, pos); pos += 512;
      if (b.every(x => x === 0)) break;
      const str = (start, len) => b.subarray(start, start + len).toString('utf8').split('\0')[0];
      const checksum = parseInt(str(148, 8).trim(), 8);
      const sum = b.reduce((n, v, i) => n + (i >= 148 && i < 156 ? 32 : v), 0);
      if (checksum !== sum) throw new Error('Invalid tar header checksum');
      const bytes = parseInt(str(124, 12).trim() || '0', 8), type = str(156, 1);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || pos + bytes > size) throw new Error('Invalid tar size');
      if (type === 'x' || type === 'g') {
        if (bytes > 1024 * 1024) throw new Error('Oversized tar metadata');
        const data = Buffer.alloc(bytes); await fd.read(data, 0, bytes, pos); let offset = 0; const fields = {};
        while (offset < bytes) { const space = data.indexOf(32, offset), len = Number(data.subarray(offset, space).toString()); if (space < 0 || !Number.isInteger(len) || len <= 0 || offset + len > bytes) throw new Error('Invalid pax metadata'); const record = data.subarray(space + 1, offset + len - 1).toString(); const eq = record.indexOf('='); fields[record.slice(0, eq)] = record.slice(eq + 1); offset += len; }
        if (Object.keys(fields).some(k => k === 'size' || k === 'linkpath' || /sparse/i.test(k))) throw new Error('Unsupported pax override');
        if (type === 'g') global = { ...global, ...fields }; else pax = fields;
      } else {
        if (type !== '' && type !== '0' && type !== '5') throw new Error('Archive contains link or unsupported entry');
        if (type === '5' && bytes !== 0) throw new Error('Directory contains payload');
        const name = safePath(pax.path || global.path || [str(345, 155), str(0, 100)].filter(Boolean).join('/'));
        if (pax.linkpath || global.linkpath || seen.has(name)) throw new Error('Duplicate or linked archive entry');
        seen.add(name); pax = {};
      }
      pos += Math.ceil(bytes / 512) * 512;
    }
    if (!seen.has('manifest.json')) throw new Error('Missing archive manifest');
  } finally { await fd.close(); }
}
async function validateDirectory(root) {
  if ((await fs.promises.lstat(root)).isSymbolicLink()) throw new Error('Extracted root is a link');
  const manifest = JSON.parse(await fs.promises.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported manifest');
  const expected = new Map(manifest.files.map(f => [safePath(f.path), f]));
  if (expected.size !== manifest.files.length) throw new Error('Duplicate manifest file');
  const found = new Set();
  async function walk(dir, relative = '') {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const rel = relative ? relative + '/' + entry.name : entry.name, full = path.join(dir, entry.name);
      const st = await fs.promises.lstat(full); if (st.isSymbolicLink()) throw new Error('Extracted tree contains a link');
      if (st.isDirectory()) { safePath(rel); await walk(full, rel); }
      else if (st.isFile()) {
        if (rel === 'manifest.json') continue;
        const f = expected.get(rel); if (!f || st.size !== f.size || await hash(full) !== f.sha256) throw new Error('Manifest mismatch: ' + rel);
        found.add(rel);
      } else throw new Error('Unsupported extracted entry');
    }
  }
  await walk(root); if (found.size !== expected.size) throw new Error('Manifest files missing'); return manifest;
}
module.exports = { hash, safePath, validateDirectory, validateArchive, validateArchiveListing };
if (require.main === module) (async () => { if (process.argv[2] === 'archive') await validateArchive(process.argv[3]); else await validateDirectory(process.argv[2]); console.log('Migration validation passed'); })().catch(e => { console.error(e.message); process.exitCode = 1; });
