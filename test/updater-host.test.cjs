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

// v3.3.2（供应链加固·哈希强校验）
test('UPD-05 parseAssetDigest 提取 tgz 资产 sha256（GitHub API digest）', () => {
  const hex = 'ab'.repeat(32);
  const rel = { assets: [
    { name: 'dsh-prompt-enhancer-3.3.1.tgz', digest: 'sha256:' + hex.toUpperCase() },
    { name: 'other.zip', digest: 'sha256:' + 'cd'.repeat(32) },
  ] };
  assert.equal(updater.parseAssetDigest(rel, 'dsh-prompt-enhancer-3.3.1.tgz'), hex);
  // 非 sha256: 前缀 / 缺 digest / 无资产 / 非法 JSON 形状 → 空（按无期望哈希处理）
  assert.equal(updater.parseAssetDigest({ assets: [{ name: 'x.tgz', digest: 'md5:xxx' }] }, 'x.tgz'), '');
  assert.equal(updater.parseAssetDigest({ assets: [{ name: 'x.tgz' }] }, 'x.tgz'), '');
  assert.equal(updater.parseAssetDigest({ assets: [] }, 'x.tgz'), '');
  assert.equal(updater.parseAssetDigest(null, 'x.tgz'), '');
});

test('UPD-06 parseSha256Text 兼容 sha256sum 格式与裸 hex', () => {
  const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.equal(updater.parseSha256Text(hex + '  dsh-prompt-enhancer-1.0.0.tgz\n'), hex);
  assert.equal(updater.parseSha256Text(hex.toUpperCase()), hex.toLowerCase());
  assert.equal(updater.parseSha256Text('not-a-hash'), '');
  assert.equal(updater.parseSha256Text(''), '');
});

test('UPD-07 hashGate 门禁：匹配放行、失配拒绝、镜像无哈希 fail closed、直连无哈希放行', () => {
  const a = 'aa'.repeat(32);
  // 匹配 → 放行且标记已验证
  assert.deepEqual(updater.hashGate(a, a, true), { accept: true, verified: true });
  assert.deepEqual(updater.hashGate(a, a, false), { accept: true, verified: true });
  // 失配 → 拒绝（无论来源）
  const r1 = updater.hashGate(a, 'bb'.repeat(32), false);
  assert.equal(r1.accept, false);
  assert.equal(r1.code, 'STAGE_HASH_MISMATCH');
  // 无期望哈希：镜像 → 拒绝（fail closed）；直连（TLS→GitHub）→ 放行未验证
  const r2 = updater.hashGate('', a, true);
  assert.equal(r2.accept, false);
  assert.equal(r2.code, 'STAGE_HASH_UNVERIFIED');
  assert.deepEqual(updater.hashGate('', a, false), { accept: true, verified: false });
});

