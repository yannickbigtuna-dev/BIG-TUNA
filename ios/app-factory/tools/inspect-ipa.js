#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { readJson, sha256 } = require('./factory-lib');
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
const ipa = arg('--ipa'), targetsFile = arg('--targets');
if (!ipa || !targetsFile) { console.error('Usage: node inspect-ipa.js --ipa <unsigned.ipa> --targets <.factory-targets.json>'); process.exit(2); }
function extractArchiveEntry(archive, entry) {
  const result = spawnSync('tar', ['-x', '-O', '-f', archive, entry], { encoding: null, shell: false });
  if (result.status !== 0) throw new Error(`Could not extract ${entry} from IPA: ${Buffer.from(result.stderr || '').toString('utf8').trim()}`);
  return Buffer.from(result.stdout);
}
function xmlBundleIdentifier(contents) {
  const xml = contents.toString('utf8');
  const match = xml.match(/<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>([\s\S]*?)<\/string>/);
  return match ? match[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
}
function bundleIdentifierFromPlist(contents, label) {
  const xmlIdentifier = xmlBundleIdentifier(contents);
  if (xmlIdentifier) return xmlIdentifier;
  if (process.platform !== 'darwin') throw new Error(`${label} Info.plist is binary and cannot be inspected on this host. Run the macOS CI inspection, where plutil validates it before publication.`);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-app-factory-plist-'));
  const plist = path.join(temporaryDirectory, 'Info.plist');
  try {
    fs.writeFileSync(plist, contents);
    const result = spawnSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { encoding: 'utf8', shell: false });
    if (result.status !== 0) throw new Error(`${label} Info.plist has no readable CFBundleIdentifier: ${result.stderr.trim()}`);
    return result.stdout.trim();
  } finally { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
}
function requireBundleIdentifier(archive, plistPath, expected, label) {
  if (typeof expected !== 'string' || !expected) throw new Error(`Target manifest is missing expected bundle ID for ${label}`);
  const actual = bundleIdentifierFromPlist(extractArchiveEntry(archive, plistPath), label);
  if (actual !== expected) throw new Error(`${label} CFBundleIdentifier is ${actual || 'missing'}, expected ${expected}; refusing to publish a wrong-identity build`);
}
try {
  if (!fs.statSync(ipa).isFile()) throw new Error(`IPA was not found: ${ipa}`);
  const targetManifest = readJson(targetsFile);
  if (!targetManifest.targetEvidence || typeof targetManifest.targetEvidence !== 'object') throw new Error('Target manifest is missing targetEvidence; regenerate from the current Apple App Factory before inspection');
  const result = spawnSync('tar', ['-tf', ipa], { encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(`IPA is not a readable ZIP archive: ${result.stderr.trim()}`);
  const files = result.stdout.split(/\r?\n/).filter(Boolean);
  if (!targetManifest.app || typeof targetManifest.app.name !== 'string' || !targetManifest.app.name) throw new Error('Target manifest is missing the generated app name');
  const appName = targetManifest.app.name;
  const hostPrefix = `Payload/${appName}.app/`;
  const widgetPrefix = `${hostPrefix}PlugIns/${appName} Widgets.appex/`;
  const watchPrefix = `${hostPrefix}Watch/${appName} Watch.app/`;
  const watchWidgetPrefix = `${watchPrefix}PlugIns/${appName} Watch Widgets.appex/`;
  // ZIP writers are not required to include explicit directory entries, so test
  // for files below a bundle rather than relying on a trailing `.app/` record.
  const hostInfo = `${hostPrefix}Info.plist`;
  const widgetInfo = `${widgetPrefix}Info.plist`;
  const watchInfo = `${watchPrefix}Info.plist`;
  const watchWidgetInfo = `${watchWidgetPrefix}Info.plist`;
  const host = files.find(name => name === hostInfo);
  if (!host) throw new Error(`IPA is missing the generated iPhone host bundle ${hostPrefix}`);
  const requirePath = (prefix, description) => { if (!files.some(name => name.startsWith(prefix))) throw new Error(`IPA is missing ${description}; refusing to publish a stripped or wrong-identity build`); };
  requireBundleIdentifier(ipa, hostInfo, targetManifest.bundleIds && targetManifest.bundleIds.iphone, 'iPhone host app');
  if (targetManifest.targets.homeScreenWidget || targetManifest.targets.iphoneControls) { requirePath(widgetPrefix, `the generated iPhone WidgetKit extension ${widgetPrefix}`); requireBundleIdentifier(ipa, widgetInfo, targetManifest.bundleIds && targetManifest.bundleIds.widget, 'iPhone widget extension'); }
  if (targetManifest.targets.iphoneControls && targetManifest.targetEvidence.iphoneControlExtension !== (targetManifest.bundleIds && targetManifest.bundleIds.widget)) throw new Error('Target manifest does not prove that the iPhone control uses the existing iPhone WidgetKit extension');
  if (targetManifest.targets.watchMode !== 'none') { requirePath(watchPrefix, `the generated embedded Apple Watch app ${watchPrefix}`); requireBundleIdentifier(ipa, watchInfo, targetManifest.bundleIds && targetManifest.bundleIds.watch, 'Apple Watch app'); }
  if (targetManifest.targets.watchWidgets) { requirePath(watchWidgetPrefix, `the generated Apple Watch widget/complication extension ${watchWidgetPrefix}`); requireBundleIdentifier(ipa, watchWidgetInfo, targetManifest.bundleIds && targetManifest.bundleIds.watchWidget, 'Apple Watch widget extension'); }
  if (targetManifest.targets.watchControls && targetManifest.targetEvidence.watchControlExtension !== (targetManifest.bundleIds && targetManifest.bundleIds.watchWidget)) throw new Error('Target manifest does not prove that the Watch control uses the existing Watch widget extension');
  const report = { ok: true, ipa: path.resolve(ipa), sha256: sha256(ipa), hostBundlePath: host, fileCount: files.length, requestedTargets: targetManifest.targets, targetEvidence: targetManifest.targetEvidence };
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(`IPA inspection failed: ${error.message}`); process.exit(1); }
