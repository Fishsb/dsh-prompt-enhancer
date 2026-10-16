// ============================================================================
// CHG-143（纠错语音独立步批）：语音纠错的**可见性状态**（不得静默失效 —— 承 CHG-115 I-2）。
//   归属：**语音增值模块**（与 filler/vad/hotkey/autoEnhance 同类），**不是**增强管线的一部分。
//   形态：照抄 `filler.js` 的既有可见性模式（单一事实源 + 订阅 + snapshot），不新造机制。
//
//   为什么需要：纠错是一个**可能不发生**的步骤（默认关；开了也可能因草稿为空/失败而未跑）。
//   若不记读数，用户无法区分「没有错字可纠」与「功能根本没跑」——那正是「会掩盖问题」。
//   故本模块记录并暴露：
//     · runs     = 实际发起过的纠错调用次数
//     · skipped  = 因**开关关闭**而跳过的次数（开关真的约束了行为的证据）
//     · ok       = 返回成功的次数
//     · changed  = 结果确实改动了草稿的次数（用户可见：这次纠错有没有改东西）
//     · failed   = 失败次数（含网络/无模型/超时）
//     · lastCode = 最近一次失败码（'' = 无失败）
// ============================================================================

var correctionState = {
  runs: 0,
  skipped: 0,
  ok: 0,
  changed: 0,
  failed: 0,
  lastAt: 0,
  lastCode: '',
  lastSkipReason: '',
};

const correctionListeners = new Set();

function notifyCorrection() {
  for (var fn of Array.from(correctionListeners)) { try { fn(); } catch (e) { /* 单个订阅者失败不影响其余 */ } }
}

function subscribeCorrection(fn) {
  correctionListeners.add(fn);
  return function () { correctionListeners.delete(fn); };
}

/** 开关关闭 ⇒ 记为**跳过**（可见），不静默（与 filler 的 `disabled` 分支同款语义）。 */
function markCorrectionSkipped(reason) {
  correctionState.skipped += 1;
  correctionState.lastSkipReason = reason || 'disabled';
  correctionState.lastAt = Date.now();
  notifyCorrection();
}

function correctionSnapshot() {
  return {
    runs: correctionState.runs,
    skipped: correctionState.skipped,
    ok: correctionState.ok,
    changed: correctionState.changed,
    failed: correctionState.failed,
    lastAt: correctionState.lastAt,
    lastCode: correctionState.lastCode,
    lastSkipReason: correctionState.lastSkipReason,
    enabled: (function () {
      try {
        var c = (typeof voiceCfgState !== 'undefined' && voiceCfgState) ? voiceCfgState.value.correction : null;
        return !!(c && c.enabled === true);
      } catch (e) { return false; }
    })(),
  };
}
