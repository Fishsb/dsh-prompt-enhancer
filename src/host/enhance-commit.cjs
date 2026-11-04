'use strict';

// 增强提交阶段（目标模式：普通 CommonJS，构建期由打包器内联）。
// 只把生成阶段的候选产物归一为现有 RPC 返回；不调模型、不读写草稿。
const { commitEnhanceResult } = require('../shared/contracts/enhance-result.cjs');

function createCommitStage(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};

  function enhanceStageCommit(state) {
    const candidate = state && state.enhanceCandidate ? state.enhanceCandidate : null;
    if (!candidate || typeof candidate !== 'object') {
      state.result = { ok: false, status: 'failed', code: 'LLM_FAILED' };
      hlog('[enhance] commit rejected: missing candidate');
      return state;
    }
    state.result = commitEnhanceResult(candidate);
    return state;
  }

  return { enhanceStageCommit };
}

module.exports = { createCommitStage };
