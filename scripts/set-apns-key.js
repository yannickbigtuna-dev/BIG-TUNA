#!/usr/bin/env node
'use strict';

// Installs an Apple Push Notification (.p8) key into server.env and checks it
// against both APNs environments.
//
//   node scripts/set-apns-key.js ~/Downloads/AuthKey_ABC123DEFG.p8 [--env both|production|sandbox]
//
// --env both (default) writes APNS_KEY_ID / APNS_AUTH_KEY_BASE64, used for both
// environments. Use --env production or --env sandbox to install a key that
// Apple restricted to one environment (APNS_PRODUCTION_* / APNS_SANDBOX_*).
// Restart afterwards with: pm2 restart bigtuna-web --update-env

const fs = require('fs');
const path = require('path');
const { createChallengeApns } = require('../lib/challenge-apns');

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith('--'));
const envIndex = args.indexOf('--env');
const target = envIndex >= 0 ? String(args[envIndex + 1] || '').toLowerCase() : 'both';
if (!file || !['both', 'production', 'sandbox'].includes(target)) {
  console.error('Usage: node scripts/set-apns-key.js /path/to/AuthKey_KEYID.p8 [--env both|production|sandbox]');
  process.exit(1);
}
const keyText = fs.readFileSync(path.resolve(file.replace(/^~(?=\/)/, process.env.HOME || '~')), 'utf8');
if (!keyText.includes('BEGIN PRIVATE KEY')) { console.error('That file is not an Apple .p8 private key.'); process.exit(1); }
const match = path.basename(file).match(/AuthKey_([A-Z0-9]{10})\.p8$/i);
const keyIdArg = args.indexOf('--key-id') >= 0 ? args[args.indexOf('--key-id') + 1] : null;
const keyId = (keyIdArg || (match && match[1]) || '').toUpperCase();
if (!/^[A-Z0-9]{10}$/.test(keyId)) { console.error('Could not read the 10-character Key ID from the file name; pass --key-id KEYID.'); process.exit(1); }

const envFile = path.join(__dirname, '..', 'server.env');
const original = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const prefix = target === 'both' ? 'APNS_' : target === 'production' ? 'APNS_PRODUCTION_' : 'APNS_SANDBOX_';
const updates = { [`${prefix}KEY_ID`]: keyId, [`${prefix}AUTH_KEY_BASE64`]: Buffer.from(keyText).toString('base64') };
let lines = original.split(/\r?\n/);
for (const [name, value] of Object.entries(updates)) {
  const index = lines.findIndex(line => line.startsWith(`${name}=`));
  if (index >= 0) lines[index] = `${name}=${value}`; else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
}
const backup = `${envFile}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
if (original) fs.writeFileSync(backup, original, { mode: 0o600 });
fs.writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
console.log(`Saved ${prefix}KEY_ID=${keyId} to server.env${original ? ` (backup: ${path.basename(backup)})` : ''}.`);

const env = {};
for (const line of lines) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
createChallengeApns({ env, logger: { warn() {} } }).probe().then(result => {
  const describe = value => value === 'ok' ? 'OK' : value;
  console.log(`APNs production (TestFlight/App Store): ${describe(result.production)}`);
  console.log(`APNs sandbox (Xcode builds):           ${describe(result.sandbox)}`);
  if (result.production !== 'ok') console.log('Production pushes will still fail. Create the key with environment "Sandbox & Production" (or "Production") in Apple Developer > Keys.');
  console.log('Now restart the server: pm2 restart bigtuna-web --update-env');
});
