#!/usr/bin/env node
// Generates the checked-in project. The Mac transfer never needs XcodeGen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = path.join(root, 'ios', 'big-tuna-lights-widget');
const destination = path.join(source, 'YannickLights.xcodeproj', 'project.pbxproj');
let serial = 1;
const uid = () => (serial++).toString(16).toUpperCase().padStart(24, '0');
const listSwift = folder => {
  const directory = path.join(source, folder);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.swift'))
    .map(entry => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
};
const data = [
  ['YannickLights', 'Yannick Lights.app', 'com.apple.product-type.application', 'ca.yannickmorgans.bigtuna.lights', 'iphoneos', '18.0', 'BigTunaLights/BigTunaLights.entitlements', null, () => [...listSwift('BigTunaLights'), ...listSwift('Shared')]],
  ['YannickLightsWidgets', 'Yannick Lights Widgets.appex', 'com.apple.product-type.app-extension', 'ca.yannickmorgans.bigtuna.lights.widget', 'iphoneos', '18.0', 'BigTunaLightsWidget/BigTunaLightsWidget.entitlements', 'BigTunaLightsWidget/Info.plist', () => [...listSwift('BigTunaLightsWidget'), ...listSwift('Shared').filter(file => !['IPhoneWatchConnectivity.swift', 'LightsAppIntents.swift', 'YannickLightsShortcuts.swift'].some(name => file.endsWith('/' + name)))]],
  ['YannickLightsWatch', 'Yannick Lights Watch.app', 'com.apple.product-type.application.watchapp2', 'ca.yannickmorgans.bigtuna.lights.watchapp', 'watchos', '26.0', 'BigTunaLightsWatch/BigTunaLightsWatch.entitlements', null, () => listSwift('BigTunaLightsWatch')],
  ['YannickLightsWatchWidgets', 'Yannick Lights Watch Widgets.appex', 'com.apple.product-type.app-extension', 'ca.yannickmorgans.bigtuna.lights.watchapp.widget', 'watchos', '26.0', 'BigTunaLightsWatchWidget/BigTunaLightsWatchWidget.entitlements', 'BigTunaLightsWatchWidget/Info.plist', () => [...listSwift('BigTunaLightsWatchWidget'), ...listSwift('BigTunaLightsWatch/Shared')]],
  ['YannickLightsTests', 'YannickLightsTests.xctest', 'com.apple.product-type.bundle.unit-test', 'ca.yannickmorgans.bigtuna.lights.tests', 'iphoneos', '18.0', null, null, () => listSwift('YannickLightsTests')]
].map(row => ({ name: row[0], product: row[1], type: row[2], bundle: row[3], sdk: row[4], os: row[5], entitlement: row[6], info: row[7], getFiles: row[8], id: uid(), productID: uid(), sourceID: uid(), configs: uid() }));
const byName = Object.fromEntries(data.map(target => [target.name, target]));
const build = [], refs = [], sources = [], resources = [], configs = [], configLists = [], native = [], copy = [], proxies = [], dependencies = [];
for (const target of data) {
  const wrapper = target.product.endsWith('.appex') ? 'app-extension' : target.product.endsWith('.xctest') ? 'cfbundle' : 'application';
  refs.push('\t\t' + target.productID + ' /* ' + target.product + ' */ = {isa = PBXFileReference; explicitFileType = wrapper.' + wrapper + '; includeInIndex = 0; path = "' + target.product + '"; sourceTree = BUILT_PRODUCTS_DIR; };');
  const ids = [];
  target.sourceReferences = [];
  for (const file of target.getFiles()) {
    const reference = uid(), buildID = uid();
    refs.push('\t\t' + reference + ' /* ' + file + ' */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "' + file + '"; sourceTree = "<group>"; };');
    build.push('\t\t' + buildID + ' /* ' + file + ' */ = {isa = PBXBuildFile; fileRef = ' + reference + ' /* ' + file + ' */; };');
    ids.push(buildID + ' /* ' + file + ' */');
    target.sourceReferences.push(reference + ' /* ' + file + ' */');
  }
  sources.push('\t\t' + target.sourceID + ' /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (' + ids.join(', ') + '); runOnlyForDeploymentPostprocessing = 0; };');
  if (target.name === 'YannickLights' || target.name === 'YannickLightsWatch') {
    const assetReference = uid(), assetBuild = uid(), assetPhase = uid();
    refs.push('\t\t' + assetReference + ' /* Assets.xcassets */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; };');
    target.sourceReferences.push(assetReference + ' /* Assets.xcassets */');
    build.push('\t\t' + assetBuild + ' /* Assets.xcassets */ = {isa = PBXBuildFile; fileRef = ' + assetReference + ' /* Assets.xcassets */; };');
    resources.push('\t\t' + assetPhase + ' /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (' + assetBuild + '); runOnlyForDeploymentPostprocessing = 0; };');
    target.resourceID = assetPhase;
  }
  const debug = uid(), release = uid(), setting = [
    'PRODUCT_BUNDLE_IDENTIFIER = ' + target.bundle + ';', 'PRODUCT_MODULE_NAME = ' + target.name + ';', 'PRODUCT_NAME = "' + target.product.replace(/\.(app|appex|xctest)$/, '') + '";',
    'SWIFT_VERSION = 5.10;', 'MARKETING_VERSION = 1.3.0;', 'CURRENT_PROJECT_VERSION = 6;', 'CODE_SIGN_STYLE = Automatic;',
    'SDKROOT = ' + target.sdk + ';', (target.sdk === 'watchos' ? 'WATCHOS' : 'IPHONEOS') + '_DEPLOYMENT_TARGET = ' + target.os + ';'
  ];
  if (target.entitlement) setting.push('CODE_SIGN_ENTITLEMENTS = ' + target.entitlement + ';');
  if (target.info) setting.push('INFOPLIST_FILE = ' + target.info + ';'); else setting.push('GENERATE_INFOPLIST_FILE = YES;');
  if (target.name === 'YannickLights') setting.push('ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;', 'INFOPLIST_KEY_CFBundleDisplayName = "Yannick Lights";', 'INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;', 'INFOPLIST_KEY_UILaunchScreen_Generation = YES;', 'TARGETED_DEVICE_FAMILY = "1,2";');
  if (target.name === 'YannickLightsWatch') setting.push('ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;', 'INFOPLIST_KEY_CFBundleDisplayName = "Yannick Lights";', 'INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;', 'INFOPLIST_KEY_WKApplication = YES;', 'INFOPLIST_KEY_WKCompanionAppBundleIdentifier = ca.yannickmorgans.bigtuna.lights;', 'INFOPLIST_KEY_CFBundleURLTypes = ({CFBundleURLSchemes = (bigtunalights);});', 'TARGETED_DEVICE_FAMILY = 4;');
  if (target.name.includes('Widgets')) setting.push('SKIP_INSTALL = YES;');
  if (target.name === 'YannickLightsTests') setting.push('TEST_HOST = "$(BUILT_PRODUCTS_DIR)/Yannick Lights.app/Yannick Lights";', 'BUNDLE_LOADER = "$(TEST_HOST)";');
  configs.push('\t\t' + debug + ' /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {' + setting.join(' ') + '}; name = Debug; };', '\t\t' + release + ' /* Release */ = {isa = XCBuildConfiguration; buildSettings = {' + setting.join(' ') + '}; name = Release; };');
  configLists.push('\t\t' + target.configs + ' /* Build configuration list for ' + target.name + ' */ = {isa = XCConfigurationList; buildConfigurations = (' + debug + ', ' + release + '); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };');
}
function addEmbed(hostName, childName, destinationFolder) {
  const host = byName[hostName], child = byName[childName], phase = uid(), buildID = uid(), proxy = uid(), dependency = uid();
  build.push('\t\t' + buildID + ' /* ' + child.product + ' */ = {isa = PBXBuildFile; fileRef = ' + child.productID + ' /* ' + child.product + ' */; settings = {ATTRIBUTES = (CodeSignOnCopy, RemoveHeadersOnCopy, );}; };');
  copy.push('\t\t' + phase + ' /* Embed ' + child.name + ' */ = {isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = ' + destinationFolder + '; files = (' + buildID + '); name = "Embed ' + child.name + '"; runOnlyForDeploymentPostprocessing = 0; };');
  proxies.push('\t\t' + proxy + ' /* PBXContainerItemProxy */ = {isa = PBXContainerItemProxy; containerPortal = PROJECTOBJECT; proxyType = 1; remoteGlobalIDString = ' + child.id + '; remoteInfo = ' + child.name + '; };');
  dependencies.push('\t\t' + dependency + ' /* PBXTargetDependency */ = {isa = PBXTargetDependency; target = ' + child.id + '; targetProxy = ' + proxy + '; };');
  (host.phases ??= []).push(phase); (host.dependencies ??= []).push(dependency);
}
addEmbed('YannickLights', 'YannickLightsWidgets', 13);
addEmbed('YannickLights', 'YannickLightsWatch', 16);
addEmbed('YannickLightsWatch', 'YannickLightsWatchWidgets', 13);
const testProxy = uid(), testDependency = uid();
proxies.push('\t\t' + testProxy + ' /* PBXContainerItemProxy */ = {isa = PBXContainerItemProxy; containerPortal = PROJECTOBJECT; proxyType = 1; remoteGlobalIDString = ' + byName.YannickLights.id + '; remoteInfo = YannickLights; };');
dependencies.push('\t\t' + testDependency + ' /* PBXTargetDependency */ = {isa = PBXTargetDependency; target = ' + byName.YannickLights.id + '; targetProxy = ' + testProxy + '; };');
byName.YannickLightsTests.dependencies = [testDependency];
for (const target of data) native.push('\t\t' + target.id + ' /* ' + target.name + ' */ = {isa = PBXNativeTarget; buildConfigurationList = ' + target.configs + '; buildPhases = (' + [...(target.phases || []), target.sourceID, ...(target.resourceID ? [target.resourceID] : [])].join(', ') + '); buildRules = (); dependencies = (' + (target.dependencies || []).join(', ') + '); name = ' + target.name + '; productName = ' + target.name + '; productReference = ' + target.productID + '; productType = "' + target.type + '"; };');
const project = uid(), main = uid(), products = uid(), config = uid(), debug = uid(), release = uid();
for (const target of data) target.groupID = uid();
configs.push('\t\t' + debug + ' /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {}; name = Debug; };', '\t\t' + release + ' /* Release */ = {isa = XCBuildConfiguration; buildSettings = {}; name = Release; };');
configLists.push('\t\t' + config + ' /* Build configuration list for PBXProject */ = {isa = XCConfigurationList; buildConfigurations = (' + debug + ', ' + release + '); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };');
for (let index = 0; index < proxies.length; index += 1) proxies[index] = proxies[index].replaceAll('PROJECTOBJECT', project);
const section = (title, rows) => '\n/* Begin ' + title + ' section */\n' + rows.join('\n') + '\n/* End ' + title + ' section */';
const pbx = '// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 77;\n\tobjects = {' +
  section('PBXBuildFile', build) + section('PBXCopyFilesBuildPhase', copy) + section('PBXContainerItemProxy', proxies) + section('PBXFileReference', refs) +
  section('PBXGroup', ['\t\t' + main + ' = {isa = PBXGroup; children = (' + [products + ' /* Products */', ...data.map(target => target.groupID + ' /* ' + target.name + ' */')].join(', ') + '); sourceTree = "<group>"; };', '\t\t' + products + ' /* Products */ = {isa = PBXGroup; children = (' + data.map(target => target.productID + ' /* ' + target.product + ' */').join(', ') + '); name = Products; sourceTree = "<group>"; };', ...data.map(target => '\t\t' + target.groupID + ' /* ' + target.name + ' */ = {isa = PBXGroup; children = (' + target.sourceReferences.join(', ') + '); name = ' + target.name + '; sourceTree = "<group>"; };')]) +
  section('PBXNativeTarget', native) + section('PBXProject', ['\t\t' + project + ' /* Project object */ = {isa = PBXProject; attributes = { LastUpgradeCheck = 2600; TargetAttributes = {}; }; buildConfigurationList = ' + config + '; compatibilityVersion = "Xcode 16.0"; developmentRegion = en; mainGroup = ' + main + '; productRefGroup = ' + products + '; projectDirPath = ""; projectRoot = ""; targets = (' + data.map(target => target.id).join(', ') + '); };']) +
  section('PBXResourcesBuildPhase', resources) + section('PBXSourcesBuildPhase', sources) + section('PBXTargetDependency', dependencies) + section('XCBuildConfiguration', configs) + section('XCConfigurationList', configLists) + '\n\t};\n\trootObject = ' + project + ';\n}\n';
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, pbx);
console.log(JSON.stringify({ ok: true, output: destination, targets: data.map(target => target.name) }));
