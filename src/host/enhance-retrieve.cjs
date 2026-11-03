'use strict';

// 增强 retrieve 阶段（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 职责：会话窗口检索、相关性/开发意向判定、工作区文档与代码检索、网络主题规划、
// publish 旧上下文管道与参考注入。模型、服务、计时器、提示词和纯函数全部注入。

function createRetrieveStage(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const ctx = d.ctx;
  const llm = d.llm;
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};
  const markDegraded = d.markDegraded;
  const budgetExhausted = d.budgetExhausted;
  const startHelperAbort = d.startHelperAbort;
  const startWaitAbort = d.startWaitAbort;
  const setProgress = d.setProgress;
  const collectStream = d.collectStream;
  const buildV2ContextBlock = d.buildV2ContextBlock;
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
  const SKILL_MANIFEST = d.skillManifest;
  const DEFAULT_MODE = d.defaultMode;
  const STAGE_HISTORY = d.stageHistory;
  const STAGE_ANALYZE = d.stageAnalyze;
  const STAGE_FILES = d.stageFiles;
  const V2_SEARCH_EVENTS_TIMEOUT_MS = d.v2SearchEventsTimeoutMs;
  const V2_MSG_SEQ_SCAN = d.v2MsgSeqScan;
  const V2_HISTORY_LIMIT = d.v2HistoryLimit;
  const V2_WORKSPACE_TIMEOUT_MS = d.v2WorkspaceTimeoutMs;
  const SCAN_FILE_LIST_MAX = d.scanFileListMax;
  const V2_WORKSPACE_IGNORE_DIRS = d.v2WorkspaceIgnoreDirs;
  const SNIPPET_BUDGET = d.snippetBudget;
  const RELEVANCE_TIMEOUT_MS = d.relevanceTimeoutMs;
  const RELEVANCE_MAX_TOKENS = d.relevanceMaxTokens;
  const RELEVANCE_OUTPUT_LIMIT = d.relevanceOutputLimit;
  const WEB_PLAN_TIMEOUT_MS = d.webPlanTimeoutMs;
  const WEB_PLAN_MAX_TOKENS = d.webPlanMaxTokens;
  const WEB_PLAN_OUTPUT_LIMIT = d.webPlanOutputLimit;
  const WEB_MEMO_TOPICS_MAX = d.webMemoTopicsMax;
  const WEB_MEMO_MAX = d.webMemoMax;
  const RELEVANCE_PROMPT = d.relevancePrompt;
  const WEBSEARCH_PLAN_PROMPT = d.websearchPlanPrompt;
  const DEV_INTENT_PROMPT = d.devIntentPrompt;
  const DOC_ANALYSIS_PROMPT = d.docAnalysisPrompt;
  const REFERENCE_GUIDE = d.referenceGuide;
  const SMART_TAIL_PROMPT = d.smartTailPrompt;
  const publishWebMemo = d.publishWebMemo instanceof Map ? d.publishWebMemo : new Map();

    // ---- stage: retrieve——V2 上下文构建 / 检索 ----
    // ---- v3.0：会话历史提取（listEvents/filterEvents → extractHistory；失败/不可用 → []）----
    async function fetchSessionHistory(sessionId, state) {
      const sq = ctx.get('sessionQuery');
      if (!sq || typeof sq.listEvents !== 'function' || typeof sq.filterEvents !== 'function') return [];
      // v3.0p 审查（超时/耗时匹配）：会话历史提取补超时保护（10s，超时/失败 → [] 不阻断）
      // P0-b 修正（2026-10-12 · 第三轮 · 独立复核 blocker）：原先 histTimer **只置标志位**，
      // 而 `await sq.readSurface(...)` / `await sq.listEvents(...)` 会一直等到调用自己返回
      // ⇒ 慢的会话读取可越过钳后超时、吃掉总预算并侵蚀生成额度（复核实测：readSurface 23s/24s/30s
      // ⇒ 改后 TIMEOUT、genCalls=0，HEAD 为 ok:true）。
      // 现统一到 startWaitAbort（race + dispose，机制与 LLM 腿的 startHelperAbort 同源）：
      // 超时即**不再等待**该调用，并按上游「超时 → 跳过检索段」语义返回 []，同时登记降级。
      const waitAbort = startWaitAbort(ctx.timer, V2_SEARCH_EVENTS_TIMEOUT_MS);
      try {
        // v3.1.3（用户需求·仅结论参考）：优先 readSurface（完整事件，保留 content 块结构）
        // → 结论提取（仅 text 块，丢弃思考/工具调用/系统注入）；旧 listEvents+filterEvents
        // 路径的文档文本为预拼接语义文本（含工具参数），仅作 readSurface 缺失时的兜底。
        if (typeof sq.readSurface === 'function') {
          const surface = await waitAbort.race(sq.readSurface(sessionId));
          if (waitAbort.timedOut()) { markDegraded(state, 'history-timeout'); hlog('[enhance] v3 history timeout'); return []; }
          const events = extractHistoryConclusions(surface && surface.events);
          hlog('[enhance] v3 history events=' + events.length + ' conclusion-only');
          return events;
        }
        const records = await waitAbort.race(sq.listEvents(sessionId));
        if (waitAbort.timedOut()) { markDegraded(state, 'history-timeout'); hlog('[enhance] v3 history timeout'); return []; }
        const msgSeqs = [];
        for (let i = records.length - 1; i >= 0 && msgSeqs.length < V2_MSG_SEQ_SCAN; i--) {
          const r = records[i];
          const t = String(r && r.type || '');
          if (t === 'user/message' || t === 'assistant/message') msgSeqs.push(r && r.seq);
        }
        if (msgSeqs.length === 0) return [];
        const minSeq = msgSeqs[msgSeqs.length - 1];
        const docs = await waitAbort.race(sq.filterEvents(sessionId, [{ kind: 'seq', from: minSeq }]));
        if (waitAbort.timedOut()) { markDegraded(state, 'history-timeout'); hlog('[enhance] v3 history timeout'); return []; }
        const events = extractHistory(docs, V2_HISTORY_LIMIT);
        hlog('[enhance] v3 history events=' + events.length);
        return events;
      } catch (e) {
        hlog('[enhance] v3 history failed', e && e.message ? e.message : e);
        return [];
      } finally {
        waitAbort.dispose();
      }
    }

    // ---- v3.0：LLM 关联性判定（RELEVANCE_PROMPT 占位替换；10s 超时；失败/解析失败 → 不相关）----
    async function judgeRelevance(historyText, currentText, entry, state) {
      if (llm === undefined || !entry) { markDegraded(state, 'relevance'); return { related: false, reason: 'no-llm' }; }
      // P0-b：辅助调用并入主预算——超预算直接跳过（记降级，不阻断主流程）
      if (budgetExhausted(state)) { markDegraded(state, 'relevance-budget'); hlog('[enhance] v3 relevance skipped budget-exhausted'); return { related: false, reason: 'budget-exhausted' }; }
      const system = RELEVANCE_PROMPT
        .replace('{history}', String(historyText || ''))
        .replace('{current}', String(currentText || ''));
      let timedOut = false;
      // P0-b：自身 10s 超时钳到剩余预算内（不越过主预算）
      // P0-b 修正：超时到点**真正中止**该辅助流（不再等它自然结束——见 startHelperAbort 注释）
      const abortCtl = startHelperAbort(state, RELEVANCE_TIMEOUT_MS);
      try {
        const stream = llm.stream({
          provider: entry.provider,
          model: entry.model,
          // v3.0p 审查（超时/耗时匹配）：judge 类小调用剥离 reasoningEffort——判定/规划任务无需深度思考；effort 思考会消耗小预算输出（空流风险）并放大耗时
          maxTokens: RELEVANCE_MAX_TOKENS,
          system,
          messages: [{
            id: 'enhance-relevance',
            role: 'user',
            content: [{ type: 'text', text: '请依据上述规则判断关联性。' }],
            source: { kind: 'user' },
          }],
        });
        const iterator = stream[Symbol.asyncIterator]();
        abortCtl.attach(iterator);
        const collectP = collectStream(iterator, RELEVANCE_OUTPUT_LIMIT);
        // 超时闸先结算时，collectP 可能随后才 reject —— 先挂空处理器，避免未处理拒绝
        collectP.catch(() => { /* 落败方 */ });
        const result = await abortCtl.race(collectP);
        timedOut = abortCtl.timedOut();
        // P0-e（消费点 2/6 之一）：max-tokens 现返回可区分 kind 'maxtokens'（不再是 EMPTY_RESPONSE）；
        // 判定类辅助调用**按原样透传**——非 'ok' 一律判失败（显式声明，不静默沿用旧兜底）。
        if (!timedOut && result.kind === 'ok') {
          const parsed = parseRelevance(result.text);
          if (parsed) return parsed;
        }
        // P0-d：判定失败/超时 → 记降级（结果在无参考状态下生成，用户须可见）
        markDegraded(state, timedOut ? 'relevance-timeout' : (result.kind === 'maxtokens' ? 'relevance-truncated' : 'relevance-unparsed'));
        hlog('[enhance] v3 relevance ' + (timedOut ? 'timeout' : 'unparsed'));
      } catch (e) {
        markDegraded(state, 'relevance-failed');
        hlog('[enhance] v3 relevance failed', e && e.message ? e.message : e);
      } finally {
        abortCtl.dispose();
      }
      return { related: false, reason: 'judge-failed' };
    }


    // ---- v3.0p（publish 多步检索）：LLM 检索主题规划（WEBSEARCH_PLAN_PROMPT 占位替换；
    // 10s 超时；失败/解析失败 → null → retrieve 降级 buildWebQuery 单 query）----
    async function planWebSearch(text, memoText, scenario, entry, state) {
      if (llm === undefined || !entry) { markDegraded(state, 'webplan'); return null; }
      // P0-b：辅助调用并入主预算——超预算直接跳过（降级为单 query 路径）
      if (budgetExhausted(state)) { markDegraded(state, 'webplan-budget'); hlog('[enhance] v3p web-plan skipped budget-exhausted'); return null; }
      const system = WEBSEARCH_PLAN_PROMPT
        .replace('{text}', String(text || ''))
        .replace('{memo}', String(memoText || '（暂无）'))
        .replace('{scenario}', String(scenario || 'generic'));
      let timedOut = false;
      // P0-b 修正：超时到点**真正中止**该辅助流（不再等它自然结束——见 startHelperAbort 注释）
      const abortCtl = startHelperAbort(state, WEB_PLAN_TIMEOUT_MS);
      try {
        const stream = llm.stream({
          provider: entry.provider,
          model: entry.model,
          // v3.0p 审查（超时/耗时匹配）：judge 类小调用剥离 reasoningEffort——判定/规划任务无需深度思考；effort 思考会消耗小预算输出（空流风险）并放大耗时
          maxTokens: WEB_PLAN_MAX_TOKENS,
          system,
          messages: [{
            id: 'enhance-webplan',
            role: 'user',
            content: [{ type: 'text', text: '请输出检索主题规划。' }],
            source: { kind: 'user' },
          }],
        });
        const iterator = stream[Symbol.asyncIterator]();
        abortCtl.attach(iterator);
        const collectP = collectStream(iterator, WEB_PLAN_OUTPUT_LIMIT);
        // 超时闸先结算时，collectP 可能随后才 reject —— 先挂空处理器，避免未处理拒绝
        collectP.catch(() => { /* 落败方 */ });
        const result = await abortCtl.race(collectP);
        timedOut = abortCtl.timedOut();
        // P0-e（消费点 3/6）：maxtokens 按原样透传 → 非 ok 即降级（显式声明）。
        if (!timedOut && result.kind === 'ok') {
          const parsed = parseSearchPlan(result.text);
          if (parsed) return parsed;
        }
        markDegraded(state, timedOut ? 'webplan-timeout' : (result.kind === 'maxtokens' ? 'webplan-truncated' : 'webplan-unparsed'));
        hlog('[enhance] v3p web-plan ' + (timedOut ? 'timeout' : 'unparsed'));
      } catch (e) {
        markDegraded(state, 'webplan-failed');
        hlog('[enhance] v3p web-plan failed', e && e.message ? e.message : e);
      } finally {
        abortCtl.dispose();
      }
      return null;
    }
    // ---- v3.0（S3）：工作区文件检索（扩展名过滤 + 关键词排序 + 摘要；2s 超时降级）----
    const DOC_FILE_RE = /\.md$/i;
    const CODE_FILE_RE = /\.(?:js|ts|jsx|tsx|py|go|rs|java|cpp|c|h|cs|rb|php|sql|sh|vue|html|css|json|yaml|yml|toml)$/i;
    async function searchWorkspaceFiles(extRe, keywords, maxFiles, maxDepth, paths) {
      const fsSvc = ctx.get('fs');
      const sp = ctx.get('sandboxPolicy');
      const root = sp && sp.workspaceRoot;
      if (!fsSvc || !root || typeof fsSvc.listDir !== 'function' || typeof fsSvc.resolve !== 'function' || typeof fsSvc.readText !== 'function') return [];
      // P0-b 修正（2026-10-12 · 第三轮）：标志位 → race+dispose（与 v2SearchWorkspace 同一机制）。
      // 慢的 fs 调用此前会越过 V2_WORKSPACE_TIMEOUT_MS 一直等 ⇒ 侵蚀生成额度。
      const waitAbort = startWaitAbort(ctx.timer, V2_WORKSPACE_TIMEOUT_MS);
      const aborted = () => waitAbort.timedOut();
      try {
        let rootTarget;
        try { rootTarget = await waitAbort.race(fsSvc.resolve(root)); } catch (e) { return []; }
        if (waitAbort.timedOut()) return [];
        const files = [];
        const walk = async (target, rel, level) => {
          if (aborted() || files.length >= SCAN_FILE_LIST_MAX || level > maxDepth) return;
          let entries;
          try { entries = await waitAbort.race(fsSvc.listDir(target)); } catch (e) { return; }
          if (waitAbort.timedOut()) return;
          for (const en of entries || []) {
            if (aborted()) return;
            const name = en && en.name;
            if (!name) continue;
            if (en.type === 'directory') {
              if (V2_WORKSPACE_IGNORE_DIRS.has(name)) continue;
              const sub = en.target;
              if (sub) await walk(sub, rel ? rel + '/' + name : name, level + 1);
              continue;
            }
            const p = rel ? rel + '/' + name : name;
            if (extRe.test(name) && !shouldIgnoreFile(p)) files.push(p);
          }
        };
        await walk(rootTarget, '', 1);
        const kws = (keywords || []).filter((k) => typeof k === 'string' && k.length >= 2);
        // 关键词为空（短文本提不出词）→ 不排序直接取前 maxFiles；
        // 关键词非空但名称 0 命中 → 内容兜底扫描（中文关键词 vs 英文文件名的老问题，
        // 与 v2SearchWorkspace content-fallback 同策略）
        let ranked = kws.length > 0 ? rankFiles(files, kws, 10).map((c) => c.path) : files.slice(0, maxFiles);
        if (ranked.length === 0 && kws.length > 0) {
          const scored = [];
          // 中文组合词分段匹配（「登录功能」→「登录」/「功能」），避免 4 字组合词 vs 内容子串失配
          const kwSegs = [];
          for (const k of kws) {
            const kl = String(k).toLowerCase();
            kwSegs.push(kl);
            for (const sg of splitCnSegments(kl)) {
              if (sg.length >= 2 && !kwSegs.includes(sg)) kwSegs.push(sg);
            }
            // 2 字前缀兜底（组合词切不开时，如「登录功能」→「登录」）
            if (kl.length >= 2 && !kwSegs.includes(kl.slice(0, 2))) kwSegs.push(kl.slice(0, 2));
          }
          for (const rel of files.slice(0, 8)) {
            if (aborted()) break;
            try {
              const tgt = await waitAbort.race(fsSvc.resolve(rel, { cwd: root }));
              if (waitAbort.timedOut()) break;
              const text = await waitAbort.race(fsSvc.readText(tgt));
              if (waitAbort.timedOut()) break;
              let hits = 0;
              for (const ln of text.split('\n')) {
                if (kwSegs.length > 0 && kwSegs.some((sg) => ln.toLowerCase().includes(sg))) hits++;
                if (hits >= 8) break;
              }
              if (hits > 0) scored.push({ path: rel, hits });
            } catch (e) { /* 跳过 */ }
          }
          scored.sort((a, b) => b.hits - a.hits);
          ranked = scored.slice(0, maxFiles).map((s) => s.path);
        }
        // 最终兜底：内容仍不匹配（中文关键词 vs 英文代码/文件名的语义鸿沟）→ 取前 N 个
        // （开发环境已确认或 md 文档场景下文件有限，全取参考优于空参考）
        if (ranked.length === 0) ranked = files.slice(0, maxFiles);
        // v3.0v2：项目地图指向路径优先（codePaths 前缀命中排前，不足补全量）
        if (paths && paths.length > 0 && files.length > 0) {
          const prefixed = files.filter((f) => paths.some((p) => f === p || f.startsWith(p + '/')));
          const rest = files.filter((f) => !prefixed.includes(f));
          ranked = prefixed.concat(rest).slice(0, maxFiles);
        }
        const out = [];
        for (const rel of ranked.slice(0, maxFiles)) {
          if (aborted()) break;
          try {
            const tgt = await waitAbort.race(fsSvc.resolve(rel, { cwd: root }));
            if (waitAbort.timedOut()) break;
            const text = await waitAbort.race(fsSvc.readText(tgt));
            if (waitAbort.timedOut()) break;
            out.push({ path: rel, snippet: snippetFromLines(text.split('\n'), kws, SNIPPET_BUDGET) });
          } catch (e) { /* 跳过 */ }
        }
        return out;
      } finally {
        waitAbort.dispose();
      }
    }

    // ---- v3.0v2：smart 工作区阶段（门槛：有 .md + 相关文档命中 + 项目地图结构）----
    // 返回 { block, enteredThird }——enteredThird 决定 SMART_TAIL（调整方案）是否追加。
    async function enhanceSmartWorkspace(state, text, chain0, rbudget) {
      // v3.1.8（用户需求·预算真正生效）：smart 工作区规模随预算伸缩（BUDGET_RETRIEVE_TABLE）——
      // 文档扫描数/深度、文档与代码内容上限随档位递增；预算 0 由调用方跳过（不进入本函数）。
      const kws = extractKeywords(text, []);
      const docs = await searchWorkspaceFiles(DOC_FILE_RE, kws, rbudget.smartDocs, rbudget.smartDepth);
      if (docs.length === 0) {
        hlog('[enhance] v3 smart no-md');
        return { block: state.v2Block, enteredThird: false };
      }
      const docsText = docs.map((d) => '📄 ' + d.path + '\n' + d.snippet).join('\n\n').slice(0, rbudget.smartChars);
      // B+C 合并：一次 LLM 调用——检索相关文档 + 分析项目地图结构
      if (state.rec) setProgress(state.rec, STAGE_FILES, 'docs');
      const analysis = await analyzeDocsRelevance(docsText, text, state.v2Block || '', chain0, state);
      if (!analysis || analysis.relatedDocs.length === 0) {
        hlog('[enhance] v3 smart no-related-doc');
        return { block: state.v2Block, enteredThird: false };
      }
      const docPart = (state.v2Block ? state.v2Block + '\n\n' : '') + '【项目文档参考】\n' +
        analysis.relatedDocs.map((d) => '📄 ' + d.path + '\n' + d.excerpt).join('\n\n');
      if (!analysis.hasProjectMap) {
        hlog('[enhance] v3 smart no-project-map reason=' + analysis.reason);
        return { block: docPart, enteredThird: false };
      }
      // 第三步：代码文档检索（项目地图指向路径优先）
      hlog('[enhance] v3 smart project-map paths=' + JSON.stringify(analysis.codePaths));
      if (state.rec) setProgress(state.rec, STAGE_FILES, 'code');
      const codes = await searchWorkspaceFiles(CODE_FILE_RE, kws, 3, 3, analysis.codePaths);
      const codeText = codes.map((c) => '📄 ' + c.path + '\n' + c.snippet).join('\n\n').slice(0, rbudget.smartCodeChars);
      return { block: codeText ? docPart + '\n\n【相关代码参考】\n' + codeText : docPart, enteredThird: true };
    }

    // ---- v3.0v2：提示词开发意向判定（DEV_INTENT_PROMPT；10s 超时降级非开发意向）----
    async function judgeDevIntent(text, sessionRef, entry, state) {
      if (llm === undefined || !entry) { markDegraded(state, 'intent'); return { isDevIntent: false, reason: 'no-llm' }; }
      if (budgetExhausted(state)) { markDegraded(state, 'intent-budget'); hlog('[enhance] v3 intent skipped budget-exhausted'); return { isDevIntent: false, reason: 'budget-exhausted' }; }
      const system = DEV_INTENT_PROMPT
        .replace('{prompt}', String(text || ''))
        .replace('{session}', String(sessionRef || ''));
      let timedOut = false;
      // P0-b 修正：超时到点**真正中止**该辅助流（不再等它自然结束——见 startHelperAbort 注释）
      const abortCtl = startHelperAbort(state, RELEVANCE_TIMEOUT_MS);
      try {
        const stream = llm.stream({
          provider: entry.provider,
          model: entry.model,
          // v3.0p 审查（超时/耗时匹配）：judge 类小调用剥离 reasoningEffort——判定/规划任务无需深度思考；effort 思考会消耗小预算输出（空流风险）并放大耗时
          maxTokens: RELEVANCE_MAX_TOKENS,
          system,
          messages: [{
            id: 'enhance-intent',
            role: 'user',
            content: [{ type: 'text', text: '请依据上述规则判断。' }],
            source: { kind: 'user' },
          }],
        });
        const iterator = stream[Symbol.asyncIterator]();
        abortCtl.attach(iterator);
        const collectP = collectStream(iterator, RELEVANCE_OUTPUT_LIMIT);
        // 超时闸先结算时，collectP 可能随后才 reject —— 先挂空处理器，避免未处理拒绝
        collectP.catch(() => { /* 落败方 */ });
        const result = await abortCtl.race(collectP);
        timedOut = abortCtl.timedOut();
        // P0-e（消费点 4/6）：maxtokens 按原样透传 → 非 ok 即降级（显式声明）。
        if (!timedOut && result.kind === 'ok') {
          const parsed = parseIntent(result.text);
          if (parsed) return parsed;
        }
        markDegraded(state, timedOut ? 'intent-timeout' : (result.kind === 'maxtokens' ? 'intent-truncated' : 'intent-unparsed'));
        hlog('[enhance] v3 intent ' + (timedOut ? 'timeout' : 'unparsed'));
      } catch (e) {
        markDegraded(state, 'intent-failed');
        hlog('[enhance] v3 intent failed', e && e.message ? e.message : e);
      } finally {
        abortCtl.dispose();
      }
      return { isDevIntent: false, reason: 'judge-failed' };
    }

    // ---- v3.0v2：文档检索 + 项目地图合并分析（DOC_ANALYSIS_PROMPT 一次调用）----
    async function analyzeDocsRelevance(docsText, text, sessionRef, entry, state) {
      if (llm === undefined || !entry) { markDegraded(state, 'docs'); return null; }
      if (budgetExhausted(state)) { markDegraded(state, 'docs-budget'); hlog('[enhance] v3 doc-analysis skipped budget-exhausted'); return null; }
      const system = DOC_ANALYSIS_PROMPT
        .replace('{docs}', String(docsText || ''))
        .replace('{prompt}', String(text || ''))
        .replace('{session}', String(sessionRef || ''));
      let timedOut = false;
      // P0-b 修正：超时到点**真正中止**该辅助流（不再等它自然结束——见 startHelperAbort 注释）
      const abortCtl = startHelperAbort(state, RELEVANCE_TIMEOUT_MS);
      try {
        const stream = llm.stream({
          provider: entry.provider,
          model: entry.model,
          // v3.0p 审查（超时/耗时匹配）：judge 类小调用剥离 reasoningEffort——判定/规划任务无需深度思考；effort 思考会消耗小预算输出（空流风险）并放大耗时
          maxTokens: RELEVANCE_MAX_TOKENS,
          system,
          messages: [{
            id: 'enhance-docanalysis',
            role: 'user',
            content: [{ type: 'text', text: '请依据上述规则分析。' }],
            source: { kind: 'user' },
          }],
        });
        const iterator = stream[Symbol.asyncIterator]();
        abortCtl.attach(iterator);
        const collectP = collectStream(iterator, RELEVANCE_OUTPUT_LIMIT);
        // 超时闸先结算时，collectP 可能随后才 reject —— 先挂空处理器，避免未处理拒绝
        collectP.catch(() => { /* 落败方 */ });
        const result = await abortCtl.race(collectP);
        timedOut = abortCtl.timedOut();
        // P0-e（消费点 5/6）：maxtokens 按原样透传 → 非 ok 即降级（显式声明）。
        if (!timedOut && result.kind === 'ok') {
          const parsed = parseDocsAnalysis(result.text);
          if (parsed) return parsed;
        }
        markDegraded(state, timedOut ? 'docs-timeout' : (result.kind === 'maxtokens' ? 'docs-truncated' : 'docs-unparsed'));
        hlog('[enhance] v3 doc-analysis ' + (timedOut ? 'timeout' : 'unparsed'));
      } catch (e) {
        markDegraded(state, 'docs-failed');
        hlog('[enhance] v3 doc-analysis failed', e && e.message ? e.message : e);
      } finally {
        abortCtl.dispose();
      }
      return null;
    }
    // ---- stage: retrieve——v3.0 检索策略分发（rounds 窗口判定 / v2 旧管道 / none）----
    async function enhanceStageRetrieve(state) {
      const cfg = state.cfg;
      const text = state.text;
      const sessionId = state.sessionId;
      const rec = state.rec;
      const row = SKILL_MANIFEST[cfg.mode].retrieve || SKILL_MANIFEST[DEFAULT_MODE].retrieve; // v3.2.23 retrieve 声明化（prompts/*/PACKAGE.md）
      state.v2Block = '';
      state.v2Log = 'none';
      if (state.isContinuation) {
        state.v2Log = 'continuation-skip';
        return state;
      }
      if (row.kind === 'rounds' && row.windows.length > 0) {
        // v3.1.8（用户需求·预算真正生效）：rounds 模式消费上下文预算——budget 0 = 跳过检索
        // （不注入参考，等价 base 直发）；budget > 0 时注入上限随档位伸缩（BUDGET_RETRIEVE_TABLE）。
        const rbudget = resolveRetrieveBudget(cfg.mode, cfg.context && cfg.context.budgetChars ? cfg.context.budgetChars : 0);
        if (rbudget.roundsChars > 0) {
          // v3.0：会话轮次窗口关联检索——逐窗口 LLM 判定，命中即停并注入参考；
          // 窗口越界（历史不足）跳过；全不中 → 无参考（不阻断主流程）。
          // 2026-08-18（用户需求·步骤补充）：rounds 模式补「读取会话」进度（与 publish 一致）
          if (state.rec) setProgress(state.rec, STAGE_HISTORY);
          const events = await fetchSessionHistory(sessionId, state);
          const chain0 = state.chain && state.chain.length > 0 ? state.chain[0] : null;
          for (let wi = 0; wi < row.windows.length; wi++) {
            const win = row.windows[wi];
            if (rec.cancelled || rec.timedOut) break;
            const winText = splitHistoryRounds(events, win[0], win[1]).join('\n');
            if (winText === '') {
              hlog('[enhance] v3 window empty rounds=' + win[0] + '-' + win[1]);
              continue;
            }
            setProgress(rec, STAGE_ANALYZE, 'judge', null, wi + 1, row.windows.length);
            const judge = await judgeRelevance(winText, text, chain0, state);
            if (judge.related) {
              state.v2Block = '【相关会话参考（仅吸收明确需求，禁止复述）】\n' + winText.slice(0, rbudget.roundsChars);
              state.v2Log = 'rounds=' + win[0] + '-' + win[1] + ' chars=' + winText.length + ' inject=' + Math.min(winText.length, rbudget.roundsChars) + ' reason=' + judge.reason;
              hlog('[enhance] v3 window hit rounds=' + win[0] + '-' + win[1] + ' reason=' + judge.reason);
              break;
            }
            hlog('[enhance] v3 window miss rounds=' + win[0] + '-' + win[1] + ' reason=' + judge.reason);
          }
          // v3.0v2：smart——窗口判定后先判开发意向（非开发意向直接停，不进工作区）；
          // 开发意向 → 工作区阶段（.md + 相关文档命中 + 项目地图三门槛），
          // 仅进入第三步（代码阶段）才追加 SMART_TAIL（调整方案输出）
          if (SKILL_MANIFEST[cfg.mode].sources.indexOf('workspace') !== -1) {
            setProgress(rec, STAGE_ANALYZE, 'intent');
            const intent = await judgeDevIntent(text, state.v2Block || '', chain0, state);
            if (!intent.isDevIntent) {
              hlog('[enhance] v3 smart not-dev-intent reason=' + intent.reason);
            } else {
              hlog('[enhance] v3 smart dev-intent reason=' + intent.reason);
              const ws = await enhanceSmartWorkspace(state, text, chain0, rbudget);
              state.v2Block = ws.block;
              if (ws.enteredThird) {
                state.system = state.system + '\n\n' + SMART_TAIL_PROMPT;
                hlog('[enhance] v3 smart tail injected');
              }
            }
          }
        } else {
          // 预算 0：rounds 检索跳过（不注入参考；smart 工作区同样不进入）
          state.v2Log = 'rounds-skip budget=0';
        }
      } else if (row.kind === 'v2') {
        // publish：v2 旧管道 + v3.0p 多步网络检索（LLM 规划主题 → 逐主题搜索 → 跨轮记忆回注）
        const memoRec = publishWebMemo.get(sessionId);
        const memoText = memoRec && memoRec.memo ? memoRec.memo : '';
        const memoTopics = memoRec && Array.isArray(memoRec.topics) ? memoRec.topics : [];
        const chain0 = state.chain && state.chain.length > 0 ? state.chain[0] : null;
        const budget = cfg.context && cfg.context.budgetChars ? cfg.context.budgetChars : 0;
        // v3.0p：预算 > 0 才启用检索（与「上下文预算需 > 0 才启用检索」联动语义一致）
        setProgress(rec, STAGE_FILES, 'plan');
        // P0-b：预算耗尽 → 直接跳过规划（planWebSearch 内部亦自检，双保险）
        const plan = (budget > 0 && !budgetExhausted(state)) ? await planWebSearch(text, memoText, state.scenario, chain0, state) : (budget > 0 ? (markDegraded(state, 'webplan-budget'), null) : null);
        hlog('[enhance] v3p web-plan ' + (budget <= 0 ? 'skipped budget=0' : (plan ? 'topics=' + plan.topics.map((t) => t.query).join('|') : 'none→legacy')));
        // v3.0p：规划主题与已检索主题去重（LLM 未遵从提示词时的硬过滤；过滤后为空 → 降级单 query）
        const freshPlan = plan && budget > 0 ? plan.topics.filter((t) => memoTopics.indexOf(String(t && t.query || '').trim()) === -1) : null;
        const v2 = await buildV2ContextBlock({
          llm: ctx.get('llm'),
          sessionQuery: ctx.get('sessionQuery'),
          sandboxPolicy: ctx.get('sandboxPolicy'),
          fs: ctx.get('fs'),
          timer: ctx.timer,
          chain: state.chain,
          web: ctx.get('web'),
          delta: state.memDelta,
          scenario: state.scenario,
          webPlan: freshPlan && freshPlan.length > 0 ? freshPlan : null,
          webMemo: memoText,
          // P0-b（2026-10-12）：publish 的 v2 旧管道（阶段 A 任务分析 15s / 阶段 B 2s /
          // 网络检索 10s）同属准备阶段——把主预算截止时刻交给它，内部各调用据此钳到剩余预算。
          budgetDeadline: state.budgetDeadline,
          budgetMs: state.budgetMs,
          // P0-d（2026-10-12 · 独立复核 medium）：v2 管道内的辅助调用降级回传
          // （第 5 个辅助点 v2ResolveProgress 经此暴露，不再只写 hlog）
          onDegrade: (kind) => { markDegraded(state, kind); },
        }, sessionId, text, cfg, (st, detail) => {
          rec.stage = st;
          if (detail && typeof detail === 'object') {
            rec.detailKey = detail.key || '';
            rec.detailArgs = detail.args || null;
            rec.step = detail.step || 0;
            rec.total = detail.total || 0;
          } else {
            rec.detailKey = '';
            rec.detailArgs = null;
            rec.step = 0;
            rec.total = 0;
          }
        });
        state.v2Block = v2.block;
        state.v2Log = v2.log;
        // v3.0p：跨轮检索记忆更新——仅成功命中的主题入已检索列表（失败/超时不占位），
        // 主题去重（≤WEB_MEMO_TOPICS_MAX）+ 要点摘要累积（≤WEB_MEMO_MAX，保留最新）
        const hitTopics = Array.isArray(v2.webTopics) ? v2.webTopics.filter((t) => t && t.hits > 0) : [];
        if (hitTopics.length > 0) {
          const merged = memoTopics.concat(hitTopics.map((t) => t.query)).filter((q, i, a) => q && a.indexOf(q) === i).slice(-WEB_MEMO_TOPICS_MAX);
          const memo = (memoText ? memoText + '\n' : '') + (v2.webMemoText || '');
          publishWebMemo.set(sessionId, { topics: merged, memo: memo.slice(-WEB_MEMO_MAX) });
          hlog('[enhance] v3p memo topics=' + merged.length + ' chars=' + memo.slice(-WEB_MEMO_MAX).length);
        }
      }
      // v3.2.24（规则落点 L2）：参考使用规则改为条件注入——参考块/记忆命中才追加（v3.2.20 并入 discipline 无条件，
      // 现拆为独立 REFERENCE_GUIDE 提示词文件按需加载，无参考场景省 tokens）；L0 纪律保持精简。
      if (state.v2Block !== '' || state.memoryActive) state.system = state.system + '\n\n' + REFERENCE_GUIDE;
      return state;
    }

  return { enhanceStageRetrieve };
}

module.exports = { createRetrieveStage };
