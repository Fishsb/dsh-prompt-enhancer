'use strict';

// Publish/V2 上下文运行时（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 职责：可中断等待、任务进度解析、工作区/会话检索、网络补充与上下文块组装。
// 服务、计时器、提示词、模式表和纯函数全部由调用方注入。

function createContextRuntime(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};
  const collectStream = d.collectStream;
  const buildContextBlock = d.buildContextBlock;
  const buildWebQuery = d.buildWebQuery;
  const extractHistory = d.extractHistory;
  const extractHistoryConclusions = d.extractHistoryConclusions;
  const extractKeywords = d.extractKeywords;
  const inferFocusRules = d.inferFocusRules;
  const parseTaskProgress = d.parseTaskProgress;
  const rankFiles = d.rankFiles;
  const resolveScanLimit = d.resolveScanLimit;
  const shouldIgnoreFile = d.shouldIgnoreFile;
  const snippetFromLines = d.snippetFromLines;
  const MODE_TABLE = d.modeTable;
  const DEFAULT_MODE = d.defaultMode;
  const STAGE_HISTORY = d.stageHistory;
  const STAGE_ANALYZE = d.stageAnalyze;
  const STAGE_FILES = d.stageFiles;
  const STAGE_EVENTS = d.stageEvents;
  const STAGE_CONTEXT = d.stageContext;
  const V2_HISTORY_LIMIT = d.v2HistoryLimit;
  const V2_HISTORY_MAX_CHARS = d.v2HistoryMaxChars;
  const V2_MSG_SEQ_SCAN = d.v2MsgSeqScan;
  const V2_PROGRESS_MAX_TOKENS = d.v2ProgressMaxTokens;
  const V2_PROGRESS_OUTPUT_LIMIT = d.v2ProgressOutputLimit;
  const V2_PROGRESS_TIMEOUT_MS = d.v2ProgressTimeoutMs;
  const V2_SEARCH_EVENTS_TIMEOUT_MS = d.v2SearchEventsTimeoutMs;
  const V2_WORKSPACE_IGNORE_DIRS = d.v2WorkspaceIgnoreDirs;
  const V2_WORKSPACE_TIMEOUT_MS = d.v2WorkspaceTimeoutMs;
  const SCAN_FILE_LIST_MAX = d.scanFileListMax;
  const SNIPPET_BUDGET = d.snippetBudget;
  const WEB_MEMO_MAX = d.webMemoMax;
  const WEB_REF_MAX = d.webRefMax;
  const WEB_SEARCH_MAX_RESULTS = d.webSearchMaxResults;
  const WEB_SEARCH_TIMEOUT_MS = d.webSearchTimeoutMs;
  const CONTENT_FALLBACK_SCAN = d.contentFallbackScan;
  const TASK_ANALYSIS_PROMPT = d.taskAnalysisPrompt;

function startWaitAbort(timerSvc, ms) {
  let fired = false;
  let settled = false;
  let fireTimer = null;
  let settle = null;
  const work = [];
  const gate = new Promise((resolve) => { settle = resolve; });
  const fire = () => {
    if (settled) return;
    fired = true;
    settled = true;
    try { settle({ timedOut: true }); } catch (e) { /* 忽略 */ }
    // 到点后底层迟到 settle：吞掉，防 unhandledRejection
    for (const p of work) {
      if (p && typeof p.then === 'function') { try { p.then(noop, noop); } catch (e) { /* 忽略 */ } }
    }
  };
  const noop = () => {};
  const n = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (n > 0 && timerSvc && typeof timerSvc.timeout === 'function') {
    fireTimer = timerSvc.timeout(fire, n);
  } else {
    fire();  // 预算已耗尽 / 无 timer 服务 → 立即超时（调用方直接走降级）
  }
  return {
    timedOut: () => fired,
    // 把底层 promise 纳入「迟到吞掉」集合后 race；早于闸门 settle 则返回其真值。
    race: (p) => {
      if (p && typeof p.then === 'function') {
        work.push(p);
        if (fired) { try { p.then(noop, noop); } catch (e) { /* 忽略 */ } }
      }
      return Promise.race([p, gate]);
    },
    dispose: () => {
      try { if (fireTimer) fireTimer(); } catch (e) { /* 忽略 */ }
      settled = true;
    },
  };
}

// 阶段 A：任务进度理解（表驱动 phaseA：none 跳过 / rule 正则 / llm 智能（失败降级 rule）/ memory 读记忆对）
// 返回值：{ progress, mode }；mode: 'smart'|'rule'|'memory'|'none'
async function v2ResolveProgress(services, historyText, cfg) {
  // P0-d（2026-10-12 · 独立复核 medium）：本函数是 5 处辅助 LLM 调用之一，原先失败**只写 hlog**
  // （用户侧零痕迹），且不接 state/rec。现经 services.onDegrade 回调把降级回传到 enhance handler。
  const degrade = (kind) => {
    if (services && typeof services.onDegrade === 'function') {
      try { services.onDegrade('v2progress-' + kind); } catch (e) { /* 忽略 */ }
    }
  };
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  if (row.phaseA === 'llm' && services.llm && services.chain && services.chain.length > 0 && historyText.trim() !== '') {
    const entry = services.chain[0];
    let timedOut = false;
    // P0-b（2026-10-12 · 辅助调用并入同一预算）：自身 15s 超时钳到剩余主预算内
    // （services.budgetDeadline 由 enhance handler 传入；未设预算 → Infinity，行为不变）。
    const remainMs = (typeof services.budgetDeadline === 'number')
      ? Math.max(0, services.budgetDeadline - Date.now())
      : Infinity;
    const progressTimeoutMs = remainMs === Infinity ? V2_PROGRESS_TIMEOUT_MS : Math.max(0, Math.min(V2_PROGRESS_TIMEOUT_MS, remainMs));
    // P0-b 修正（2026-10-12 · 独立复核 blocker）：超时到点须**真正中止**该辅助流，
    // 否则慢但健康的辅助会跑过自己的钳后超时、侵蚀生成额度（见 enhance-handlers.js startHelperAbort 注释）。
    let abortIterator = null;
    let settleTimeout = null;
    const timeoutGate = new Promise((resolve) => { settleTimeout = resolve; });
    const fireAbort = () => {
      timedOut = true;
      if (abortIterator && typeof abortIterator.return === 'function') {
        try { abortIterator.return(); } catch (e) { /* 忽略 */ }
      }
      try { settleTimeout({ kind: 'aborted', aborted: true }); } catch (e) { /* 忽略 */ }
    };
    const timer = progressTimeoutMs > 0
      ? services.timer.timeout(fireAbort, progressTimeoutMs)
      : (fireAbort(), () => {});
    try {
      const stream = services.llm.stream({
        provider: entry.provider,
        model: entry.model,
        // v3.0p 审查（超时/耗时匹配）：阶段 A 任务分析剥离 reasoningEffort（同 judge 策略）
        maxTokens: V2_PROGRESS_MAX_TOKENS,
        system: TASK_ANALYSIS_PROMPT,
        messages: [{
          id: 'enhance-task-progress',
          role: 'user',
          content: [{ type: 'text', text: historyText.slice(0, V2_HISTORY_MAX_CHARS) }],
          source: { kind: 'user' },
        }],
      });
      const iterator = stream[Symbol.asyncIterator]();
      abortIterator = iterator;
      if (timedOut) fireAbort();
      const collectP = collectStream(iterator, V2_PROGRESS_OUTPUT_LIMIT);
      collectP.catch(() => { /* 超时闸先结算时 collectP 可能随后 reject */ });
      const result = await Promise.race([collectP, timeoutGate]);
      // P0-e（消费点 1/6）：max-tokens 现返回可区分 kind 'maxtokens'；阶段 A 任务分析
      // **按原样透传**（非 ok 一律走降级日志/规则兜底）——显式声明，不静默沿用旧兜底。
      if (!timedOut && result.kind === 'ok') {
        const parsed = parseTaskProgress(result.text);
        if (parsed) {
          hlog('[enhance] v2 smart progress ok');
          return { progress: parsed, mode: 'smart' };
        }
        degrade('bad-json');
        hlog('[enhance] v2 smart progress bad-json');
      } else {
        // 独立复审 low（2026-10-12）：finish.kind==='error'（如 SERVER/QUOTA）此前落进 'empty'，
        // 诊断标签失准会误导排查方向——按真实 kind 分流，并带上 failure code。
        const why = timedOut ? 'timeout'
          : (result.kind === 'maxtokens' ? 'truncated'
          : (result.kind === 'error' ? ('error-' + String((result.failure && result.failure.code) || 'unknown'))
          : (result.kind === 'aborted' || result.kind === 'cancelled' ? String(result.kind) : 'empty')));
        degrade(why);
        hlog('[enhance] v2 smart progress ' + why);
      }
    } catch (e) {
      degrade('failed');
      hlog('[enhance] v2 smart progress failed', e && e.message ? e.message : e);
    } finally {
      try { timer(); } catch (e) { /* 忽略 */ }
      if (abortIterator && typeof abortIterator.return === 'function') {
        try { abortIterator.return(); } catch (e) { /* 忽略 */ }
      }
    }
  }
  // rule 规则提取（零成本；无历史时返回空 focus）——phaseA: rule / llm 降级 / memory 无记忆时兜底
  const focus = inferFocusRules(historyText);
  if (focus.length > 0) return { progress: { focus }, mode: 'rule' };
  return { progress: null, mode: 'rule' };
}

// 阶段 B：工作区文件检索（fs 扫描 + 名称/内容命中 → Top-3 摘要；2s 超时降级）
// v2.0.7：fs 契约修正——listDir/readText 接收 FsTarget（resolve 产出），条目 shape 为
// {name, type:'file'|'directory', target}；不再传字符串路径。
async function v2SearchWorkspace(services, keywords, cfg) {
  const fsSvc = services.fs;
  const root = services.sandboxPolicy && services.sandboxPolicy.workspaceRoot;
  if (!fsSvc || !root || typeof fsSvc.listDir !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.resolve !== 'function') return [];
  // 表驱动：phaseB 非 file+event 跳过；扫描上限按 scanLimit（by-budget 查联动表 / fixed 固定）
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  if (row.phaseB !== 'file+event') return [];
  const lim = resolveScanLimit(cfg.mode, cfg.context.budgetChars);
  const depth = lim.depth;
  const maxFiles = lim.maxFiles;
  // P0-b 修正（第三轮）：标志位 → race+dispose（超时即不再等；到点后迟到 settle 被吞）
  const waitAbort = startWaitAbort(services.timer, V2_WORKSPACE_TIMEOUT_MS);
  const abortedFn = () => waitAbort.timedOut();
  try {
    let rootTarget;
    try {
      const rootRes = await waitAbort.race(fsSvc.resolve(root));
      if (waitAbort.timedOut()) { hlog('[enhance] v2 workspace resolve-root timeout'); return []; }
      rootTarget = rootRes;
    } catch (e) {
      hlog('[enhance] v2 workspace resolve-root failed', e && e.message ? e.message : e);
      return [];
    }
    const files = [];
    const walk = async (target, rel, level) => {
      if (abortedFn() || files.length >= SCAN_FILE_LIST_MAX || level > depth) return;
      let entries;
      try {
        // P0-b 修正（第三轮）：目录列举纳入同一 race（超时即不再等待该目录）
        entries = await waitAbort.race(fsSvc.listDir(target));
        if (waitAbort.timedOut()) return;
      } catch (e) { return; }
      for (const en of entries || []) {
        if (abortedFn()) return;
        const name = en && en.name;
        if (!name) continue;
        if (V2_WORKSPACE_IGNORE_DIRS.has(name)) continue;
        const relPath = rel ? rel + '/' + name : name;
        if (en.type === 'directory') {
          await walk(en.target, relPath, level + 1);
        } else if (en.type === 'file') {
          files.push(relPath);
        }
      }
    };
    await walk(rootTarget, '', 1);
    if (abortedFn()) { hlog('[enhance] v2 workspace scan timeout'); return []; }
    hlog('[enhance] v2 workspace scanned files=' + files.length);
    // 名称匹配 → 候选；v2.7.0：名称 0 命中时内容兜底（中文场景名称匹配几乎必然落空——
    // 中文关键词 vs 英文文件名；降级取前 N 个文本文件按内容关键词命中，救活
    // 「文件内容相关但文件名无关」场景；读取受 V2_WORKSPACE_TIMEOUT_MS 总超时保护）
    const candidates = rankFiles(files, keywords, 10).map((c) => c.path);
    if (candidates.length === 0) {
      const textRe = /\.(?:md|txt|py|ts|js|tsx|jsx|json|yaml|yml|toml|css|html|go|rs|java|cpp|c|h|sh|sql|vue)$/i;
      // 文档类（md/txt）优先——描述性内容最可能命中主题词
      const docFirst = files.slice().sort((a, b) => {
        const da = /\.(?:md|txt)$/i.test(a) ? 0 : 1;
        const db = /\.(?:md|txt)$/i.test(b) ? 0 : 1;
        return da - db;
      });
      const kws = (keywords || []).filter((k) => typeof k === 'string' && k.length >= 2);
      const contentScored = [];
      let scanned = 0;
      for (const rel of docFirst) {
        if (abortedFn() || scanned >= CONTENT_FALLBACK_SCAN) break;
        if (!textRe.test(rel) || shouldIgnoreFile(rel)) continue;
        scanned++;
        let text = '';
        try {
          // P0-b 修正（第三轮）：内容兜底读取纳入同一 race（超时即中止本轮扫描）
          const tgtRes = await waitAbort.race(fsSvc.resolve(rel, { cwd: root }));
          if (waitAbort.timedOut()) break;
          text = await waitAbort.race(fsSvc.readText(tgtRes));
          if (waitAbort.timedOut()) break;
        } catch (e) { continue; } // 只读权限/读取失败 → 跳过该文件
        const lines = text.split('\n');
        let contentHits = 0;
        for (const ln of lines) {
          if (kws.some((k) => ln.toLowerCase().includes(k.toLowerCase()))) contentHits++;
          if (contentHits >= 8) break;
        }
        if (contentHits > 0) contentScored.push({ path: rel, lines, contentHits });
      }
      hlog('[enhance] v2 workspace content-fallback scanned=' + scanned + ' hits=' + contentScored.length + ' kws=' + JSON.stringify(keywords));
      if (contentScored.length === 0) {
        hlog('[enhance] v2 workspace no-name-match files=' + files.length + ' kws=' + JSON.stringify(keywords));
        return [];
      }
      contentScored.sort((a, b) => b.contentHits - a.contentHits);
      const top = contentScored.slice(0, maxFiles);
      return top.map((f) => ({ path: f.path, snippet: snippetFromLines(f.lines, keywords, SNIPPET_BUDGET) }));
    }
    // 内容命中加分 → 排序 Top-maxFiles
    const scored = [];
    for (const rel of candidates) {
      if (abortedFn()) break;
      if (shouldIgnoreFile(rel)) continue;
      let text = '';
      try {
        // P0-b 修正（第三轮）：候选文件读取纳入同一 race
        const tgtRes = await waitAbort.race(fsSvc.resolve(rel, { cwd: root }));
        if (waitAbort.timedOut()) break;
        text = await waitAbort.race(fsSvc.readText(tgtRes));
        if (waitAbort.timedOut()) break;
      } catch (e) { continue; } // 只读权限/读取失败 → 跳过该文件
      const lines = text.split('\n');
      let contentHits = 0;
      const kws = (keywords || []).filter((k) => typeof k === 'string' && k.length >= 2);
      for (const ln of lines) {
        if (kws.some((k) => ln.toLowerCase().includes(k.toLowerCase()))) contentHits++;
        if (contentHits >= 8) break;
      }
      if (contentHits > 0) scored.push({ path: rel, lines, contentHits });
    }
    if (scored.length === 0) {
      hlog('[enhance] v2 workspace no-content-match candidates=' + candidates.length + ' kws=' + JSON.stringify(keywords));
      return [];
    }
    scored.sort((a, b) => b.contentHits - a.contentHits);
    const top = scored.slice(0, maxFiles);
    return top.map((f) => ({ path: f.path, snippet: snippetFromLines(f.lines, keywords, SNIPPET_BUDGET) }));
  } finally {
    waitAbort.dispose();
  }
}

// 阶段 B3：会话事件检索（增强；searchEvents 契约：{sessionId,query,limit} → {items:[{snippet}]}；失败跳过）
async function v2SearchEvents(services, sessionId, keywords, cfg) {
  const sq = services.sessionQuery;
  const kws = (keywords || []).filter((k) => typeof k === 'string' && k.trim() !== '');
  // 表驱动：phaseB 非 file+event 跳过
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  if (row.phaseB !== 'file+event') return [];
  if (!sq || typeof sq.searchEvents !== 'function' || kws.length === 0) {
    hlog('[enhance] v2 searchEvents skipped kws=' + kws.length);
    return [];
  }
  // v3.0p 审查（超时/耗时匹配）：searchEvents 补超时保护（10s，超时/失败 → [] 不阻断）
  // P0-b 修正（第三轮）：标志位 → race+dispose（超时即不再等；到点后迟到 settle 被吞）
  const waitAbort = startWaitAbort(services.timer, V2_SEARCH_EVENTS_TIMEOUT_MS);
  try {
    const page = await waitAbort.race(sq.searchEvents({ sessionId, query: kws.join(' '), limit: 3 }));
    if (waitAbort.timedOut()) { hlog('[enhance] v2 searchEvents timeout'); return []; }
    const hits = page && Array.isArray(page.items) ? page.items : [];
    hlog('[enhance] v2 searchEvents kws=' + JSON.stringify(kws) + ' hits=' + hits.length);
    if (hits.length === 0) return [];
    return hits.slice(0, 3).map((h) => {
      const txt = h && (typeof h.snippet === 'string' ? h.snippet : (typeof h.text === 'string' ? h.text : ''));
      return txt ? txt.slice(0, 300) : '';
    }).filter(Boolean);
  } catch (e) {
    hlog('[enhance] v2 searchEvents failed', e && e.message ? e.message : e);
    return []; // 服务缺失/请求形状不符/失败 → 跳过事件段
  } finally {
    waitAbort.dispose();
  }
}

// 阶段 A/B/C 汇总：返回 { block, log }（全部不可用 → { block: '', log: 'none' }）
// v2.2（§6.5）：4 模式管道（base/lite 空块 / standard/smart 检索）。
// v2.6.1（记忆链）：记忆不再作为文本块叠加（改由 enhance 入口以真多轮消息注入，
// 见 buildChatMessages），模式块独享预算；log 仅含模式块口径（记忆见入口 memory 日志）。
// v2.3（§7.3）：onStage 回调（由 enhance handler 注入，写 pending 记录的 stage 字段；
// 纯函数本体不接触模块状态，回调缺省为 no-op 保持 PURE 区段可切片）。
async function buildV2ContextBlock(services, sessionId, text, cfg, onStage) {
  const mark = typeof onStage === 'function' ? onStage : () => {};
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  const budget = cfg.context.budgetChars || 0;
  // ===== 模式管道（base/lite：phaseB='none' 无检索 → 空模式块）=====
  let modeBlock = '';
  let modeLog = 'none';
  // v3.0p（publish 多步检索）：web 段结果透出（跨轮记忆用；无检索时为空）
  let webTopics = [];
  let webMemoText = '';
  if (row.phaseC === 'inject') {
    // 历史 + 阶段A + 阶段B
    let events = [];
    let historyText = '';
    const sq = services.sessionQuery;
    if (sq && typeof sq.listEvents === 'function' && typeof sq.filterEvents === 'function') {
      // P0-b 修正（2026-10-12 · 第三轮）：publish 路径的历史读取同样统一到 race+dispose
      // （此前与 fetchSessionHistory 同形：只置标志位、await 会一直等到调用返回）。
      const waitHist = startWaitAbort(services.timer, V2_SEARCH_EVENTS_TIMEOUT_MS);
      try {
        mark(STAGE_HISTORY);
        // v3.1.3（用户需求·仅结论参考）：同 v3 路径——readSurface 块级结论提取，旧路径兜底
        if (typeof sq.readSurface === 'function') {
          const surface = await waitHist.race(sq.readSurface(sessionId));
          if (waitHist.timedOut()) { hlog('[enhance] v2 history timeout'); }
          if (!waitHist.timedOut()) events = extractHistoryConclusions(surface && surface.events);
        } else {
          const records = await waitHist.race(sq.listEvents(sessionId));
          if (waitHist.timedOut()) { hlog('[enhance] v2 history timeout'); }
          // 尾部反向找最近的消息事件 seq（listEvents 升序，无文本；seq 用于 filterEvents 范围过滤）
          const msgSeqs = [];
          for (let i = (waitHist.timedOut() ? 0 : records.length - 1); i >= 0 && msgSeqs.length < V2_MSG_SEQ_SCAN; i--) {
            const r = records[i];
            const t = String(r && r.type || '');
            if (t === 'user/message' || t === 'assistant/message') msgSeqs.push(r && r.seq);
          }
          if (msgSeqs.length > 0) {
            const minSeq = msgSeqs[msgSeqs.length - 1];
            const docs = await waitHist.race(sq.filterEvents(sessionId, [{ kind: 'seq', from: minSeq }]));
            if (!waitHist.timedOut()) events = extractHistory(docs, V2_HISTORY_LIMIT);
          }
        }
        historyText = events.map((e) => (e.type === 'user' ? '[用户] ' : '[助手] ') + e.text).join('\n');
        hlog('[enhance] v2 history events=' + events.length + ' chars=' + historyText.length + (typeof sq.readSurface === 'function' ? ' conclusion-only' : ''));
      } catch (e) {
        hlog('[enhance] v2 history failed', e && e.message ? e.message : e);
      } finally {
        waitHist.dispose();
      }
    } else {
      hlog('[enhance] v2 sessionQuery unavailable');
    }
    const root = services.sandboxPolicy && services.sandboxPolicy.workspaceRoot;
    hlog('[enhance] v2 workspaceRoot=' + (root || '(none)') + ' fs=' + (services.fs ? 'yes' : 'no'));
    // 阶段 A（表驱动 phaseA：llm 智能 / rule 正则 / none 跳过）
    mark(STAGE_ANALYZE);
    const { progress, mode } = await v2ResolveProgress(services, historyText, cfg);
    // 阶段 B（表驱动 phaseB：file+event 全量 / none 跳过）
    const focus = progress && Array.isArray(progress.focus) ? progress.focus : [];
    const keywords = extractKeywords(text, focus);
    mark(STAGE_FILES, { key: 'scan' });
    const files = await v2SearchWorkspace(services, keywords, cfg);
    mark(STAGE_EVENTS);
    const eventsHits = await v2SearchEvents(services, sessionId, keywords, cfg);
    // 阶段 C（inject）：模式块独享预算（记忆链不占文本块）
    modeBlock = buildContextBlock(progress, files, eventsHits, budget);
    // v2.7.0（一键发布 · 网络检索）：publish 专属——依据草稿主题词 + 记忆链 delta
    // 改动方向构造检索词，经 ctx.web 搜索同类项目结构参考，注入模式块（预算余量内）。
    // 独立超时/降级：搜索失败/服务缺失 → 跳过，不阻断规格生成。
    let webLog = 'none';
    if (cfg.mode === 'publish' && budget > 0) {
      mark(STAGE_FILES); // 复用 files 阶段标记（检索类）
      // v3.0p（publish 多步检索）：跨轮要点回注——历史【已获取网络参考】前置（预算内），
      // 让模型「记住」此前检索到的信息，只补新缺口（配合 publishWebMemo 会话级记忆）
      if (services.webMemo) {
        const memoBlock = '【已获取网络参考】\n' + String(services.webMemo).slice(0, WEB_MEMO_MAX);
        modeBlock = modeBlock ? modeBlock + '\n\n' + memoBlock : memoBlock;
      }
      // v3.0p（publish 多步检索）：LLM 规划的差异化主题逐主题搜索（services.webPlan 非空时）；
      // 无规划 / 规划失败 → 降级旧单 query 路径（buildWebQuery + 场景方向词，行为不变）
      const web = services.web;
      const planQueries = Array.isArray(services.webPlan) && services.webPlan.length > 0
        ? services.webPlan.map((t) => String(t && t.query || '').trim()).filter((q) => q !== '').slice(0, 3)
        : [];
      const queries = planQueries.length > 0 ? planQueries : [null];
      const topicLogs = [];
      if (web && typeof web.search === 'function') {
        const refParts = [];
        const memoParts = [];
        for (let qi = 0; qi < queries.length; qi++) {
          const q = queries[qi];
          let query = q;
          if (query === null) {
            query = buildWebQuery(text, keywords, services.delta || null);
            if (services.scenario === 'game') query = (query ? query + ' 游戏实现' : '游戏实现');
            else if (services.scenario === 'software') query = (query ? query + ' 软件架构' : '软件架构');
          }
          // v3.0r（细粒度进度反馈）：逐主题搜索进度（detailKey=search，client 渲染「正在搜索 i/n：query」）
          mark(STAGE_FILES, { key: 'search', args: { query }, step: qi + 1, total: queries.length });
          // P0-b 修正（第三轮）：标志位 → race+dispose（超时即不再等该主题；迟到 settle 被吞）
          const waitAbort = startWaitAbort(services.timer, WEB_SEARCH_TIMEOUT_MS);
          try {
            const res = await waitAbort.race(web.search({ query, maxResults: WEB_SEARCH_MAX_RESULTS }));
            if (!waitAbort.timedOut() && res && Array.isArray(res.sources) && res.sources.length > 0) {
              const lines = res.sources.slice(0, WEB_SEARCH_MAX_RESULTS).map((s) => {
                const title = s && s.title ? String(s.title) : '';
                const url = s && s.url ? String(s.url) : '';
                const summary = s && s.summary ? String(s.summary).slice(0, 200) : '';
                return '- ' + title + (url ? ' (' + url + ')' : '') + (summary ? '\n  ' + summary : '');
              }).join('\n');
              refParts.push('### 检索主题：' + query + '\n' + lines);
              memoParts.push('『' + query + '』：' + res.sources.slice(0, 2).map((s) => String(s && s.title || '') + (s && s.summary ? '——' + String(s.summary).slice(0, 60) : '')).join('；'));
              topicLogs.push({ query, hits: res.sources.length });
            } else {
              topicLogs.push({ query, hits: waitAbort.timedOut() ? -2 : 0 });
            }
          } catch (e) {
            topicLogs.push({ query, hits: -1 });
          } finally {
            waitAbort.dispose();
          }
        }
        const refText = refParts.join('\n\n');
        if (refText) {
          const webBlock = '【网络参考】\n' + refText.slice(0, Math.min(WEB_REF_MAX, Math.max(0, budget - modeBlock.length)));
          if (webBlock.length > 20) {
            modeBlock = modeBlock ? modeBlock + '\n\n' + webBlock : webBlock;
            webLog = 'web=' + topicLogs.filter((t) => t.hits > 0).length + '/' + topicLogs.length + ' chars=' + webBlock.length;
          } else {
            webLog = 'web=0';
          }
        } else {
          webLog = 'web=0';
        }
        webTopics = topicLogs;
        webMemoText = memoParts.join('\n').slice(0, WEB_MEMO_MAX);
      } else {
        webLog = 'web=none';
      }
      hlog('[enhance] v2 web ' + webLog + ' queries=' + topicLogs.map((t) => t.query + ':' + t.hits).join('|').slice(0, 200));
    }    modeLog = modeBlock === '' ? 'none' : (mode + ' files=' + files.length + ' events=' + eventsHits.length + (webLog !== 'none' ? ' ' + webLog : '') + ' chars=' + modeBlock.length);
  }
  // ===== 汇总（记忆链由 enhance 入口以多轮消息注入，不占文本块）=====
  mark(STAGE_CONTEXT);
  return { block: modeBlock, log: modeBlock === '' ? 'none' : modeLog, webTopics, webMemoText };
}


  return { startWaitAbort, buildV2ContextBlock };
}

module.exports = { createContextRuntime };
