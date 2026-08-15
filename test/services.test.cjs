'use strict';
// M2: service interface tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelService } = require('../src/host/model-service.js');
const { createDiagnosticsService } = require('../src/host/diagnostics-service.js');
const { createUpdateService } = require('../src/host/update-service.js');
const { createPluginsService } = require('../src/host/plugins-service.js');
const { createConfigService } = require('../src/host/config-service.js');

test('SVC-01 diagnostics service rings and tails', () => {
  const d = createDiagnosticsService();
  d.log('a');
  d.error('b');
  assert.deepEqual(d.tail(), ['a', 'b']);
  assert.equal(d.tail(1).length, 1);
});

test('SVC-02 model/update/plugins/config services expose interface methods', () => {
  const m = createModelService();
  for (const fn of ['resolve', 'current', 'test', 'autochain']) assert.equal(typeof m[fn], 'function');

  const u = createUpdateService();
  for (const fn of ['check', 'pull', 'envcheck', 'apply', 'canHotReload']) assert.equal(typeof u[fn], 'function');

  const p = createPluginsService();
  for (const fn of ['inventory', 'run', 'stop', 'undefine']) assert.equal(typeof p[fn], 'function');

  const c = createConfigService();
  for (const fn of ['validate', 'defaults']) assert.equal(typeof c[fn], 'function');
});

test('SVC-03 update service apply uses platform', async () => {
  let applied = false;
  const platform = {
    async canHotReload() { return false; },
    async apply(tag, profile) { applied = true; return { ok: true, tag, profile }; },
  };
  const u = createUpdateService({ platform });
  const r = await u.apply('v2.8.3', 'web', 'dsh-web');
  assert.equal(applied, true);
  assert.equal(r.ok, true);
  assert.equal(r.tag, 'v2.8.3');
});
