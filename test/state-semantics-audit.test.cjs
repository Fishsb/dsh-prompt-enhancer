'use strict';

// 状态语义收口锁：增强 / 纠错 / 清口水词共用一套四态语义。
//   changed | unchanged | skipped | failed
// 关键约束：失败优先于跳过与无改动；degraded 只表示结果质量下降，不改变终态类别。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const result = require(path.join(ROOT, 'src', 'shared', 'contracts', 'result.cjs'));
const { commitEnhanceResult } = require(path.join(ROOT, 'src', 'shared', 'contracts', 'enhance-result.cjs'));
const { createCorrectionState } = require(path.join(ROOT, 'src', 'client', 'domains', 'voice', 'correction.cjs'));
const correctionCore = require(path.join(ROOT, 'src', 'client', 'domains', 'voice', 'correction-state.cjs'));
const filler = require(path.join(ROOT, 'src', 'client', 'domains', 'voice', 'filler.cjs'));

function correctionState() {
  const voiceCfgState = { value: { correction: { enabled: true } } };
  return createCorrectionState({ voiceCfgState, correctionStateCore: correctionCore });
}

test('SSA-01 增强四态：超时失败、截断失败、原样、改动均可判', () => {
  assert.equal(result.resultStatusOf(commitEnhanceResult({ timedOut: true })), 'failed');
  assert.equal(result.resultStatusOf(commitEnhanceResult({ kind: 'maxtokens', text: '' })), 'failed');
  assert.equal(result.resultStatusOf(commitEnhanceResult({ kind: 'ok', before: 'a', text: 'a' })), 'unchanged');
  assert.equal(result.resultStatusOf(commitEnhanceResult({ kind: 'ok', before: 'a', text: 'b' })), 'changed');
});

test('SSA-02 degraded 不改变终态：降级但成功仍是 changed/unchanged，失败仍是 failed', () => {
  assert.equal(result.resultStatusOf({ ok: true, changed: true, degraded: ['docs'] }), 'changed');
  assert.equal(result.resultStatusOf({ ok: true, changed: false, degraded: ['history-timeout'] }), 'unchanged');
  assert.equal(result.resultStatusOf({ ok: false, code: 'TIMEOUT', degraded: ['docs'] }), 'failed');
});

test('SSA-03 纠错四态：skip / unchanged / changed / failed 分别结算', () => {
  const c = correctionState();
  c.markCorrectionSettled({ ok: true, skipped: true, code: 'CORRECTION_DISABLED', text: 'x' }, 'x', 's');
  assert.equal(c.correctionSnapshot().phase, 'skipped');
  c.markCorrectionSettled({ ok: true, text: 'x', changed: false }, 'x', 's');
  assert.equal(c.correctionSnapshot().phase, 'unchanged');
  c.markCorrectionSettled({ ok: true, text: 'y', changed: true }, 'x', 's');
  assert.equal(c.correctionSnapshot().phase, 'changed');
  c.markCorrectionSettled({ ok: false, code: 'TIMEOUT' }, 'x', 's');
  assert.equal(c.correctionSnapshot().phase, 'failed');
});

test('SSA-04 失败优先：ok:false + skipped:true 不得被记成 skipped', () => {
  const c = correctionState();
  c.markCorrectionSettled({ ok: false, skipped: true, code: 'CORRECTION_DISABLED' }, 'x', 's');
  const snap = c.correctionSnapshot();
  assert.equal(snap.phase, 'failed');
  assert.equal(snap.lastFailCode, 'CORRECTION_DISABLED');
  assert.equal(snap.skipped, 0);
  assert.equal(snap.failed, 1);
});

test('SSA-05 清口水词：关闭=skipped、无改动=unchanged、有改动=changed', () => {
  const off = filler.runFiller('嗯好的', false);
  assert.equal(result.resultStatusOf({ ok: true, ...off }), 'skipped');
  const same = filler.runFiller('我们明天开会', true);
  assert.equal(result.resultStatusOf({ ok: true, ...same }), 'unchanged');
  const changed = filler.runFiller('嗯那个我们明天开会', true);
  assert.equal(result.resultStatusOf({ ok: true, ...changed }), 'changed');
  assert.deepEqual(result.postprocessOutcomeOf({ ok: true, ...changed }).status, 'changed');
});

test('SSA-06 所有后处理结果共享同一形状：status/text/changes/reason/degraded', () => {
  const out = result.postprocessOutcomeOf({ ok: true, text: 'b', before: 'a', removed: ['嗯'], reason: 'fixture', degraded: ['docs'] });
  assert.deepEqual(out, { status: 'changed', text: 'b', changes: ['嗯'], reason: 'fixture', degraded: true });
});
