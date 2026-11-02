'use strict';

// 语音后处理计划：识别完成后的动作顺序，单一事实源。
// 只描述“按开关应当发生什么”，不执行副作用；执行层按步骤调用既有能力。
// 该文件同时被 Node 测试与 client bundle 构建器读取，因此不得 require 浏览器或宿主模块。

const VOICE_POSTPROCESS_STEPS = Object.freeze({
  FILLER: 'filler',
  CORRECTION: 'correction',
  ENHANCE: 'enhance',
});

const VOICE_POSTPROCESS_STEP_ORDER = Object.freeze([
  VOICE_POSTPROCESS_STEPS.FILLER,
  VOICE_POSTPROCESS_STEPS.CORRECTION,
  VOICE_POSTPROCESS_STEPS.ENHANCE,
]);

function voicePostprocessFlag(value) {
  return value === true;
}

/**
 * 输入三个独立开关，输出有序步骤。
 * 不变量：全关 => 空计划；纠错开增强关 => 绝不出现 enhance；失败由执行层处理，计划不短路。
 */
function planVoicePostprocess(input) {
  const flags = input && typeof input === 'object' ? input : {};
  const steps = [];
  if (voicePostprocessFlag(flags.fillerEnabled)) steps.push(VOICE_POSTPROCESS_STEPS.FILLER);
  if (voicePostprocessFlag(flags.correctionEnabled)) steps.push(VOICE_POSTPROCESS_STEPS.CORRECTION);
  if (voicePostprocessFlag(flags.autoEnhanceEnabled)) steps.push(VOICE_POSTPROCESS_STEPS.ENHANCE);
  return Object.freeze({
    steps: Object.freeze(steps),
    hasCorrection: steps.indexOf(VOICE_POSTPROCESS_STEPS.CORRECTION) !== -1,
    hasEnhance: steps.indexOf(VOICE_POSTPROCESS_STEPS.ENHANCE) !== -1,
    correctionBeforeEnhance: steps.indexOf(VOICE_POSTPROCESS_STEPS.CORRECTION) !== -1
      && steps.indexOf(VOICE_POSTPROCESS_STEPS.ENHANCE) !== -1
      && steps.indexOf(VOICE_POSTPROCESS_STEPS.CORRECTION) < steps.indexOf(VOICE_POSTPROCESS_STEPS.ENHANCE),
  });
}

function voicePostprocessHas(plan, step) {
  return !!(plan && Array.isArray(plan.steps) && plan.steps.indexOf(step) !== -1);
}

function voicePostprocessNext(plan, fromIndex) {
  const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
  const index = Number.isInteger(fromIndex) && fromIndex >= 0 ? fromIndex : 0;
  return index < steps.length ? steps[index] : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VOICE_POSTPROCESS_STEPS, VOICE_POSTPROCESS_STEP_ORDER, planVoicePostprocess, voicePostprocessHas, voicePostprocessNext };
}
