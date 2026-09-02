#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { readJson, validateSpec, bundleIds, mkdirp, writeJson, escapeSwift, copyTree } = require('./factory-lib');

function usage() { console.error('Usage: node generate-project.js --spec <spec.yml> --output <project-directory>'); process.exit(2); }
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function quote(value) { return JSON.stringify(String(value)); }
function entitlements(spec, includeHealth = false) {
  const entries = [];
  if (spec.capabilities.appGroups) entries.push(`  <key>com.apple.security.application-groups</key>\n  <array><string>${spec.appGroupId}</string></array>`);
  if (includeHealth && spec.capabilities.healthKit) entries.push('  <key>com.apple.developer.healthkit</key>\n  <true/>');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${entries.join('\n')}\n</dict></plist>\n`;
}
function projectYml(spec) {
  const ids = bundleIds(spec), target = spec.targets, capability = spec.capabilities;
  const dependencies = [];
  if (target.homeScreenWidget || target.iphoneControls) dependencies.push('      - target: AppWidget\n        embed: true');
  if (target.watchMode !== 'none') dependencies.push('      - target: AppWatch\n        embed: true');
  const appInfo = [
    '        INFOPLIST_KEY_UILaunchScreen_Generation: YES',
    '        INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone: UIInterfaceOrientationPortrait',
    `        INFOPLIST_KEY_CFBundleDisplayName: ${quote(spec.app.name)}`,
    target.liveActivities ? '        INFOPLIST_KEY_NSSupportsLiveActivities: YES' : '',
    capability.location ? `        INFOPLIST_KEY_NSLocationWhenInUseUsageDescription: ${quote(spec.privacy.locationWhenInUse)}` : '',
    capability.bluetooth ? `        INFOPLIST_KEY_NSBluetoothAlwaysUsageDescription: ${quote(spec.privacy.bluetooth)}` : '',
    capability.healthKit ? `        INFOPLIST_KEY_NSHealthShareUsageDescription: ${quote(spec.privacy.healthShare)}\n        INFOPLIST_KEY_NSHealthUpdateUsageDescription: ${quote(spec.privacy.healthUpdate)}` : '',
  ].filter(Boolean).join('\n');
  const sections = [`name: ${quote(spec.app.name)}`,
    'options:', '  minimumXcodeGenVersion: 2.40.0', 'settings:', '  base:', '    SWIFT_VERSION: 5.9', '    CODE_SIGN_STYLE: Automatic', `    IPHONEOS_DEPLOYMENT_TARGET: ${quote(spec.app.minimumIOS)}`, `    MARKETING_VERSION: ${quote(spec.app.version)}`, `    CURRENT_PROJECT_VERSION: ${quote(spec.app.build)}`, 'targets:',
    '  App:', '    type: application', '    platform: iOS', `    deploymentTarget: ${quote(spec.app.minimumIOS)}`, '    sources:', '      - path: Sources/App', '      - path: Sources/Shared', '      - path: Generated', '    entitlements:', '      path: Generated/App.entitlements', '    settings:', '      base:', `        PRODUCT_BUNDLE_IDENTIFIER: ${ids.iphone}`, `        PRODUCT_NAME: ${quote(spec.app.name)}`, '        GENERATE_INFOPLIST_FILE: YES', appInfo, ...(dependencies.length ? ['    dependencies:', ...dependencies] : [])];
  if (target.homeScreenWidget || target.iphoneControls) sections.push(
    '  AppWidget:', '    type: app-extension', '    platform: iOS', `    deploymentTarget: ${quote(spec.app.minimumIOS)}`, '    sources:', '      - path: Sources/Widget', ...(target.iphoneControls ? ['      - path: Sources/Control'] : []), '      - path: Sources/Shared', '      - path: Generated', ...(target.liveActivities ? ['      - path: Sources/LiveActivity'] : []), '    entitlements:', '      path: Generated/Widget.entitlements', '    settings:', '      base:', `        PRODUCT_BUNDLE_IDENTIFIER: ${ids.widget}`, `        PRODUCT_NAME: ${quote(`${spec.app.name} Widgets`)}`, '        GENERATE_INFOPLIST_FILE: YES', '        SKIP_INSTALL: YES', '        INFOPLIST_KEY_NSExtension: {NSExtensionPointIdentifier: com.apple.widgetkit-extension}'
  );
  if (target.watchMode !== 'none') sections.push(
    '  AppWatch:', '    type: application', '    platform: watchOS', `    deploymentTarget: ${quote(spec.app.minimumWatchOS)}`, '    sources:', '      - path: Sources/WatchApp', '      - path: Sources/Shared', '      - path: Generated', '    entitlements:', '      path: Generated/Watch.entitlements', '    settings:', '      base:', `        PRODUCT_BUNDLE_IDENTIFIER: ${ids.watch}`, `        PRODUCT_NAME: ${quote(`${spec.app.name} Watch`)}`, '        GENERATE_INFOPLIST_FILE: YES', `        INFOPLIST_KEY_WKApplication: YES`, target.watchMode === 'independent' ? '        INFOPLIST_KEY_WKIndependentWatchApp: YES' : '', ...(target.watchWidgets ? ['    dependencies:', '      - target: AppWatchWidget', '        embed: true'] : [])
  );
  if (target.watchWidgets) sections.push(
    '  AppWatchWidget:', '    type: app-extension', '    platform: watchOS', `    deploymentTarget: ${quote(spec.app.minimumWatchOS)}`, '    sources:', '      - path: Sources/WatchWidget', ...(target.watchControls ? ['      - path: Sources/WatchControl'] : []), '      - path: Sources/Shared', '      - path: Generated', '    entitlements:', '      path: Generated/WatchWidget.entitlements', '    settings:', '      base:', `        PRODUCT_BUNDLE_IDENTIFIER: ${ids.watchWidget}`, `        PRODUCT_NAME: ${quote(`${spec.app.name} Watch Widgets`)}`, '        GENERATE_INFOPLIST_FILE: YES', '        SKIP_INSTALL: YES', '        INFOPLIST_KEY_NSExtension: {NSExtensionPointIdentifier: com.apple.widgetkit-extension}'
  );
  return `${sections.filter(Boolean).join('\n')}\n`;
}
function generatedSwift(spec) {
  const target = spec.targets, cap = spec.capabilities;
  return `// Generated by ios/app-factory/tools/generate-project.js. Do not edit.\nimport Foundation\n\nenum FactoryAppConfiguration {\n  static let name = "${escapeSwift(spec.app.name)}"\n  static let bundleID = "${escapeSwift(spec.app.bundleId)}"\n  static let bundleIDNamespace = "${escapeSwift(spec.app.bundleIdNamespace)}"\n  static let iconSource = "${escapeSwift(spec.app.iconSource)}"\n  static let accentHex = "${escapeSwift(spec.app.theme.accentHex)}"\n  static let backgroundHex = "${escapeSwift(spec.app.theme.backgroundHex)}"\n  static let version = "${escapeSwift(spec.app.version)}"\n  static let build = "${spec.app.build}"\n  static let usesAppGroup = ${cap.appGroups}\n  static let appGroupID = ${cap.appGroups ? `"${escapeSwift(spec.appGroupId)}"` : 'nil'}\n  static let supportsWatchConnectivity = ${target.watchConnectivity}\n  static let supportsLiveActivities = ${target.liveActivities}\n  static let supportsIPhoneControls = ${target.iphoneControls}\n  static let supportsWatchControls = ${target.watchControls}\n}\n`;
}
function targetManifest(spec) {
  const ids = bundleIds(spec);
  return {
    schemaVersion: 2, app: spec.app, factory: spec.factory, bundleIds: ids,
    targets: spec.targets, capabilities: spec.capabilities,
    targetEvidence: {
      iphoneWidgetExtension: (spec.targets.homeScreenWidget || spec.targets.iphoneControls) ? ids.widget : null,
      iphoneControlExtension: spec.targets.iphoneControls ? ids.widget : null,
      watchWidgetExtension: spec.targets.watchWidgets ? ids.watchWidget : null,
      watchControlExtension: spec.targets.watchControls ? ids.watchWidget : null
    }
  };
}
const specPath = arg('--spec'), output = arg('--output'); if (!specPath || !output) usage();
try {
  const spec = validateSpec(readJson(specPath), specPath);
  const template = path.resolve(__dirname, '..', 'template');
  if (!fs.existsSync(template)) throw new Error(`Missing template directory: ${template}`);
  if (fs.existsSync(output) && fs.readdirSync(output).length > 0) throw new Error(`Refusing to overwrite non-empty output directory: ${path.resolve(output)}. Generate into a fresh CI/build directory so app source is never silently replaced.`);
  mkdirp(output);
  if (spec.factory.sourceProject) {
    const repository = path.resolve(__dirname, '..', '..', '..');
    const source = path.resolve(repository, spec.factory.sourceProject);
    const sourcePrefix = `${repository}${path.sep}`;
    if (!source.startsWith(sourcePrefix) || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error(`factory.sourceProject does not exist: ${spec.factory.sourceProject}`);
    const sourceProjectFile = path.join(source, 'project.yml');
    if (!fs.existsSync(sourceProjectFile)) throw new Error(`factory.sourceProject must contain project.yml: ${spec.factory.sourceProject}`);
    const sourceProjectYml = fs.readFileSync(sourceProjectFile, 'utf8');
    const ids = bundleIds(spec);
    const requiredSourceIDs = [ids.iphone];
    if (spec.targets.homeScreenWidget || spec.targets.iphoneControls) requiredSourceIDs.push(ids.widget);
    if (spec.targets.watchMode !== 'none') requiredSourceIDs.push(ids.watch);
    if (spec.targets.watchWidgets) requiredSourceIDs.push(ids.watchWidget);
    for (const id of requiredSourceIDs) if (!sourceProjectYml.includes(id)) throw new Error(`factory.sourceProject project.yml does not declare required bundle identifier ${id}`);
    copyTree(source, output);
    writeJson(path.join(output, '.factory-targets.json'), targetManifest(spec));
    console.log(`Copied deterministic product source from ${spec.factory.sourceProject} to ${path.resolve(output)}`);
    process.exit(0);
  }
  copyTree(template, output);
  mkdirp(path.join(output, 'Generated'));
  const widgetFile = path.join(output, 'Sources', 'Widget', 'FactoryWidget.swift');
  if (fs.existsSync(widgetFile)) {
    const source = fs.readFileSync(widgetFile, 'utf8');
    fs.writeFileSync(widgetFile, source.replace('// HOME_SCREEN_WIDGET', spec.targets.homeScreenWidget ? 'FactoryWidget()' : '').replace('// IPHONE_CONTROL_WIDGET', spec.targets.iphoneControls ? 'FactoryControl()' : '').replace('// LIVE_ACTIVITY_WIDGET', spec.targets.liveActivities ? 'FactoryLiveActivity()' : '').replace('// LOCK_SCREEN_FAMILIES', spec.targets.lockScreenWidget ? '.accessoryCircular, .accessoryRectangular, .accessoryInline' : ''));
  }
  const watchWidgetFile = path.join(output, 'Sources', 'WatchWidget', 'FactoryWatchWidget.swift');
  if (fs.existsSync(watchWidgetFile)) {
    const source = fs.readFileSync(watchWidgetFile, 'utf8');
    fs.writeFileSync(watchWidgetFile, source.replace('// WATCH_CONTROL_WIDGET', spec.targets.watchControls ? 'FactoryWatchControl()' : ''));
  }
  fs.writeFileSync(path.join(output, 'project.yml'), projectYml(spec));
  fs.writeFileSync(path.join(output, 'Generated', 'FactoryAppConfiguration.swift'), generatedSwift(spec));
  fs.writeFileSync(path.join(output, 'Generated', 'App.entitlements'), entitlements(spec, true));
  fs.writeFileSync(path.join(output, 'Generated', 'Widget.entitlements'), entitlements(spec));
  fs.writeFileSync(path.join(output, 'Generated', 'Watch.entitlements'), entitlements(spec, true));
  fs.writeFileSync(path.join(output, 'Generated', 'WatchWidget.entitlements'), entitlements(spec));
  writeJson(path.join(output, '.factory-targets.json'), targetManifest(spec));
  console.log(`Generated deterministic XcodeGen input at ${path.resolve(output)}`);
} catch (error) { console.error(`App Factory generation failed: ${error.message}`); process.exit(1); }
