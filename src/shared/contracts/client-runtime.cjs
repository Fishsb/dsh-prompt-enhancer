'use strict';

// 客户端共享契约入口（目标模式：普通 CommonJS 源码，由构建器打成自包含表达式）。
// 只聚合无环境依赖的纯数据与纯函数；不得 require 浏览器或宿主模块。
const voiceConfig = require('./voice-config.cjs');
const postprocessPlan = require('../voice/postprocess-plan.cjs');
const result = require('./result.cjs');

module.exports = {
  VOICE_CONFIG_KEYS: voiceConfig.VOICE_CONFIG_KEYS,
  VOICE_CONFIG_DEFAULTS: voiceConfig.VOICE_CONFIG_DEFAULTS,
  cloneVoiceConfigDefaults: voiceConfig.cloneVoiceConfigDefaults,
  normalizeVadSilenceMs: voiceConfig.normalizeVadSilenceMs,
  VOICE_POSTPROCESS_STEPS: postprocessPlan.VOICE_POSTPROCESS_STEPS,
  VOICE_POSTPROCESS_STEP_ORDER: postprocessPlan.VOICE_POSTPROCESS_STEP_ORDER,
  planVoicePostprocess: postprocessPlan.planVoicePostprocess,
  voicePostprocessHas: postprocessPlan.voicePostprocessHas,
  voicePostprocessNext: postprocessPlan.voicePostprocessNext,
  RESULT_STATUS: result.RESULT_STATUS,
  resultStatusOf: result.resultStatusOf,
  resultIsTerminal: result.resultIsTerminal,
  postprocessOutcomeOf: result.postprocessOutcomeOf,
};
