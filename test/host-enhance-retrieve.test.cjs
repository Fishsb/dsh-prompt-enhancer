'use strict';

// 目标模式：增强 retrieve 阶段的语义锁（跳过 / 窗口命中 / publish / 参考注入 / 接线）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createRetrieveStage } = require('../src/host/enhance-retrieve.cjs');

function makeStage(overrides) {
  const logs = [];
  const progress = [];
  const memo = new Map();
  const calls = { history: 0, judge: 0, plan: 0, v2: 0 };
  const deps = {
    ctx: {
      timer: { timeout: () => () => {} },
      get: (name) => {
        if (name === 'sessionQuery') {
          return {
            readSurface: async () => { calls.history += 1; return { events: [{ type: 'user/message' }] }; },
            listEvents: async () => [],
            filterEvents: async () => [],
          };
        }
        return null;
      },
    },
    llm: {
      stream: () => ({
        [Symbol.asyncIterator]() {
          return { next: async () => ({ done: true }), return: async () => ({ done: true }) };
        },
      }),
    },
    hlog: (...args) => logs.push(args.join(' ')),
    markDegraded: (state, kind) => { state.degradedKinds = (state.degradedKinds || []).concat(kind); },
    budgetExhausted: () => false,
    startHelperAbort: () => ({ attach: () => {}, race: (p) => p, timedOut: () => false, dispose: () => {} }),
    startWaitAbort: () => ({ race: (p) => p, timedOut: () => false, dispose: () => {} }),
    setProgress: (rec, stage, key, args, step, total) => progress.push({ stage, key, args, step, total }),
    collectStream: async () => ({ kind: 'ok', text: 'judge-ok' }),
    buildV2ContextBlock: async () => { calls.v2 += 1; return { block: 'V2', log: 'v2-log', webTopics: [], webMemoText: '' }; },
    extractHistoryConclusions: () => ['history'],
    extractHistory: () => [],
    splitHistoryRounds: () => ['HISTORY'],
    rankFiles: () => [],
    splitCnSegments: () => [],
    shouldIgnoreFile: () => false,
    snippetFromLines: () => '',
    extractKeywords: () => [],
    parseRelevance: () => { calls.judge += 1; return { related: true, reason: 'ok' }; },
    parseSearchPlan: () => { calls.plan += 1; return { topics: [] }; },
    parseIntent: () => ({ isDevIntent: false, reason: 'no' }),
    parseDocsAnalysis: () => null,
    resolveRetrieveBudget: () => ({ roundsChars: 100, smartDocs: 1, smartDepth: 1, smartChars: 100, smartCodeChars: 100 }),
    skillManifest: {
      base: { retrieve: { kind: 'rounds', windows: [[1, 1]] }, sources: [] },
      publish: { retrieve: { kind: 'v2', windows: [] }, sources: [] },
    },
    defaultMode: 'base',
    stageHistory: 'history', stageAnalyze: 'analyze', stageFiles: 'files',
    v2SearchEventsTimeoutMs: 100, v2MsgSeqScan: 10, v2HistoryLimit: 10,
    v2WorkspaceTimeoutMs: 100, scanFileListMax: 10,
    v2WorkspaceIgnoreDirs: new Set(), snippetBudget: 100,
    relevanceTimeoutMs: 100, relevanceMaxTokens: 100, relevanceOutputLimit: 100,
    webPlanTimeoutMs: 100, webPlanMaxTokens: 100, webPlanOutputLimit: 100,
    webMemoTopicsMax: 5, webMemoMax: 100,
    relevancePrompt: 'R {history} {current}', websearchPlanPrompt: 'W {text} {memo} {scenario}',
    devIntentPrompt: 'I {history} {current}', docAnalysisPrompt: 'D {docs} {text} {session}',
    referenceGuide: 'REF', smartTailPrompt: 'TAIL', publishWebMemo: memo,
  };
  return {
    stage: createRetrieveStage(Object.assign(deps, overrides || {})).enhanceStageRetrieve,
    logs, progress, memo, calls,
  };
}

function state(mode, overrides) {
  return Object.assign({
    cfg: { mode, context: { budgetChars: 1000 } },
    text: '原文', sessionId: 's', rec: {}, chain: [{ provider: 'p', model: 'm' }],
    v2Block: '', v2Log: '', memoryActive: false, isContinuation: false,
    memDelta: null, scenario: 'generic', system: 'SYS', budgetMs: 30000,
    budgetDeadline: Date.now() + 30000,
  }, overrides || {});
}

test('HER2-01 继续模式跳过检索并保留既有 v2 字段', async () => {
  const { stage, calls } = makeStage();
  const out = await stage(state('base', { isContinuation: true }));
  assert.equal(out.v2Log, 'continuation-skip');
  assert.equal(calls.history, 0);
});

test('HER2-02 rounds 预算为 0 时明确跳过，不读会话', async () => {
  const { stage, calls } = makeStage({ resolveRetrieveBudget: () => ({ roundsChars: 0 }) });
  const out = await stage(state('base'));
  assert.equal(out.v2Log, 'rounds-skip budget=0');
  assert.equal(calls.history, 0);
});

test('HER2-03 rounds 窗口命中后注入参考，并记录窗口原因', async () => {
  const { stage, calls } = makeStage();
  const out = await stage(state('base'));
  assert.equal(calls.history, 1);
  assert.equal(calls.judge, 1);
  assert.ok(out.v2Block.includes('【相关会话参考（仅吸收明确需求，禁止复述）】\nHISTORY'));
  assert.match(out.v2Log, /rounds=1-1/);
  assert.match(out.v2Log, /reason=ok/);
});

test('HER2-04 publish 继续走 v2 上下文块，保留 block/log 写回', async () => {
  const { stage, calls } = makeStage();
  const out = await stage(state('publish'));
  assert.equal(calls.v2, 1);
  assert.equal(out.v2Block, 'V2');
  assert.equal(out.v2Log, 'v2-log');
});

test('HER2-05 有参考或记忆时追加 REFERENCE_GUIDE；产物内联 retrieve 模块', async () => {
  const { stage } = makeStage({ resolveRetrieveBudget: () => ({ roundsChars: 0 }) });
  const out = await stage(state('base', { memoryActive: true }));
  assert.equal(out.system, 'SYS\n\nREF');
  const host = fs.readFileSync(path.join(REPO_ROOT, 'plugin-host.js'), 'utf8');
  assert.ok(host.includes('"src/host/enhance-retrieve.cjs"'));
  assert.ok(host.includes('"src/host/enhance-retrieve.cjs"'));
  assert.ok(host.includes("registerEnhanceStage('retrieve', enhanceStageRetrieve"));
  assert.equal((host.match(/require\(/g) || []).length, 0);
});
