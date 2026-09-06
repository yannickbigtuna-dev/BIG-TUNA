import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectRelativePath = path.join('ios', 'big-tuna-lights-widget');
const defaultOutput = path.join(repositoryRoot, 'YannickLights-Xcode.zip');
const excludedDirectories = new Set(['.git', '.build', 'build', 'deriveddata', 'xcuserdata', '.swiftpm', 'node_modules', 'archives', 'artifacts']);
const excludedFile = (name) => {
  const lower = name.toLowerCase();
  return lower === '.ds_store'
    || lower === '.env'
    || lower.startsWith('.env.')
    || lower === 'server.env'
    || lower === 'token.txt'
    || /\.(zip|ipa|dSYM|p8|p12|pem|key|cer|crt|mobileprovision|provisionprofile)$/i.test(name);
};

function usage() {
  process.stderr.write('Usage: node scripts/apple-app-factory/package-big-tuna-lights-xcode.mjs [--output <new-zip-path>]\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--help') { args.help = true; continue; }
    if (item !== '--output') throw new Error(`Unknown option: ${item}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for --output.');
    args.output = value;
    index += 1;
  }
  return args;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date) {
  const safeYear = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((safeYear - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function collectFiles(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryRelative = path.join(relative, entry.name);
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to package symbolic link: ${entryRelative}`);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name.toLowerCase())) files.push(...collectFiles(fullPath, entryRelative));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!excludedFile(entry.name)) files.push({ fullPath, relative: entryRelative });
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function zipEntry(name, content, executable = false) {
  const nameBuffer = Buffer.from(name.replaceAll(path.sep, '/'));
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const compressed = zlib.deflateRawSync(body, { level: 9 });
  const timestamp = dosTimestamp(new Date('2026-01-01T00:00:00Z'));
  const crc = crc32(body);
  return { nameBuffer, body, compressed, timestamp, crc, executable };
}

function writeZip(output, entries) {
  let offset = 0;
  const locals = [];
  const central = [];
  for (const entry of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(entry.timestamp.time, 10);
    local.writeUInt16LE(entry.timestamp.date, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.compressed.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(entry.nameBuffer.length, 26);
    locals.push(local, entry.nameBuffer, entry.compressed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x031e, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(entry.timestamp.time, 12);
    record.writeUInt16LE(entry.timestamp.date, 14);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.compressed.length, 20);
    record.writeUInt32LE(entry.body.length, 24);
    record.writeUInt16LE(entry.nameBuffer.length, 28);
    record.writeUInt32LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt32LE(((entry.executable ? 0o100755 : 0o100644) * 0x10000) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, entry.nameBuffer);
    offset += local.length + entry.nameBuffer.length + entry.compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.concat([...locals, centralBytes, end]), { flag: 'wx' });
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(0); }
  const generated = spawnSync(process.execPath, [path.join(repositoryRoot, 'scripts', 'apple-app-factory', 'generate-yannick-lights-xcodeproj.mjs')], { cwd: repositoryRoot, encoding: 'utf8' });
  if (generated.status !== 0) throw new Error('Could not generate YannickLights.xcodeproj.');
  const audited = spawnSync(process.execPath, [path.join(repositoryRoot, 'scripts', 'apple-app-factory', 'audit-yannick-lights-xcodeproj.mjs')], { cwd: repositoryRoot, encoding: 'utf8' });
  if (audited.status !== 0) throw new Error(`Generated Xcode project failed structural audit: ${(audited.stderr || audited.stdout).trim()}`);
  const source = path.join(repositoryRoot, projectRelativePath);
  const output = path.resolve(args.output || defaultOutput);
  if (!fs.statSync(source).isDirectory()) throw new Error(`Missing maintained source project: ${projectRelativePath}`);
  if (!fs.existsSync(path.join(source, 'YannickLights.xcodeproj', 'project.pbxproj'))) throw new Error('Missing checked-in YannickLights.xcodeproj. Run generate-yannick-lights-xcodeproj.mjs first.');
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing archive: ${output}`);
  const sourceEntries = collectFiles(source).map(file => zipEntry(path.posix.join('YannickLights-Xcode', file.relative.replaceAll(path.sep, '/')), fs.readFileSync(file.fullPath)));
  const entries = [
    ...sourceEntries,
    zipEntry('YannickLights-Xcode/APP-SPEC.yml', fs.readFileSync(path.join(repositoryRoot, 'ios', 'app-factory', 'specs', 'big-tuna-lights.yml')))
  ];
  writeZip(output, entries);
  process.stdout.write(`${JSON.stringify({ ok: true, output, files: entries.length, sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex') })}\n`);
} catch (error) {
  process.stderr.write(`Xcode transfer package not created: ${error.message}\n`);
  process.exitCode = 1;
}
