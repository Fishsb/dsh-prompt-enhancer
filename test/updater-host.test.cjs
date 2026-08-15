'use strict';
// updater-host 可测试性单测（M0 基线补充；require 不启动 HTTP server）
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const updater = require('../lib/updater-host.cjs');

test('UPD-01 初始状态与版本常量', () => {
  assert.equal(updater.state.phase, 'idle');
  assert.equal(updater.state.busy, false);
  assert.equal(updater.state.applying, false);
  assert.equal(updater.VERSION, require('../lib/sys.cjs').EXECUTOR_VERSION);
  assert.equal(updater.PORT, 3081);
  assert.ok(updater.STAGING_DIR.includes('dsh-prompt-enhancer'));
});

test('UPD-02 verifyTarball 对缺失文件返回明确错误', async () => {
  const missing = path.join(updater.STAGING_DIR, 'no-such-file.tgz');
  const r = await updater.verifyTarball(missing);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'STAGE_MISSING');
});

test('UPD-03 rollbackToVersion 无旧版本时直接失败且无副作用', async () => {
  const r = await updater.rollbackToVersion('dsh-web', 'web', null);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_OLD_VERSION');
});

test('UPD-04 installLocal 对不存在 tarball 返回 BAD_ARGS', async () => {
  const r = await updater.installLocal('C:\\no\\such\\file.tgz', 'web');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_ARGS');
});
