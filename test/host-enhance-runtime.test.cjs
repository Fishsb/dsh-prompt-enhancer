'use strict';

// 目标模式：增强运行时辅助域（降级/预算/可中断闸/重试策略/进度）的语义锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { RETRY_ALWAYS_SAFETY_CAP, createEnhanceRuntime } = require('../src/host/domains/enhance/runtime.cjs');

function makeRuntime(overrides) {
  const timers = [];
  const logs = [];
  const deps = {
    ctx: { timer: { timeout: (cb, ms) => { timers.push({ cb, ms }); return () => {}; } } },
    llm: undefined,
    hlog: (...args) => logs.push(args.join(' ')),
  };
  const rt = createEnhanceRuntime(Object.assign(deps, overrides || {}));
  return { rt, timers, logs };
}

test('HER-01 降级登记去重且保持顺序；无 rec 时不抛错', () => {
  const { rt } = makeRuntime();
  const state = { rec: {} };
  rt.markDegraded(state, 'relevance');
  rt.markDegraded(state, 'relevance');
  rt.markDegraded(state, 'history-timeout');
  assert.deepEqual(state.rec.degraded, ['relevance', 'history-timeout']);
  assert.doesNotThrow(() => rt.markDegraded({}, 'x'));
  assert.doesNotThrow(() => rt.markDegraded(null, 'x'));
});

test('HER-02 剩余预算 / 辅助超时钳制 / 预算耗尽语义不变', () => {
  const { rt } = makeRuntime();
  assert.equal(rt.remainingBudgetMs({}), Infinity);
  assert.equal(rt.helperTimeoutMs({}, 10000), 10000);
  const future = { budgetDeadline: Date.now() + 5000 };
  assert.ok(rt.remainingBudgetMs(future) <= 5000);
  assert.ok(rt.helperTimeoutMs(future, 10000) <= 5000);
  assert.equal(rt.budgetExhausted({ budgetDeadline: Date.now() - 1 }), true);
  assert.equal(rt.budgetExhausted({ budgetDeadline: Date.now() + 10000 }), false);
});

test('HER-03 可中断闸：到点置 timedOut、中止迭代器并以 aborted 结算', async () => {
  const { rt, timers } = makeRuntime();
  const ctl = rt.startHelperAbort({ budgetDeadline: Date.now() + 60000 }, 5000);
  let returned = 0;
  const iterator = { return: () => { returned += 1; return Promise.resolve({ done: true }); } };
  ctl.attach(iterator);
  assert.equal(timers.length, 1);
  timers[0].cb();
  assert.equal(ctl.timedOut(), true);
  assert.equal(returned, 1);
  const settled = await ctl.race(new Promise(() => {}));
  assert.deepEqual(settled, { kind: 'aborted', aborted: true });
  ctl.dispose();
});

test('HER-04 重试策略：无 llm / 无 API / 抛错 → null；有效策略原样返回', () => {
  const { rt } = makeRuntime();
  assert.equal(rt.retryPolicyFor('p'), null);
  const noApi = makeRuntime({ llm: {} }).rt;
  assert.equal(noApi.retryPolicyFor('p'), null);
  const throwing = makeRuntime({ llm: { providerRetryPolicy: () => { throw new Error('SENTINEL'); } } }).rt;
  assert.equal(throwing.retryPolicyFor('p'), null);
  const pol = { mode: 'normal', maxRetries: 2 };
  const ok = makeRuntime({ llm: { providerRetryPolicy: () => pol } }).rt;
  assert.equal(ok.retryPolicyFor('p'), pol);
  assert.equal(RETRY_ALWAYS_SAFETY_CAP, 5);
});

test('HER-05 进度写入与 sleepMs 的既有边界', async () => {
  const { rt, timers } = makeRuntime();
  const rec = {};
  rt.setProgress(rec, 'llm', 'retry', { current: 1, total: 2 }, 1, 2);
  assert.deepEqual(rec, { stage: 'llm', detailKey: 'retry', detailArgs: { current: 1, total: 2 }, step: 1, total: 2 });
  rt.setProgress(rec, 'analyze');
  assert.deepEqual(rec, { stage: 'analyze', detailKey: '', detailArgs: null, step: 0, total: 0 });
  await rt.sleepMs(0);
  assert.equal(timers.length, 0, '0/负延迟立即返回，不挂计时器');
});

test('HER-06 产物内联运行时模块（无外部 require）', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/domains/enhance/runtime.cjs"'), 'host 产物必须内联运行时模块');
  assert.ok(host.includes('"src/host/domains/enhance/runtime.cjs"'));
  assert.ok(host.includes('createEnhanceRuntime({ ctx, llm, hlog })'), 'chunk 必须以注入依赖构造运行时');
  assert.equal((host.match(/require\(/g) || []).length, 0, 'host 产物不得含外部 require');
});

test('HER-07 降级清单只收契约内原因（契约外只留诊断日志）', () => {
  const { rt, logs } = makeRuntime();
  const state = { rec: {} };
  rt.markDegraded(state, 'relevance-timeout');
  rt.markDegraded(state, 'not-in-contract');
  rt.markDegraded(state, 'output-truncated');
  assert.deepEqual(state.rec.degraded, ['relevance-timeout', 'output-truncated']);
  assert.ok(logs.some((line) => line.includes('not-in-contract')), '契约外原因必须可诊断');
});
