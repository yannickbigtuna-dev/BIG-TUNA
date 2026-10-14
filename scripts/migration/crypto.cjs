'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const MAGIC = Buffer.from('BTMIG001');
async function encrypt(input, output, key) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const derived = crypto.scryptSync(key.trim(), salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  cipher.setAAD(header);
  // Acquire ownership first; EEXIST must never enter cleanup for another file.
  const owned = await fs.promises.open(output, 'wx', 0o600);
  const sink = owned.createWriteStream();
  sink.write(header);
  try {
    await pipeline(fs.createReadStream(input), cipher, sink, { end: false });
    await new Promise((resolve, reject) => { sink.on('error', reject); sink.end(cipher.getAuthTag(), resolve); });
  } catch (e) { sink.destroy(); await owned.close().catch(() => {}); await fs.promises.rm(output, { force: true }); throw e; }
}
async function decrypt(input, output, key) {
  const file = await fs.promises.open(input, 'r');
  let header, tag, size;
  try {
    size = (await file.stat()).size;
    if (size < 52) throw new Error('Invalid migration bundle');
    header = Buffer.alloc(36); tag = Buffer.alloc(16);
    await file.read(header, 0, 36, 0); await file.read(tag, 0, 16, size - 16);
    if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Unsupported migration bundle version');
  } finally { await file.close(); }
  const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(key.trim(), header.subarray(8, 24), 32), header.subarray(24));
  decipher.setAAD(header); decipher.setAuthTag(tag);
  // Unauthenticated plaintext is private and never made available for extraction.
  const temp = output + '.partial-' + crypto.randomBytes(8).toString('hex');
  try {
    await pipeline(fs.createReadStream(input, { start: 36, end: size - 17 }), decipher, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    await fs.promises.link(temp, output); // Refuse overwriting an existing destination.
  } catch (e) { throw new Error('Decryption failed (wrong recovery key, damaged bundle, or existing output)', { cause: e }); }
  finally { await fs.promises.rm(temp, { force: true }); }
}
module.exports = { encrypt, decrypt };
if (require.main === module) {
  (async () => {
    if (!['encrypt', 'decrypt'].includes(process.argv[2]) || process.argv.length !== 5) throw new Error('Usage: node crypto.cjs encrypt|decrypt <input> <output>; recovery key on stdin');
    let key = ''; for await (const chunk of process.stdin) { key += chunk; if (key.length > 1024) throw new Error('Invalid key'); }
    if (!/^[a-f0-9]{64}$/.test(key.trim())) throw new Error('Invalid recovery key');
    await module.exports[process.argv[2]](process.argv[3], process.argv[4], key);
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}
