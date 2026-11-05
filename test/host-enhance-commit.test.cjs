'use strict';

// 目标模式：生成与提交分离后的接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createCommitStage } = require('../src/host/domains/enhance/commit.cjs');

test('HEC-01 生成候选经 commit 映射为既有结果，不伪报改动', () => {
  const commit = createCommitStage();
  assert.deepEqual(commit.enhanceStageCommit({
    enhanceCandidate: { kind: 'ok', before: 'a', text: 'b', model: 'm', fallbackUsed: true },
  }).result, {
    ok: true, status: 'changed', text: 'b', model: 'm', fallbackUsed: true,
  });
  assert.deepEqual(commit.enhanceStageCommit({
    enhanceCandidate: { kind: 'ok', before: 'a', text: 'a', model: 'm' },
  }).result, {
    ok: true, status: 'unchanged', text: 'a', model: 'm',
  });
});

test('HEC-02 缺少候选必须失败，不得当成空成功', () => {
  const commit = createCommitStage();
  assert.deepEqual(commit.enhanceStageCommit({}).result,
    { ok: false, status: 'failed', code: 'LLM_FAILED' });
});

test('HEC-03 产物内联 commit 模块并接入主链，外部 require 为 0', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  const handlers = fs.readFileSync(path.join(REPO_ROOT, 'src/host/domains/enhance/handlers.cjs'), 'utf8');
  assert.ok(host.includes('"src/host/domains/enhance/commit.cjs"'));
  assert.ok(host.includes("registerEnhanceStage('commit', enhanceStageCommit"));
  assert.ok(handlers.includes('await runEnhancePipeline(state);'));
  assert.equal((host.match(/require\(/g) || []).length, 0);
});

test('HEC-04 契约顺序包含 commit，且旧 progress 的 llm 名未改', () => {
  const stages = require('../src/shared/contracts/enhance-stages.cjs');
  assert.deepEqual(stages.ENHANCE_STAGE_ORDER, ['analyze', 'retrieve', 'assemble', 'llm', 'commit']);
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes("registerEnhanceStage('llm', enhanceStageLlm"));
});
