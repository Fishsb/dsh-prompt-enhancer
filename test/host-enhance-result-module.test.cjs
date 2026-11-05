'use strict';

// 增强结果归一模块的字段兼容锁：只附加可选 status，不改既有字段。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { enhanceSuccessResult, enhanceFailureResult } = require('../src/host/domains/enhance/result.cjs');

test('HER-01 成功结果保留 text/model，未改动时 status=unchanged', () => {
  assert.deepEqual(enhanceSuccessResult({ before: 'a', text: 'a', model: 'm' }), {
    ok: true, text: 'a', model: 'm', status: 'unchanged',
  });
});

test('HER-02 成功且有改动时 status=changed', () => {
  assert.deepEqual(enhanceSuccessResult({ before: 'a', text: 'b', model: 'm' }), {
    ok: true, text: 'b', model: 'm', status: 'changed',
  });
});

test('HER-03 可选 fallbackUsed / truncated 仅在为 true 时出现', () => {
  const base = enhanceSuccessResult({ before: 'a', text: 'b', model: 'm' });
  assert.equal(Object.prototype.hasOwnProperty.call(base, 'fallbackUsed'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(base, 'truncated'), false);
  const full = enhanceSuccessResult({ before: 'a', text: 'b', model: 'm', fallbackUsed: true, truncated: true });
  assert.equal(full.fallbackUsed, true);
  assert.equal(full.truncated, true);
});

test('HER-04 失败结果保留既有 code/message，并标记 status=failed', () => {
  assert.deepEqual(enhanceFailureResult({ code: 'TIMEOUT', message: 'timeout' }), {
    ok: false, code: 'TIMEOUT', message: 'timeout', status: 'failed',
  });
  assert.deepEqual(enhanceFailureResult({}), { ok: false, code: 'LLM_FAILED', status: 'failed' });
});

test('HER-05 产物内联结果契约与 commit 阶段，生成 -> 提交统一归一', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  const handlers = fs.readFileSync(path.join(REPO_ROOT, 'src/host/domains/enhance/handlers.cjs'), 'utf8');
  const generation = fs.readFileSync(path.join(REPO_ROOT, 'src/host/domains/enhance/generate.cjs'), 'utf8');
  assert.ok(host.includes('"src/host/domains/enhance/result.cjs"'), 'host 产物必须内联结果契约');
  assert.ok(host.includes('"src/host/domains/enhance/commit.cjs"'), 'host 产物必须内联 commit 阶段');
  assert.ok(host.includes("registerEnhanceStage('commit', enhanceStageCommit"), 'commit 阶段必须接入主链');
  assert.ok(handlers.includes('await runEnhancePipeline(state);'), '主链必须走统一阶段执行器');
  assert.ok(generation.includes('state.enhanceCandidate'), '生成阶段须产出待提交候选');
  assert.ok(host.includes('commitEnhanceResult(candidate)'), '候选必须由 commit 统一归一');
  assert.equal((host.match(/require\(/g) || []).length, 0, 'host 产物不得含外部 require');
});
