import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJson, requireSafeSlug, requireSafeVersion, sha256, usage } from './release-lib.mjs';

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage('verify-release.mjs', '--release-root <ignored-root> --slug <slug> [--version <version>]'); process.exit(0); }
  const slug = requireSafeSlug(args.slug);
  const root = path.resolve(args['release-root'] || '');
  const version = args.version ? requireSafeVersion(args.version) : null;
  if (!args['release-root']) throw new Error('--release-root is required.');
  const appRoot = path.join(root, slug);
  const manifest = readJson(path.join(appRoot, version ? 'releases' : '', ...(version ? [version] : []), 'manifest.json'));
  const release = manifest.release && typeof manifest.release === 'object' ? manifest.release : manifest;
  const ipaFile = String(manifest.ipaFile || release.ipaFile || manifest.ipa || release.ipa || '').trim();
  if (!ipaFile || path.basename(ipaFile) !== ipaFile || !ipaFile.endsWith('.ipa')) throw new Error('Unsafe or missing ipaFile in manifest.');
  const ipa = version ? path.join(appRoot, 'releases', version, ipaFile) : path.join(appRoot, 'latest.ipa');
  const digest = sha256(ipa);
  if (!/^[a-f0-9]{64}$/i.test(String(release.sha256 || '')) || digest !== String(release.sha256).toLowerCase()) throw new Error('SHA-256 does not match manifest.');
  if (version && !fs.existsSync(path.join(appRoot, 'releases', version, 'release-notes.txt'))) throw new Error('Release notes missing.');
  process.stdout.write(`Verified ${slug}${version ? ` ${version}` : ' latest'}\nSHA-256 ${digest}\n`);
} catch (error) {
  process.stderr.write(`Release verification failed: ${error.message}\n`);
  process.exitCode = 1;
}
