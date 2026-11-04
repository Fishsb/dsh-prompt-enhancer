'use strict';

// Host 装配入口（目标模式：普通 CommonJS，构建期由打包器内联）。
// 只做插件对象装配与 RPC 注册编排；业务逻辑在各自域模块中。
const pure = require('./pure-module.cjs');
const { createDiagnostics } = require('./diagnostics-module.cjs');
const models = require('./models-module.cjs');
const { createModelsRpc } = require('./models-rpc.cjs');
const { createTemplateRpc } = require('./template-rpc.cjs');
const { createContextRuntime } = require('./context-runtime.cjs');
const { createEnhanceHandlers } = require('./enhance-handlers-module.cjs');
const { createEnhancePipeline } = require('./enhance-pipeline.cjs');
const { createEnhanceRuntime, RETRY_ALWAYS_SAFETY_CAP } = require('./enhance-runtime.cjs');
const { createAnalyzeStage } = require('./enhance-analyze.cjs');
const { createRetrieveStage } = require('./enhance-retrieve.cjs');
const { createAssembleStage } = require('./enhance-assemble.cjs');
const { createGenerationStage } = require('./enhance-generation.cjs');
const { createCorrectionRunner } = require('./correction-runner.cjs');
const correctionSwitch = require('./correction-switch.cjs');
const { enhanceSuccessResult, enhanceFailureResult } = require('./enhance-result-module.cjs');
const prompts = require('./prompts-module.cjs');
const { RPC_METHODS } = require('../shared/contracts/rpc.cjs');

const V2_WORKSPACE_IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', '.cache', 'coverage', 'target', '.idea', '.vscode']);

function createHostPlugin(harness, runtime) {
  const r = runtime && typeof runtime === 'object' ? runtime : {};
  const diagnostics = createDiagnostics(r.console || console);
  const hlog = diagnostics.hlog;
  const herr = diagnostics.herr;
  const logsLast = diagnostics.logsLast;

  return {
    inject: ['llm', 'timer'],
    apply(ctx) {
      const llm = ctx.get('llm');
      const pending = new Map();
      const publishScenarioCache = new Map();
      const publishWebMemo = new Map();

      function requestKey(sessionId, seq) {
        return String(sessionId) + ':' + String(seq);
      }

      function markAndAbort(key, flag) {
        const rec = pending.get(key);
        if (!rec) return;
        rec[flag] = true;
        if (rec.iterator && typeof rec.iterator.return === 'function') {
          try { rec.iterator.return(); } catch (e) { /* 忽略 */ }
        }
      }

      const modelsRpc = createModelsRpc({
        ctx, hlog, herr,
        resolveModelInfoCached: models.resolveModelInfoCached,
        resolveAdaptiveChain: models.resolveAdaptiveChain,
        pingStream: pure.pingStream,
        friendlyMessage: pure.friendlyMessage,
        estimateBaseModeSeconds: pure.estimateBaseModeSeconds,
        estimateLiteModeSeconds: pure.estimateLiteModeSeconds,
        extractModelRouteFromEvents: pure.extractModelRouteFromEvents,
        accumulateProjectionStats: pure.accumulateProjectionStats,
        summarizeModelStats: pure.summarizeModelStats,
      });
      for (const [name, handler] of modelsRpc.handlers) harness.handle(name, handler);

      harness.handle(RPC_METHODS.LOGS_LAST, logsLast);
      const templateRpc = createTemplateRpc({
        base: prompts.SYSTEM_PROMPT, lite: prompts.SYSTEM_LITE_PROMPT, standard: prompts.SYSTEM_STANDARD_PROMPT,
        smart: prompts.SYSTEM_SMART_PROMPT, publish: prompts.SYSTEM_PUBLISH_PROMPT,
        incrementBase: prompts.SYSTEM_INCREMENT_PROMPT, incrementLite: prompts.SYSTEM_INCREMENT_LITE_PROMPT,
        incrementStandard: prompts.SYSTEM_INCREMENT_STANDARD_PROMPT,
        incrementSmart: prompts.SYSTEM_INCREMENT_SMART_PROMPT,
        incrementPublish: prompts.SYSTEM_INCREMENT_PUBLISH_PROMPT,
      });
      harness.handle(RPC_METHODS.TEMPLATE_DEFAULT, templateRpc.templateDefault);

      const contextRuntime = createContextRuntime({
        hlog,
        buildContextBlock: pure.buildContextBlock,
        collectStream: pure.collectStream,
        buildWebQuery: pure.buildWebQuery,
        extractHistory: pure.extractHistory,
        extractHistoryConclusions: pure.extractHistoryConclusions,
        extractKeywords: pure.extractKeywords,
        inferFocusRules: pure.inferFocusRules,
        parseTaskProgress: pure.parseTaskProgress,
        rankFiles: pure.rankFiles,
        resolveScanLimit: pure.resolveScanLimit,
        shouldIgnoreFile: pure.shouldIgnoreFile,
        snippetFromLines: pure.snippetFromLines,
        modeTable: pure.MODE_TABLE,
        defaultMode: pure.DEFAULT_MODE,
        stageHistory: pure.STAGE_HISTORY,
        stageAnalyze: pure.STAGE_ANALYZE,
        stageFiles: pure.STAGE_FILES,
        stageEvents: pure.STAGE_EVENTS,
        stageContext: pure.STAGE_CONTEXT,
        v2HistoryLimit: pure.V2_HISTORY_LIMIT,
        v2HistoryMaxChars: pure.V2_HISTORY_MAX_CHARS,
        v2MsgSeqScan: pure.V2_MSG_SEQ_SCAN,
        v2ProgressMaxTokens: pure.V2_PROGRESS_MAX_TOKENS,
        v2ProgressOutputLimit: pure.V2_PROGRESS_OUTPUT_LIMIT,
        v2ProgressTimeoutMs: pure.V2_PROGRESS_TIMEOUT_MS,
        v2SearchEventsTimeoutMs: pure.V2_SEARCH_EVENTS_TIMEOUT_MS,
        v2WorkspaceIgnoreDirs: V2_WORKSPACE_IGNORE_DIRS,
        v2WorkspaceTimeoutMs: pure.V2_WORKSPACE_TIMEOUT_MS,
        scanFileListMax: pure.SCAN_FILE_LIST_MAX,
        snippetBudget: pure.SNIPPET_BUDGET,
        webMemoMax: pure.WEB_MEMO_MAX,
        webRefMax: pure.WEB_REF_MAX,
        webSearchMaxResults: pure.WEB_SEARCH_MAX_RESULTS,
        webSearchTimeoutMs: pure.WEB_SEARCH_TIMEOUT_MS,
        contentFallbackScan: pure.CONTENT_FALLBACK_SCAN,
        taskAnalysisPrompt: prompts.TASK_ANALYSIS_PROMPT,
      });

      createEnhanceHandlers({
        ctx, harness, llm, pending, hlog, herr, requestKey, markAndAbort,
        createEnhancePipeline, createEnhanceRuntime, createAnalyzeStage, createRetrieveStage,
        createAssembleStage, createGenerationStage, createCorrectionRunner,
        CORRECTION_SWITCH: correctionSwitch,
        validateConfig: pure.validateConfig,
        buildTryChain: pure.buildTryChain,
        resolveTemplateSystem: pure.resolveTemplateSystem,
        shouldInjectMemory: pure.shouldInjectMemory,
        computeEditDelta: pure.computeEditDelta,
        filterDeltaForPublish: pure.filterDeltaForPublish,
        detectScenario: pure.detectScenario,
        resolveEnhanceTimeoutMs: pure.resolveEnhanceTimeoutMs,
        SKILL_MANIFEST: prompts.SKILL_MANIFEST,
        MODE_KEYS: pure.MODE_KEYS,
        MEMORY_ROUNDS_MAX: pure.MEMORY_ROUNDS_MAX,
        STAGE_PREPARE: pure.STAGE_PREPARE,
        STAGE_ANALYZE: pure.STAGE_ANALYZE,
        STAGE_HISTORY: pure.STAGE_HISTORY,
        STAGE_FILES: pure.STAGE_FILES,
        STAGE_EVENTS: pure.STAGE_EVENTS,
        STAGE_CONTEXT: pure.STAGE_CONTEXT,
        STAGE_LLM: pure.STAGE_LLM,
        DISCIPLINE_PROMPT: prompts.DISCIPLINE_PROMPT,
        publishScenarioCache, publishWebMemo,
        startWaitAbort: contextRuntime.startWaitAbort,
        buildV2ContextBlock: contextRuntime.buildV2ContextBlock,
        collectStream: pure.collectStream,
        cleanOutput: pure.cleanOutput,
        cleanCorrectionOutput: pure.cleanCorrectionOutput,
        friendlyMessage: pure.friendlyMessage,
        extractHistoryConclusions: pure.extractHistoryConclusions,
        extractHistory: pure.extractHistory,
        splitHistoryRounds: pure.splitHistoryRounds,
        rankFiles: pure.rankFiles,
        splitCnSegments: pure.splitCnSegments,
        shouldIgnoreFile: pure.shouldIgnoreFile,
        snippetFromLines: pure.snippetFromLines,
        extractKeywords: pure.extractKeywords,
        parseRelevance: pure.parseRelevance,
        parseSearchPlan: pure.parseSearchPlan,
        parseIntent: pure.parseIntent,
        parseDocsAnalysis: pure.parseDocsAnalysis,
        resolveRetrieveBudget: pure.resolveRetrieveBudget,
        DEFAULT_MODE: pure.DEFAULT_MODE,
        wrapUserText: pure.wrapUserText,
        wrapPublishText: pure.wrapPublishText,
        buildMemoryDeltaHint: pure.buildMemoryDeltaHint,
        buildChatMessages: pure.buildChatMessages,
        enhanceSuccessResult, enhanceFailureResult,
        stripScenarioEcho: pure.stripScenarioEcho,
        computeBackoffDelayMs: pure.computeBackoffDelayMs,
        isRetryableFailure: pure.isRetryableFailure,
        probeCacheGet: pure.probeCacheGet,
        probeCacheSet: pure.probeCacheSet,
        pingStream: pure.pingStream,
        resolvePrepareBudgetMs: pure.resolvePrepareBudgetMs,
        V2_SEARCH_EVENTS_TIMEOUT_MS: pure.V2_SEARCH_EVENTS_TIMEOUT_MS,
        V2_WORKSPACE_TIMEOUT_MS: pure.V2_WORKSPACE_TIMEOUT_MS,
        V2_PROGRESS_TIMEOUT_MS: pure.V2_PROGRESS_TIMEOUT_MS,
        V2_MSG_SEQ_SCAN: pure.V2_MSG_SEQ_SCAN,
        V2_HISTORY_LIMIT: pure.V2_HISTORY_LIMIT,
        SCAN_FILE_LIST_MAX: pure.SCAN_FILE_LIST_MAX,
        V2_WORKSPACE_IGNORE_DIRS,
        SNIPPET_BUDGET: pure.SNIPPET_BUDGET,
        RELEVANCE_TIMEOUT_MS: pure.RELEVANCE_TIMEOUT_MS,
        RELEVANCE_MAX_TOKENS: pure.RELEVANCE_MAX_TOKENS,
        RELEVANCE_OUTPUT_LIMIT: pure.RELEVANCE_OUTPUT_LIMIT,
        WEB_PLAN_TIMEOUT_MS: pure.WEB_PLAN_TIMEOUT_MS,
        WEB_PLAN_MAX_TOKENS: pure.WEB_PLAN_MAX_TOKENS,
        WEB_PLAN_OUTPUT_LIMIT: pure.WEB_PLAN_OUTPUT_LIMIT,
        WEB_MEMO_TOPICS_MAX: pure.WEB_MEMO_TOPICS_MAX,
        WEB_MEMO_MAX: pure.WEB_MEMO_MAX,
        RELEVANCE_PROMPT: prompts.RELEVANCE_PROMPT,
        WEBSEARCH_PLAN_PROMPT: prompts.WEBSEARCH_PLAN_PROMPT,
        DEV_INTENT_PROMPT: prompts.DEV_INTENT_PROMPT,
        DOC_ANALYSIS_PROMPT: prompts.DOC_ANALYSIS_PROMPT,
        REFERENCE_GUIDE: prompts.REFERENCE_GUIDE,
        SMART_TAIL_PROMPT: prompts.SMART_TAIL_PROMPT,
        CORRECTION_PROMPT: prompts.CORRECTION_PROMPT,
        WATCHDOG_TIMEOUT_MS: pure.WATCHDOG_TIMEOUT_MS,
        PROBE_TIMEOUT_MS: pure.PROBE_TIMEOUT_MS,
        RETRY_ALWAYS_SAFETY_CAP,
        WEB_SEARCH_MAX_RESULTS: pure.WEB_SEARCH_MAX_RESULTS,
        WEB_SEARCH_TIMEOUT_MS: pure.WEB_SEARCH_TIMEOUT_MS,
        CONTINUE_PROMPT: prompts.CONTINUE_PROMPT,
      });

      ctx.effect(() => () => {
        for (const key of [...pending.keys()]) {
          const rec = pending.get(key);
          if (rec && rec.iterator && typeof rec.iterator.return === 'function') {
            try { rec.iterator.return(); } catch (e) { /* 忽略 */ }
          }
        }
      });
    },
  };
}

module.exports = { createHostPlugin };
