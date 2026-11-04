'use strict';

// 增强运行时辅助域（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 只承载与业务无关的运行时策略：
//   · 降级登记（P0-d）；
//   · 主预算剩余量与辅助超时钳制（P0-b）；
//   · 可中断辅助闸（P0-b 真中断）；
//   · 重试策略读取与安全上限（P0-a）；
//   · 进度详情写入（v3.0r）。
//
// 不读取配置、不调用模型、不写回草稿；llm/timer/日志全部由调用方注入。

const RETRY_ALWAYS_SAFETY_CAP = 5;
const contractData = require('../shared/contracts/contract-data.cjs');
const DEGRADED_REASONS = new Set(contractData.DEGRADED_REASONS);

function createEnhanceRuntime(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const ctx = d.ctx;
  const llm = d.llm;
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};

  function markDegraded(state, kind) {
    if (!state || !state.rec) return;
    const rec = state.rec;
    if (!Array.isArray(rec.degraded)) rec.degraded = [];
    const k = String(kind || 'unknown');
    // 契约外的降级原因不进入用户可见的 degraded 清单，避免契约面与运行面各说一套。
    if (!DEGRADED_REASONS.has(k)) {
      hlog('[enhance] degraded reason not in contract: ' + k);
      return;
    }
    if (rec.degraded.indexOf(k) === -1) rec.degraded.push(k);
  }

  function remainingBudgetMs(state) {
    const dl = state && typeof state.budgetDeadline === 'number' ? state.budgetDeadline : null;
    if (dl === null) return Infinity;
    return Math.max(0, dl - Date.now());
  }

  function helperTimeoutMs(state, baseMs) {
    const remain = remainingBudgetMs(state);
    if (remain === Infinity) return baseMs;
    return Math.max(0, Math.min(baseMs, remain));
  }

  function budgetExhausted(state) {
    return remainingBudgetMs(state) <= 0;
  }

  function startHelperAbort(state, baseMs) {
    const ms = helperTimeoutMs(state, baseMs);
    let fired = false;
    let iterator = null;
    let fireTimer = null;
    let settle = null;
    const abortIterator = () => {
      if (iterator && typeof iterator.return === 'function') {
        try { iterator.return(); } catch (e) { /* 忽略 */ }
      }
    };
    const gate = new Promise((resolve) => { settle = resolve; });
    if (ms > 0) {
      fireTimer = ctx.timer.timeout(() => {
        fired = true;
        abortIterator();
        try { settle({ kind: 'aborted', aborted: true }); } catch (e) { /* 忽略 */ }
      }, ms);
    } else {
      fired = true;
      try { settle({ kind: 'aborted', aborted: true }); } catch (e) { /* 忽略 */ }
    }
    return {
      timedOut: () => fired,
      attach: (it) => { iterator = it; if (fired) abortIterator(); },
      race: (collectPromise) => Promise.race([collectPromise, gate]),
      dispose: () => { try { if (fireTimer) fireTimer(); } catch (e) { /* 忽略 */ } abortIterator(); },
    };
  }

  function retryPolicyFor(provider) {
    if (llm === undefined || typeof llm.providerRetryPolicy !== 'function') return null;
    try {
      const pol = llm.providerRetryPolicy(provider);
      return pol && typeof pol === 'object' ? pol : null;
    } catch (e) {
      hlog('[enhance] providerRetryPolicy failed provider=' + provider + ' ' + (e && e.message ? e.message : e));
      return null;
    }
  }

  async function sleepMs(ms) {
    const delay = Number(ms);
    if (!Number.isFinite(delay) || delay <= 0) return;
    try {
      await new Promise((resolve) => {
        try {
          ctx.timer.timeout(() => resolve(), delay);
        } catch (e) { resolve(); }
      });
    } catch (e) { /* 上下文销毁 → 直接继续 */ }
  }

  function setProgress(rec, stage, key, args, step, total) {
    rec.stage = stage;
    rec.detailKey = key || '';
    rec.detailArgs = args || null;
    rec.step = step || 0;
    rec.total = total || 0;
  }

  return {
    RETRY_ALWAYS_SAFETY_CAP,
    markDegraded,
    remainingBudgetMs,
    helperTimeoutMs,
    budgetExhausted,
    startHelperAbort,
    retryPolicyFor,
    sleepMs,
    setProgress,
  };
}

module.exports = { RETRY_ALWAYS_SAFETY_CAP, createEnhanceRuntime };
