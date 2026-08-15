'use strict';
// M4: update platform coordinator tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { UnsupportedReloader } = require('../src/host/reloader.js');
const { createUpdatePlatform } = require('../src/host/update-platform.js');

test('UPDPLAT-01 unsupported reloader falls back to executor', async () => {
  let called = false;
  const executor = {
    async apply(tag, profile) {
      called = true;
      return { ok: true, tag, profile };
    },
  };
  const platform = createUpdatePlatform({ reloader: new UnsupportedReloader(), executor });
  assert.equal(await platform.canHotReload(), false);
  const r = await platform.apply('v2.8.3', 'web', 'dsh-web');
  assert.equal(called, true);
  assert.equal(r.ok, true);
});

test('UPDPLAT-02 no reloader/executor returns NO_RELOADER', async () => {
  const platform = createUpdatePlatform({});
  const r = await platform.apply('v2.8.3', 'web', 'dsh-web');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_RELOADER');
});
