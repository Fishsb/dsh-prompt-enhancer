'use strict';

// 纠错状态机纯逻辑（目标模式：普通 CommonJS，构建期由打包器内联）。
// 职责：相位常量、相位推导、会话归属闸、失败票据高水位。
// 不负责：计数写入、通知订阅者、读取 voice 配置；这些仍由既有 chunk 承担。

var CORRECTION_PHASES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  CHANGED: 'changed',
  UNCHANGED: 'unchanged',
  SKIPPED: 'skipped',
  FAILED: 'failed',
});

function correctionPhaseKnown(phase) {
  for (var k in CORRECTION_PHASES) {
    if (Object.prototype.hasOwnProperty.call(CORRECTION_PHASES, k) && CORRECTION_PHASES[k] === phase) return true;
  }
  return false;
}

function correctionPhaseOf(snap, sessionId) {
  var s = (snap && typeof snap === 'object') ? snap : {};
  var owner = typeof s.ownerSessionId === 'string' ? s.ownerSessionId : '';
  if (owner !== '' && typeof sessionId === 'string' && sessionId !== '' && sessionId !== owner) return CORRECTION_PHASES.IDLE;
  if (s.phase === CORRECTION_PHASES.FAILED) return CORRECTION_PHASES.FAILED;
  if (s.inFlight === true) return CORRECTION_PHASES.RUNNING;
  return correctionPhaseKnown(s.phase) ? s.phase : CORRECTION_PHASES.IDLE;
}

function correctionFailureTicket(snap, sessionId) {
  var s = (snap && typeof snap === 'object') ? snap : {};
  if (correctionPhaseOf(s, sessionId) !== CORRECTION_PHASES.FAILED) return '';
  var seq = (typeof s.failureSeq === 'number') ? s.failureSeq : 0;
  var used = (typeof s.consumedSeq === 'number') ? s.consumedSeq : 0;
  if (seq <= used) return '';
  return String(seq);
}

function correctionFailureConsume(token, currentSeq, consumedSeq) {
  var raw = String(token === undefined || token === null ? '' : token);
  if (!/^[0-9]+$/.test(raw)) return null;
  var seq = parseInt(raw, 10);
  var current = (typeof currentSeq === 'number') ? currentSeq : 0;
  var used = (typeof consumedSeq === 'number') ? consumedSeq : 0;
  if (!(seq > used) || seq > current) return null;
  return seq;
}

module.exports = {
  CORRECTION_PHASES,
  correctionPhaseKnown,
  correctionPhaseOf,
  correctionFailureTicket,
  correctionFailureConsume,
};
