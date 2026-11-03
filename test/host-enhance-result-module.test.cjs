'use strict';

// 增强结果归一模块的字段兼容锁：只附加可选 status，不改既有字段。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { enhanceSuccessResult, enhanceFailureResult } = require('../src/host/enhance-result-module.cjs');

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

test('HER-05 产物内联结果模块（无外部 require），主链调用统一归一', () => {
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/enhance-result-module.cjs"'), 'host 产物必须内联增强结果模块');
  assert.ok(host.includes('"src/host/enhance-result-module.cjs"'));
  assert.ok(host.includes('enhanceSuccessResult({ before: state.text'), '成功结果须走统一归一');
  assert.ok(host.includes('enhanceFailureResult({'), '失败结果须走统一归一');
  assert.equal((host.match(/require\(/g) || []).length, 0, 'host 产物不得含外部 require');
});
