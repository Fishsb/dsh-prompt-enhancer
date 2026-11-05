'use strict';

// 增强 analyze 阶段（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 职责：解析配置、建立模型链、组装 system、准备记忆轮次与 publish 场景。
// 不调用模型、不写回草稿；纯函数、提示词、场景缓存与日志全部由调用方注入。

function createAnalyzeStage(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const validateConfig = d.validateConfig;
  const buildTryChain = d.buildTryChain;
  const resolveTemplateSystem = d.resolveTemplateSystem;
  const shouldInjectMemory = d.shouldInjectMemory;
  const computeEditDelta = d.computeEditDelta;
  const filterDeltaForPublish = d.filterDeltaForPublish;
  const detectScenario = d.detectScenario;
  const resolveEnhanceTimeoutMs = d.resolveEnhanceTimeoutMs;
  const setProgress = d.setProgress;
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};
  const skillManifest = d.skillManifest || {};
  const modeKeys = Array.isArray(d.modeKeys) ? d.modeKeys : [];
  const memoryRoundsMax = Number.isSafeInteger(d.memoryRoundsMax) ? d.memoryRoundsMax : 0;
  const stageAnalyze = d.stageAnalyze;
  const disciplinePrompt = d.disciplinePrompt || '';
  const publishScenarioCache = d.publishScenarioCache instanceof Map ? d.publishScenarioCache : new Map();

  async function enhanceStageAnalyze(state) {
    const args = state.args;
    const sessionId = state.sessionId;
    const text = state.text;
    if (state.rec) setProgress(state.rec, stageAnalyze);
    const cfg = validateConfig(args && args.config);
    if (args && typeof args.mode === 'string' && modeKeys.includes(args.mode)) cfg.mode = args.mode;
    const chain = buildTryChain(cfg.fallback);
    const builtinTemplates = {};
    for (const mode of Object.keys(skillManifest)) {
      builtinTemplates[mode] = [skillManifest[mode].templates.t1, skillManifest[mode].templates.t2];
    }
    let system = resolveTemplateSystem(cfg, cfg.mode, builtinTemplates);
    system = system + '\n\n' + disciplinePrompt;
    const memRounds = args && args.memory && Array.isArray(args.memory.rounds)
      ? args.memory.rounds.filter((r) => r && (r.input || r.output)).slice(-memoryRoundsMax)
      : [];
    const hasMemory = memRounds.length > 0;
    const memoryActive = shouldInjectMemory(cfg.memory, hasMemory, cfg.context.budgetChars);
    let memDelta = null;
    if (memoryActive) {
      const lastOutput = memRounds[memRounds.length - 1].output;
      memDelta = filterDeltaForPublish(computeEditDelta(lastOutput, text), cfg.mode);
    }
    let scenario = 'generic';
    if (cfg.mode === 'publish') {
      const cached = publishScenarioCache.get(sessionId);
      if (cached) {
        scenario = cached;
      } else {
        const src = memRounds.length > 0 ? memRounds[0].input : text;
        scenario = detectScenario(src);
        publishScenarioCache.set(sessionId, scenario);
      }
      if (scenario !== 'generic') {
        system = system + '\n\n【场景判定】本次场景判定：' + scenario + '（依据用户输入自动判定；章节适配要求见「场景适配」段；请勿复述本判定行）';
      }
      hlog('[enhance] scenario=' + scenario + (cached ? ' cached' : ' judged src=' + (memRounds.length > 0 ? 'rounds[0]' : 'text')));
    }
    const isPublish = cfg.mode === 'publish';
    state.cfg = cfg;
    state.chain = chain;
    state.system = system;
    state.memRounds = memRounds;
    state.hasMemory = hasMemory;
    state.memoryActive = memoryActive;
    state.memDelta = memDelta;
    state.isContinuation = memoryActive && memRounds.length > 0 && memDelta !== null && (memDelta.added.length > 0 || memDelta.removed.length > 0);
    state.scenario = scenario;
    state.isPublish = isPublish;
    state.timeoutMs = resolveEnhanceTimeoutMs(cfg, chain);
    state.maxTokens = cfg.maxTokens;
    state.outputLimit = cfg.outputLimit;
    return state;
  }

  return { enhanceStageAnalyze };
}

module.exports = { createAnalyzeStage };
