'use strict';

// 目标模式：增强/纠错 RPC 注册域普通模块的产物面与接线锁（CHG-344）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createEnhanceHandlers } = require('../src/host/domains/enhance/handlers.cjs');

const REL = 'src/host/domains/enhance/handlers.cjs';

test('HEHM-01 旧字符串 chunk 退役，普通模块在位且可独立求值', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/host/enhance-handlers.js')), false, '旧 chunk 必须退役');
  assert.equal(fs.existsSync(path.join(REPO_ROOT, REL)), true, '普通模块必须存在');
  assert.equal(typeof createEnhanceHandlers, 'function');
});

test('HEHM-02 产物内联注册域模块，旧 chunk 与外部 require 均不存在', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/domains/enhance/handlers.cjs"'), 'host 产物必须内联注册域模块 id');
  assert.ok(host.includes('"src/host/domains/enhance/handlers.cjs"'), 'host 产物必须内联注册域模块 id');
  assert.equal(host.includes('"src/host/enhance-handlers.js"'), false, '产物不得再装载旧 chunk');
  assert.equal((host.match(/require\(/g) || []).length, 0, 'host 产物不得含外部 require');
});

test('HEHM-03 四个线上 RPC 仍按原顺序注册（名称与顺序不变）', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  const { RPC_METHODS } = require('../src/shared/contracts/rpc.cjs');
  const names = [...host.matchAll(/harness\.handle\(\s*(?:'([^']+)'|RPC_METHODS\.([A-Z0-9_]+))/g)]
    .map((m) => m[1] || RPC_METHODS[m[2]]);
  const idx = (n) => names.indexOf(n);
  for (const n of [RPC_METHODS.ENHANCE_PROGRESS, RPC_METHODS.ENHANCE, RPC_METHODS.VOICE_CORRECT, RPC_METHODS.CANCEL]) {
    assert.ok(idx(n) >= 0, '缺少 RPC：' + n);
  }
  assert.ok(idx(RPC_METHODS.ENHANCE_PROGRESS) < idx(RPC_METHODS.ENHANCE));
  assert.ok(idx(RPC_METHODS.ENHANCE) < idx(RPC_METHODS.VOICE_CORRECT));
  assert.ok(idx(RPC_METHODS.VOICE_CORRECT) < idx(RPC_METHODS.CANCEL));
});

test('HEHM-04 构建器以普通模块入口打包，装配点显式注入', () => {
  const build = fs.readFileSync(path.join(REPO_ROOT, 'scripts/build-host.mjs'), 'utf8');
  assert.ok(build.includes("entry: 'src/host/app.cjs'"), 'build-host 缺单一装配入口');
  assert.ok(build.includes("entry: 'src/host/app.cjs'"), 'build-host 缺单一装配入口');
});
