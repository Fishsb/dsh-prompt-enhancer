'use strict';

// 增强结果提交：把 stage 产物归一成现有 RPC 返回形状。
// ⚠ 本函数只做纯映射，不改变字段名与语义；接入前必须与现有返回逐字段对照。

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
      return { ok: true, status: RESULT_STATUS.CHANGED, text: v.text, model: v.model, truncated: true };
    }
    return { ok: false, status: RESULT_STATUS.FAILED, code: 'OUTPUT_TRUNCATED' };
  }
  if (v.kind === 'ok' && typeof v.text === 'string' && v.text !== '') {
    const status = resultStatusOf({ ok: true, before: v.before, text: v.text });
    return { ok: true, status, text: v.text, model: v.model };
  }
  return { ok: false, status: RESULT_STATUS.FAILED, code: v.code || 'LLM_FAILED' };
}

module.exports = { commitEnhanceResult };