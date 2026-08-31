#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { readJson, validateSpec } = require('./factory-lib');
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
const file = arg('--spec'), requested = arg('--version');
if (!file) { console.error('Usage: node bump-version.js --spec <spec.yml> [--version <x.y.z>]'); process.exit(2); }
try {
  const spec = validateSpec(readJson(file), file);
  let next = requested;
  if (!next) { const parts = spec.app.version.split('.').map(Number); parts[parts.length - 1] += 1; next = parts.join('.'); }
  if (!/^\d+(?:\.\d+){0,2}$/.test(next)) throw new Error('--version must be numeric, for example 1.2.0');
  spec.app.version = next;
  spec.app.build += 1;
  validateSpec(spec, file);
  fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, version: spec.app.version, build: spec.app.build }, null, 2));
} catch (error) { console.error(`Version bump failed: ${error.message}`); process.exit(1); }
