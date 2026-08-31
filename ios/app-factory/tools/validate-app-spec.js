#!/usr/bin/env node
'use strict';
const { readJson, validateSpec, bundleIds } = require('./factory-lib');
const file = process.argv[2];
if (!file) { console.error('Usage: node validate-app-spec.js <spec.yml>'); process.exit(2); }
try { const spec = validateSpec(readJson(file), file); console.log(JSON.stringify({ ok: true, slug: spec.app.slug, bundleIds: bundleIds(spec) }, null, 2)); }
catch (error) { console.error(`App Factory validation failed: ${error.message}`); process.exit(1); }
