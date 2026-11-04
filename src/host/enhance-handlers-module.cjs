'use strict';

const { RPC_METHODS } = require('../shared/contracts/rpc.cjs');

// 增强/纠错 RPC 注册域（目标模式：普通 CommonJS，构建期由 build-host 打包内联）。
// 这里只把既有 apply() 内的注册正文搬入显式工厂；RPC 名、参数、返回字段与执行顺序不变。
// 依赖由构建期装配点显式注入，产物仍保持自包含、无外部 require。
function createEnhanceHandlers(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const ctx = d.ctx;
  const harness = d.harness;
  const llm = d.llm;
  const pending = d.pending;
  const hlog = d.hlog;
  const herr = d.herr;
  const requestKey = d.requestKey;
  const markAndAbort = d.markAndAbort;
  const createEnhancePipeline = d.createEnhancePipeline;
  const createEnhanceRuntime = d.createEnhanceRuntime;
  const createAnalyzeStage = d.createAnalyzeStage;
  const createRetrieveStage = d.createRetrieveStage;
  const createAssembleStage = d.createAssembleStage;
  const createGenerationStage = d.createGenerationStage;
  const createCorrectionRunner = d.createCorrectionRunner;
  const CORRECTION_SWITCH = d.CORRECTION_SWITCH;
  const validateConfig = d.validateConfig;
  const buildTryChain = d.buildTryChain;
  const resolveTemplateSystem = d.resolveTemplateSystem;
  const shouldInjectMemory = d.shouldInjectMemory;
  const computeEditDelta = d.computeEditDelta;
  const filterDeltaForPublish = d.filterDeltaForPublish;
  const detectScenario = d.detectScenario;
  const resolveEnhanceTimeoutMs = d.resolveEnhanceTimeoutMs;
  const SKILL_MANIFEST = d.SKILL_MANIFEST;
  const MODE_KEYS = d.MODE_KEYS;
  const MEMORY_ROUNDS_MAX = d.MEMORY_ROUNDS_MAX;
  const STAGE_PREPARE = d.STAGE_PREPARE;
  const STAGE_ANALYZE = d.STAGE_ANALYZE;
  const STAGE_HISTORY = d.STAGE_HISTORY;
  const STAGE_FILES = d.STAGE_FILES;
  const STAGE_EVENTS = d.STAGE_EVENTS;
  const STAGE_CONTEXT = d.STAGE_CONTEXT;
  const STAGE_LLM = d.STAGE_LLM;
  const DISCIPLINE_PROMPT = d.DISCIPLINE_PROMPT;
  const publishScenarioCache = d.publishScenarioCache;
  const publishWebMemo = d.publishWebMemo;
  const startWaitAbort = d.startWaitAbort;
  const buildV2ContextBlock = d.buildV2ContextBlock;
  const collectStream = d.collectStream;
  const cleanOutput = d.cleanOutput;
  const cleanCorrectionOutput = d.cleanCorrectionOutput;
  const friendlyMessage = d.friendlyMessage;
  const extractHistoryConclusions = d.extractHistoryConclusions;
  const extractHistory = d.extractHistory;
  const splitHistoryRounds = d.splitHistoryRounds;
  const rankFiles = d.rankFiles;
  const splitCnSegments = d.splitCnSegments;
  const shouldIgnoreFile = d.shouldIgnoreFile;
  const snippetFromLines = d.snippetFromLines;
  const extractKeywords = d.extractKeywords;
  const parseRelevance = d.parseRelevance;
  const parseSearchPlan = d.parseSearchPlan;
  const parseIntent = d.parseIntent;
  const parseDocsAnalysis = d.parseDocsAnalysis;
  const resolveRetrieveBudget = d.resolveRetrieveBudget;
  const DEFAULT_MODE = d.DEFAULT_MODE;
  const wrapUserText = d.wrapUserText;
  const wrapPublishText = d.wrapPublishText;
  const buildMemoryDeltaHint = d.buildMemoryDeltaHint;
  const buildChatMessages = d.buildChatMessages;
  const enhanceSuccessResult = d.enhanceSuccessResult;
  const enhanceFailureResult = d.enhanceFailureResult;
  const stripScenarioEcho = d.stripScenarioEcho;
  const computeBackoffDelayMs = d.computeBackoffDelayMs;
  const isRetryableFailure = d.isRetryableFailure;
  const probeCacheGet = d.probeCacheGet;
  const probeCacheSet = d.probeCacheSet;
  const pingStream = d.pingStream;
  const resolvePrepareBudgetMs = d.resolvePrepareBudgetMs;
  const V2_SEARCH_EVENTS_TIMEOUT_MS = d.V2_SEARCH_EVENTS_TIMEOUT_MS;
  const V2_WORKSPACE_TIMEOUT_MS = d.V2_WORKSPACE_TIMEOUT_MS;
  const V2_PROGRESS_TIMEOUT_MS = d.V2_PROGRESS_TIMEOUT_MS;
  const V2_MSG_SEQ_SCAN = d.V2_MSG_SEQ_SCAN;
  const V2_HISTORY_LIMIT = d.V2_HISTORY_LIMIT;
  const SCAN_FILE_LIST_MAX = d.SCAN_FILE_LIST_MAX;
  const V2_WORKSPACE_IGNORE_DIRS = d.V2_WORKSPACE_IGNORE_DIRS;
  const SNIPPET_BUDGET = d.SNIPPET_BUDGET;
  const RELEVANCE_TIMEOUT_MS = d.RELEVANCE_TIMEOUT_MS;
  const RELEVANCE_MAX_TOKENS = d.RELEVANCE_MAX_TOKENS;
  const RELEVANCE_OUTPUT_LIMIT = d.RELEVANCE_OUTPUT_LIMIT;
  const WEB_PLAN_TIMEOUT_MS = d.WEB_PLAN_TIMEOUT_MS;
  const WEB_PLAN_MAX_TOKENS = d.WEB_PLAN_MAX_TOKENS;
  const WEB_PLAN_OUTPUT_LIMIT = d.WEB_PLAN_OUTPUT_LIMIT;
  const WEB_MEMO_TOPICS_MAX = d.WEB_MEMO_TOPICS_MAX;
  const WEB_MEMO_MAX = d.WEB_MEMO_MAX;
  const RELEVANCE_PROMPT = d.RELEVANCE_PROMPT;
  const WEBSEARCH_PLAN_PROMPT = d.WEBSEARCH_PLAN_PROMPT;
  const DEV_INTENT_PROMPT = d.DEV_INTENT_PROMPT;
  const DOC_ANALYSIS_PROMPT = d.DOC_ANALYSIS_PROMPT;
  const REFERENCE_GUIDE = d.REFERENCE_GUIDE;
  const SMART_TAIL_PROMPT = d.SMART_TAIL_PROMPT;
  const CORRECTION_PROMPT = d.CORRECTION_PROMPT;
  const WATCHDOG_TIMEOUT_MS = d.WATCHDOG_TIMEOUT_MS;
  const PROBE_TIMEOUT_MS = d.PROBE_TIMEOUT_MS;
  const RETRY_ALWAYS_SAFETY_CAP = d.RETRY_ALWAYS_SAFETY_CAP;
  const WEB_SEARCH_MAX_RESULTS = d.WEB_SEARCH_MAX_RESULTS;
  const WEB_SEARCH_TIMEOUT_MS = d.WEB_SEARCH_TIMEOUT_MS;
  const CONTINUE_PROMPT = d.CONTINUE_PROMPT;
// ================= M2 深化：增强管道（bundle 内 Pipeline，契约同已退役的 M2 骨架（P1b 2026-09-19））=================
// 新增增强模式 / 检索源 = registerEnhanceStage 注册 stage handler，而非修改 enhance 主流程。
// 2026-08-18（模板体系修订）：每模式 2 个内置模板（default/increment）+ 多自定义模板——
// system 组装改走 pure.js resolveTemplateSystem（pick/custom 解析 + 旧配置兼容迁移）。
const enhancePipeline = createEnhancePipeline();
function registerEnhanceStage(name, handler, options) {
  enhancePipeline.register(name, handler, options);
}
async function runEnhanceStages(name, value) {
  return enhancePipeline.run(name, value);
}
async function runEnhancePipeline(state) {
  return enhancePipeline.runAll(state);
}

// v2.3（§7.3）：优化进度轮询 RPC——从 pending Map 读 stage（纯展示，失败静默降级）
harness.handle(RPC_METHODS.ENHANCE_PROGRESS, async (args) => {
  const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
  const seq = args && typeof args.seq === 'number' ? args.seq : -1;
  const rec = pending.get(requestKey(sessionId, seq));
  if (!rec) return { ok: false, code: 'NO_RECORD' };
  // v3.0r（细粒度进度反馈）：返回 stage + 子步骤详情 + 已用时间（纯展示，失败静默降级）
  return {
    ok: true,
    stage: rec.stage || STAGE_PREPARE,
    detailKey: rec.detailKey || '',
    detailArgs: rec.detailArgs || null,
    step: rec.step || 0,
    total: rec.total || 0,
    elapsedMs: rec.startedAt ? Date.now() - rec.startedAt : 0,
    // P0-d：降级清单（辅助调用失败 → 结果在「半瞎」状态生成，用户须可见）
    degraded: Array.isArray(rec.degraded) ? rec.degraded.slice() : [],
    // 复审 medium ⑦ 的配套：重试与降级分通道——重试次数单独暴露（可观测），
    // 混进 degraded 会把「重试后成功」误标成「部分上下文不可用」。
    retries: Array.isArray(rec.retries) ? rec.retries.slice() : [],
  };
});

// 目标模式（CHG-322）：降级/预算/可中断闸/重试策略/进度迁为普通模块。
const enhanceRuntime = createEnhanceRuntime({ ctx, llm, hlog });
const markDegraded = enhanceRuntime.markDegraded;
const remainingBudgetMs = enhanceRuntime.remainingBudgetMs;
const helperTimeoutMs = enhanceRuntime.helperTimeoutMs;
const budgetExhausted = enhanceRuntime.budgetExhausted;
const startHelperAbort = enhanceRuntime.startHelperAbort;
const retryPolicyFor = enhanceRuntime.retryPolicyFor;
const sleepMs = enhanceRuntime.sleepMs;
const setProgress = enhanceRuntime.setProgress;

// ---- stage: analyze——配置解析 / 模型链 / system 组装 / 记忆与场景准备 ----
// 目标模式（CHG-323）：analyze 阶段迁为普通模块；state 字段与场景缓存语义不变。
const analyzeStage = createAnalyzeStage({
  validateConfig, buildTryChain, resolveTemplateSystem, shouldInjectMemory,
  computeEditDelta, filterDeltaForPublish, detectScenario, resolveEnhanceTimeoutMs,
  setProgress, hlog, skillManifest: SKILL_MANIFEST, modeKeys: MODE_KEYS,
  memoryRoundsMax: MEMORY_ROUNDS_MAX, stageAnalyze: STAGE_ANALYZE,
  disciplinePrompt: DISCIPLINE_PROMPT, publishScenarioCache,
});
const enhanceStageAnalyze = analyzeStage.enhanceStageAnalyze;

// ---- stage: retrieve——V2 上下文构建 / 检索 ----
// 目标模式（CHG-326）：retrieve 辅助域与阶段迁为普通模块；检索分支与 state 字段不变。
const retrieveStage = createRetrieveStage({
  ctx, llm, hlog, markDegraded, budgetExhausted, startHelperAbort,
  startWaitAbort, setProgress, collectStream, buildV2ContextBlock,
  extractHistoryConclusions, extractHistory, splitHistoryRounds, rankFiles,
  splitCnSegments, shouldIgnoreFile, snippetFromLines, extractKeywords,
  parseRelevance, parseSearchPlan, parseIntent, parseDocsAnalysis,
  resolveRetrieveBudget, skillManifest: SKILL_MANIFEST, defaultMode: DEFAULT_MODE,
  stageHistory: STAGE_HISTORY, stageAnalyze: STAGE_ANALYZE, stageFiles: STAGE_FILES,
  v2SearchEventsTimeoutMs: V2_SEARCH_EVENTS_TIMEOUT_MS,
  v2MsgSeqScan: V2_MSG_SEQ_SCAN, v2HistoryLimit: V2_HISTORY_LIMIT,
  v2WorkspaceTimeoutMs: V2_WORKSPACE_TIMEOUT_MS,
  scanFileListMax: SCAN_FILE_LIST_MAX,
  v2WorkspaceIgnoreDirs: V2_WORKSPACE_IGNORE_DIRS,
  snippetBudget: SNIPPET_BUDGET, relevanceTimeoutMs: RELEVANCE_TIMEOUT_MS,
  relevanceMaxTokens: RELEVANCE_MAX_TOKENS,
  relevanceOutputLimit: RELEVANCE_OUTPUT_LIMIT,
  webPlanTimeoutMs: WEB_PLAN_TIMEOUT_MS,
  webPlanMaxTokens: WEB_PLAN_MAX_TOKENS,
  webPlanOutputLimit: WEB_PLAN_OUTPUT_LIMIT,
  webMemoTopicsMax: WEB_MEMO_TOPICS_MAX, webMemoMax: WEB_MEMO_MAX,
  relevancePrompt: RELEVANCE_PROMPT, websearchPlanPrompt: WEBSEARCH_PLAN_PROMPT,
  devIntentPrompt: DEV_INTENT_PROMPT, docAnalysisPrompt: DOC_ANALYSIS_PROMPT,
  referenceGuide: REFERENCE_GUIDE, smartTailPrompt: SMART_TAIL_PROMPT,
  publishWebMemo,
});
const enhanceStageRetrieve = retrieveStage.enhanceStageRetrieve;

// ---- stage: assemble——消息组装 / 日志 ----
// 目标模式（CHG-324）：消息组装迁为普通模块；阶段名、进度与 state.messages 不变。
const assembleStage = createAssembleStage({
  setProgress, hlog,
  wrapUserText, wrapPublishText, buildMemoryDeltaHint, buildChatMessages,
  stageContext: STAGE_CONTEXT, continuePrompt: CONTINUE_PROMPT,
});
const enhanceStageAssemble = assembleStage.enhanceStageAssemble;

// ---- stage: llm——模型链调用 / 流式收集 / 结果清理 ----
// 目标模式（CHG-325）：llm 阶段与探测迁为普通模块；阶段名与结果行为不变。
const generationStage = createGenerationStage({
  ctx, llm, hlog, markDegraded, remainingBudgetMs, budgetExhausted,
  retryPolicyFor, sleepMs, setProgress, enhanceSuccessResult,
  enhanceFailureResult, friendlyMessage, collectStream, cleanOutput,
  stripScenarioEcho, computeBackoffDelayMs, isRetryableFailure,
  probeCacheGet, probeCacheSet, pingStream, stageLlm: STAGE_LLM,
  watchdogTimeoutMs: WATCHDOG_TIMEOUT_MS, probeTimeoutMs: PROBE_TIMEOUT_MS,
  retryAlwaysSafetyCap: RETRY_ALWAYS_SAFETY_CAP,
});
const enhanceStageLlm = generationStage.enhanceStageLlm;

registerEnhanceStage('analyze', enhanceStageAnalyze, { priority: 100 });
registerEnhanceStage('retrieve', enhanceStageRetrieve, { priority: 100 });
registerEnhanceStage('assemble', enhanceStageAssemble, { priority: 100 });
registerEnhanceStage('llm', enhanceStageLlm, { priority: 100 });

harness.handle(RPC_METHODS.ENHANCE, async (args) => {
  const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : 'unknown';
  const seq = args && typeof args.seq === 'number' ? args.seq : -1;
  const text = args && typeof args.text === 'string' ? args.text : '';
  const key = requestKey(sessionId, seq);
  if (text.trim() === '' || text.startsWith('/')) {
    return { ok: false, code: 'GUARD', message: friendlyMessage({ code: 'GUARD' }) };
  }
  if (llm === undefined) {
    return { ok: false, code: 'NO_LLM', message: friendlyMessage({ code: 'NO_LLM' }) };
  }

  // v2.3（§7.3）：记录提前创建（入参校验后）——stage 从 prepare 起可被 progress RPC 轮询
  // v3.0r（细粒度进度反馈）：rec 扩展——startedAt/detailKey/detailArgs/step/total
  const rec = { cancelled: false, timedOut: false, iterator: null, stage: STAGE_PREPARE, startedAt: Date.now(), detailKey: '', detailArgs: null, step: 0, total: 0 };
  pending.set(key, rec);

  // M2 深化：请求状态经 Pipeline 四阶段链式传递（analyze→retrieve→assemble→llm）。
  // P0-b（2026-10-12 · 超时预算错位修复；独立复核 high 修正）：主超时计时器上移到**任何阶段之前**——
  // 准备阶段（analyze/retrieve/assemble，内含 5 处各 10–15s 的辅助调用）首次被真正限界，
  // 不再「准备阶段不设防」；辅助调用另按剩余预算钳制（helperTimeoutMs），超预算即跳过并记降级。
  // ⚠ 不劣化生成额度（复核实测过「prepare+generation 超时」的拆东墙）：总预算 = **生成额度 + 准备额度**，
  //   准备最多吃掉自己的额度 ⇒ 生成阶段仍拿满原 timeoutMs。旧行为（生成计时器后挂）等价于
  //   「准备不计费」；新行为是「准备有自己的上限」，两者在**所有原本能过的场景**下都仍然能过。
  const state = { args, sessionId, seq, text, key, rec };
  const budgetCfg = validateConfig(args && args.config);
  if (args && typeof args.mode === 'string' && MODE_KEYS.includes(args.mode)) budgetCfg.mode = args.mode;
  const genTimeoutMs = resolveEnhanceTimeoutMs(budgetCfg, buildTryChain(budgetCfg.fallback));
  const modeRow = (SKILL_MANIFEST[budgetCfg.mode] || SKILL_MANIFEST[DEFAULT_MODE]) || {};
  // 超时表由调用方传入（避免 PURE 区段内 const 的暂时性死区；见 pure.js 注释）
  const prepareBudgetMs = resolvePrepareBudgetMs(modeRow.retrieve, modeRow.sources, {
    relevanceMs: RELEVANCE_TIMEOUT_MS,
    eventsMs: V2_SEARCH_EVENTS_TIMEOUT_MS,
    workspaceMs: V2_WORKSPACE_TIMEOUT_MS,
    progressMs: V2_PROGRESS_TIMEOUT_MS,
    webPlanMs: WEB_PLAN_TIMEOUT_MS,
    webSearchMs: WEB_SEARCH_TIMEOUT_MS,
    webSearchMaxResults: WEB_SEARCH_MAX_RESULTS,
  });
  const totalBudgetMs = genTimeoutMs > 0 ? genTimeoutMs + prepareBudgetMs : 0;
  state.budgetMs = genTimeoutMs;          // 生成额度（llm 阶段语义 / 日志沿用）
  state.prepareBudgetMs = prepareBudgetMs;
  state.budgetDeadline = totalBudgetMs > 0 ? Date.now() + totalBudgetMs : null;
  // v3.1.7（用户需求·超时无限制）：timeoutMs<=0 不挂超时计时器（0 = 无限制，等待模型自然完成）
  const timeoutDisposer = totalBudgetMs > 0 ? ctx.timer.timeout(() => {
    markAndAbort(key, 'timedOut');
  }, totalBudgetMs) : null;

  try {
    await runEnhancePipeline(state);
    // P0-d：降级清单随结果回传（结果态 UI 可见；无降级 → 不附字段，行为零变化）
    if (state.result && typeof state.result === 'object' && Array.isArray(rec.degraded) && rec.degraded.length > 0) {
      state.result.degraded = rec.degraded.slice();
    }
    return state.result;
  } catch (e) {
    herr('[enhance] unexpected error session=' + sessionId + ' seq=' + seq, e);
    return { ok: false, code: 'LLM_FAILED', message: friendlyMessage({ code: 'LLM_FAILED' }) };
  } finally {
    if (timeoutDisposer) timeoutDisposer();
    pending.delete(key);
  }
});

// 目标模式（CHG-321）：纠错执行域迁为普通模块（src/host/correction-runner.cjs）。
// RPC 注册与既有包装名留在本 chunk；开关守卫、历史参考、模型链与结果清洗由模块提供。
// 目标模式：开关解析由普通模块提供；以下包装保留既有调用名与语义。
const CORRECTION_DISABLED_CODE = CORRECTION_SWITCH.CORRECTION_DISABLED_CODE;
const CORRECTION_ENABLED_REASON = CORRECTION_SWITCH.CORRECTION_ENABLED_REASON;
function correctionEnabledOf(rawCfg) {
  return CORRECTION_SWITCH.correctionEnabledOf(rawCfg);
}
function resolveCorrectionSwitch(argsCfg) {
  return CORRECTION_SWITCH.resolveCorrectionSwitch(argsCfg, harness);
}

const correctionRunner = createCorrectionRunner({
  ctx, harness, llm, hlog, startWaitAbort, validateConfig, buildTryChain,
  collectStream, cleanCorrectionOutput, friendlyMessage,
  extractHistoryConclusions, splitHistoryRounds, correctionPrompt: CORRECTION_PROMPT,
  historyTimeoutMs: V2_SEARCH_EVENTS_TIMEOUT_MS,
});
async function runCorrection(args) {
  return correctionRunner.runCorrection(args);
}

harness.handle(RPC_METHODS.VOICE_CORRECT, async (args) => {
  try {
    return await runCorrection(args);
  } catch (e) {
    herr('[correction] unexpected error', e);
    return { ok: false, code: 'LLM_FAILED', message: friendlyMessage({ code: 'LLM_FAILED' }) };
  }
});

harness.handle(RPC_METHODS.CANCEL, async (args) => {
  const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : 'unknown';
  const seq = args && typeof args.seq === 'number' ? args.seq : -1;
  markAndAbort(requestKey(sessionId, seq), 'cancelled');
  return { ok: true };
});

  return { registerEnhanceStage, runEnhanceStages, runEnhancePipeline, runCorrection };
}

module.exports = { createEnhanceHandlers };
