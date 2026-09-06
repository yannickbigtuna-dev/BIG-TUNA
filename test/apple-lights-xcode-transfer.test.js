'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'apple-app-factory', 'package-big-tuna-lights-xcode.mjs');
const projectAudit = path.join(root, 'scripts', 'apple-app-factory', 'audit-yannick-lights-xcodeproj.mjs');

function zipNames(buffer) {
  const names = [];
  for (let offset = 0; offset <= buffer.length - 4; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + length).toString('utf8'));
    offset += 46 + length + extraLength + commentLength - 1;
  }
  return names;
}

test('Yannick Lights Xcode transfer archive contains a directly-openable unified project', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-lights-xcode-'));
  const output = path.join(directory, 'YannickLights-Xcode.zip');
  const result = JSON.parse(execFileSync(process.execPath, [script, '--output', output], { cwd: root, encoding: 'utf8' }));
  assert.equal(result.ok, true);
  assert.ok(/^[a-f0-9]{64}$/.test(result.sha256));
  const names = zipNames(fs.readFileSync(output));
  assert.ok(names.includes('YannickLights-Xcode/APP-SPEC.yml'));
  assert.ok(names.includes('YannickLights-Xcode/YannickLights.xcodeproj/project.pbxproj'));
  assert.ok(names.includes('YannickLights-Xcode/project.yml'));
  assert.ok(names.includes('YannickLights-Xcode/MAC-INSTRUCTIONS.md'));
  assert.ok(names.some(name => name.endsWith('/BigTunaLights/BigTunaLightsApp.swift')));
  assert.ok(names.every(name => !/Bootstrap\.command$/i.test(name)));
  assert.ok(names.every(name => !/(^|\/)(\.git|node_modules|DerivedData|xcuserdata)(\/|$)/i.test(name)));
  assert.ok(names.every(name => !/\.(zip|ipa|dSYM)$/i.test(name)));
  assert.ok(names.every(name => !/(^|\/)(\.env(?:\.|$)|server\.env$|token\.txt$)/i.test(name)));
  assert.ok(names.every(name => !/\.(p8|p12|pem|key|cer|crt|mobileprovision|provisionprofile)$/i.test(name)));
});

test('Yannick Lights Xcode transfer helper refuses to overwrite an existing archive', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-lights-xcode-existing-'));
  const output = path.join(directory, 'existing.zip');
  fs.writeFileSync(output, 'important existing archive');
  const result = spawnSync(process.execPath, [script, '--output', output], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Refusing to overwrite existing archive/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'important existing archive');
});

test('Yannick Lights checked-in PBX project has all supported Apple surfaces wired', () => {
  const result = JSON.parse(execFileSync(process.execPath, [projectAudit], { cwd: root, encoding: 'utf8' }));
  assert.equal(result.ok, true);
  assert.equal(result.targetCount, 5);
});
