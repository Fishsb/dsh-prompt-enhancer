'use strict';

// 增强结果提交：把生成阶段候选归一成现有 RPC 返回形状。
// 只做纯映射，不改变既有字段名与语义；可选字段仅在为 true 时出现。

const { RESULT_STATUS, resultStatusOf } = require('./result.cjs');

function commitEnhanceResult(input) {
  const v = input && typeof input === 'object' ? input : {};
  if (v.cancelled === true || v.timedOut === true) {
    const code = v.timedOut === true ? 'TIMEOUT' : 'ABORTED';
    return { ok: false, status: RESULT_STATUS.FAILED, code };
  }
  if (v.kind === 'toolong') {
    return { ok: false, status: RESULT_STATUS.FAILED, code: 'OUTPUT_TOO_LONG' };
  }
  if (v.kind === 'maxtokens') {
    if (typeof v.text === 'string' && v.text !== '') {
      const result = { ok: true, status: RESULT_STATUS.CHANGED, text: v.text, model: v.model, truncated: true };
      if (v.fallbackUsed === true) result.fallbackUsed = true;
      return result;
    }
    return { ok: false, status: RESULT_STATUS.FAILED, code: 'OUTPUT_TRUNCATED' };
  }
  if (v.kind === 'ok' && typeof v.text === 'string' && v.text !== '') {
    const status = resultStatusOf({ ok: true, before: v.before, text: v.text });
    const result = { ok: true, status, text: v.text, model: v.model };
    if (v.fallbackUsed === true) result.fallbackUsed = true;
    return result;
  }
  const result = { ok: false, status: RESULT_STATUS.FAILED, code: v.code || 'LLM_FAILED' };
  if (v.message !== undefined) result.message = v.message;
  return result;
}

module.exports = { commitEnhanceResult };
