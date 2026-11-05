'use strict';

// 目标模式：增强 llm 阶段的语义锁（结果 / 重试 / 截断 / 产物接线）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createGenerationStage } = require('../src/host/domains/enhance/generate.cjs');

function makeStage(overrides) {
  const logs = [];
  const progress = [];
  const results = overrides && overrides.results ? overrides.results.slice() : [];
  let calls = 0;
  const timers = [];
  const deps = {
    ctx: { timer: { timeout: (cb, ms) => { timers.push({ cb, ms }); return () => {}; } } },
    llm: {
      stream: () => ({
        [Symbol.asyncIterator]() {
          return { next: async () => ({ done: true, value: undefined }), return: async () => ({ done: true }) };
        },
      }),
    },
    hlog: (...args) => logs.push(args.join(' ')),
    markDegraded: (state, kind) => { state.degradedKinds = (state.degradedKinds || []).concat(kind); },
    remainingBudgetMs: () => Infinity,
    budgetExhausted: () => false,
    retryPolicyFor: () => ({ mode: 'fixed', maxRetries: 1, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 1 }),
    sleepMs: async () => {},
    setProgress: (rec, stage, key, args, step, total) => progress.push({ stage, key, args, step, total }),
    enhanceSuccessResult: (x) => ({ ok: true, ...x }),
    enhanceFailureResult: (x) => ({ ok: false, ...x }),
    friendlyMessage: (x) => 'MSG:' + (x && x.code || '?'),
    collectStream: async () => results[Math.min(calls++, results.length - 1)],
    cleanOutput: (text) => text,
    stripScenarioEcho: (text) => text,
    computeBackoffDelayMs: () => 1,
    isRetryableFailure: () => true,
    probeCacheGet: () => null,
    probeCacheSet: () => {},
    pingStream: async () => ({ ok: true, latencyMs: 1 }),
    stageLlm: 'llm',
    watchdogTimeoutMs: 19000,
    probeTimeoutMs: 12000,
    retryAlwaysSafetyCap: 5,
  };
  return {
    stage: createGenerationStage(Object.assign(deps, overrides || {})).enhanceStageLlm,
    logs,
    progress,
    timers,
    calls: () => calls,
  };
}

function state(overrides) {
  return Object.assign({
    sessionId: 's', seq: 1, text: '原文',
    rec: { cancelled: false, timedOut: false, iterator: null },
    chain: [{ provider: 'p', model: 'm' }],
    system: 'SYS', messages: [], isPublish: false,
    maxTokens: 2000, outputLimit: 8000,
    cfg: { fallback: [{ provider: 'p', model: 'm' }] },
  }, overrides || {});
}

function commit(out) {
  const { createCommitStage } = require('../src/host/domains/enhance/commit.cjs');
  return createCommitStage({ hlog: () => {} }).enhanceStageCommit(out);
}

test('HEG-01 空链明确失败为 NO_MODEL', async () => {
  const { stage } = makeStage({ results: [{ kind: 'ok', text: '不会走到' }] });
  const out = commit(await stage(state({ chain: [] })));
  assert.equal(out.result.ok, false);
  assert.equal(out.result.code, 'NO_MODEL');
  assert.equal(out.result.message, 'MSG:NO_MODEL');
});

test('HEG-02 成功结果经清洗后提交，不误报 fallback', async () => {
  const { stage, logs } = makeStage({ results: [{ kind: 'ok', text: '优化后' }] });
  const out = commit(await stage(state()));
  assert.deepEqual(out.result, { ok: true, status: 'changed', text: '优化后', model: 'm' });
  assert.match(logs[0], /ok session=s via m|try session=s/);
});

test('HEG-03 策略声明可重试时，同链节退避重试后可成功；retries 与 degraded 分通道', async () => {
  const { stage, progress } = makeStage({
    results: [{ kind: 'error', failure: { code: 'RATE_LIMIT' } }, { kind: 'ok', text: '重试成功' }],
  });
  const s = state();
  const out = commit(await stage(s));
  assert.equal(out.result.ok, true);
  assert.equal(out.result.text, '重试成功');
  assert.deepEqual(s.rec.retries, ['RATE_LIMIT']);
  assert.equal(s.rec.degraded, undefined, '重试不得混入降级通道');
  assert.ok(progress.some((p) => p.key === 'retry' && p.step === 1));
});

test('HEG-04 有文本的 max-tokens 截断直接采纳，并标注 truncated', async () => {
  const { stage } = makeStage({ results: [{ kind: 'maxtokens', text: '一段足够长的可用结果' }] });
  const out = commit(await stage(state()));
  assert.equal(out.result.ok, true);
  assert.equal(out.result.truncated, true);
  assert.equal(out.result.text, '一段足够长的可用结果');
  assert.deepEqual(out.degradedKinds, ['output-truncated']);
});

test('HEG-05 产物内联生成与提交模块，线上进度阶段名仍为 llm', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/domains/enhance/generate.cjs"'));
  assert.ok(host.includes('"src/host/domains/enhance/commit.cjs"'));
  assert.ok(host.includes("registerEnhanceStage('llm', enhanceStageLlm"));
  assert.ok(host.includes("registerEnhanceStage('commit', enhanceStageCommit"));
  assert.equal((host.match(/require\(/g) || []).length, 0);
});
