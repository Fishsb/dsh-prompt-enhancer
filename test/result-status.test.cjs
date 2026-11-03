'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RESULT_STATUS, resultStatusOf, resultIsTerminal, postprocessOutcomeOf } = require('../src/shared/contracts/result.cjs');

test('RESULT-01 成功且有改动 => changed', () => {
  assert.equal(resultStatusOf({ ok: true, changed: true, text: 'b' }), RESULT_STATUS.CHANGED);
});

test('RESULT-02 成功但无改动 => unchanged（不伪造成失败）', () => {
  assert.equal(resultStatusOf({ ok: true, changed: false, text: 'a' }), RESULT_STATUS.UNCHANGED);
});

test('RESULT-03 跳过 => skipped（与 unchanged 必须分开）', () => {
  assert.equal(resultStatusOf({ ok: true, skipped: true, code: 'CORRECTION_DISABLED' }), RESULT_STATUS.SKIPPED);
});

test('RESULT-04 失败 => failed（优先于文本判断）', () => {
  assert.equal(resultStatusOf({ ok: false, code: 'NO_MODEL', text: 'a' }), RESULT_STATUS.FAILED);
});

test('RESULT-05 由 before/text 推断改动；无证据保守为 unchanged', () => {
  assert.equal(resultStatusOf({ ok: true, before: 'a', text: 'b' }), RESULT_STATUS.CHANGED);
  assert.equal(resultStatusOf({ ok: true, before: 'a', text: 'a' }), RESULT_STATUS.UNCHANGED);
  assert.equal(resultStatusOf({ ok: true, text: 'a' }), RESULT_STATUS.UNCHANGED);
});

test('RESULT-06 非对象/空值 => failed，不得抛错', () => {
  assert.equal(resultStatusOf(null), RESULT_STATUS.FAILED);
  assert.equal(resultStatusOf(undefined), RESULT_STATUS.FAILED);
});

test('RESULT-07 terminal：只有 changed/unchanged 算终态', () => {
  assert.equal(resultIsTerminal({ ok: true, changed: true }), true);
  assert.equal(resultIsTerminal({ ok: true, changed: false }), true);
  assert.equal(resultIsTerminal({ ok: true, skipped: true }), false);
  assert.equal(resultIsTerminal({ ok: false }), false);
});

test('RESULT-08 postprocessOutcomeOf：统一四态与 changes/reason/degraded', () => {
  assert.deepEqual(postprocessOutcomeOf({ ok: true, before: 'a', text: 'b' }), {
    status: 'changed', text: 'b', changes: [], reason: '', degraded: false,
  });
  assert.deepEqual(postprocessOutcomeOf({ ok: true, before: 'a', text: 'a', removed: [{ text: '嗯' }] }), {
    status: 'unchanged', text: 'a', changes: [{ text: '嗯' }], reason: '', degraded: false,
  });
  assert.deepEqual(postprocessOutcomeOf({ ok: true, skipped: true, reason: 'disabled' }), {
    status: 'skipped', text: '', changes: [], reason: 'disabled', degraded: false,
  });
  assert.deepEqual(postprocessOutcomeOf({ ok: false, code: 'NO_MODEL', degraded: ['events'] }), {
    status: 'failed', text: '', changes: [], reason: '', degraded: true,
  });
  assert.deepEqual(postprocessOutcomeOf(null), {
    status: 'failed', text: '', changes: [], reason: '', degraded: false,
  });
});
