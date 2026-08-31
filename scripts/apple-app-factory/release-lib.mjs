import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const versionPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    if (key === 'help') { args.help = true; continue; }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value; index += 1;
  }
  return args;
}

export function requireSafeSlug(value) {
  if (!slugPattern.test(value || '')) throw new Error('Slug must contain only lowercase letters, numbers, and internal hyphens.');
  return value;
}

export function requireSafeVersion(value) {
  if (!versionPattern.test(value || '')) throw new Error('Version may contain letters, numbers, periods, underscores, and hyphens only.');
  return value;
}

export function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function readJson(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`Unsafe JSON input: ${filePath}`);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected an object in ${filePath}`);
  return value;
}

export function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, filePath);
}

export function copyFileSafely(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

export function usage(command, text) {
  process.stderr.write(`Usage: node scripts/apple-app-factory/${command} ${text}\n`);
}
