'use strict';
// M3: config schema/migration tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, migrateLegacyConfig, cloneDefaults } = require('../src/host/config-schema.js');

test('CFG-01 validateConfig accepts valid config', () => {
  const r = validateConfig({ mode: 'smart', memory: true });
  assert.equal(r.ok, true);
  assert.equal(r.value.mode, 'smart');
  assert.equal(r.value.memory, true);
});

test('CFG-02 validateConfig rejects invalid mode', () => {
  const r = validateConfig({ mode: 'unknown' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('invalid mode')));
});

test('CFG-03 migrateLegacyConfig maps v1 fields', () => {
  const out = migrateLegacyConfig({ provider: 'p', model: 'm', mode: 'lite', memory: true });
  assert.equal(out.main.provider, 'p');
  assert.equal(out.main.model, 'm');
  assert.equal(out.mode, 'lite');
  assert.equal(out.memory, true);
});

test('CFG-04 cloneDefaults returns fresh copy', () => {
  const a = cloneDefaults();
  const b = cloneDefaults();
  a.mode = 'smart';
  assert.equal(b.mode, 'base');
});
