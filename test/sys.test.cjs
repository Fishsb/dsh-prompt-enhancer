'use strict';
// sys.cjs 共享原语单测（M0 基线补充）
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sys = require('../lib/sys.cjs');

test('SYS-01 executorDir 返回外部版本化目录', () => {
  const dir = sys.executorDir('0.1.6');
  assert.ok(dir.includes('dsh-prompt-enhancer'));
  assert.ok(dir.includes('executor'));
  assert.ok(dir.endsWith(path.join('0.1.6')), '版本号作为末级目录');
});

test('SYS-02 profileDir 返回 DSH profile 路径', () => {
  const dir = sys.profileDir('web');
  assert.ok(dir.endsWith(path.join('.dsh', 'profiles', 'web')), 'profile 路径拼接正确');
});

test('SYS-03 isLocalTarballInstallArgs 只允许 staging 内 tarball', () => {
  const good = sys.isLocalTarballInstallArgs([
    'node', 'plugin', '--profile', 'web', 'add', path.join(sys.STAGING_DIR, 'dsh-prompt-enhancer-2.8.3.tgz'),
  ]);
  assert.equal(good, true, 'staging 内 tgz 应放行');

  const badPath = sys.isLocalTarballInstallArgs([
    'node', 'plugin', '--profile', 'web', 'add', 'C:\\Temp\\evil.tgz',
  ]);
  assert.equal(badPath, false, 'staging 外路径应拒绝');

  const badExt = sys.isLocalTarballInstallArgs([
    'node', 'plugin', '--profile', 'web', 'add', path.join(sys.STAGING_DIR, 'evil.zip'),
  ]);
  assert.equal(badExt, false, '非 tgz 应拒绝');

  const badArgs = sys.isLocalTarballInstallArgs(['node', 'plugin', '--profile', 'web', 'install', 'x.tgz']);
  assert.equal(badArgs, false, '非 add 命令应拒绝');
});

test('SYS-04 isEnvcheckBlocked 识别 block 失败项', () => {
  const blocked = [
    { key: 'service', level: 'block', ok: false },
    { key: 'net', level: 'warn', ok: false },
  ];
  assert.equal(sys.isEnvcheckBlocked(blocked), true, '存在 block 失败应 true');

  const warnOnly = [
    { key: 'service', level: 'block', ok: true },
    { key: 'net', level: 'warn', ok: false },
  ];
  assert.equal(sys.isEnvcheckBlocked(warnOnly), false, '仅 warn 失败应 false');
});

test('SYS-05 extractPure 暴露新 PURE 函数', () => {
  const body = `
// ==PURE-BEGIN==
function buildTarballUrl(repo, tag) { return 'https://github.com/' + repo + '/releases/download/' + tag; }
function buildLocalInstallArgs(a, b, c) { return [a, b, c]; }
function mergeEnvPath(a, b) { return a + ';' + b; }
function buildRestartPlan() { return {}; }
function buildInstallArgs() { return []; }
// ==PURE-END==
`;
  const pure = sys.extractPure(body);
  assert.equal(typeof pure.buildTarballUrl, 'function');
  assert.equal(typeof pure.buildLocalInstallArgs, 'function');
  assert.equal(typeof pure.mergeEnvPath, 'function');
});
