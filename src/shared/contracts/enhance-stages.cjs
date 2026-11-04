'use strict';

// 增强阶段契约：显式声明内部执行顺序，避免主流程与各阶段注册各写一份。
// 内部 GENERATE 仍使用线上既有名称 `llm`，以保持 enhance/progress 契约兼容。
const ENHANCE_STAGES = Object.freeze({
  ANALYZE: 'analyze',
  RETRIEVE: 'retrieve',
  ASSEMBLE: 'assemble',
  GENERATE: 'llm',
  COMMIT: 'commit',
});

const ENHANCE_STAGE_ORDER = Object.freeze([
  ENHANCE_STAGES.ANALYZE,
  ENHANCE_STAGES.RETRIEVE,
  ENHANCE_STAGES.ASSEMBLE,
  ENHANCE_STAGES.GENERATE,
  ENHANCE_STAGES.COMMIT,
]);

function isEnhanceStage(name) {
  return ENHANCE_STAGE_ORDER.indexOf(name) !== -1;
}

function nextEnhanceStage(name) {
  const i = ENHANCE_STAGE_ORDER.indexOf(name);
  return i >= 0 && i + 1 < ENHANCE_STAGE_ORDER.length ? ENHANCE_STAGE_ORDER[i + 1] : null;
}

module.exports = { ENHANCE_STAGES, ENHANCE_STAGE_ORDER, isEnhanceStage, nextEnhanceStage };
