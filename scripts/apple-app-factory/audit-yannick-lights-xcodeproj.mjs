#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const productRoot = path.join(root, 'ios', 'big-tuna-lights-widget');
const project = path.join(productRoot, 'YannickLights.xcodeproj', 'project.pbxproj');
const expected = {
  YannickLights: ['BigTunaLights', 'Shared'],
  YannickLightsWidgets: ['BigTunaLightsWidget', 'Shared'],
  YannickLightsWatch: ['BigTunaLightsWatch'],
  YannickLightsWatchWidgets: ['BigTunaLightsWatchWidget', 'BigTunaLightsWatch/Shared'],
  YannickLightsTests: ['YannickLightsTests']
};
function swiftFiles(folder) {
  const directory = path.join(productRoot, folder);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.swift'))
    .map(entry => path.relative(productRoot, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}
function escaped(text) { return text.replaceAll('\\', '\\\\').replaceAll('.', '\\.'); }
try {
  const text = fs.readFileSync(project, 'utf8');
  const definitions = [...text.matchAll(/^\s*([A-F0-9]{24})\b[^=]*= \{/gm)].map(match => match[1]);
  if (new Set(definitions).size !== definitions.length) throw new Error('Duplicate PBX object UUIDs.');
  const defined = new Set(definitions);
  const references = [...text.matchAll(/\b([A-F0-9]{24})\b/g)].map(match => match[1]);
  for (const reference of references) if (!defined.has(reference)) throw new Error('Unresolved PBX object UUID ' + reference + '.');
  for (const [name, folders] of Object.entries(expected)) {
    const target = text.match(new RegExp('([A-F0-9]{24}) /\\* ' + name + ' \\*/ = \\{isa = PBXNativeTarget;([^}]*)\\};'));
    if (!target) throw new Error('Missing target ' + name + '.');
    const sourcePhase = target[2].match(/buildPhases = \(([^)]*)\)/);
    if (!sourcePhase) throw new Error('Missing build phases for ' + name + '.');
    const phaseIDs = sourcePhase[1].match(/[A-F0-9]{24}/g) || [];
    const phase = phaseIDs.map(id => text.match(new RegExp(id + ' /\\* Sources \\*/ = \\{isa = PBXSourcesBuildPhase;([^}]*)\\};'))).find(Boolean);
    if (!phase) throw new Error('Missing Sources build phase for ' + name + '.');
    const buildIDs = phase[1].match(/[A-F0-9]{24}/g) || [];
    const builtFiles = buildIDs.map(id => {
      const build = text.match(new RegExp(id + ' /\\* ([^*]+) \\*/ = \\{isa = PBXBuildFile;'));
      return build && build[1];
    }).filter(Boolean);
    let required = folders.flatMap(swiftFiles);
    if (name === 'YannickLightsWidgets') required = required.filter(file => !['IPhoneWatchConnectivity.swift', 'LightsAppIntents.swift', 'YannickLightsShortcuts.swift'].some(source => file.endsWith('/' + source)));
    for (const file of required) {
      if (!builtFiles.includes(file)) throw new Error(name + ' is missing Swift source ' + file + '.');
      if (!new RegExp('[A-F0-9]{24} /\\* ' + escaped(file) + ' \\*/ = \\{isa = PBXFileReference;').test(text)) throw new Error('Missing PBXFileReference for ' + file + '.');
    }
  }
  const entitlementPaths = ['BigTunaLights/BigTunaLights.entitlements', 'BigTunaLightsWidget/BigTunaLightsWidget.entitlements', 'BigTunaLightsWatch/BigTunaLightsWatch.entitlements', 'BigTunaLightsWatchWidget/BigTunaLightsWatchWidget.entitlements'];
  for (const file of entitlementPaths) {
    if (!fs.readFileSync(path.join(productRoot, file), 'utf8').includes('group.ca.yannickmorgans.bigtuna.lights')) throw new Error(file + ' is missing the shared App Group entitlement.');
  }
  const groupSection = text.match(/\/\* Begin PBXGroup section \*\/([\s\S]*?)\/\* End PBXGroup section \*\//)?.[1] ?? '';
  for (const match of text.matchAll(/^\s*([A-F0-9]{24})\b[^=]*= \{isa = PBXFileReference;/gm)) {
    if (!groupSection.includes(match[1])) throw new Error('Orphan PBXFileReference ' + match[1] + '.');
  }
  for (const identity of ['ca.yannickmorgans.bigtuna.lights', 'ca.yannickmorgans.bigtuna.lights.widget', 'ca.yannickmorgans.bigtuna.lights.watchapp', 'ca.yannickmorgans.bigtuna.lights.watchapp.widget']) if (!text.includes(identity)) throw new Error('Missing stable identity ' + identity + '.');
  for (const required of ['Embed YannickLightsWidgets', 'Embed YannickLightsWatch', 'Embed YannickLightsWatchWidgets', 'dstSubfolderSpec = 13', 'dstSubfolderSpec = 16', 'SDKROOT = iphoneos', 'SDKROOT = watchos', 'INFOPLIST_KEY_WKCompanionAppBundleIdentifier = ca.yannickmorgans.bigtuna.lights', 'INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO', 'INFOPLIST_KEY_CFBundleURLTypes']) if (!text.includes(required)) throw new Error('Missing required project evidence: ' + required);
  for (const file of ['BigTunaLightsWidget/Info.plist', 'BigTunaLightsWatchWidget/Info.plist']) {
    const plist = fs.readFileSync(path.join(productRoot, file), 'utf8');
    if (!/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist)) throw new Error(file + ' must declare standard exempt networking only.');
  }
  const iconCatalog = JSON.parse(fs.readFileSync(path.join(productRoot, 'Assets.xcassets', 'AppIcon.appiconset', 'Contents.json'), 'utf8'));
  for (const platform of ['ios', 'watchos']) {
    const slot = iconCatalog.images.find(image => image.platform === platform && image.idiom === 'universal' && image.size === '1024x1024');
    if (!slot?.filename) throw new Error('Missing single-size ' + platform + ' app icon slot.');
    const bytes = fs.readFileSync(path.join(productRoot, 'Assets.xcassets', 'AppIcon.appiconset', slot.filename));
    if (bytes.length < 24 || bytes.readUInt32BE(16) !== 1024 || bytes.readUInt32BE(20) !== 1024) throw new Error(platform + ' app icon must be exactly 1024x1024 PNG.');
  }
  console.log(JSON.stringify({ ok: true, project, targetCount: Object.keys(expected).length, objectCount: definitions.length }));
} catch (error) {
  console.error('Yannick Lights Xcode project audit failed: ' + error.message);
  process.exitCode = 1;
}
