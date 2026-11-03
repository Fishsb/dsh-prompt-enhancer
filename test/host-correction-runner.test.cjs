'use strict';

// 目标模式：语音纠错执行域普通模块的语义锁 + 产物接线锁。
// 线上 voice/correct 契约不变：跳过仍带 skipped/skippedBy/switchFrom/code，且不伪造 changed。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const {
  CORRECTION_WINDOW,
  CORRECTION_TIMEOUT_MS,
  CORRECTION_MAX_TOKENS,
  CORRECTION_OUTPUT_LIMIT,
  createCorrectionRunner,
} = require('../src/host/correction-runner.cjs');

const MODULE_REL = 'src/host/correction-runner.cjs';

function makeDeps(overrides) {
  const calls = [];
  const logs = [];
  const deps = {
    ctx: {
      get: () => undefined,
      timer: { timeout: () => () => {} },
    },
    harness: { readVoiceConfig: () => ({ correction: { enabled: true } }) },
    llm: {
      stream: () => {
        throw new Error('llm.stream must be overridden per test');
      },
    },
    hlog: (...args) => logs.push(args.join(' ')),
    startWaitAbort: () => ({ timedOut: () => false, race: (p) => p, dispose: () => {} }),
    validateConfig: (cfg) => cfg || { fallback: [{ provider: 'p', model: 'm' }] },
    buildTryChain: (fallback) => (Array.isArray(fallback) ? fallback : []),
    collectStream: async () => ({ kind: 'ok', text: '改写后的文本' }),
    cleanCorrectionOutput: (text) => text,
    friendlyMessage: ({ code }) => 'msg:' + code,
    extractHistoryConclusions: () => [],
    splitHistoryRounds: () => [],
    correctionPrompt: 'HISTORY={history}',
    historyTimeoutMs: 1000,
  };
  return { deps: Object.assign(deps, overrides || {}), calls, logs };
}

test('HCR-01 常量与既有纠错契约一致', () => {
  assert.deepEqual(CORRECTION_WINDOW, [1, 1]);
  assert.equal(CORRECTION_TIMEOUT_MS, 30000);
  assert.equal(CORRECTION_MAX_TOKENS, 4000);
  assert.equal(CORRECTION_OUTPUT_LIMIT, 16000);
});

test('HCR-02 开关关闭 ⇒ 零模型调用，返回既有跳过字段且不伪造 changed', async () => {
  const { deps } = makeDeps({
    harness: { readVoiceConfig: () => ({ correction: { enabled: false } }) },
    llm: { stream: () => { throw new Error('must not call'); } },
  });
  const runner = createCorrectionRunner(deps);
  const out = await runner.runCorrection({ sessionId: 's', text: '原文', config: {} });
  assert.equal(out.ok, true);
  assert.equal(out.skipped, true);
  assert.equal(out.skippedBy, 'correction.enabled');
  assert.equal(out.switchFrom, 'host-normalized');
  assert.equal(out.code, 'CORRECTION_DISABLED');
  assert.equal(out.text, '原文');
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'changed'), false);
});

test('HCR-03 打开时走模型链；逐字回显 ⇒ changed=false，改写 ⇒ changed=true', async () => {
  let calls = 0;
  const { deps } = makeDeps({
    llm: {
      stream: () => {
        calls += 1;
        return {
          [Symbol.asyncIterator]() {
            let i = 0;
            return {
              async next() {
                if (i === 0) { i += 1; return { done: false, value: { type: 'text-delta', text: '改写后的文本' } }; }
                if (i === 1) { i += 1; return { done: false, value: { type: 'finish', reason: { kind: 'stop' } } }; }
                return { done: true };
              },
            };
          },
        };
      },
    },
  });
  const runner = createCorrectionRunner(deps);
  const out = await runner.runCorrection({ sessionId: 's', text: '原文', config: { fallback: [{ provider: 'p', model: 'm' }] } });
  assert.equal(calls, 1);
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  assert.equal(out.text, '改写后的文本');
  assert.equal(out.fallbackUsed, false);
});

test('HCR-04 空文本 / 无模型 / 无模型链的既有错误码不变', async () => {
  const { deps: d1 } = makeDeps();
  const r1 = createCorrectionRunner(d1);
  assert.equal((await r1.runCorrection({ text: '   ' })).code, 'GUARD');
  const { deps: d2 } = makeDeps({ llm: undefined });
  assert.equal((await createCorrectionRunner(d2).runCorrection({ text: 'x' })).code, 'NO_LLM');
  const { deps: d3 } = makeDeps({ buildTryChain: () => [] });
  assert.equal((await createCorrectionRunner(d3).runCorrection({ text: 'x', config: {} })).code, 'NO_MODEL');
});

test('HCR-05 产物内联执行域模块（无外部 require），RPC 仍由 chunk 注册', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/correction-runner.cjs"'), 'host 产物必须内联纠错执行域模块');
  assert.ok(host.includes('"src/host/correction-runner.cjs"'));
  assert.ok(host.includes('voice/correct'), 'voice/correct RPC 必须仍在位');
  assert.ok(host.includes('return correctionRunner.runCorrection(args);'), '既有 runCorrection 包装必须委托模块');
  assert.equal((host.match(/require\(/g) || []).length, 0, 'host 产物不得含外部 require');
});
