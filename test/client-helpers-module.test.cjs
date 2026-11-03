'use strict';

// 目标模式：client 增强会话普通模块的等价、状态机与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { resultStatusOf } = require('../src/shared/contracts/result.cjs');
const { createClientHelpers } = require('../src/client/helpers-module.cjs');

function createStorage(seed) {
  const backing = new Map(seed ? Object.entries(seed) : []);
  return {
    backing,
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
  };
}

function createHarness(options) {
  const opts = options || {};
  const calls = [];
  const storage = createStorage(opts.seed);
  const host = {
    calls,
    respond: opts.respond || (() => ({ ok: true, text: '优化结果' })),
    call(method, args) {
      calls.push({ method, args });
      return Promise.resolve(this.respond(method, args));
    },
  };
  const api = createClientHelpers({
    host,
    configState: { value: Object.assign({ mode: 'standard', memory: false }, opts.config || {}) },
    dictionary: { titleIdle: '一键优化' },
    storage,
    resultStatusOf,
  });
  return { api, host, storage, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const RESULT_KEY = (sessionId) => 'dsh-enh-result:' + sessionId;

test('CHELP-01 旧 helpers chunk 退役，工厂在位并纳入共享运行时', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/helpers.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/helpers-module.cjs')), true);
  assert.equal(typeof createClientHelpers, 'function');
  const shared = fs.readFileSync(path.join(REPO_ROOT, 'src/client/shared-runtime.cjs'), 'utf8');
  assert.ok(shared.includes("require('./helpers-module.cjs')"));
  assert.ok(shared.includes('createClientHelpers: clientHelpers.createClientHelpers'));
});

test('CHELP-02 斜杠命令拆分与增强守卫保持原语义', () => {
  const { api } = createHarness();
  assert.deepEqual(api.splitCommand('/search   abc def'), { prefix: '/search   ', body: 'abc def' });
  assert.deepEqual(api.splitCommand('普通草稿'), { prefix: '', body: '普通草稿' });
  assert.equal(api.guardPasses('普通草稿', { phase: 'idle' }), true);
  assert.equal(api.guardPasses('/search abc', { phase: 'idle' }), true);
  assert.equal(api.guardPasses('/search', { phase: 'idle' }), false);
  assert.equal(api.guardPasses('普通草稿', { phase: 'submitting' }), false);
  assert.equal(api.guardPasses('普通草稿', null), false);
});

test('CHELP-03 稳定 id、错误码与模型显示名映射不变', () => {
  const { api } = createHarness();
  assert.equal(api.dshEnhId('field'), 'field-1');
  assert.equal(api.dshEnhId('field'), 'field-2');
  assert.equal(api.errorKey('TIMEOUT'), 'errTIMEOUT');
  assert.equal(api.errorKey('UNKNOWN_FUTURE_CODE'), 'errUNKNOWN');
  assert.equal(api.prettifyModel('deepseek-v4-pro'), 'DeepSeek-V4-Pro');
  assert.equal(api.prettifyModel('custom-model'), 'custom-model');
  assert.equal(api.makeT({})('titleIdle'), '一键优化');
});

test('CHELP-04 记忆只携带已有轮次，不改变用户选择的模式', () => {
  const { api } = createHarness();
  const session = api.storeFor('s1');
  session.memoryRounds.push({ input: '上一轮', output: '上一轮结果' });
  assert.deepEqual(api.resolveActualMode('s1', { mode: 'smart', memory: true }), {
    mode: 'smart',
    seed: false,
    memory: { rounds: session.memoryRounds },
  });
  assert.deepEqual(api.resolveActualMode('s2', { mode: 'base', memory: true }), {
    mode: 'base',
    seed: false,
    memory: null,
  });
});

test('CHELP-05 会话结果可从存储恢复、保存与清理', () => {
  const storage = createStorage({
    [RESULT_KEY('saved')]: JSON.stringify({ b: '原文', e: '“原文”' }),
  });
  const { api } = createHarness();
  const restoredApi = createClientHelpers({
    host: { call: () => Promise.resolve({ ok: true }) },
    configState: { value: { mode: 'base' } },
    dictionary: {},
    storage,
    resultStatusOf,
  });
  const restored = restoredApi.storeFor('saved');
  assert.equal(restored.phase, 'result');
  assert.equal(restored.backup, '原文');
  assert.equal(restored.enhanced, '“原文”');
  assert.equal(restored.optimized, true);
  assert.equal(api.resultKey('x'), RESULT_KEY('x'));
  api.saveResultStore('x', 'a', 'b');
});

test('CHELP-06 增强成功写回草稿、保存统一结果态并写入记忆', async () => {
  const { api, host, storage } = createHarness({
    config: { mode: 'smart', memory: true },
    respond: () => ({
      ok: true,
      text: '优化后',
      model: 'deepseek-v4-pro',
      fallbackUsed: true,
      degraded: ['docs'],
      truncated: true,
    }),
  });
  const sessionId = 'stay';
  api.setActiveSession(sessionId);
  const writes = [];
  const draftRef = { current: '/search 原稿' };
  api.enhance(sessionId, '/search 原稿', { setDraft: (value) => writes.push(value) }, draftRef);
  await flush();

  const request = host.calls.find((call) => call.method === 'enhance').args;
  assert.equal(request.text, '原稿');
  assert.equal(request.mode, 'smart');
  assert.equal(writes.at(-1), '/search 优化后');
  const session = api.storeFor(sessionId);
  assert.equal(session.phase, 'result');
  assert.equal(session.resultStatus, 'changed');
  assert.equal(session.lastModel, 'deepseek-v4-pro');
  assert.equal(session.fallbackUsed, true);
  assert.deepEqual(session.degraded, ['docs']);
  assert.equal(session.truncated, true);
  assert.deepEqual(session.memoryRounds, [{ input: '原稿', output: '优化后' }]);
  assert.ok(storage.backing.has(RESULT_KEY(sessionId)));
});

test('CHELP-07 切走会话不写草稿；用户已编辑则丢弃迟到结果', async () => {
  const away = createHarness({ respond: () => ({ ok: true, text: '迟到结果' }) });
  const awayWrites = [];
  away.api.enhance('away', '原文', { setDraft: (value) => awayWrites.push(value) }, { current: '原文' });
  await flush();
  assert.deepEqual(awayWrites, []);
  assert.equal(away.api.storeFor('away').phase, 'result');
  assert.ok(away.storage.backing.has(RESULT_KEY('away')));

  const edited = createHarness({ respond: () => ({ ok: true, text: '迟到结果' }) });
  const editedWrites = [];
  edited.api.setActiveSession('edited');
  edited.api.enhance('edited', '原文', { setDraft: (value) => editedWrites.push(value) }, { current: '用户已编辑' });
  await flush();
  assert.deepEqual(editedWrites, []);
  assert.equal(edited.api.storeFor('edited').phase, 'idle');
  assert.equal(edited.storage.backing.has(RESULT_KEY('edited')), false);
});

test('CHELP-08 取消在途增强会还原草稿、清结果并发送 cancel RPC', async () => {
  const { api, host, storage } = createHarness();
  host.respond = () => new Promise(() => {});
  api.setActiveSession('cancel');
  storage.setItem(RESULT_KEY('cancel'), JSON.stringify({ b: '旧', e: '旧结果' }));
  const writes = [];
  api.enhance('cancel', '原文', { setDraft: (value) => writes.push(value) }, { current: '原文' });
  await flush();
  assert.equal(api.isEnhancing('cancel'), true);
  api.cancelEnhance('cancel', { setDraft: (value) => writes.push(value) });
  assert.equal(writes.at(-1), '原文');
  assert.equal(api.isEnhancing('cancel'), false);
  assert.equal(storage.backing.has(RESULT_KEY('cancel')), false);
  assert.ok(host.calls.some((call) => call.method === 'cancel'));
});

test('CHELP-09 产物内联增强会话模块，仍自包含', () => {
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(client.includes('src/client/helpers-module.cjs'));
  assert.ok(client.includes('createClientHelpers('));
  assert.ok(client.includes('storage: typeof localStorage !== \\"undefined\\" ? localStorage : null'),
    '产物中的注入片段应保留浏览器 storage 注入');
  assert.equal(client.includes('src/client/helpers.js'), false);
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
});
