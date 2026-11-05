'use strict';

// 包身份三面一致：`package.json` ↔ `package-lock.json` 顶层 ↔ `packages[""]`。
//
// 背景（2026-11-05 实测漂移）：改名到 dsh-voice-prompt-enhancer 后，package-lock.json
// 仍停在 `dsh-prompt-enhancer@3.4.2`。npm 发布读的是 package.json 所以包本身没出错，
// 但任何按 lock 判身份的消费方（审计、供应链扫描、依赖图工具）都会读到旧名旧版本。
// 门禁锁 name / version 两面相等，并确认 engines.dsh 也镜像到 lock（市场读的就是这个字段）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
const root = (lock.packages && lock.packages['']) || {};

test('PLI-01 lock 顶层 name/version 与 package.json 相等', () => {
  assert.equal(lock.name, pkg.name, 'package-lock.json 顶层 name 必须等于 package.json');
  assert.equal(lock.version, pkg.version, 'package-lock.json 顶层 version 必须等于 package.json');
});

test('PLI-02 lock packages[""] 的 name/version 与 package.json 相等', () => {
  assert.equal(root.name, pkg.name, 'lock packages[""].name 必须等于 package.json');
  assert.equal(root.version, pkg.version, 'lock packages[""].version 必须等于 package.json');
});

test('PLI-03 宿主版本声明镜像到 lock（市场读 engines.dsh）', () => {
  const declared = pkg.engines && pkg.engines.dsh;
  assert.ok(typeof declared === 'string' && declared.length > 0, 'package.json 必须声明 engines.dsh');
  assert.equal(root.engines && root.engines.dsh, declared,
    'lock 的 engines.dsh 必须与 package.json 同值');
});

test('PLI-04 peer 依赖集合三面相等（package.json ↔ lock root）', () => {
  const pkgPeers = Object.keys(pkg.peerDependencies || {}).sort();
  const lockPeers = Object.keys(root.peerDependencies || {}).sort();
  assert.deepEqual(lockPeers, pkgPeers, 'peer 依赖键集必须相等');
  for (const name of pkgPeers) {
    assert.equal(root.peerDependencies[name], pkg.peerDependencies[name],
      'peer ' + name + ' 的区间必须相等');
  }
});

test('PLI-05 判据有牙：篡改 name 必须被 PLI-01/02 拦住', () => {
  const tampered = { ...lock, name: 'dsh-prompt-enhancer' };
  assert.notEqual(tampered.name, pkg.name, '注入旧名后必须与 package.json 不等（否则门禁无判别力）');
});
