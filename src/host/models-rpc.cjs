'use strict';

const { RPC_METHODS } = require('../shared/contracts/rpc.cjs');

// 模型 RPC 面（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 保留原 models/* 注册正文与返回结构；内部 harness 仅收集处理器，由 app 装配到真实 harness。

function createModelsRpc(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const ctx = d.ctx;
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};
  const herr = typeof d.herr === 'function' ? d.herr : hlog;
  const resolveModelInfoCached = d.resolveModelInfoCached;
  const resolveAdaptiveChain = d.resolveAdaptiveChain;
  const pingStream = d.pingStream;
  const friendlyMessage = d.friendlyMessage;
  const estimateBaseModeSeconds = d.estimateBaseModeSeconds;
  const estimateLiteModeSeconds = d.estimateLiteModeSeconds;
  const extractModelRouteFromEvents = d.extractModelRouteFromEvents;
  const accumulateProjectionStats = d.accumulateProjectionStats;
  const summarizeModelStats = d.summarizeModelStats;
  const handlers = new Map();
  const harness = { handle: (name, fn) => { handlers.set(name, fn); } };

    harness.handle(RPC_METHODS.MODELS_LIST, async () => {
      const llmService = ctx.get('llm');
      if (!llmService || typeof llmService.listProviders !== 'function') {
        return { ok: false, code: 'NO_LLM', message: 'llm service unavailable' };
      }
      try {
        const providers = llmService.listProviders();
        const out = [];
        for (const p of providers) {
          let models = [];
          try {
            const list = await llmService.listModels(p.id);
            models = (list || []).map((m) => ({ id: m.id, name: m.name || m.id }));
          } catch (e) { models = []; }
          out.push({ provider: p.id, name: p.name, models });
        }
        return { ok: true, providers: out };
      } catch (e) {
        herr('[enhance] models/list failed', e);
        return { ok: false, code: 'MODELS_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle(RPC_METHODS.MODELS_RESOLVE, async (args) => {
      const provider = args && typeof args.provider === 'string' ? args.provider : '';
      const model = args && typeof args.model === 'string' ? args.model : '';
      const llmService = ctx.get('llm');
      if (!llmService || typeof llmService.resolveModelInfo !== 'function') {
        return { ok: false, code: 'NO_LLM', message: 'llm service unavailable' };
      }
      if (!provider || !model) return { ok: false, code: 'BAD_ARGS', message: 'provider and model required' };
      try {
        // v21（P1-4）：走 TTL 缓存，避免重复适配器能力查询
        // F1（配置卫生）：noCache 旁路 TTL——client effort 纠偏场景需要新鲜能力表
        const info = await resolveModelInfoCached(llmService, provider, model, !!(args && args.noCache === true));
        const reasoning = info && info.reasoning ? {
          efforts: info.reasoning.efforts.map((e) => ({
            id: String(e.id),
            name: e.name,
            ...(e.description ? { description: e.description } : {}),
          })),
          ...(info.reasoning.defaultEffort ? { defaultEffort: String(info.reasoning.defaultEffort) } : {}),
        } : undefined;
        return {
          ok: true,
          provider,
          model,
          ...(reasoning ? { reasoning } : {}),
          ...(info && info.context ? { context: info.context } : {}),
          ...(info && info.defaultMaxTokens ? { defaultMaxTokens: info.defaultMaxTokens } : {}),
        };
      } catch (e) {
        herr('[enhance] models/resolve failed', e);
        return { ok: false, code: 'RESOLVE_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle(RPC_METHODS.MODELS_CURRENT, async () => {
      const adm = ctx.get('agentDefaultModel');
      if (!adm || typeof adm.currentSelection !== 'function') {
        return { ok: false, code: 'NO_SERVICE', message: 'agentDefaultModel unavailable' };
      }
      try {
        const sel = adm.currentSelection();
        if (!sel || typeof sel.provider !== 'string' || typeof sel.model !== 'string' || !sel.provider || !sel.model) {
          return { ok: false, code: 'EMPTY', message: 'no current selection' };
        }
        return {
          ok: true,
          provider: sel.provider,
          model: sel.model,
          ...(typeof sel.reasoningEffort === 'string' && sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}),
        };
      } catch (e) {
        herr('[enhance] models/current failed', e);
        return { ok: false, code: 'CURRENT_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    // v19：暴露自适应解析出的默认兜底链（供 client 首装继承 / 恢复默认使用，不再硬编码 provider）
    harness.handle(RPC_METHODS.MODELS_AUTOCHAIN, async (args) => {
      const llmSvc = ctx.get('llm');
      const adm = ctx.get('agentDefaultModel');
      try {
        // F8（配置卫生）：noCache 旁路 TTL——「恢复默认」始终取最新自适应链
        const chain = await resolveAdaptiveChain(llmSvc, adm, !!(args && args.noCache === true));
        return { ok: true, chain };
      } catch (e) {
        herr('[enhance] models/autochain failed', e);
        return { ok: false, code: 'AUTOCHAIN_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle(RPC_METHODS.MODELS_TEST, async (args) => {
      const provider = args && typeof args.provider === 'string' ? args.provider : '';
      const model = args && typeof args.model === 'string' ? args.model : '';
      const reasoningEffort = args && typeof args.reasoningEffort === 'string' && args.reasoningEffort !== '' ? args.reasoningEffort : undefined;
      const inputChars = args && typeof args.inputChars === 'number' && Number.isFinite(args.inputChars) ? args.inputChars : 0;
      const llmService = ctx.get('llm');
      if (!llmService || typeof llmService.stream !== 'function') {
        return { ok: false, code: 'NO_LLM', message: 'llm service unavailable' };
      }
      if (!provider || !model) return { ok: false, code: 'BAD_ARGS', message: 'provider and model required' };
      const entry = { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
      // 预校验：失败不阻断（目录 advisory，端点最终裁决；结果附 precheck 供展示）
      let precheck = null;
      if (llmService.resolveCallConfig) {
        try {
          await llmService.resolveCallConfig({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}), maxTokens: 1 });
        } catch (e) {
          precheck = { code: e && e.code ? String(e.code) : 'PRECHECK_FAILED', message: String(e && e.message ? e.message : e) };
        }
      }
      const ref = { current: null };
      let timedOut = false;
      // v3.1.7（方案 2）：探测改长文（~1200 token）后，真实吞吐 75–267 tok/s 需 4–16s + TTFT；
      // 15s 超时不够，放宽到 30s（最慢档 75 tok/s × 1200 token ≈ 16s，留足余量）。
      const timer = ctx.timer.timeout(() => {
        timedOut = true;
        if (ref.current && typeof ref.current.return === 'function') {
          try { ref.current.return(); } catch (e) { /* 忽略 */ }
        }
      }, 30000);
      let r;
      try {
        r = await pingStream(llmService, entry, ref);
      } finally {
        timer();
      }
      if (timedOut) {
        hlog('[enhance] test provider=' + provider + ' model=' + model + (reasoningEffort ? ' effort=' + reasoningEffort : '') + ' → timeout');
        return { ok: false, code: 'TIMEOUT', message: friendlyMessage({ code: 'TIMEOUT' }) };
      }
      hlog('[enhance] test provider=' + provider + ' model=' + model + (reasoningEffort ? ' effort=' + reasoningEffort : '') + ' → ' + (r.ok ? 'ok ' + r.latencyMs + 'ms' : r.code));
      if (r.ok && typeof r.tokensPerSecond === 'number' && Number.isFinite(r.tokensPerSecond) && typeof r.ttftMs === 'number' && Number.isFinite(r.ttftMs)) {
        r.estimatedBaseSeconds = estimateBaseModeSeconds(r.ttftMs, r.tokensPerSecond, inputChars);
        r.estimatedLiteSeconds = estimateLiteModeSeconds(r.ttftMs, r.tokensPerSecond, inputChars);
      }
      return { ...r, ...(precheck && r.ok ? { precheck } : {}) };
    });


    // 2026-08-17（连通性测试预计耗时）：按模型名实时聚合 DSH 会话投影统计。
    // 性能约束：持久化会话全量日志读取很重，不能每次/每个会话都 readSession。
    // 策略：live 会话每次走内存（快）；persisted 会话首次最多扫描 SCAN_LIMIT 个，
    // 命中后把 model route + projection 缓存，后续调用只聚合缓存，避免卡 UI。
    // 匹配口径：只按模型名匹配（用户要求），不区分 provider 路由。
    const sessionModelCache = new Map();        // sid -> { route, at }
    const sessionProjectionCache = new Map();   // sid -> { values, at }
    const SESSION_MODEL_TTL_MS = 600000;        // persisted route 缓存 10 分钟
    const SESSION_PROJECTION_TTL_MS = 600000;   // persisted projection 缓存 10 分钟
    const MODEL_STATS_SCAN_LIMIT = 5;           // 单次调用最多新读多少个 persisted 会话（5 个足够命中同模型历史，避免冷启动超时）

    function cachedSessionModel(sid) {
      const hit = sessionModelCache.get(sid);
      if (hit && Date.now() - hit.at < SESSION_MODEL_TTL_MS) return hit.route;
      return undefined;
    }

    async function loadPersistedSession(sq, proj, sid) {
      const snap = await sq.readSession(sid);
      const route = extractModelRouteFromEvents(snap && snap.events);
      sessionModelCache.set(sid, { route, at: Date.now() });
      let projection = null;
      try {
        const sessionLike = { seq: (snap.events || []).length, events: snap.events || [] };
        const pval = proj.snapshot(sessionLike);
        projection = pval && pval.values ? pval.values : {};
        sessionProjectionCache.set(sid, { values: projection, at: Date.now() });
      } catch (e) {
        projection = null;
      }
      return { route, projection };
    }

    async function resolveModelStats(provider, model) {
      const sq = ctx.get('sessionQuery');
      const proj = ctx.get('sessionProjections');
      if (!sq || typeof sq.listSessions !== 'function' || !proj || typeof proj.snapshot !== 'function') {
        return { ok: false, code: 'NO_STATS', message: 'session stats unavailable' };
      }
      const acc = { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, sessions: 0 };
      try {
        const records = await sq.listSessions();
        let scanBudget = MODEL_STATS_SCAN_LIMIT;
        for (const rec of records) {
          const sid = rec && rec.header && rec.header.id;
          if (!sid) continue;
          let route;
          let projection;
          if (rec.live === true) {
            // live 会话：直接走内存 Session，不落持久化缓存
            const sessions = ctx.get('sessions');
            const live = sessions && typeof sessions.get === 'function' ? sessions.get(sid) : undefined;
            if (!live) continue;
            route = extractModelRouteFromEvents(live.events);
            try {
              const pval = proj.snapshot(live);
              projection = pval && pval.values ? pval.values : {};
            } catch (e) {
              projection = null;
            }
          } else {
            const cachedRoute = cachedSessionModel(sid);
            if (cachedRoute !== undefined) {
              route = cachedRoute;
              const pc = sessionProjectionCache.get(sid);
              if (pc && Date.now() - pc.at < SESSION_PROJECTION_TTL_MS) projection = pc.values;
            } else if (scanBudget > 0) {
              scanBudget -= 1;
              try {
                const loaded = await loadPersistedSession(sq, proj, sid);
                route = loaded.route;
                projection = loaded.projection;
              } catch (e) {
                route = null;
                projection = null;
              }
            }
          }
          if (!route || route.model !== model) continue;
          if (projection) {
            // 按用户要求：只按模型名匹配，不区分 provider 路由
            accumulateProjectionStats(acc, { values: projection });
          }
        }
      } catch (e) {
        herr('[enhance] models/stats failed', e);
        return { ok: false, code: 'STATS_FAILED', message: String(e && e.message ? e.message : e) };
      }
      return { ok: true, ...summarizeModelStats(acc) };
    }

    harness.handle(RPC_METHODS.MODELS_STATS, async (args) => {
      const provider = args && typeof args.provider === 'string' ? args.provider : '';
      const model = args && typeof args.model === 'string' ? args.model : '';
      const inputChars = args && typeof args.inputChars === 'number' && Number.isFinite(args.inputChars) ? args.inputChars : 0;
      if (!provider || !model) return { ok: false, code: 'BAD_ARGS', message: 'provider and model required' };
      const stats = await resolveModelStats(provider, model);
      if (!stats.ok) return stats;
      const estimatedBaseSeconds = estimateBaseModeSeconds(stats.ttftMs, stats.tokensPerSecond, inputChars);
      const estimatedLiteSeconds = estimateLiteModeSeconds(stats.ttftMs, stats.tokensPerSecond, inputChars);
      return { ...stats, estimatedBaseSeconds, estimatedLiteSeconds };
    });



  return { handlers };
}

module.exports = { createModelsRpc };
