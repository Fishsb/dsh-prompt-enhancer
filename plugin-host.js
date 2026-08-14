// ============================================================================
// DSH「提示词优化」插件 · Host 半部（v20：内置兜底链硬编码 DeepSeek 官方模型）
// v14：新增日志环形缓冲 + logs/last 诊断 RPC（供客户端诊断日志查看器与故障排查）
// v17：① models/resolve：逐模型解析 reasoning 元数据（efforts/defaultEffort，懒加载）
//      ② models/test：连通性测试（resolveCallConfig 预校验失败不阻断 + 探测流计时，15s 超时）
//      ③ enhance 支持 reasoningEffort（主模型思考等级透传 llm.stream；cfg 日志加 effort=）
// v17.3：探测请求带 system + 明确指令 + maxTokens=16（真实请求形态）
// v18：① validateConfig v2：main/fallback/customModels/order/params/template（兼容 v1 平铺）
//      ② models/current：agentDefaultModel.currentSelection()（fresh install 兜底链继承）
//      ③ enhance 尝试链 = main + fallback 按序（每条独立 reasoningEffort）；cfg 日志加 chain=
// v19：新增 resolveAdaptiveChain（60s TTL 缓存）与 models/autochain RPC
// v20：内置兜底链硬编码指向 DeepSeek 官方模型（deepseek-official/deepseek-v4-flash、deepseek-v4-pro），
//      不再扫描任意 provider——主模型优先 currentSelection，兜底补足固定 DeepSeek 官方。
// v21：P1-4 模型能力解析缓存（resolveModelInfoCached，TTL 5min，按 provider:model 键，200 条上限清理）
// ============================================================================

// —— v14 诊断日志：环形缓冲（最近 300 行），供 logs/last RPC 读取 ——
const LOG_RING = [];
const LOG_RING_MAX = 300;
function hlog() {
  const line = Array.prototype.map.call(arguments, (a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
  LOG_RING.push(line);
  if (LOG_RING.length > LOG_RING_MAX) LOG_RING.shift();
  console.log(line);
}
function herr() {
  const line = Array.prototype.map.call(arguments, (a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
  LOG_RING.push(line);
  if (LOG_RING.length > LOG_RING_MAX) LOG_RING.shift();
  console.error(line);
}

// v20：内置兜底链硬编码指向 DeepSeek 官方模型（provider=deepseek-official）。
// 主模型优先取 agentDefaultModel.currentSelection()（当前使用模型），
// 兜底补足固定为 DeepSeek 官方模型链，不再扫描任意 provider（保证确定性）。
const DEEPSEEK_OFFICIAL_CHAIN = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
];
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_OUTPUT_LIMIT = 8000;
// 兜底链 TTL 缓存（避免每次 enhance 都重新解析）
const adaptiveChainCache = { value: null, at: 0 };
const ADAPTIVE_CHAIN_TTL_MS = 60000;
// v21（P1-4）：模型能力解析缓存（resolveModelInfo 结果，TTL 5 分钟，按 provider:model 键）
// 避免 models/resolve 每次调用都重复走适配器能力查询（可能含网络发现，毫秒~秒级开销）
const modelInfoCache = new Map();
const MODEL_INFO_TTL_MS = 300000;

async function resolveModelInfoCached(llmService, provider, model) {
  const key = provider + '/' + model;
  const hit = modelInfoCache.get(key);
  const now = Date.now();
  if (hit && (now - hit.at) < MODEL_INFO_TTL_MS) return hit.value;
  const info = await llmService.resolveModelInfo(provider, model);
  modelInfoCache.set(key, { value: info, at: now });
  // 防无限增长：超过 200 条时清理过期项
  if (modelInfoCache.size > 200) {
    for (const [k, v] of modelInfoCache) {
      if ((now - v.at) >= MODEL_INFO_TTL_MS) modelInfoCache.delete(k);
    }
  }
  return info;
}

async function resolveAdaptiveChain(llmSvc, adm) {
  const now = Date.now();
  if (adaptiveChainCache.value && (now - adaptiveChainCache.at) < ADAPTIVE_CHAIN_TTL_MS) {
    return adaptiveChainCache.value;
  }
  const chain = [];
  try {
    if (adm && typeof adm.currentSelection === 'function') {
      const sel = adm.currentSelection();
      if (sel && typeof sel.provider === 'string' && sel.provider &&
          typeof sel.model === 'string' && sel.model) {
        const lead = { provider: sel.provider, model: sel.model };
        if (typeof sel.reasoningEffort === 'string' && sel.reasoningEffort) lead.reasoningEffort = sel.reasoningEffort;
        chain.push(lead);
      }
    }
  } catch (e) { herr('[enhance] adaptive lead resolve failed', e); }
  // 兜底补足固定为 DeepSeek 官方模型（硬编码，不扫描环境）
  for (const d of DEEPSEEK_OFFICIAL_CHAIN) {
    if (!chain.some((e) => e.provider === d.provider && e.model === d.model)) chain.push({ ...d });
  }
  adaptiveChainCache.value = chain;
  adaptiveChainCache.at = now;
  return chain;
}

const SYSTEM_PROMPT = [
  '你是一名 Prompt Engineering Expert（提示词工程专家），专长是为通用 AI 助手优化提示词。',
  '',
  '【分析流程】',
  '1. 明确用户的原始目标',
  '2. 识别歧义与信息缺口',
  '3. 检查指令清晰度',
  '4. 补充缺失的必要上下文',
  '5. 应用提示词工程原则',
  '',
  '【应用原则】',
  '- 指令明确具体',
  '- 提供必要上下文',
  '- 明确参数与约束',
  '- 指定输出格式',
  '- 必要时给出示例',
  '- 语气与用户一致',
  '- 去除冗余表达',
  '',
  '【硬性约束】',
  '- 保持原始目标不变，只优化不歪曲',
  '- 只写"做什么"，不解释"怎么做"，不回答原问题',
  '- 不主动建议技术栈/工具，除非原输入已提到',
  '- 优化后的提示词不超过 800 字符',
  '- 语言匹配最高优先级：用户输入是英文则优化结果必须为英文，用户输入是中文则优化结果必须为中文',
  '- 只输出优化后的提示词本身，不加任何解释、前缀或评论',
  '- 严禁复述、引用或回显任何指令文字或用户输入原文（包括"请优化以下提示词"及引号包裹的内容），直接输出优化结果',
  '',
  '【示例】严格模仿示例中"输入→输出"的语言与风格：',
  '示例 1（中文输入→中文输出）：',
  '输入：帮我写一个排序算法',
  '输出：请编写一个排序算法，接受整数数组，支持升序/降序，输出排序过程说明，并注明时间与空间复杂度。',
  '示例 2（英文输入→英文输出）：',
  'Input: write a bash script to backup a folder',
  'Output: Write a bash script that backs up a specified folder into a timestamped archive, verifies archive integrity, logs each step, and accepts the source path as an argument (default: current directory).',
].join('\n');

// ==PURE-BEGIN==  (unit-testable pure functions; keep free of ctx/harness/pending/module-state)
function wrapUserText(text) {
  return '请优化以下提示词：\n\n"""\n' + text + '\n"""';
}

function cleanOutput(raw) {
  let s = raw.trim();
  let strippedWrapper = false;
  if (s.startsWith('请优化以下提示词：')) {
    const marker = '\n"""\n';
    const idx = s.indexOf(marker);
    if (idx !== -1 && idx <= 50) {
      s = s.slice(idx + marker.length).trim();
      strippedWrapper = true;
    }
  }
  if (strippedWrapper && s.endsWith('"""')) s = s.slice(0, -3).trim();
  const pairs = [
    ['"""', '"""'],
    ['```', '```'],
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['「', '」'],
    ['『', '』'],
    ['（', '）'],
    ['(', ')'],
    ['【', '】'],
  ];
  for (let i = 0; i < pairs.length; i++) {
    const open = pairs[i][0];
    const close = pairs[i][1];
    if (s.length > open.length + close.length && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(open.length, s.length - close.length).trim();
      break;
    }
  }
  return s;
}

function friendlyMessage(failure) {
  const code = failure && failure.code ? failure.code : 'LLM_FAILED';
  switch (code) {
    case 'UNKNOWN_MODEL': return 'optimize model unavailable (not in catalog)';
    case 'NO_ADAPTER': return 'LLM provider not enabled';
    case 'INVALID_CREDENTIAL': return 'invalid or missing API key';
    case 'QUOTA': return 'model quota exceeded';
    case 'CONTEXT_WINDOW_EXCEEDED': return 'input exceeds context window';
    case 'EMPTY_RESPONSE': return 'model returned an empty response';
    case 'OUTPUT_TOO_LONG': return 'optimization exceeds length limit';
    case 'TIMEOUT': return 'request timed out, original text restored';
    case 'ABORTED': return 'request cancelled';
    default: return failure && failure.message ? failure.message : 'optimize failed';
  }
}

function validateConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  // v18：v2 结构（main/fallback/customModels/order/params/template）；兼容 v1 平铺字段
  const main = src.main && typeof src.main === 'object' ? src.main : src;
  const p = src.params && typeof src.params === 'object' ? src.params : src;
  const t = src.template && typeof src.template === 'object' ? src.template : src;
  const out = {
    provider: '',
    model: '',
    reasoningEffort: '',
    fallback: [],
    customModels: [],
    order: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxTokens: DEFAULT_MAX_TOKENS,
    outputLimit: DEFAULT_OUTPUT_LIMIT,
    templateMode: 'builtin',
    templateText: '',
  };
  if (typeof main.provider === 'string' && main.provider.trim() !== '') out.provider = main.provider.trim();
  if (typeof main.model === 'string' && main.model.trim() !== '') out.model = main.model.trim();
  const effortOf = (obj) => (obj && typeof obj === 'object' && obj.enabled === true && typeof obj.effort === 'string' && obj.effort.trim() !== '' && obj.effort.trim().length <= 32) ? obj.effort.trim() : '';
  out.reasoningEffort = effortOf(main.reasoning) || (typeof main.reasoningEffort === 'string' && main.reasoningEffort.trim() !== '' && main.reasoningEffort.trim().length <= 32 ? main.reasoningEffort.trim() : '');
  // fallback（独立配置项；数组顺序 = 尝试顺序；每条可带 reasoning）
  if (Array.isArray(src.fallback)) {
    for (const item of src.fallback.slice(0, 8)) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
      const provider = item.provider.trim();
      const model = item.model.trim();
      if (!provider || !model) continue;
      if (out.fallback.some((x) => x.provider === provider && x.model === model)) continue;
      const entry = { provider, model };
      const effort = effortOf(item.reasoning);
      if (effort) entry.reasoningEffort = effort;
      out.fallback.push(entry);
    }
  }
  // customModels（自定义条目：provider/model/name；仅已有 provider 路由下的模型 ID）
  if (Array.isArray(src.customModels)) {
    for (const item of src.customModels.slice(0, 20)) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
      const provider = item.provider.trim();
      const model = item.model.trim();
      if (!provider || !model) continue;
      out.customModels.push({
        provider,
        model,
        name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim().slice(0, 40) : model,
      });
    }
  }
  // order（仅约束展示顺序）
  if (Array.isArray(src.order)) {
    for (const key of src.order.slice(0, 50)) {
      if (typeof key === 'string' && key.trim() !== '') {
        const k = key.trim();
        if (!out.order.includes(k)) out.order.push(k);
      }
    }
  }
  if (Number.isInteger(p.timeoutMs) && p.timeoutMs >= 1000 && p.timeoutMs <= 300000) out.timeoutMs = p.timeoutMs;
  if (Number.isInteger(p.maxTokens) && p.maxTokens >= 100 && p.maxTokens <= 16000) out.maxTokens = p.maxTokens;
  if (Number.isInteger(p.outputLimit) && p.outputLimit >= 500 && p.outputLimit <= 50000) out.outputLimit = p.outputLimit;
  if (t.templateMode === 'custom' || t.templateMode === 'builtin') out.templateMode = t.templateMode;
  if (typeof t.templateText === 'string' && t.templateText.length <= 4000) out.templateText = t.templateText;
  return out;
}

async function collectStream(iterator, outputLimit) {
  let text = '';
  let sawDelta = false;
  const blockTexts = [];
  let finish = null;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      const chunk = next.value;
      if (chunk.type === 'text-delta') {
        if (text.length + chunk.text.length > outputLimit) return { kind: 'toolong' };
        sawDelta = true;
        text += chunk.text;
      } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
        blockTexts.push(chunk.block.text);
      } else if (chunk.type === 'finish') {
        finish = chunk.reason;
        break;
      }
    }
  } catch (e) {
    return { kind: 'cancelled' };
  }
  if (!finish) return { kind: 'cancelled' };
  if (finish.kind === 'stop') {
    return { kind: 'ok', text: sawDelta ? text : blockTexts.join('') };
  }
  if (finish.kind === 'aborted' || finish.kind === 'error' && finish.failure && finish.failure.code === 'ABORTED') {
    return { kind: 'aborted' };
  }
  if (finish.kind === 'error') {
    return { kind: 'error', failure: finish.failure };
  }
  return { kind: 'error', failure: { code: 'EMPTY_RESPONSE', message: 'stream ended without a finish chunk' } };
}

// v17：1-token 连通性探测（计时 TTFT/总耗时；ref.current 供外部超时 abort）
async function pingStream(llmService, entry, ref) {
  const startedAt = Date.now();
  let ttftMs = -1;
  let sawFirst = false;
  let stream;
  try {
    stream = llmService.stream({
      provider: entry.provider,
      model: entry.model,
      ...(entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
      maxTokens: 16,
      system: 'You are a connectivity probe. Reply with OK.',
      messages: [{
        id: 'enhance-ping',
        role: 'user',
        content: [{ type: 'text', text: 'Reply with the single word OK' }],
        source: { kind: 'user' },
      }],
    });
  } catch (e) {
    return { ok: false, code: e && e.code ? String(e.code) : 'LLM_FAILED', message: String(e && e.message ? e.message : e) };
  }
  const iterator = stream[Symbol.asyncIterator]();
  if (ref) ref.current = iterator;
  let finish = null;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      const chunk = next.value;
      if (!sawFirst && (chunk.type === 'text-delta' || (chunk.type === 'block-end' && chunk.block.type === 'text'))) {
        sawFirst = true;
        ttftMs = Date.now() - startedAt;
      }
      if (chunk.type === 'finish') {
        finish = chunk.reason;
        break;
      }
    }
  } catch (e) {
    return { ok: false, code: 'ABORTED', message: 'probe aborted' };
  }
  const latencyMs = Date.now() - startedAt;
  // 容错：部分网关对极短请求直接结束流不发 finish——收到过文本即视为连通
  if (!finish) {
    if (sawFirst) return { ok: true, latencyMs, ttftMs, model: entry.model };
    return { ok: false, code: 'EMPTY_RESPONSE', message: 'probe returned no output' };
  }
  if (finish.kind === 'stop') {
    return { ok: true, latencyMs, ttftMs: sawFirst ? ttftMs : latencyMs, model: entry.model };
  }
  if (finish.kind === 'aborted' || (finish.kind === 'error' && finish.failure && finish.failure.code === 'ABORTED')) {
    return { ok: false, code: 'ABORTED', message: 'probe aborted' };
  }
  if (finish.kind === 'error') {
    const code = finish.failure && finish.failure.code ? String(finish.failure.code) : 'LLM_FAILED';
    return { ok: false, code, message: friendlyMessage(finish.failure) };
  }
  // v17.2：其余 finish（length/content-filter/tool-calls 等）——端点已响应即视为连通（探测目标是可达性）
  return { ok: true, latencyMs, ttftMs: sawFirst ? ttftMs : latencyMs, model: entry.model };
}

// ==PURE-END==
function selfState(reference) {
  const status = reference.latestRun && reference.latestRun.status;
  if (status === 'awaiting-approval') return 'awaiting-approval';
  if (status === 'client-pending' || status === 'starting-host') return 'client-pending';
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'failed';
  if (status === 'waiting') return 'waiting';
  if (status === 'running') return 'running';
  if (reference.activeRun !== undefined) return 'running';
  return reference.currentPackageId === undefined ? 'defined' : 'stopped';
}

function summarize(reference) {
  const latest = reference.latestRun;
  const state = selfState(reference);
  return {
    pluginId: String(reference.pluginId),
    name: reference.name,
    state,
    ...(reference.packages ? { packages: reference.packages.map((p) => ({ packageId: String(p.packageId), name: p.name, purpose: p.purpose || '' })) } : { packages: [] }),
    ...(reference.currentPackageId === undefined ? {} : { currentPackageId: String(reference.currentPackageId) }),
    ...(reference.nextPackageId === undefined ? {} : { nextPackageId: String(reference.nextPackageId) }),
    ...(reference.activeRun === undefined ? {} : { activeRun: { pluginRunId: String(reference.activeRun.pluginRunId), packageId: String(reference.activeRun.packageId) } }),
    ...(latest && latest.status === 'awaiting-approval' ? { pendingApproval: { pluginRunId: String(latest.pluginRunId), packageId: String(latest.packageId), mode: latest.mode } } : {}),
  };
}

return {
  inject: ['timer'],
  apply(ctx) {
    const llm = ctx.get('llm');
    const pending = new Map();

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

    function resolveAgent(sessionId) {
      const agents = ctx.get('agents');
      if (!agents || typeof agents.get !== 'function') return null;
      return agents.get(sessionId) || null;
    }

    harness.handle('models/list', async () => {
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

    harness.handle('models/resolve', async (args) => {
      const provider = args && typeof args.provider === 'string' ? args.provider : '';
      const model = args && typeof args.model === 'string' ? args.model : '';
      const llmService = ctx.get('llm');
      if (!llmService || typeof llmService.resolveModelInfo !== 'function') {
        return { ok: false, code: 'NO_LLM', message: 'llm service unavailable' };
      }
      if (!provider || !model) return { ok: false, code: 'BAD_ARGS', message: 'provider and model required' };
      try {
        // v21（P1-4）：走 TTL 缓存，避免重复适配器能力查询
        const info = await resolveModelInfoCached(llmService, provider, model);
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

    harness.handle('models/current', async () => {
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
    harness.handle('models/autochain', async () => {
      const llmSvc = ctx.get('llm');
      const adm = ctx.get('agentDefaultModel');
      try {
        const chain = await resolveAdaptiveChain(llmSvc, adm);
        return { ok: true, chain };
      } catch (e) {
        herr('[enhance] models/autochain failed', e);
        return { ok: false, code: 'AUTOCHAIN_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('models/test', async (args) => {
      const provider = args && typeof args.provider === 'string' ? args.provider : '';
      const model = args && typeof args.model === 'string' ? args.model : '';
      const reasoningEffort = args && typeof args.reasoningEffort === 'string' && args.reasoningEffort !== '' ? args.reasoningEffort : undefined;
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
      const timer = ctx.timer.timeout(() => {
        timedOut = true;
        if (ref.current && typeof ref.current.return === 'function') {
          try { ref.current.return(); } catch (e) { /* 忽略 */ }
        }
      }, 15000);
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
      return { ...r, ...(precheck && r.ok ? { precheck } : {}) };
    });

    harness.handle('plugins/inventory', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
      const runner = ctx.get('dynamicCordisRunner');
      if (!runner || typeof runner.listPlugins !== 'function') {
        return { ok: false, code: 'NO_SERVICE', message: 'plugin runner unavailable' };
      }
      const agent = resolveAgent(sessionId);
      if (!agent) return { ok: false, code: 'NO_AGENT', message: 'session agent unavailable' };
      try {
        const plugins = runner.listPlugins(agent).map(summarize);
        return { ok: true, plugins };
      } catch (e) {
        herr('[enhance] inventory failed', e);
        return { ok: false, code: 'INVENTORY_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('plugins/run', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : '';
      const packageId = args && typeof args.packageId === 'string' ? args.packageId : '';
      const mode = args && args.mode === 'update' ? 'update' : 'run';
      const runner = ctx.get('dynamicCordisRunner');
      if (!runner || typeof runner.run !== 'function') {
        return { ok: false, code: 'NO_SERVICE', message: 'plugin runner unavailable' };
      }
      const agent = resolveAgent(sessionId);
      if (!agent) return { ok: false, code: 'NO_AGENT', message: 'session agent unavailable' };
      try {
        const result = await runner.run(agent, pluginId, packageId, mode, undefined);
        if (result && result.ok) {
          return { ok: true, status: result.status, pluginRunId: result.pluginRunId || '' };
        }
        return { ok: false, code: result && result.reason ? result.reason : 'RUN_FAILED', message: result && result.message ? result.message : 'run failed' };
      } catch (e) {
        herr('[enhance] run failed', e);
        return { ok: false, code: 'RUN_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('plugins/stop', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : '';
      const runner = ctx.get('dynamicCordisRunner');
      if (!runner || typeof runner.stop !== 'function') {
        return { ok: false, code: 'NO_SERVICE', message: 'plugin runner unavailable' };
      }
      const agent = resolveAgent(sessionId);
      if (!agent) return { ok: false, code: 'NO_AGENT', message: 'session agent unavailable' };
      try {
        const result = await runner.stop(agent, pluginId);
        return { ok: !result || result.ok !== false, ...(result && result.message ? { message: result.message } : {}) };
      } catch (e) {
        herr('[enhance] stop failed', e);
        return { ok: false, code: 'STOP_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('plugins/undefine', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
      const pluginId = args && typeof args.pluginId === 'string' ? args.pluginId : '';
      const runner = ctx.get('dynamicCordisRunner');
      if (!runner || typeof runner.undefine !== 'function') {
        return { ok: false, code: 'NO_SERVICE', message: 'plugin runner unavailable' };
      }
      const agent = resolveAgent(sessionId);
      if (!agent) return { ok: false, code: 'NO_AGENT', message: 'session agent unavailable' };
      try {
        const result = await runner.undefine(agent, pluginId);
        return { ok: !result || result.ok !== false, ...(result && result.message ? { message: result.message } : {}) };
      } catch (e) {
        herr('[enhance] undefine failed', e);
        return { ok: false, code: 'UNDEFINE_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('logs/last', async () => ({ ok: true, lines: LOG_RING.slice() }));

    harness.handle('enhance', async (args) => {
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

      const cfg = validateConfig(args && args.config);
      const mainEntry = cfg.provider !== '' && cfg.model !== ''
        ? { provider: cfg.provider, model: cfg.model, ...(cfg.reasoningEffort !== '' ? { reasoningEffort: cfg.reasoningEffort } : {}) }
        : null;
      // v19：尝试链 = main + fallback 按序（每条独立 reasoningEffort）；
      // fallback 为空或 main 不可用 → 自适应解析当前环境默认链（不再写死 provider）
      const chain = [];
      if (mainEntry) chain.push(mainEntry);
      for (const item of cfg.fallback) {
        if (chain.some((e) => e.provider === item.provider && e.model === item.model)) continue;
        chain.push({ provider: item.provider, model: item.model, ...(item.reasoningEffort ? { reasoningEffort: item.reasoningEffort } : {}) });
      }
      if (cfg.fallback.length === 0) {
        const adaptive = await resolveAdaptiveChain(ctx.get('llm'), ctx.get('agentDefaultModel'));
        for (const d of adaptive) {
          if (chain.some((e) => e.provider === d.provider && e.model === d.model)) continue;
          chain.push({ ...d });
        }
      }
      if (chain.length === 0) {
        const adaptive = await resolveAdaptiveChain(ctx.get('llm'), ctx.get('agentDefaultModel'));
        chain.push(...adaptive);
      }
      const timeoutMs = cfg.timeoutMs;
      const maxTokens = cfg.maxTokens;
      const outputLimit = cfg.outputLimit;
      const system = cfg.templateMode === 'custom' && cfg.templateText.trim() !== '' ? cfg.templateText.trim() : SYSTEM_PROMPT;
      hlog('[enhance] cfg session=' + sessionId + ' main=' + (mainEntry ? mainEntry.provider + '/' + mainEntry.model : 'builtin-chain') + (cfg.reasoningEffort !== '' ? ' effort=' + cfg.reasoningEffort : '') + ' chain=' + (cfg.fallback.length > 0 ? cfg.fallback.map((f) => f.provider + '/' + f.model).join(',') : '-') + ' timeout=' + timeoutMs + ' maxTokens=' + maxTokens + ' outputLimit=' + outputLimit + ' template=' + (system === SYSTEM_PROMPT ? 'builtin' : 'custom'));

      const rec = { cancelled: false, timedOut: false, iterator: null };
      pending.set(key, rec);
      const timeoutDisposer = ctx.timer.timeout(() => {
        markAndAbort(key, 'timedOut');
      }, timeoutMs);

      try {
        let lastFailure = null;
        for (let i = 0; i < chain.length; i++) {
          const entry = chain[i];
          if (rec.cancelled || rec.timedOut) {
            return { ok: false, code: rec.timedOut ? 'TIMEOUT' : 'ABORTED', message: friendlyMessage({ code: rec.timedOut ? 'TIMEOUT' : 'ABORTED' }) };
          }
          hlog('[enhance] try session=' + sessionId + ' provider=' + entry.provider + ' model=' + entry.model + (entry.reasoningEffort ? ' effort=' + entry.reasoningEffort : '') + ' seq=' + seq);
          const stream = llm.stream({
            provider: entry.provider,
            model: entry.model,
            ...(entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
            system,
            maxTokens,
            messages: [{
              id: 'enhance-' + sessionId + '-' + seq,
              role: 'user',
              content: [{ type: 'text', text: wrapUserText(text) }],
              source: { kind: 'user' },
            }],
          });
          const iterator = stream[Symbol.asyncIterator]();
          rec.iterator = iterator;
          let result;
          try {
            result = await collectStream(iterator, outputLimit);
          } finally {
            rec.iterator = null;
          }
          if (result.kind === 'ok') {
            const cleaned = cleanOutput(result.text);
            if (cleaned === '') {
              lastFailure = { code: 'EMPTY_RESPONSE', message: 'model returned empty text' };
              continue;
            }
            hlog('[enhance] ok session=' + sessionId + ' via ' + entry.model);
            return { ok: true, text: cleaned, model: entry.model };
          }
          if (result.kind === 'toolong') {
            lastFailure = { code: 'OUTPUT_TOO_LONG', message: 'output exceeded limit' };
            continue;
          }
          if (result.kind === 'cancelled' || result.kind === 'aborted') {
            return { ok: false, code: rec.timedOut ? 'TIMEOUT' : 'ABORTED', message: friendlyMessage({ code: rec.timedOut ? 'TIMEOUT' : 'ABORTED' }) };
          }
          hlog('[enhance] fail session=' + sessionId + ' model=' + entry.model + ' code=' + (result.failure ? result.failure.code : '?'));
          lastFailure = result.failure || { code: 'LLM_FAILED', message: 'unknown failure' };
        }
        hlog('[enhance] chain exhausted session=' + sessionId + ' last code=' + (lastFailure ? lastFailure.code : '?'));
        return { ok: false, code: lastFailure.code || 'LLM_FAILED', message: friendlyMessage(lastFailure) };
      } catch (e) {
        herr('[enhance] unexpected error session=' + sessionId + ' seq=' + seq, e);
        return { ok: false, code: 'LLM_FAILED', message: friendlyMessage({ code: 'LLM_FAILED' }) };
      } finally {
        timeoutDisposer();
        pending.delete(key);
      }
    });

    harness.handle('cancel', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : 'unknown';
      const seq = args && typeof args.seq === 'number' ? args.seq : -1;
      markAndAbort(requestKey(sessionId, seq), 'cancelled');
      return { ok: true };
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