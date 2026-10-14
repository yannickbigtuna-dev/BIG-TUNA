'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { encrypt, decrypt } = require('../scripts/migration/crypto.cjs');

test('refusing an existing encryption output preserves its exact contents', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tuna-crypto-existing-'));
  try {
    const source = path.join(root, 'source');
    const output = path.join(root, 'existing');
    fs.writeFileSync(source, 'synthetic secret');
    fs.writeFileSync(output, 'existing user-owned bundle');
    await assert.rejects(encrypt(source, output, crypto.randomBytes(32).toString('hex')));
    assert.equal(fs.readFileSync(output, 'utf8'), 'existing user-owned bundle');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refusing existing decryption output and corrupt ciphertext preserves output and removes partial plaintext', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tuna-crypto-auth-'));
  try {
    const source = path.join(root, 'source'), bundle = path.join(root, 'bundle');
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(source, 'synthetic secret');
    await encrypt(source, bundle, key);
    const output = path.join(root, 'existing');
    fs.writeFileSync(output, 'existing user-owned plaintext');
    await assert.rejects(decrypt(bundle, output, key));
    assert.equal(fs.readFileSync(output, 'utf8'), 'existing user-owned plaintext');
    const bytes = fs.readFileSync(bundle); bytes[40] ^= 1; fs.writeFileSync(bundle, bytes);
    await assert.rejects(decrypt(bundle, path.join(root, 'fresh'), key));
    assert.equal(fs.existsSync(path.join(root, 'fresh')), false);
    assert.equal(fs.readdirSync(root).some(name => name.includes('.partial-')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('LAN download server serves only kit/final ciphertext and refuses keys, traversal and linked final directories', async () => {
  const { createDownloadServer } = require('../tools/windows-migration/download-server.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tuna-download-whitelist-'));
  const { server, token } = createDownloadServer(root);
  try {
    fs.writeFileSync(path.join(root, 'BigTuna-Mac-Migration.zip'), 'synthetic kit');
    fs.writeFileSync(path.join(root, 'RECOVERY-KEY.txt'), 'synthetic recovery key');
    const final = path.join(root, 'Final-20261014-190000'); fs.mkdirSync(final);
    fs.writeFileSync(path.join(final, 'migration.btm'), 'synthetic final ciphertext');
    fs.writeFileSync(path.join(final, 'inventory.json'), JSON.stringify({ consistency: 'final-stopped-writers' }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/${token}/`;
    const kit = await fetch(base + 'BigTuna-Mac-Migration.zip');
    assert.equal(kit.status, 200); assert.equal(await kit.text(), 'synthetic kit');
    const payload = await fetch(base + 'final-migration.btm');
    assert.equal(payload.status, 200); assert.equal(await payload.text(), 'synthetic final ciphertext');
    for (const request of ['RECOVERY-KEY.txt', '%2e%2e/RECOVERY-KEY.txt', 'Final-20261014-190000/RECOVERY-KEY.txt', 'BigTuna-Mac-Migration.zip?file=RECOVERY-KEY.txt']) {
      assert.equal((await fetch(base + request)).status, 404);
    }
    assert.equal((await fetch(base.replace(token, 'wrong-token') + 'BigTuna-Mac-Migration.zip')).status, 404);
    const linked = path.join(root, 'Final-20261015-190000');
    fs.symlinkSync(final, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const ciphertext = await fetch(base + 'final-migration.btm');
    assert.equal(ciphertext.status, 200); assert.equal(await ciphertext.text(), 'synthetic final ciphertext');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Mac backup refuses same-size source mutation during a snapshot', () => {
  const { backupSnapshot } = require('../tools/mac-migration/helper.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tuna-backup-writer-'));
  const source = path.join(root, 'source'), destination = path.join(root, 'destination');
  const originalCopy = fs.copyFileSync;
  try {
    fs.mkdirSync(path.join(source, 'SERVER'), { recursive: true });
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ roots: [] }));
    const state = path.join(source, 'SERVER', 'state.json');
    fs.writeFileSync(state, 'before');
    fs.copyFileSync = function(from, to, ...args) {
      originalCopy.call(fs, from, to, ...args);
      if (from === state) fs.writeFileSync(from, 'after!');
    };
    assert.throws(() => backupSnapshot(source, destination), /chang|unstable|writer|consisten/i);
  } finally {
    fs.copyFileSync = originalCopy;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
