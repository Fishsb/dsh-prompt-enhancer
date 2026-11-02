'use strict';

// 增强阶段契约：显式声明顺序，避免主流程与各阶段注册各写一份。
// 本批先建立契约；现有 host 仍使用内联 Pipeline，切换前须做行为对照。
const ENHANCE_STAGES = Object.freeze({
  ANALYZE: 'analyze',
  RETRIEVE: 'retrieve',
  ASSEMBLE: 'assemble',
  GENERATE: 'llm',
});

const ENHANCE_STAGE_ORDER = Object.freeze([
  ENHANCE_STAGES.ANALYZE,
  ENHANCE_STAGES.RETRIEVE,
  ENHANCE_STAGES.ASSEMBLE,
  ENHANCE_STAGES.GENERATE,
]);

function isEnhanceStage(name) {
  return ENHANCE_STAGE_ORDER.indexOf(name) !== -1;
}

function nextEnhanceStage(name) {
  const i = ENHANCE_STAGE_ORDER.indexOf(name);
  return i >= 0 && i + 1 < ENHANCE_STAGE_ORDER.length ? ENHANCE_STAGE_ORDER[i + 1] : null;
}

module.exports = { ENHANCE_STAGES, ENHANCE_STAGE_ORDER, isEnhanceStage, nextEnhanceStage };