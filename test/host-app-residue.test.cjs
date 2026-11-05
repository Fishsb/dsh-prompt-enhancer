'use strict';

// 目标模式：宿主装配入口不得重新长出已退役更新执行器/agent 查询死残留。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');

const FORBIDDEN = ['updateCache', 'pullInFlight', 'resolveSessionPolicy', 'resolveAgent'];

test('HAR-01 app 源不再定义退役更新/agent 残片', () => {
  const app = fs.readFileSync(path.join(REPO_ROOT, 'src/host/app.cjs'), 'utf8');
  for (const name of FORBIDDEN) {
    assert.equal(app.includes(name), false, 'app 源仍含死残留：' + name);
  }
});

test('HAR-03 host 装配入口与产物面一致：普通 CommonJS 单入口 + 无外部 require', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src/host/app.cjs'), 'utf8');
  assert.ok(src.includes("require('./domains/enhance/pure.cjs')"), '装配入口必须显式 require 纯函数模块');
  assert.ok(src.includes("require('./domains/enhance/prompts.cjs')"), '装配入口必须显式 require 提示词模块');
  assert.ok(!src.includes('@dsh-'), '装配入口不得再依赖注入标记');
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.equal((host.match(/require\(/g) || []).length, 0, 'host 产物不得含外部 require');
  assert.ok(host.includes('"src/host/app.cjs"'), 'host 产物必须内联单一装配入口');
});

test('HAR-04 host 产物仍可求值，inject 声明与 RPC 注册顺序保持不变', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  const regs = [];
  const harness = { handle: (name) => regs.push(name) };
  const plugin = new Function('harness', host)(harness);
  assert.deepEqual(plugin.inject, ['llm', 'timer']);
  const ctx = { get: (n) => (n === 'llm' ? { providerRetryPolicy: () => null, stream: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }) } : null), timer: { timeout: () => () => {} }, effect: () => () => {} };
  plugin.apply(ctx);
  assert.deepEqual(regs, ['models/list', 'models/resolve', 'models/current', 'models/autochain', 'models/test', 'models/stats', 'logs/last', 'template/default', 'enhance/progress', 'enhance', 'voice/correct', 'cancel']);
});

test('HAR-02 host 产物不再携带退役更新/agent 残片', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  for (const name of FORBIDDEN) {
    assert.equal(host.includes(name), false, 'host 产物仍含死残留：' + name);
  }
});
