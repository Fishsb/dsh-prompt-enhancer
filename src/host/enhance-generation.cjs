'use strict';

// 增强 llm 阶段（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 职责：模型链调用、流式收集、退避重试、看门狗、连通性探测与结果提交。
// 不读取配置、不读写草稿；llm/timer/纯函数/结果映射/日志全部由调用方注入。

function createGenerationStage(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const ctx = d.ctx;
  const llm = d.llm;
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};
  const markDegraded = d.markDegraded;
  const remainingBudgetMs = d.remainingBudgetMs;
  const budgetExhausted = d.budgetExhausted;
  const retryPolicyFor = d.retryPolicyFor;
  const sleepMs = d.sleepMs;
  const setProgress = d.setProgress;
  const enhanceSuccessResult = d.enhanceSuccessResult;
  const enhanceFailureResult = d.enhanceFailureResult;
  const friendlyMessage = d.friendlyMessage;
  const collectStream = d.collectStream;
  const cleanOutput = d.cleanOutput;
  const stripScenarioEcho = d.stripScenarioEcho;
  const computeBackoffDelayMs = d.computeBackoffDelayMs;
  const isRetryableFailure = d.isRetryableFailure;
  const probeCacheGet = d.probeCacheGet;
  const probeCacheSet = d.probeCacheSet;
  const pingStream = d.pingStream;
  const STAGE_LLM = d.stageLlm;
  const WATCHDOG_TIMEOUT_MS = d.watchdogTimeoutMs;
  const PROBE_TIMEOUT_MS = d.probeTimeoutMs;
  const RETRY_ALWAYS_SAFETY_CAP = d.retryAlwaysSafetyCap;

    async function enhanceStageLlm(state) {
      const sessionId = state.sessionId;
      const seq = state.seq;
      const rec = state.rec;
      let chain = state.chain.slice();
      const system = state.system;
      const messages = state.messages;
      const isPublish = state.isPublish;
      const maxTokens = state.maxTokens;
      const outputLimit = state.outputLimit;
      let lastFailure = null;
      // 2026-08-18（用户需求·删内置兜底链）：模型链为空 → 明确报「未配置模型」（不自适应补足）
      if (chain.length === 0) {
        state.result = { ok: false, code: 'NO_MODEL', message: friendlyMessage({ code: 'NO_MODEL' }) };
        return state;
      }
      // v3.3.3（2026-08-27 用户实测·增强易断链修复）：外层 pass 循环——首轮整链耗尽后
      // 整体重试一次（最多 2 pass），瞬时限流/慢首字/网络抖动自愈；重试轮不再挂看门狗、
      // 不走探测缓存（直接真实生成），杜绝「探测判死 → 冻结整链 → 连续失败」；
      // 总预算仍由外层 timeoutMs 计时器兜底（rec.timedOut 立即中断，不无限重试）。
      for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < chain.length; i++) {
        const entry = chain[i];
        if (rec.cancelled || rec.timedOut) {
          state.result = enhanceFailureResult({ code: rec.timedOut ? 'TIMEOUT' : 'ABORTED', message: friendlyMessage({ code: rec.timedOut ? 'TIMEOUT' : 'ABORTED' }) });
          return state;
        }
        hlog('[enhance] try session=' + sessionId + ' provider=' + entry.provider + ' model=' + entry.model + (entry.reasoningEffort ? ' effort=' + entry.reasoningEffort : '') + ' seq=' + seq);
        // v3.2.4（用户需求）：模型序号 = 用户设置（fallback 链）中的位置——buildTryChain
        // 会去重/过滤导致 chain 索引偏移；用 fallback 原始序号，设置里第 N 条就显示 N（自动随数量）
        const fb = state.cfg && Array.isArray(state.cfg.fallback) ? state.cfg.fallback : [];
        let stepNum = i + 1;
        for (let fi = 0; fi < fb.length; fi++) {
          const it = fb[fi];
          if (it && typeof it === 'object' && String(it.provider).trim() === entry.provider && String(it.model).trim() === entry.model) {
            stepNum = fi + 1;
            break;
          }
        }
        setProgress(rec, STAGE_LLM, i > 0 ? 'retry' : '', null, stepNum, fb.length > 0 ? fb.length : chain.length);
        let result = null;
        let streamThrowFailure = null;
        let watchFired = false;
        // P0-a（2026-10-12 · 补退避重试）：插件直调 ctx.llm.stream() 站在官方设计上**没有可靠性层**的位置——
        // 宿主退避挂在 agent/request-error 水位（由 agent-loop 生产），插件自己消费流吃不到（官方明文：
        // 直接调用 ctx.llm.stream() 的调用方仍然只尝试一次）。此处按官方语义在其外层补一层退避重试：
        //   · 退避参数**不硬编码** —— 调 ctx.llm.providerRetryPolicy(provider) 取官方**已解析**的策略
        //     （**平铺**结构：{mode,maxRetries,retryableCodes,initialDelayMs,maxDelayMs,jitterRatio}）；
        //   · 可重试码集同样**从策略取**（policy.retryableCodes），不照抄常量；
        //   · 退避公式与官方 dsh-llm-retry localDelay 逐式一致（见 pure.js computeBackoffDelayMs）；
        //   · 策略不可得（旧宿主/未注册路由）→ 不重试，行为回到「只尝试一次」（零回归）。
        for (let attempt = 0; ; attempt++) {
          if (rec.cancelled || rec.timedOut) break;
          let stream;
          try {
            stream = llm.stream({
              provider: entry.provider,
              model: entry.model,
              ...(entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
              system,
              // v2.7.0（publish）：maxTokens<=0 省略字段 → provider 默认上限（不设限制）
              // v2.9.0-fix（实测确证）：reasoning 模式（带 effort）下思考过程消耗 maxTokens
              // 预算——配置的 2000 在长输入 + effort=max 时耗尽 → 空流（EMPTY_RESPONSE）；
              // 自动放宽到 >=8000（保守版；publish 九章规格长文同策略放宽——实测 maxTokens=2000 时空流，v3.2.27 修复）
              ...(entry.reasoningEffort ? { maxTokens: Math.max(maxTokens, 8000) } : (isPublish ? { maxTokens: Math.max(maxTokens, 8000) } : (maxTokens > 0 ? { maxTokens } : {}))),
              // v3.2.21（用户需求·优化结果稳定）：确定性重述任务压低 temperature——不传时用平台默认
              // （随机性高，同一输入每次结果不同）；reasoning 链节由 effort 控制，不传 temperature
              ...(entry.reasoningEffort ? {} : { temperature: 0.3 }),
              messages,
            });
          } catch (e) {
            // v3.1.3（看门狗 + 延迟连通性预检）：llm.stream 同步抛错 = 模型不可达 → 记失败走下一条
            hlog('[enhance] fail session=' + sessionId + ' model=' + entry.model + ' code=STREAM_THROW attempt=' + attempt);
            streamThrowFailure = { code: e && e.code ? String(e.code) : 'STREAM_THROW', message: String(e && e.message ? e.message : e) };
            break;
          }
          const iterator = stream[Symbol.asyncIterator]();
          rec.iterator = iterator;
          // v3.1.3（看门狗 + 延迟连通性预检）：仅首个尝试挂响应看门狗——WATCHDOG_TIMEOUT_MS 内
          // 无任何 chunk → 判首模型不通，中断当前流并进入连通性探测（探测选模型重启生成，
          // 重启不再挂看门狗，防「慢但健康」模型被反复打断成死循环）
          let watchTimer = null;
          watchFired = false;
          if (i === 0 && !state.watchdogDone) {
            // P0-c（2026-10-12）：看门狗阈值按实测 TTFT 重算（= ceil(9300×2/1000)×1000 = 19s），
          // 但**必须按剩余主预算钳制**——
            // 否则放宽阈值会掩盖真挂死（一个不响应的路由可以一直在预算内耗着）。钳制后：
            // ① 慢但健康（TTFT ≤ 9.3s 实测上界）不会被误杀；② 真无响应仍在主预算处被砍（TIMEOUT）。
            const watchBudget = remainingBudgetMs(state);
            const watchMs = watchBudget === Infinity ? WATCHDOG_TIMEOUT_MS : Math.max(0, Math.min(WATCHDOG_TIMEOUT_MS, watchBudget));
            watchTimer = ctx.timer.timeout(() => {
              watchFired = true;
              if (rec.iterator && typeof rec.iterator.return === 'function') {
                try { rec.iterator.return(); } catch (e) { /* 忽略 */ }
              }
            }, watchMs);
          }
          try {
            result = await collectStream(iterator, outputLimit, () => {
              if (watchTimer) { watchTimer(); watchTimer = null; }
            });
          } finally {
            if (watchTimer) watchTimer();
            rec.iterator = null;
          }
          if (watchFired) break;
          // ---- P0-a：退避重试判定（仅对策略声明的可重试码；watchdog/toolong/aborted/cancelled 不在此列）----
          // P0-e 联动：max-tokens 截断是**确定性**结果（同 maxTokens 重试必然再截断）——
          //   · 有实质文本 → 视为终态，break 出去由主生成点采纳（不进重试，省预算且语义正确）；
          //   · 无文本（纯思考吃满预算） → 可能是瞬时故障，才交给策略判定是否重试。
          const truncatedWithText = result && result.kind === 'maxtokens' && typeof result.text === 'string' && result.text !== '';
          if (truncatedWithText) break;
          const attemptFailure = result && (result.kind === 'error' || result.kind === 'maxtokens') ? (result.failure || null) : null;
          if (!attemptFailure) break;
          const policy = retryPolicyFor(entry.provider);
          if (!isRetryableFailure(policy, attemptFailure)) break;
          // always 语义官方无 maxRetries（不设限）；插件侧给安全上限防不收敛——
          // 尤其 timeoutMs=0（无限制）时 budgetDeadline=null，预算不构成中断（独立复核 medium）。
          const retryCap = policy.mode === 'always'
            ? RETRY_ALWAYS_SAFETY_CAP
            : (Number.isSafeInteger(policy.maxRetries) ? policy.maxRetries : 0);
          if (attempt >= retryCap) break;
          if (budgetExhausted(state)) { hlog('[enhance] retry skipped budget-exhausted code=' + attemptFailure.code); break; }
          // 平铺策略对象直接传入（官方 ResolvedRetryPolicy 无 backoff 子对象）
          const delayMs = computeBackoffDelayMs(policy, attempt + 1, Math.random);
          // 独立复审 medium（2026-10-12）：重试**不得**混进「降级」通道——
          // 「重试后成功」是瞬时故障自愈（P0-a 的目标场景），不是「上下文不完整」；
          // 混入会让常见成功路径被 UI 误标「⚠ 部分上下文不可用」，削弱降级信号可信度。
          // 故重试只记 hlog（可观测）与独立计数 rec.retries，绝不进 rec.degraded。
          if (!Array.isArray(rec.retries)) rec.retries = [];
          rec.retries.push(String(attemptFailure.code || 'unknown'));
          hlog('[enhance] retry attempt=' + (attempt + 1) + '/' + retryCap + ' code=' + attemptFailure.code + ' delay=' + Math.round(delayMs) + 'ms provider=' + entry.provider + ' seq=' + seq);
          setProgress(rec, STAGE_LLM, 'retry', { current: attempt + 1, total: retryCap }, attempt + 1, retryCap);
          await sleepMs(delayMs);
        }
        if (streamThrowFailure) {
          lastFailure = streamThrowFailure;
          continue;
        }
        if (watchFired) {
          state.watchdogDone = true;
          hlog('[enhance] watchdog no-response in ' + WATCHDOG_TIMEOUT_MS + 'ms on ' + entry.provider + '/' + entry.model + ' seq=' + seq);
          setProgress(rec, STAGE_LLM, 'probe', null, 1, chain.length);
          // 连通性探测：跳过刚挂起的首条，探测剩余链（缓存优先，每条 PROBE_TIMEOUT_MS 超时）
          const rest = chain.slice(i + 1);
          const pick = await probeFirstReachable(rest);
          if (!pick) {
            // 剩余全不通 → 回头探测挂起首条：通畅（只是慢）→ 重试一次；不通 → 全不可用
            const headOk = await probeEntry(entry);
            if (!headOk) {
              hlog('[enhance] chain all unavailable session=' + sessionId + ' last code=' + (lastFailure ? lastFailure.code : '?'));
              // v3.3.3（设计决策）：探测窗口已按实测放大（PROBE_TIMEOUT_MS=12s）——探测全败
              // = 实测全不可达（慢模型不再被误杀），立即报错不进入重试轮（避免无望的二次等待）；
              // 重试轮只覆盖生成级失败耗尽（EMPTY/STREAM_THROW/QUOTA/瞬时错误等自愈场景）。
              state.result = enhanceFailureResult({ code: 'ALL_MODELS_UNAVAILABLE', message: friendlyMessage({ code: 'ALL_MODELS_UNAVAILABLE' }) });
              return state;
            }
            hlog('[enhance] watchdog retry head via ' + entry.provider + '/' + entry.model + ' seq=' + seq);
            chain = [entry];
            i = -1;
            continue;
          }
          hlog('[enhance] watchdog restart via ' + pick.provider + '/' + pick.model + ' seq=' + seq);
          chain = [pick].concat(chain.filter((e) => e !== pick && e !== entry));
          i = -1;
          continue;
        }
        if (result.kind === 'ok') {
          // v2.8.0（实测修正）：publish 剥离输出首部【场景判定】回显行（确定性，不依赖模型遵从）
          const cleaned = isPublish ? stripScenarioEcho(cleanOutput(result.text, state.text)) : cleanOutput(result.text, state.text);
          if (cleaned === '') {
            lastFailure = { code: 'EMPTY_RESPONSE', message: 'model returned empty text' };
            continue;
          }
          hlog('[enhance] ok session=' + sessionId + ' via ' + entry.model);
          state.result = enhanceSuccessResult({ before: state.text, text: cleaned, model: entry.model, fallbackUsed: state.watchdogDone === true || i > 0 });
          return state;
        }
        if (result.kind === 'toolong') {
          lastFailure = { code: 'OUTPUT_TOO_LONG', message: 'output exceeded limit' };
          continue;
        }
        // P0-e（2026-10-12）：max-tokens 截断是**官方合法** finish（不再落 EMPTY_RESPONSE 兜底）。
        // 若已收到实质文本 → 直接采纳为结果（长草稿被截断但内容可用，优于报错丢弃）；
        // 无文本（纯思考吃满预算）→ 如实报 OUTPUT_TRUNCATED（文案由 friendlyMessage 给真实原因）。
        if (result.kind === 'maxtokens') {
          const truncated = typeof result.text === 'string' ? result.text : '';
          if (truncated !== '') {
            const cleanedMt = isPublish ? stripScenarioEcho(cleanOutput(truncated, state.text)) : cleanOutput(truncated, state.text);
            // P0-e 修正（2026-10-12 · 独立复核 high）：截断文本**不得无条件采纳**——截断点可能落在
            // 指令包装中途（模型回显「请优化以下提示词："""…」），此时 cleanOutput 因包装未闭合剥不掉，
            // 会把带包装的残片当结果覆盖用户草稿（旧行为是报 EMPTY_RESPONSE、草稿保留 ⇒ 反而更安全）。
            // 采纳门槛（离线可判，不调模型）：① 剥离后非空；② 剥离后**不再含未闭合的指令包装特征**
            // （三引号/「请优化以下提示词」等 wrap 痕迹）；③ 非残片（≥8 字符）。
            // ⚠ 曾用「≥原文 10%」，实测会误伤「短输入 + 短而合法的截断输出」（过度收紧）——已回退为绝对值下限。
            // 任一不满足 → 不采纳，按 OUTPUT_TRUNCATED 如实失败（草稿保留）。
            const stillWrapped = /"""|请优化以下提示词|优化以下提示词|【用户输入】/.test(cleanedMt);
            // 残片下限：极短输入（如 4 字）不应被绝对值门槛误伤——取 min(8, 原文长度) 作下限
            const minLen = Math.min(8, Math.max(1, String(state.text || '').length));
            const longEnough = cleanedMt.length >= minLen;
            if (cleanedMt !== '' && !stillWrapped && longEnough) {
              markDegraded(state, 'output-truncated');
              hlog('[enhance] ok(truncated by max-tokens) session=' + sessionId + ' via ' + entry.model + ' chars=' + cleanedMt.length);
              state.result = enhanceSuccessResult({ before: state.text, text: cleanedMt, model: entry.model, truncated: true, fallbackUsed: state.watchdogDone === true || i > 0 });
              return state;
            }
            hlog('[enhance] truncated output rejected session=' + sessionId + ' wrapped=' + stillWrapped + ' longEnough=' + longEnough + ' chars=' + cleanedMt.length);
          }
          lastFailure = { code: 'OUTPUT_TRUNCATED', message: 'output reached the length limit and was truncated' };
          continue;
        }
        if (result.kind === 'cancelled' || result.kind === 'aborted') {
          state.result = { ok: false, code: rec.timedOut ? 'TIMEOUT' : 'ABORTED', message: friendlyMessage({ code: rec.timedOut ? 'TIMEOUT' : 'ABORTED' }) };
          return state;
        }
        hlog('[enhance] fail session=' + sessionId + ' model=' + entry.model + ' code=' + (result.failure ? result.failure.code : '?'));
        lastFailure = result.failure || { code: 'LLM_FAILED', message: 'unknown failure' };
      }
      // v3.3.3（链耗尽）：pass 0 且未被取消/超时 → 整链重试一次（watchdogDone=true 免看门狗）
      if (pass === 0 && !rec.cancelled && !rec.timedOut) {
        hlog('[enhance] chain exhausted retry pass=2 session=' + sessionId + ' last code=' + (lastFailure ? lastFailure.code : '?'));
        state.watchdogDone = true;
        continue;
      }
      hlog('[enhance] chain exhausted session=' + sessionId + ' last code=' + (lastFailure ? lastFailure.code : '?'));
      state.result = enhanceFailureResult({ code: lastFailure.code || 'LLM_FAILED', message: friendlyMessage(lastFailure) });
      return state;
      }
    }

    // v3.1.3（看门狗 + 延迟连通性预检）：连通性探测——缓存优先，pingStream 短输入探测
    // （可达性：QUOTA/网络/auth/超时；探测 ≠ 生成成功，生成级失败仍由原回退链兜底）
    const probeCache = new Map();
    async function probeEntry(entry) {
      if (!entry) return false;
      const key = entry.provider + '/' + entry.model;
      const now = Date.now();
      const hit = probeCacheGet(probeCache, key, now);
      if (hit) return hit.ok === true;
      if (llm === undefined) return false;
      const ref = { current: null };
      let timedOut = false;
      const timer = ctx.timer.timeout(() => {
        timedOut = true;
        if (ref.current && typeof ref.current.return === 'function') {
          try { ref.current.return(); } catch (e) { /* 忽略 */ }
        }
      }, PROBE_TIMEOUT_MS);
      let r;
      try {
        r = await pingStream(llm, entry, ref);
      } finally {
        timer();
      }
      const ok = !timedOut && r && r.ok === true;
      probeCacheSet(probeCache, key, { ok, code: timedOut ? 'TIMEOUT' : (r ? r.code : 'LLM_FAILED') }, now);
      hlog('[enhance] probe ' + entry.provider + '/' + entry.model + ' → ' + (ok ? 'ok ' + (r ? r.latencyMs : '?') + 'ms' : (timedOut ? 'timeout' : (r ? r.code : 'LLM_FAILED'))));
      return ok;
    }
    async function probeFirstReachable(entries) {
      for (const entry of entries) {
        if (await probeEntry(entry)) return entry;
      }
      return null;
    }


  return { enhanceStageLlm };
}

module.exports = { createGenerationStage };
