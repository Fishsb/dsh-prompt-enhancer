'use strict';

// 目标模式：纠错状态机纯逻辑模块的语义锁。
// 这些断言与 correction-status.test.cjs 的行为级锁互补：此处直接验证纯函数边界。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CORRECTION_PHASES,
  correctionPhaseKnown,
  correctionPhaseOf,
  correctionFailureTicket,
  correctionFailureConsume,
} = require('../src/client/voice/correction-state-module.cjs');

test('CCS-01 相位常量与线上取值逐项一致', () => {
  assert.deepEqual(CORRECTION_PHASES, {
    IDLE: 'idle', RUNNING: 'running', CHANGED: 'changed',
    UNCHANGED: 'unchanged', SKIPPED: 'skipped', FAILED: 'failed',
  });
  assert.equal(Object.isFrozen(CORRECTION_PHASES), true);
});

test('CCS-02 相位优先级：failed > running > 已知相位 > idle', () => {
  assert.equal(correctionPhaseOf({ phase: 'failed', inFlight: true }), 'failed');
  assert.equal(correctionPhaseOf({ phase: 'unchanged', inFlight: true }), 'running');
  assert.equal(correctionPhaseOf({ phase: 'skipped' }), 'skipped');
  assert.equal(correctionPhaseOf({ phase: 'nonsense' }), 'idle');
  assert.equal(correctionPhaseOf(null), 'idle');
  assert.equal(correctionPhaseKnown('failed'), true);
  assert.equal(correctionPhaseKnown('nonsense'), false);
});

test('CCS-03 会话归属闸：别的会话看到 idle，归属未知时不套用', () => {
  const snap = { phase: 'failed', ownerSessionId: 'A', failureSeq: 2, consumedSeq: 0 };
  assert.equal(correctionPhaseOf(snap, 'A'), 'failed');
  assert.equal(correctionPhaseOf(snap, 'B'), 'idle');
  assert.equal(correctionPhaseOf({ phase: 'failed', ownerSessionId: '' }, 'B'), 'failed');
});

test('CCS-04 失败票据：仅本会话、未消费、失败态时出票', () => {
  assert.equal(correctionFailureTicket({ phase: 'failed', failureSeq: 3, consumedSeq: 1 }, 'A'), '3');
  assert.equal(correctionFailureTicket({ phase: 'failed', failureSeq: 1, consumedSeq: 1 }, 'A'), '');
  assert.equal(correctionFailureTicket({ phase: 'unchanged', failureSeq: 3, consumedSeq: 1 }, 'A'), '');
});

test('CCS-05 消费高水位：只前进、不越界、非法 token 幂等失败', () => {
  assert.equal(correctionFailureConsume('2', 3, 1), 2);
  assert.equal(correctionFailureConsume('1', 3, 1), null);
  assert.equal(correctionFailureConsume('4', 3, 1), null);
  assert.equal(correctionFailureConsume('abc', 3, 1), null);
  assert.equal(correctionFailureConsume(null, 3, 1), null);
});
