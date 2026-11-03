'use strict';

// 统一结果状态：changed | unchanged | skipped | failed
// 只做语义映射，不改变 RPC 返回结构；调用方按需取 status。
const RESULT_STATUS = Object.freeze({
  CHANGED: 'changed',
  UNCHANGED: 'unchanged',
  SKIPPED: 'skipped',
  FAILED: 'failed',
});

function resultStatusOf(result) {
  const r = result && typeof result === 'object' ? result : {};
  if (r.ok !== true) return RESULT_STATUS.FAILED;
  if (r.skipped === true) return RESULT_STATUS.SKIPPED;
  if (typeof r.changed === 'boolean') return r.changed ? RESULT_STATUS.CHANGED : RESULT_STATUS.UNCHANGED;
  if (typeof r.text === 'string' && typeof r.before === 'string') return r.text === r.before ? RESULT_STATUS.UNCHANGED : RESULT_STATUS.CHANGED;
  // 没有可判证据时，不得声称已改动（保守：unchanged）
  return RESULT_STATUS.UNCHANGED;
}

function resultIsTerminal(result) {
  const s = resultStatusOf(result);
  return s !== RESULT_STATUS.SKIPPED && s !== RESULT_STATUS.FAILED;
}

// 统一后处理结果形状：执行层按“是否改动 / 是否跳过 / 是否降级”给读数，
// 这里只做归一，不改任何 RPC 字段或用户可见文案。
function postprocessOutcomeOf(result) {
  const r = result && typeof result === 'object' ? result : {};
  return {
    status: resultStatusOf(r),
    text: typeof r.text === 'string' ? r.text : '',
    changes: Array.isArray(r.removed) ? r.removed.slice() : [],
    reason: typeof r.reason === 'string' ? r.reason : '',
    degraded: r.degraded === true || (Array.isArray(r.degraded) && r.degraded.length > 0),
  };
}

module.exports = { RESULT_STATUS, resultStatusOf, resultIsTerminal, postprocessOutcomeOf };
