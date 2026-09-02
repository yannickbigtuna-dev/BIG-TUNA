#!/usr/bin/env node
'use strict';

// Dependency-free tooling: app specifications are deliberately limited to JSON.
// YAML is a superset of JSON, so .yml files may use JSON syntax. This avoids
// relying on an undeclared YAML parser in the Windows host or CI runner.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const BUNDLE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){1,}$/;
const APP_GROUP = /^group\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const capabilityNames = new Set([
  'appGroups', 'healthKit', 'workoutKit', 'coreMotion', 'location', 'bluetooth',
  'notifications', 'backgroundRefresh', 'siri', 'haptics', 'watchConnectivity'
]);
// Only these capabilities have reusable, working template plumbing. Other
// names remain recognized so a requested capability fails loudly rather than
// being silently omitted from an entitlement or source target.
const implementedCapabilities = new Set(['appGroups', 'watchConnectivity']);

function fail(message) { const error = new Error(message); error.isFactoryError = true; throw error; }
function readJson(file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`${file}: expected JSON-compatible YAML: ${error.message}`); }
  return value;
}
function required(value, label) { if (value === undefined || value === null || value === '') fail(`${label} is required`); return value; }
function property(value, key, label) { if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${label} is required`); return value[key]; }
function bool(value, label) { if (typeof value !== 'boolean') fail(`${label} must be true or false`); return value; }
function object(value, label) { if (!value || Array.isArray(value) || typeof value !== 'object') fail(`${label} must be an object`); return value; }
function str(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`); return value.trim(); }
function version(value, label) { if (!/^\d+(?:\.\d+){0,2}$/.test(str(value, label))) fail(`${label} must be numeric, for example 1.0.0`); return value; }
function int(value, label) { if (!Number.isInteger(value) || value < 1) fail(`${label} must be a positive integer`); return value; }
function nullableString(value, label) { if (value !== null && typeof value !== 'string') fail(`${label} must be a string or null`); return value; }
function hex(value, label) { if (!/^#[0-9a-fA-F]{6}$/.test(str(value, label))) fail(`${label} must be a six-digit hexadecimal colour, for example #0A84FF`); return value; }
function appleBundleId(namespace, suffix) { return suffix ? `${namespace}.${suffix}` : namespace; }
function majorVersion(value, label) {
  const result = str(value, label);
  if (!/^\d+(?:\.\d+){1,2}$/.test(result)) fail(`${label} must be a numeric platform version such as 18.0`);
  return Number.parseInt(result.split('.')[0], 10);
}
function sourceProjectPath(value, label) {
  if (value === null || value === undefined) return null;
  const result = str(value, label).replace(/\\/g, '/');
  if (!/^ios\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(result) || result.includes('..')) {
    fail(`${label} must be a repository-relative directory below ios/ without traversal`);
  }
  return result;
}

function validateSpec(spec, source = 'spec') {
  object(spec, source);
  const app = object(required(spec.app, `${source}.app`), `${source}.app`);
  str(app.name, 'app.name');
  if (!SLUG.test(str(app.slug, 'app.slug'))) fail('app.slug must use lowercase letters, digits, and single hyphens');
  if (!BUNDLE.test(str(app.bundleId, 'app.bundleId'))) fail('app.bundleId must be a reverse-DNS bundle identifier');
  if (!BUNDLE.test(str(app.bundleIdNamespace, 'app.bundleIdNamespace'))) fail('app.bundleIdNamespace must be a reverse-DNS bundle identifier');
  if (!app.bundleId.startsWith(`${app.bundleIdNamespace}.`)) fail('app.bundleId must remain inside app.bundleIdNamespace');
  str(app.iconSource, 'app.iconSource');
  const theme = object(required(app.theme, 'app.theme'), 'app.theme'); hex(theme.accentHex, 'app.theme.accentHex'); hex(theme.backgroundHex, 'app.theme.backgroundHex');
  str(app.minimumIOS, 'app.minimumIOS');
  str(app.minimumWatchOS, 'app.minimumWatchOS');
  version(app.version, 'app.version'); int(app.build, 'app.build');
  const targets = object(required(spec.targets, 'targets'), 'targets');
  // Control flags were added after schema version 1. Missing flags are false so
  // existing durable specs remain valid without silently opting into a target.
  for (const name of ['iphoneControls', 'watchControls']) if (targets[name] === undefined) targets[name] = false;
  for (const name of ['iphone', 'homeScreenWidget', 'lockScreenWidget', 'liveActivities', 'iphoneControls', 'watchWidgets', 'watchComplications', 'watchControls', 'watchConnectivity']) bool(required(targets[name], `targets.${name}`), `targets.${name}`);
  if (!['none', 'companion', 'independent'].includes(str(targets.watchMode, 'targets.watchMode'))) fail('targets.watchMode must be none, companion, or independent');
  if (!targets.iphone) fail('targets.iphone must remain enabled: every factory project has an iPhone host');
  if ((targets.lockScreenWidget || targets.liveActivities) && !targets.homeScreenWidget) fail('Lock Screen widgets and Live Activities require targets.homeScreenWidget=true');
  if ((targets.watchWidgets || targets.watchComplications || targets.watchConnectivity) && targets.watchMode === 'none') fail('Watch widgets, complications, and WatchConnectivity require a Watch app');
  if (targets.watchComplications && !targets.watchWidgets) fail('Watch complications require targets.watchWidgets=true');
  if (targets.iphoneControls && majorVersion(app.minimumIOS, 'app.minimumIOS') < 18) fail('targets.iphoneControls requires app.minimumIOS 18.0 or later');
  if (targets.watchControls && targets.watchMode === 'none') fail('targets.watchControls requires a Watch app');
  if (targets.watchControls && !targets.watchWidgets) fail('targets.watchControls requires targets.watchWidgets=true because controls live in the existing Watch widget extension');
  if (targets.watchControls && majorVersion(app.minimumWatchOS, 'app.minimumWatchOS') < 26) fail('targets.watchControls requires app.minimumWatchOS 26.0 or later');
  const capabilities = object(spec.capabilities || {}, 'capabilities');
  for (const key of Object.keys(capabilities)) {
    if (!capabilityNames.has(key)) fail(`capabilities.${key} is not supported by this template; add explicit template support before requesting it`);
    bool(capabilities[key], `capabilities.${key}`);
    if (capabilities[key] && !implementedCapabilities.has(key)) fail(`capabilities.${key} is not implemented by the reusable template. Add its entitlement, privacy text, runtime implementation, and physical-device validation before enabling it.`);
  }
  for (const key of capabilityNames) if (capabilities[key] === undefined) capabilities[key] = false;
  if (targets.watchConnectivity !== capabilities.watchConnectivity) fail('targets.watchConnectivity and capabilities.watchConnectivity must have the same value');
  if (capabilities.appGroups) {
    const group = str(spec.appGroupId, 'appGroupId');
    if (!APP_GROUP.test(group)) fail('appGroupId must start with group. and be a reverse-DNS identifier');
  } else if (spec.appGroupId) fail('appGroupId may only be set when capabilities.appGroups=true');
  const privacy = object(spec.privacy || {}, 'privacy');
  const requiredPrivacy = { healthKit: ['healthShare', 'healthUpdate'], location: ['locationWhenInUse'], bluetooth: ['bluetooth'], notifications: [] };
  for (const capability of Object.keys(requiredPrivacy)) if (capabilities[capability]) for (const key of requiredPrivacy[capability]) str(privacy[key], `privacy.${key} is required when capabilities.${capability}=true`);
  const factory = object(required(spec.factory, 'factory'), 'factory');
  const sourceProject = sourceProjectPath(factory.sourceProject, 'factory.sourceProject');
  const factoryBundles = object(required(factory.bundleIdentifiers, 'factory.bundleIdentifiers'), 'factory.bundleIdentifiers');
  for (const key of ['iphoneApp', 'homeWidget', 'lockScreenWidget', 'liveActivityWidget', 'watchApp', 'watchExtension', 'watchWidget']) nullableString(property(factoryBundles, key, `factory.bundleIdentifiers.${key}`), `factory.bundleIdentifiers.${key}`);
  const ids = bundleIds(spec);
  const expectedBundles = {
    iphoneApp: ids.iphone,
    homeWidget: targets.homeScreenWidget ? ids.widget : null,
    lockScreenWidget: targets.lockScreenWidget ? ids.widget : null,
    liveActivityWidget: targets.liveActivities ? ids.widget : null,
    watchApp: targets.watchMode !== 'none' ? ids.watch : null,
    // The modern SwiftUI Watch app target has no separate WatchKit extension.
    watchExtension: null,
    watchWidget: targets.watchWidgets ? ids.watchWidget : null
  };
  for (const [key, expected] of Object.entries(expectedBundles)) if (factoryBundles[key] !== expected) fail(`factory.bundleIdentifiers.${key} must be ${expected === null ? 'null' : expected} for the selected targets`);
  const data = object(required(factory.data, 'factory.data'), 'factory.data');
  str(data.storageMethod, 'factory.data.storageMethod'); int(data.schemaVersion, 'factory.data.schemaVersion'); str(data.migrationStrategy, 'factory.data.migrationStrategy'); str(data.exportOrBackup, 'factory.data.exportOrBackup');
  const api = object(required(data.homeServerApi, 'factory.data.homeServerApi'), 'factory.data.homeServerApi'); nullableString(property(api, 'baseUrl', 'factory.data.homeServerApi.baseUrl'), 'factory.data.homeServerApi.baseUrl'); str(api.authMode, 'factory.data.homeServerApi.authMode');
  const distribution = object(required(factory.distribution, 'factory.distribution'), 'factory.distribution'); str(distribution.access, 'factory.distribution.access'); nullableString(property(distribution, 'url', 'factory.distribution.url'), 'factory.distribution.url'); str(distribution.releaseRoot, 'factory.distribution.releaseRoot');
  const lastBuild = object(required(factory.lastSuccessfulBuild, 'factory.lastSuccessfulBuild'), 'factory.lastSuccessfulBuild'); str(lastBuild.status, 'factory.lastSuccessfulBuild.status'); nullableString(property(lastBuild, 'ciRunUrl', 'factory.lastSuccessfulBuild.ciRunUrl'), 'factory.lastSuccessfulBuild.ciRunUrl'); nullableString(property(lastBuild, 'completedAt', 'factory.lastSuccessfulBuild.completedAt'), 'factory.lastSuccessfulBuild.completedAt'); nullableString(property(lastBuild, 'ipaSha256', 'factory.lastSuccessfulBuild.ipaSha256'), 'factory.lastSuccessfulBuild.ipaSha256');
  if (!Array.isArray(factory.knownLimitations) || factory.knownLimitations.some(value => typeof value !== 'string' || !value.trim())) fail('factory.knownLimitations must be an array of non-empty strings');
  // Normalise optional source-project mode for deterministic manifest output.
  factory.sourceProject = sourceProject;
  return spec;
}

function bundleIds(spec) {
  const id = spec.app.bundleId;
  return {
    iphone: id,
    widget: appleBundleId(id, 'widget'),
    watch: appleBundleId(id, 'watchapp'),
    watchWidget: appleBundleId(appleBundleId(id, 'watchapp'), 'widget')
  };
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function mkdirp(directory) { fs.mkdirSync(directory, { recursive: true }); }
function writeJson(file, value) { mkdirp(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function escapeSwift(value) { return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function copyTree(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) { mkdirp(to); copyTree(from, to); } else { mkdirp(path.dirname(to)); fs.copyFileSync(from, to); }
  }
}

module.exports = { fail, readJson, validateSpec, bundleIds, sha256, mkdirp, writeJson, escapeSwift, copyTree };
