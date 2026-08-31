import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, copyFileSafely, parseArgs, readJson, requireSafeSlug, requireSafeVersion, sha256, slugPattern, usage } from './release-lib.mjs';

// Publishes a fully verified, immutable release directory first. Only after all
// files and metadata are present does it atomically replace the small latest
// pointers. A failed command leaves the last known latest release untouched.
try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage('publish-release.mjs', '--source <build-dir> --release-root <ignored-root> --slug <slug> --version <version>'); process.exit(0); }
  const slug = requireSafeSlug(args.slug);
  const version = requireSafeVersion(args.version);
  const source = path.resolve(args.source || '');
  const root = path.resolve(args['release-root'] || '');
  if (!args.source || !args['release-root'] || !fs.statSync(source).isDirectory()) throw new Error('A readable --source directory and --release-root are required.');
  const manifest = readJson(path.join(source, 'manifest.json'));
  const app = manifest.app && typeof manifest.app === 'object' ? manifest.app : manifest;
  if ((manifest.slug || app.slug) && (manifest.slug || app.slug) !== slug) throw new Error('Build manifest slug does not match --slug.');
  const release = manifest.release && typeof manifest.release === 'object' ? manifest.release : manifest;
  if (String(release.version || manifest.version || app.version || '') !== version) throw new Error('Build manifest version does not match --version.');
  const ipaFile = String(manifest.ipaFile || release.ipaFile || manifest.ipa || release.ipa || '').trim();
  if (!ipaFile || path.basename(ipaFile) !== ipaFile || !ipaFile.toLowerCase().endsWith('.ipa')) throw new Error('manifest.json must provide a safe ipaFile basename.');
  const ipaSource = path.join(source, ipaFile);
  if (!fs.statSync(ipaSource).isFile()) throw new Error(`Missing IPA: ${ipaFile}`);
  const digest = sha256(ipaSource);
  if (release.sha256 && String(release.sha256).toLowerCase() !== digest) throw new Error('Manifest SHA-256 does not match IPA.');
  const releaseNotes = path.join(source, 'release-notes.txt');
  if (!fs.statSync(releaseNotes).isFile()) throw new Error('Missing release-notes.txt.');
  const appRoot = path.join(root, slug);
  const releaseRoot = path.join(appRoot, 'releases', version);
  if (fs.existsSync(releaseRoot)) throw new Error(`Immutable release already exists: ${slug}/${version}`);
  const staging = `${releaseRoot}.staging-${process.pid}-${Date.now()}`;
  fs.mkdirSync(staging, { recursive: true });
  try {
    copyFileSafely(ipaSource, path.join(staging, ipaFile));
    copyFileSafely(releaseNotes, path.join(staging, 'release-notes.txt'));
    if (fs.existsSync(path.join(source, 'icon.png'))) copyFileSafely(path.join(source, 'icon.png'), path.join(staging, 'icon.png'));
    const releaseManifest = { ...manifest, slug, ipaFile, release: { ...release, version, sha256: digest, releaseDate: release.releaseDate || new Date().toISOString() } };
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(releaseManifest, null, 2) + '\n');
    fs.writeFileSync(path.join(staging, 'sha256.txt'), `${digest}  ${ipaFile}\n`);
    fs.renameSync(staging, releaseRoot);
    // The immutable directory is now complete. Pointer files are deliberately
    // written last and atomically, so a broken upload never replaces latest.
    fs.mkdirSync(appRoot, { recursive: true });
    atomicWrite(path.join(appRoot, 'manifest.json'), JSON.stringify(releaseManifest, null, 2) + '\n');
    atomicWrite(path.join(appRoot, 'latest.ipa'), fs.readFileSync(path.join(releaseRoot, ipaFile)));
    // The app-root pointer describes app-root latest.ipa. The immutable
    // release's sha256.txt above retains its original versioned IPA filename.
    atomicWrite(path.join(appRoot, 'sha256.txt'), `${digest}  latest.ipa\n`);
    if (fs.existsSync(path.join(releaseRoot, 'icon.png'))) atomicWrite(path.join(appRoot, 'icon.png'), fs.readFileSync(path.join(releaseRoot, 'icon.png')));
    atomicWrite(path.join(appRoot, 'release-notes.txt'), fs.readFileSync(path.join(releaseRoot, 'release-notes.txt')));
    const apps = fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory() && slugPattern.test(item.name)).map(item => item.name).sort();
    atomicWrite(path.join(root, 'index.json'), JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), apps }, null, 2) + '\n');
    process.stdout.write(`Published ${slug} ${version}\nSHA-256 ${digest}\n`);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
} catch (error) {
  process.stderr.write(`Release not published: ${error.message}\n`);
  process.exitCode = 1;
}
