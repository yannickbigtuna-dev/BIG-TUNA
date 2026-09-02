'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const tools = path.join(root, 'ios', 'app-factory', 'tools');
const { validateSpec } = require(path.join(tools, 'factory-lib'));
function fixture() { return { app: { name: 'Trail Log', slug: 'trail-log', bundleId: 'ca.example.traillog', bundleIdNamespace: 'ca.example', iconSource: 'assets/trail-log.png', minimumIOS: '17.0', minimumWatchOS: '10.0', version: '1.0.0', build: 1, theme: { accentHex: '#0A84FF', backgroundHex: '#FFFFFF' } }, targets: { iphone: true, homeScreenWidget: true, lockScreenWidget: true, liveActivities: true, watchMode: 'companion', watchWidgets: true, watchComplications: true, watchConnectivity: true }, capabilities: { appGroups: true, healthKit: false, workoutKit: false, coreMotion: false, location: false, bluetooth: false, notifications: false, backgroundRefresh: false, siri: false, haptics: false, watchConnectivity: true }, appGroupId: 'group.ca.example.traillog', privacy: {}, factory: { bundleIdentifiers: { iphoneApp: 'ca.example.traillog', homeWidget: 'ca.example.traillog.widget', lockScreenWidget: 'ca.example.traillog.widget', liveActivityWidget: 'ca.example.traillog.widget', watchApp: 'ca.example.traillog.watchapp', watchExtension: null, watchWidget: 'ca.example.traillog.watchapp.widget' }, data: { storageMethod: 'local-codable', schemaVersion: 1, migrationStrategy: 'Migrate before changing data.', exportOrBackup: 'in-app export', homeServerApi: { baseUrl: null, authMode: 'none' } }, distribution: { access: 'private-owner-authenticated', url: null, releaseRoot: 'data/apple-app-factory/releases' }, lastSuccessfulBuild: { status: 'never-built', ciRunUrl: null, completedAt: null, ipaSha256: null }, knownLimitations: ['Free signatures expire after seven days.'] } }; }
function run(script, args) { return execFileSync(process.execPath, [path.join(tools, script), ...args], { cwd: root, encoding: 'utf8' }); }
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) { value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); }
  return (value ^ 0xffffffff) >>> 0;
}
function makeZip(file, entries) {
  const records = [], central = []; let offset = 0;
  for (const entryValue of entries) {
    const entry = typeof entryValue === 'string' ? { name: entryValue, content: 'x' } : entryValue;
    const nameBuffer = Buffer.from(entry.name), body = Buffer.from(entry.content), crc = crc32(body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    records.push(local, nameBuffer, body);
    const centralEntry = Buffer.alloc(46); centralEntry.writeUInt32LE(0x02014b50, 0); centralEntry.writeUInt16LE(20, 4); centralEntry.writeUInt16LE(20, 6); centralEntry.writeUInt32LE(crc, 16); centralEntry.writeUInt32LE(body.length, 20); centralEntry.writeUInt32LE(body.length, 24); centralEntry.writeUInt16LE(nameBuffer.length, 28); centralEntry.writeUInt32LE(offset, 42);
    central.push(centralEntry, nameBuffer); offset += local.length + nameBuffer.length + body.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...records, centralBytes, end]));
}

test('factory tooling validates, generates, bumps, and creates metadata without credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-app-factory-'));
  const spec = path.join(directory, 'trail-log.yml');
  fs.writeFileSync(spec, `${JSON.stringify(fixture(), null, 2)}\n`);
  const validation = JSON.parse(run('validate-app-spec.js', [spec]));
  assert.equal(validation.ok, true);
  const generated = path.join(directory, 'generated');
  run('generate-project.js', ['--spec', spec, '--output', generated]);
  const targets = JSON.parse(fs.readFileSync(path.join(generated, '.factory-targets.json'), 'utf8'));
  assert.equal(targets.targets.watchWidgets, true);
  const projectYml = fs.readFileSync(path.join(generated, 'project.yml'), 'utf8');
  assert.match(projectYml, /AppWatchWidget/);
  assert.match(fs.readFileSync(path.join(generated, 'Sources', 'Widget', 'FactoryWidget.swift'), 'utf8'), /FactoryLiveActivity\(\)/);
  assert.match(fs.readFileSync(path.join(generated, 'Generated', 'FactoryAppConfiguration.swift'), 'utf8'), /accentHex = "#0A84FF"/);
  const bumped = JSON.parse(run('bump-version.js', ['--spec', spec]));
  assert.deepEqual({ version: bumped.version, build: bumped.build }, { version: '1.0.1', build: 2 });
  const ipa = path.join(directory, 'unsigned.ipa'); fs.writeFileSync(ipa, 'not a production IPA');
  const release = path.join(directory, 'release');
  const output = JSON.parse(run('create-release-metadata.js', ['--spec', spec, '--ipa', ipa, '--output', release]));
  assert.equal(output.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(release, 'manifest.json'), 'utf8')).app.build, 2);
});

test('factory tooling rejects target combinations instead of silently changing them', () => {
  const invalid = fixture(); invalid.targets.watchMode = 'none';
  assert.throws(() => validateSpec(invalid), /Watch widgets, complications, and WatchConnectivity require a Watch app/);
});

test('factory tooling requires operating metadata and rejects unimplemented capability switches', () => {
  const clone = () => JSON.parse(JSON.stringify(fixture()));
  for (const remove of [
    spec => delete spec.app.bundleIdNamespace,
    spec => delete spec.app.iconSource,
    spec => delete spec.app.theme,
    spec => delete spec.factory.bundleIdentifiers,
    spec => delete spec.factory.data,
    spec => delete spec.factory.distribution,
    spec => delete spec.factory.lastSuccessfulBuild,
    spec => delete spec.factory.knownLimitations
  ]) {
    const spec = clone(); remove(spec); assert.throws(() => validateSpec(spec));
  }
  const invalidTheme = clone(); invalidTheme.app.theme.accentHex = 'blue';
  assert.throws(() => validateSpec(invalidTheme), /hexadecimal colour/);
  for (const capability of ['coreMotion', 'healthKit', 'workoutKit', 'location', 'bluetooth', 'notifications', 'backgroundRefresh', 'siri', 'haptics']) {
    const unsupported = clone(); unsupported.capabilities[capability] = true;
    assert.throws(() => validateSpec(unsupported), /not implemented by the reusable template/);
  }
});

test('generator omits Lock Screen families when the specification disables them', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-app-factory-lock-'));
  const spec = fixture(); spec.targets.lockScreenWidget = false; spec.targets.liveActivities = false; spec.factory.bundleIdentifiers.lockScreenWidget = null; spec.factory.bundleIdentifiers.liveActivityWidget = null;
  const specPath = path.join(directory, 'trail-log.yml'); fs.writeFileSync(specPath, JSON.stringify(spec));
  const output = path.join(directory, 'generated'); run('generate-project.js', ['--spec', specPath, '--output', output]);
  const widget = fs.readFileSync(path.join(output, 'Sources', 'Widget', 'FactoryWidget.swift'), 'utf8');
  assert.doesNotMatch(widget, /accessoryCircular|accessoryRectangular|accessoryInline/);
});

test('factory controls are explicit, use existing extensions, and enforce OS gates', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-app-factory-controls-'));
  const spec = fixture();
  spec.app.minimumIOS = '18.0'; spec.app.minimumWatchOS = '26.0';
  spec.targets.iphoneControls = true; spec.targets.watchControls = true;
  const specPath = path.join(directory, 'trail-log.yml'); fs.writeFileSync(specPath, JSON.stringify(spec));
  const output = path.join(directory, 'generated'); run('generate-project.js', ['--spec', specPath, '--output', output]);
  const project = fs.readFileSync(path.join(output, 'project.yml'), 'utf8');
  assert.match(project, /Sources\/Control/); assert.match(project, /Sources\/WatchControl/);
  assert.match(project, /- target: AppWidget\n\s+embed: true/);
  assert.match(fs.readFileSync(path.join(output, 'Sources', 'Widget', 'FactoryWidget.swift'), 'utf8'), /FactoryControl\(\)/);
  assert.match(fs.readFileSync(path.join(output, 'Sources', 'WatchWidget', 'FactoryWatchWidget.swift'), 'utf8'), /FactoryWatchControl\(\)/);
  const iphoneControl = fs.readFileSync(path.join(output, 'Sources', 'Control', 'FactoryControl.swift'), 'utf8');
  const watchControl = fs.readFileSync(path.join(output, 'Sources', 'WatchControl', 'FactoryWatchControl.swift'), 'utf8');
  assert.match(iphoneControl, /ControlValueProvider/); assert.match(iphoneControl, /var previewValue: Bool/); assert.match(iphoneControl, /StaticControlConfiguration\(kind: kind, provider: FactoryControlValueProvider\(\)\) \{ value in/); assert.match(iphoneControl, /isOn: value/);
  assert.match(watchControl, /@available\(watchOS 26\.0, \*\)/); assert.match(watchControl, /ControlValueProvider/); assert.match(watchControl, /var previewValue: Bool/); assert.match(watchControl, /StaticControlConfiguration\(kind: kind, provider: FactoryWatchControlValueProvider\(\)\) \{ value in/); assert.match(watchControl, /isOn: value/);
  const targets = JSON.parse(fs.readFileSync(path.join(output, '.factory-targets.json'), 'utf8'));
  assert.equal(targets.targetEvidence.iphoneControlExtension, 'ca.example.traillog.widget');
  assert.equal(targets.targetEvidence.watchControlExtension, 'ca.example.traillog.watchapp.widget');
  const tooOldIOS = fixture(); tooOldIOS.targets.iphoneControls = true;
  assert.throws(() => validateSpec(tooOldIOS), /minimumIOS 18.0/);
  const noWatchWidget = fixture(); noWatchWidget.app.minimumWatchOS = '26.0'; noWatchWidget.targets.watchWidgets = false; noWatchWidget.targets.watchControls = true; noWatchWidget.targets.watchComplications = false; noWatchWidget.factory.bundleIdentifiers.watchWidget = null;
  assert.throws(() => validateSpec(noWatchWidget), /requires targets.watchWidgets=true/);
  const tooOldWatch = fixture(); tooOldWatch.targets.watchControls = true;
  assert.throws(() => validateSpec(tooOldWatch), /minimumWatchOS 26.0/);
  const invalidVersion = fixture(); invalidVersion.targets.iphoneControls = true; invalidVersion.app.minimumIOS = 'latest';
  assert.throws(() => validateSpec(invalidVersion), /numeric platform version/);
});

test('factory can copy an allowlisted product source project without overwriting it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-app-factory-source-'));
  const spec = fixture();
  spec.app.name = 'BIG TUNA Lights'; spec.app.slug = 'big-tuna-lights'; spec.app.bundleId = 'ca.yannickmorgans.bigtuna.lights'; spec.app.bundleIdNamespace = 'ca.yannickmorgans.bigtuna';
  spec.targets = { iphone: true, homeScreenWidget: true, lockScreenWidget: false, liveActivities: false, iphoneControls: false, watchMode: 'none', watchWidgets: false, watchComplications: false, watchControls: false, watchConnectivity: false };
  spec.capabilities.watchConnectivity = false; spec.factory.bundleIdentifiers = { iphoneApp: spec.app.bundleId, homeWidget: `${spec.app.bundleId}.widget`, lockScreenWidget: null, liveActivityWidget: null, watchApp: null, watchExtension: null, watchWidget: null };
  spec.factory.sourceProject = 'ios/big-tuna-lights-widget';
  const specPath = path.join(directory, 'trail-log.yml'); fs.writeFileSync(specPath, JSON.stringify(spec));
  const output = path.join(directory, 'product'); run('generate-project.js', ['--spec', specPath, '--output', output]);
  assert.ok(fs.existsSync(path.join(output, 'project.yml')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, '.factory-targets.json'), 'utf8')).factory.sourceProject, 'ios/big-tuna-lights-widget');
  const unsafe = fixture(); unsafe.factory.sourceProject = '../outside';
  assert.throws(() => validateSpec(unsafe), /repository-relative directory below ios/);
});

test('IPA inspection requires control evidence to reuse the existing extensions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-app-factory-control-ipa-'));
  const spec = fixture(); spec.app.minimumIOS = '18.0'; spec.app.minimumWatchOS = '26.0'; spec.targets.iphoneControls = true; spec.targets.watchControls = true;
  const specPath = path.join(directory, 'trail-log.yml'); fs.writeFileSync(specPath, JSON.stringify(spec));
  const generated = path.join(directory, 'generated'); run('generate-project.js', ['--spec', specPath, '--output', generated]);
  const targetManifest = path.join(generated, '.factory-targets.json');
  const plist = identifier => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>`;
  const ipa = path.join(directory, 'controls.ipa'); makeZip(ipa, [
    { name: 'Payload/Trail Log.app/Info.plist', content: plist('ca.example.traillog') },
    { name: 'Payload/Trail Log.app/PlugIns/Trail Log Widgets.appex/Info.plist', content: plist('ca.example.traillog.widget') },
    { name: 'Payload/Trail Log.app/Watch/Trail Log Watch.app/Info.plist', content: plist('ca.example.traillog.watchapp') },
    { name: 'Payload/Trail Log.app/Watch/Trail Log Watch.app/PlugIns/Trail Log Watch Widgets.appex/Info.plist', content: plist('ca.example.traillog.watchapp.widget') }
  ]);
  assert.equal(JSON.parse(run('inspect-ipa.js', ['--ipa', ipa, '--targets', targetManifest])).targetEvidence.watchControlExtension, 'ca.example.traillog.watchapp.widget');
  const badManifest = JSON.parse(fs.readFileSync(targetManifest, 'utf8')); badManifest.targetEvidence.iphoneControlExtension = 'ca.example.other';
  const badTargets = path.join(directory, 'bad-targets.json'); fs.writeFileSync(badTargets, JSON.stringify(badManifest));
  const result = spawnSync(process.execPath, [path.join(tools, 'inspect-ipa.js'), '--ipa', ipa, '--targets', badTargets], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(`${result.stdout}${result.stderr}`, /iPhone control uses the existing/);
});

test('IPA inspection requires the generated host, widget, and Watch product paths', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-app-factory-ipa-'));
  const targetManifest = path.join(directory, '.factory-targets.json');
  const generated = fixture();
  fs.writeFileSync(targetManifest, JSON.stringify({ app: generated.app, targets: generated.targets, bundleIds: { iphone: generated.app.bundleId, widget: `${generated.app.bundleId}.widget`, watch: `${generated.app.bundleId}.watchapp`, watchWidget: `${generated.app.bundleId}.watchapp.widget` }, targetEvidence: { iphoneWidgetExtension: `${generated.app.bundleId}.widget`, iphoneControlExtension: null, watchWidgetExtension: `${generated.app.bundleId}.watchapp.widget`, watchControlExtension: null } }));
  const plist = identifier => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>`;
  const correct = [
    { name: 'Payload/Trail Log.app/Info.plist', content: plist('ca.example.traillog') },
    { name: 'Payload/Trail Log.app/PlugIns/Trail Log Widgets.appex/Info.plist', content: plist('ca.example.traillog.widget') },
    { name: 'Payload/Trail Log.app/Watch/Trail Log Watch.app/Info.plist', content: plist('ca.example.traillog.watchapp') },
    { name: 'Payload/Trail Log.app/Watch/Trail Log Watch.app/PlugIns/Trail Log Watch Widgets.appex/Info.plist', content: plist('ca.example.traillog.watchapp.widget') }
  ];
  const ipa = path.join(directory, 'correct.ipa'); makeZip(ipa, correct);
  assert.equal(JSON.parse(run('inspect-ipa.js', ['--ipa', ipa, '--targets', targetManifest])).ok, true);
  for (const [label, files] of [
    ['host', correct.map(value => ({ ...value, name: value.name.replaceAll('Trail Log.app', 'Wrong.app') }))],
    ['widget', correct.map(value => ({ ...value, name: value.name.replace('Trail Log Widgets.appex', 'Wrong Widgets.appex') }))],
    ['watch', correct.map(value => ({ ...value, name: value.name.replace('Trail Log Watch.app', 'Wrong Watch.app') }))]
  ]) {
    const wrong = path.join(directory, `${label}.ipa`); makeZip(wrong, files);
    const result = spawnSync(process.execPath, [path.join(tools, 'inspect-ipa.js'), '--ipa', wrong, '--targets', targetManifest], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /wrong-identity|generated/);
  }
  const wrongIdentifier = path.join(directory, 'wrong-identifier.ipa');
  makeZip(wrongIdentifier, correct.map(value => value.name.includes('Trail Log Widgets') ? { ...value, content: plist('ca.example.wrong') } : value));
  const identifierResult = spawnSync(process.execPath, [path.join(tools, 'inspect-ipa.js'), '--ipa', wrongIdentifier, '--targets', targetManifest], { cwd: root, encoding: 'utf8' });
  assert.notEqual(identifierResult.status, 0);
  assert.match(`${identifierResult.stdout}${identifierResult.stderr}`, /CFBundleIdentifier is ca\.example\.wrong/);
});

test('IPA inspection validates an optional Sideloadly-prepared embedded hierarchy', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-app-factory-sideloadly-ipa-'));
  const targetManifest = path.join(directory, '.factory-targets.json');
  const generated = fixture();
  fs.writeFileSync(targetManifest, JSON.stringify({ app: generated.app, targets: generated.targets, bundleIds: { iphone: generated.app.bundleId, widget: `${generated.app.bundleId}.widget`, watch: `${generated.app.bundleId}.watchapp`, watchWidget: `${generated.app.bundleId}.watchapp.widget` }, targetEvidence: { iphoneWidgetExtension: `${generated.app.bundleId}.widget`, iphoneControlExtension: null, watchWidgetExtension: `${generated.app.bundleId}.watchapp.widget`, watchControlExtension: null } }));
  const suffix = 'A1B2C3D4E5';
  const futureHost = `${generated.app.bundleId}.${suffix}`;
  const plist = (identifier, companion = null) => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string>${companion === null ? '' : `<key>WKCompanionAppBundleIdentifier</key><string>${companion}</string>`}</dict></plist>`;
  const entries = [
    { name: 'Payload/Trail Log.app/Info.plist', content: plist(generated.app.bundleId) },
    { name: 'Payload/Trail Log.app/PlugIns/Trail Log Widgets.appex/Info.plist', content: plist(`${futureHost}.widget`) },
    { name: 'Payload/Trail Log.app/Watch/Trail Log Watch.app/Info.plist', content: plist(`${futureHost}.watchapp`, futureHost) },
    { name: 'Payload/Trail Log.app/Watch/Trail Log Watch.app/PlugIns/Trail Log Watch Widgets.appex/Info.plist', content: plist(`${futureHost}.watchapp.widget`) }
  ];
  const ipa = path.join(directory, 'sideloadly.ipa'); makeZip(ipa, entries);
  const report = JSON.parse(run('inspect-ipa.js', ['--ipa', ipa, '--targets', targetManifest, '--sideloadly-host-bundle-id', futureHost]));
  assert.equal(report.sideloadlyHostBundleId, futureHost);
  const wrongCompanion = path.join(directory, 'wrong-companion.ipa');
  makeZip(wrongCompanion, entries.map(entry => entry.name.includes('Trail Log Watch.app/Info.plist') ? { ...entry, content: plist(`${futureHost}.watchapp`, generated.app.bundleId) } : entry));
  const companionResult = spawnSync(process.execPath, [path.join(tools, 'inspect-ipa.js'), '--ipa', wrongCompanion, '--targets', targetManifest, '--sideloadly-host-bundle-id', futureHost], { cwd: root, encoding: 'utf8' });
  assert.notEqual(companionResult.status, 0);
  assert.match(`${companionResult.stdout}${companionResult.stderr}`, /WKCompanionAppBundleIdentifier/);
  const invalidSuffixResult = spawnSync(process.execPath, [path.join(tools, 'inspect-ipa.js'), '--ipa', ipa, '--targets', targetManifest, '--sideloadly-host-bundle-id', `${generated.app.bundleId}.lowercase1`], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalidSuffixResult.status, 0);
  assert.match(`${invalidSuffixResult.stdout}${invalidSuffixResult.stderr}`, /10-character uppercase ASCII alphanumeric suffix/);
  const insertedSegmentResult = spawnSync(process.execPath, [path.join(tools, 'inspect-ipa.js'), '--ipa', ipa, '--targets', targetManifest, '--sideloadly-host-bundle-id', `${generated.app.bundleId}.EXTRA.${suffix}`], { cwd: root, encoding: 'utf8' });
  assert.notEqual(insertedSegmentResult.status, 0);
  assert.match(`${insertedSegmentResult.stdout}${insertedSegmentResult.stderr}`, /exactly one 10-character uppercase ASCII alphanumeric suffix/);
});

test('Apple factory packages nested bundles with credential-free ad-hoc signatures before their parents', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'apple-app-factory.yml'), 'utf8');
  const packageStep = workflow.match(/- name: Package credential-free ad-hoc IPA and verify embedded components\n([\s\S]*?)(?=\n      - name: Create release metadata)/);
  assert.ok(packageStep, 'credential-free package step must exist');
  const script = packageStep[1];
  assert.match(script, /\/usr\/bin\/codesign --force --sign - --timestamp=none "\$bundle"/);
  assert.match(script, /\/usr\/bin\/codesign --verify --strict "\$bundle"/);
  assert.match(script, /find "\$app" -depth -type d -name '\*\.appex' -print0/);
  assert.match(script, /find "\$app\/Watch" -depth -type d -name '\*\.app' -print0/);
  assert.ok(script.indexOf("find \"$app\" -depth -type d -name '*.appex' -print0") < script.indexOf("find \"$app/Watch\" -depth -type d -name '*.app' -print0"));
  assert.ok(script.indexOf("find \"$app/Watch\" -depth -type d -name '*.app' -print0") < script.indexOf('sign_bundle "$app"'));
  assert.match(workflow, /sideloadly_personal_team_suffix:/);
  assert.match(workflow, /\[\[ -z "\$SIDELOADLY_PERSONAL_TEAM_SUFFIX" \|\| "\$SIDELOADLY_PERSONAL_TEAM_SUFFIX" =~ \^\[A-Z0-9\]\{10\}\$ \]\]/);
  assert.match(script, /\/usr\/libexec\/PlistBuddy/);
  assert.ok(script.indexOf('rewrite_embedded_bundle_id()') < script.indexOf('sign_bundle()'));
  assert.match(script, /--sideloadly-host-bundle-id/);
  assert.match(workflow, /sideloadly_prepared: \$\{\{ steps\.identity\.outputs\.sideloadly_prepared \}\}/);
  assert.match(workflow, /needs\.build\.outputs\.sideloadly_prepared != 'true'/);
  assert.match(workflow, /document\.sideloadlyPreparation=\{derivedHostBundleId:host, purpose:'Noncanonical metadata preparation for the owner-controlled local re-signing workflow; never promote as a canonical release\.'/);
  assert.doesNotMatch(script, /CODE_SIGN_IDENTITY|CODE_SIGN_STYLE|DEVELOPMENT_TEAM|PROVISIONING_PROFILE|allowProvisioning|APPLE_ID|APPLE_PASSWORD|APP_SPECIFIC_PASSWORD|DEVICE_ID/i);
});
