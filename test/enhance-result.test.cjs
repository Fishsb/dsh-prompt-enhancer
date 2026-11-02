'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commitEnhanceResult } = require('../src/shared/contracts/enhance-result.cjs');

test('ENHR-01 成功文本 => ok + changed + text/model', () => {
  assert.deepEqual(commitEnhanceResult({ kind: 'ok', before: 'a', text: 'b', model: 'm' }),
    { ok: true, status: 'changed', text: 'b', model: 'm' });
});

test('ENHR-02 成功但文本未变 => unchanged（不得伪报 changed）', () => {
  assert.deepEqual(commitEnhanceResult({ kind: 'ok', before: 'a', text: 'a', model: 'm' }),
    { ok: true, status: 'unchanged', text: 'a', model: 'm' });
});

test('ENHR-03 截断且有文本 => ok + truncated', () => {
  assert.deepEqual(commitEnhanceResult({ kind: 'maxtokens', text: 'partial', model: 'm' }),
    { ok: true, status: 'changed', text: 'partial', model: 'm', truncated: true });
});

test('ENHR-04 截断且无文本 => failed + OUTPUT_TRUNCATED', () => {
  assert.deepEqual(commitEnhanceResult({ kind: 'maxtokens', text: '' }),
    { ok: false, status: 'failed', code: 'OUTPUT_TRUNCATED' });
});

test('ENHR-05 超长 => failed + OUTPUT_TOO_LONG', () => {
  assert.deepEqual(commitEnhanceResult({ kind: 'toolong' }),
    { ok: false, status: 'failed', code: 'OUTPUT_TOO_LONG' });
});

test('ENHR-06 取消 / 超时 => failed + ABORTED / TIMEOUT', () => {
  assert.deepEqual(commitEnhanceResult({ cancelled: true }), { ok: false, status: 'failed', code: 'ABORTED' });
  assert.deepEqual(commitEnhanceResult({ timedOut: true }), { ok: false, status: 'failed', code: 'TIMEOUT' });
});

test('ENHR-07 非对象与空文本 => failed，不得抛错', () => {
  assert.equal(commitEnhanceResult(null).ok, false);
  assert.equal(commitEnhanceResult({}).ok, false);
});