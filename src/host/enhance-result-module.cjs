'use strict';

// 增强结果归一（目标模式：普通 CommonJS，构建期由打包器内联）。
// 只负责把生成阶段产物映射为既有 RPC 字段；不改变字段名，不新增必填字段。
//
// 兼容性：线上 enhance 返回仍为 { ok, text, model, fallbackUsed?, truncated?, degraded? }。
// status 只作为**可选**的语义读数附加，供后续客户端统一状态使用。
const { RESULT_STATUS, resultStatusOf } = require('../shared/contracts/result.cjs');

function enhanceSuccessResult(input) {
  const v = input && typeof input === 'object' ? input : {};
  const result = { ok: true, text: v.text, model: v.model };
  if (v.fallbackUsed === true) result.fallbackUsed = true;
  if (v.truncated === true) result.truncated = true;
  result.status = resultStatusOf({ ok: true, before: v.before, text: v.text });
  return result;
}

function enhanceFailureResult(input) {
  const v = input && typeof input === 'object' ? input : {};
  const result = {
    ok: false,
    code: v.code || 'LLM_FAILED',
    status: RESULT_STATUS.FAILED,
  };
  if (v.message !== undefined) result.message = v.message;
  return result;
}

module.exports = { enhanceSuccessResult, enhanceFailureResult };
