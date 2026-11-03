'use strict';

// 目标模式：client 配置/状态普通模块与 timerRef 接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createClientState } = require('../src/client/state-module.cjs');

test('CSTATE-01 旧 state chunk 退役，工厂在位', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/state.js')), false);
  assert.equal(typeof createClientState, 'function');
});

test('CSTATE-02 cloneDefaults 返回既有 v2 配置结构', () => {
  const api = createClientState({ host: { call: async () => ({ ok: true, config: null }) } });
  const d = api.cloneDefaults();
  assert.equal(d.version, 2);
  assert.equal(d.mode, 'base');
  assert.equal(d.context.budgetChars, 4000);
  assert.deepEqual(d.template.texts, { base: '', lite: '', standard: '', smart: '', publish: '' });
  assert.deepEqual(d.fallback, []);
});

test('CSTATE-03 saveConfig 只提交 patch，不整份覆盖磁盘配置', async () => {
  const calls = [];
  const host = { call: (method, args) => { calls.push({ method, args }); return Promise.resolve({ ok: true }); } };
  const api = createClientState({ host });
  await Promise.resolve();
  api.configState.value = api.cloneDefaults();
  calls.length = 0;
  api.saveConfig({ params: { timeoutMs: 30000 } });
  const set = calls.find((c) => c.method === 'config/set');
  assert.ok(set, '必须发 config/set');
  assert.deepEqual(set.args.config, { params: { timeoutMs: 30000 } });
});

test('CSTATE-04 host 启动同步成功后写入 sanitize 结果并解除 fresh', async () => {
  const host = {
    call: async (method) => method === 'config/get'
      ? { ok: true, config: { version: 2, memory: true, fallback: [{ provider: 'p', model: 'm' }] } }
      : { ok: true },
  };
  const api = createClientState({ host });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(api.configState.hostSync, true);
  assert.equal(api.configState.fresh, false);
  assert.equal(api.configState.value.memory, true);
  assert.deepEqual(api.configState.value.fallback, [{ provider: 'p', model: 'm' }]);
});

test('CSTATE-05 产物内联状态模块，app 同步 timerRef', () => {
  const shared = fs.readFileSync(path.join(REPO_ROOT, 'src/client/shared-runtime.cjs'), 'utf8');
  const app = fs.readFileSync(path.join(REPO_ROOT, 'src/client/app-module.cjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(shared.includes("require('./state-module.cjs')"));
  assert.ok(app.includes('timerRef.value = timerSvc'));
  assert.ok(client.includes('src/client/state-module.cjs'));
  assert.ok(client.includes('createClientState({ host, timerRef: __DSH_TIMER_REF__ })'));
  assert.ok(client.includes('timerRef.value = timerSvc'));
});
