// ============================================================================
// DSH「提示词优化」插件 · Host 半部（v2.0.7：V2 工作区检索改用 FsTarget 契约）
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
// v23：模型链整合——enhance 不再区分 main/fallback，直接按链顺序逐一尝试（buildTryChain）；
//      老 v2 main 字段保留解析但尝试逻辑忽略（client 侧已迁移为链首条）。
// v2.0.0：引擎共存——engine=v1（默认，行为零变化）/ engine=v2（上下文感知：阶段 A 任务进度
//      smart|basic → 阶段 B 工作区文件/会话事件相关性检索 → 阶段 C 预算组装注入）；
//      各阶段独立降级；阶段 A/B 在优化超时计时器前执行（独立超时）；防上下文回显约束；
//      敏感文件硬过滤（shouldIgnoreFile）。
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
    // v2.0.0（H1）：引擎选择 + V2 上下文配置（默认 v1，行为零变化）
    engine: 'v1',
    context: { mode: 'smart', budgetChars: 4000, workspace: { maxFiles: 3, depth: 2 } },
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
  // v2.0.0（H1）：engine 白名单 v1/v2（缺省/非法 → v1）；context 白名单校验
  if (src.engine === 'v2') out.engine = 'v2';
  const ctxCfg = src.context && typeof src.context === 'object' ? src.context : {};
  if (ctxCfg.mode === 'basic' || ctxCfg.mode === 'smart') out.context.mode = ctxCfg.mode;
  if ([0, 2000, 4000, 8000].includes(ctxCfg.budgetChars)) out.context.budgetChars = ctxCfg.budgetChars;
  if (ctxCfg.workspace && typeof ctxCfg.workspace === 'object') {
    if (Number.isInteger(ctxCfg.workspace.maxFiles) && ctxCfg.workspace.maxFiles >= 1 && ctxCfg.workspace.maxFiles <= 10) out.context.workspace.maxFiles = ctxCfg.workspace.maxFiles;
    if (Number.isInteger(ctxCfg.workspace.depth) && ctxCfg.workspace.depth >= 1 && ctxCfg.workspace.depth <= 4) out.context.workspace.depth = ctxCfg.workspace.depth;
  }
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

// v23（D6）：模型链构建——按 cfg.fallback 顺序逐一尝试（去重）；
// 链为空时才用自适应/内置链补足；不再有 main 优先概念。
function buildTryChain(fallback, adaptive) {
  const chain = [];
  for (const item of fallback || []) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
    const provider = item.provider.trim();
    const model = item.model.trim();
    if (!provider || !model) continue;
    if (chain.some((e) => e.provider === provider && e.model === model)) continue;
    const entry = { provider, model };
    if (item.reasoningEffort) entry.reasoningEffort = item.reasoningEffort;
    chain.push(entry);
  }
  if (chain.length === 0) {
    for (const d of adaptive || []) {
      if (!d || typeof d.provider !== 'string' || typeof d.model !== 'string') continue;
      if (chain.some((e) => e.provider === d.provider && e.model === d.model)) continue;
      chain.push({ ...d });
    }
  }
  return chain;
}

// ================= V2 上下文感知优化 · 纯函数族 =================
// （v2.0.0 方案 §3：阶段 A 规则提取 / 阶段 B 检索排序与摘要 / 阶段 C 预算组装）

// V2 分支判定：engine='v2' 且预算 > 0 才走注入路径（U12）
function shouldInjectV2(engine, budgetChars) {
  return engine === 'v2' && typeof budgetChars === 'number' && budgetChars > 0;
}

// 事件 → 文本消息列表（过滤噪音；**从尾部反向遍历**取最近 limit 条——DSH 日志可能达百万级）
// DSH 事件类型形如 'user/message'、'assistant/message'、'assistant/chunk'、'tool/call'；
// 只认 role/kind 前缀为 user|assistant 且 kind 非 chunk 的文本消息；
// 文本在 text/content/payload/message/data 容器（DSH 实际为 ev.data.content[].text）。
function extractHistory(events, limit) {
  const arr = Array.isArray(events) ? events : [];
  const out = [];
  // 候选文本容器（顺序优先；第一个能取出非空文本的胜出）
  const pickText = (container) => {
    if (!container || typeof container !== 'object') return '';
    if (typeof container.text === 'string') return container.text;
    if (Array.isArray(container.content)) {
      return container.content.map((b) => (b && typeof b === 'object' && typeof b.text === 'string') ? b.text : '').join(' ');
    }
    return '';
  };
  for (let i = arr.length - 1; i >= 0 && out.length < limit; i--) {
    const ev = arr[i];
    if (!ev || typeof ev !== 'object') continue;
    const type = String(ev.type || ev.kind || '').toLowerCase();
    let role = ev.role || (ev.payload && ev.payload.role) || (ev.message && ev.message.role) || (ev.data && ev.data.role) || (ev.content && typeof ev.content === 'object' && ev.content.role);
    const slash = type.indexOf('/');
    const typeRole = slash > 0 ? type.slice(0, slash) : type;
    if (typeRole === 'user' || typeRole === 'assistant') {
      if (slash > 0 && type.slice(slash + 1) === 'chunk') continue; // 流片段噪音
      if (role !== 'user' && role !== 'assistant') role = typeRole;
    }
    if (role !== 'user' && role !== 'assistant') continue;
    let text = '';
    if (typeof ev.text === 'string') text = ev.text;
    else text = pickText(ev.content) || pickText(ev.payload) || pickText(ev.message) || pickText(ev.data);
    text = text.trim();
    if (!text) continue;
    if (text.startsWith('/')) continue;
    if (/^(\[工具|tool|function call)/i.test(text)) continue;
    out.push({ type: role, text: text.slice(0, 1200) });
  }
  return out.reverse();
}

// 规则版任务焦点提取（basic 模式）：代码/路径/扩展名 token + 中文主题词
function inferFocusRules(historyText) {
  const focus = [];
  const seen = new Set();
  const add = (w) => {
    if (!w || seen.has(w) || w.length < 2) return;
    seen.add(w);
    focus.push(w);
  };
  const s = String(historyText || '');
  // 路径与文件名 token（src/xxx.py、foo_bar.ts、package.json 等）
  // 注意：长扩展名（json/tsx/jsx/yaml）必须在短前缀（js/ts/ya）之前，避免交替误匹配
  for (const m of s.matchAll(/[A-Za-z0-9_\-./\\]+\.(?:json|yaml|yml|tsx|jsx|toml|svelte|python|html|css|typescript|javascript|py|ts|js|md|txt|go|rs|java|cpp|c|h|sh|sql|vue)/g)) {
    const path = m[0];
    const base = path.split(/[\\/]/).pop();
    add(base);
    add(base.replace(/\.[^.]+$/, ''));
  }
  // 中英文主题词（2-8 字中文词组 / 驼峰与下划线英文词）
  for (const m of s.matchAll(/[\u4e00-\u9fa5]{2,8}/g)) add(m[0]);
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+/g)) add(m[0]);
  for (const m of s.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g)) add(m[0]);
  // 去除常见停用词
  const stop = new Set(['这个', '那个', '我们', '你们', '他们', '可以', '需要', '进行', '使用', '一个', '一些', '什么', '怎么', '如何', '如果', '因为', '所以', '但是', '然后', '并且', '或者', '以及', '还是', '没有', '就是', '不是', '对于', '关于', '通过', '根据', '按照', '项目', '文件', '功能', '实现', '添加', '修改', '删除', '创建', '优化', '提示', '词优', 'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into']);
  const filtered = focus.filter((w) => !stop.has(w.toLowerCase()));
  return filtered.slice(0, 8);
}

// 主题词提取：提示词关键词 ∪ focus（5–8 词）
function extractKeywords(text, focus) {
  const kw = inferFocusRules(text);
  const seen = new Set();
  const out = [];
  const add = (w) => {
    if (!w || seen.has(w) || w.length < 2) return;
    seen.add(w);
    out.push(w);
  };
  for (const w of kw) add(w);
  for (const w of (focus || [])) add(w);
  return out.slice(0, 8);
}

// 敏感文件硬过滤（防密钥/凭据注入外发）：.env/密钥/凭据/日志 等
function shouldIgnoreFile(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('.env')) return true;
  if (/(\.pem|\.key|\.p12|\.pfx|\.jks|\.keystore|\.crt|\.cer)$/.test(n)) return true;
  // 路径任意段命中凭据/密钥类文件名（含目录段，如 config/credentials.json）
  if (/(^|[\\/.])(credentials|secret|secrets|token|id_rsa|id_ed25519|id_ecdsa|\.npmrc|\.pypirc|\.netrc|\.htpasswd)([\\/.]|$)/.test(n)) return true;
  if (/\.log(\.|$)/.test(n)) return true;
  if (/^(node_modules|\.git|dist|build|\.venv|venv|__pycache__|\.next|\.cache|coverage)/.test(n)) return true;
  return false;
}

// 文件排序：名称/路径命中关键词计分（路径深度浅加分）→ Top-K
function rankFiles(files, keywords, topK) {
  const kws = (keywords || []).filter((k) => typeof k === 'string' && k.length >= 2);
  if (kws.length === 0 || !Array.isArray(files)) return [];
  const scored = [];
  for (const f of files) {
    const name = String(f || '');
    if (shouldIgnoreFile(name)) continue;
    const lower = name.toLowerCase();
    let score = 0;
    for (const k of kws) {
      const kl = k.toLowerCase();
      if (lower.includes(kl)) score += 2;          // 名称/路径命中
      const base = lower.split(/[\\/]/).pop();
      if (base.includes(kl)) score += 3;           // 文件名命中权重更高
    }
    if (score > 0) {
      const depth = name.split(/[\\/]/).length - 1;
      scored.push({ path: name, score: score - depth * 0.1 });  // 浅路径优先
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK || 3);
}

// 行摘要：命中行 ±2 上下文；无命中取头部 40 行；≤预算字符
function snippetFromLines(lines, keywords, budget) {
  const arr = Array.isArray(lines) ? lines : [];
  const b = typeof budget === 'number' && budget > 0 ? budget : 800;
  const kws = (keywords || []).filter((k) => typeof k === 'string' && k.length >= 2);
  const hits = [];
  if (kws.length > 0) {
    for (let i = 0; i < arr.length; i++) {
      const ln = String(arr[i] || '');
      if (kws.some((k) => ln.toLowerCase().includes(k.toLowerCase()))) {
        hits.push(i);
        if (hits.length >= 8) break;
      }
    }
  }
  let out = [];
  if (hits.length > 0) {
    const picked = new Set();
    for (const h of hits) {
      for (let i = Math.max(0, h - 2); i <= Math.min(arr.length - 1, h + 2); i++) picked.add(i);
    }
    out = [...picked].sort((a, b) => a - b).map((i) => String(arr[i] || ''));
  } else {
    out = arr.slice(0, 40);
  }
  let text = out.join('\n');
  if (text.length > b) text = text.slice(0, b);
  return text;
}

// 上下文块组装：任务进度(≤800) + 文件(≤3×800) + 事件(≤800)；
// 截断优先级：进度 > 文件 > 事件 > 原文完整（原文由调用方保证不截断）
function buildContextBlock(progress, files, events, budgetChars) {
  const budget = typeof budgetChars === 'number' && budgetChars > 0 ? budgetChars : 0;
  if (budget <= 0) return '';
  const MAX_PROGRESS = Math.min(800, budget);
  const MAX_EVENT = Math.min(800, Math.floor(budget / 4));
  const MAX_FILE = budget > 800 ? Math.min(800, Math.floor((budget - Math.min(800, MAX_PROGRESS) - MAX_EVENT) / 3)) : 0;
  const parts = [];
  let used = 0;
  // 1) 任务进度（最高优先级）
  if (progress && (progress.task || progress.currentStep || (progress.completed && progress.completed.length))) {
    const lines = [];
    if (progress.task) lines.push('任务：' + progress.task);
    if (progress.currentStep) lines.push('当前步骤：' + progress.currentStep);
    if (Array.isArray(progress.completed) && progress.completed.length) lines.push('已完成：' + progress.completed.join('；'));
    const text = lines.join('\n').slice(0, MAX_PROGRESS);
    if (text) {
      parts.push('【任务进度】\n' + text);
      used += text.length + 20;
    }
  }
  // 2) 相关文件（其次）
  if (MAX_FILE > 0 && Array.isArray(files) && files.length) {
    const segs = [];
    for (const f of files.slice(0, 3)) {
      if (!f || typeof f !== 'object') continue;
      const snip = String(f.snippet || '').slice(0, MAX_FILE);
      if (snip) segs.push('📄 ' + (f.path || '?') + '\n' + snip);
    }
    if (segs.length) {
      const text = segs.join('\n\n').slice(0, Math.max(0, budget - used));
      if (text) {
        parts.push('【相关项目文件】\n' + text);
        used += text.length + 20;
      }
    }
  }
  // 3) 相关会话片段（最后，预算余量）
  if (Array.isArray(events) && events.length) {
    const text = String(events.slice(0, 3).map((e) => typeof e === 'string' ? e : '').join('\n'))
      .slice(0, Math.max(0, Math.min(MAX_EVENT, budget - used)));
    if (text) parts.push('【相关会话片段】\n' + text);
  }
  return parts.join('\n\n');
}

// smart 模式 JSON 容错解析（剥离 ```json 代码块与前后缀噪音）
function parseTaskProgress(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  s = s.slice(start, end + 1);
  let obj;
  try {
    obj = JSON.parse(s);
  } catch (e) {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  if (typeof obj.task === 'string' && obj.task.trim()) out.task = obj.task.trim().slice(0, 200);
  if (typeof obj.currentStep === 'string' && obj.currentStep.trim()) out.currentStep = obj.currentStep.trim().slice(0, 200);
  if (Array.isArray(obj.completed)) {
    out.completed = obj.completed.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim().slice(0, 120)).slice(0, 5);
  }
  if (Array.isArray(obj.focus)) {
    out.focus = obj.focus.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim().slice(0, 40)).slice(0, 4);
  }
  if (!out.task && !out.currentStep && !out.completed) return null;
  return out;
}
// ================= V2 纯函数族结束 =================

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

// ================= V2 上下文感知优化 · 运行时（阶段 A/B/C） =================
// v2.0.0 方案 §3：阶段 A 任务进度（smart LLM / basic 规则）→ 阶段 B 相关性检索
// （工作区文件 + 会话事件）→ 阶段 C 预算组装注入。各阶段独立降级，不阻断优化。

const TASK_ANALYSIS_PROMPT = [
  '你是一个会话任务分析器。根据给定的会话对话历史，输出当前任务的执行进度。',
  '只输出 JSON（不要任何其他文字），格式：',
  '{"task":"任务目标一句话","currentStep":"当前正在执行的步骤","completed":["已完成步骤1","已完成步骤2"],"focus":["焦点方向1","焦点方向2"]}',
  'focus 为 2-4 个关键词/短语（中英文均可），用于后续检索项目文件。',
  '如果历史不足以判断，task 与 currentStep 可为空字符串，completed 与 focus 可为空数组。',
].join('\n');

// V2 防上下文回显约束：追加到优化 system 末尾（方案 §3 阶段 C）
const CONTEXT_GUARD = '【参考上下文】仅供理解任务与项目背景，禁止复述、引用或回显其中任何内容；只输出优化后的提示词本身。';

const V2_WORKSPACE_IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', '.cache', 'coverage', 'target', '.idea', '.vscode']);

// 阶段 A：任务进度理解（smart → basic 降级；失败返回 null 不抛错）
async function v2ResolveProgress(services, historyText, cfg) {
  if (cfg.context.mode === 'smart' && services.llm && services.chain && services.chain.length > 0 && historyText.trim() !== '') {
    const entry = services.chain[0];
    let timedOut = false;
    const timer = services.timer.timeout(() => { timedOut = true; }, 15000);
    try {
      const stream = services.llm.stream({
        provider: entry.provider,
        model: entry.model,
        ...(entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
        maxTokens: 400,
        system: TASK_ANALYSIS_PROMPT,
        messages: [{
          id: 'enhance-task-progress',
          role: 'user',
          content: [{ type: 'text', text: historyText.slice(0, 8000) }],
          source: { kind: 'user' },
        }],
      });
      const iterator = stream[Symbol.asyncIterator]();
      const result = await collectStream(iterator, 2000);
      if (!timedOut && result.kind === 'ok') {
        const parsed = parseTaskProgress(result.text);
        if (parsed) {
          hlog('[enhance] v2 smart progress ok');
          return { progress: parsed, mode: 'smart' };
        }
        hlog('[enhance] v2 smart progress bad-json');
      } else {
        hlog('[enhance] v2 smart progress ' + (timedOut ? 'timeout' : 'empty'));
      }
    } catch (e) {
      hlog('[enhance] v2 smart progress failed', e && e.message ? e.message : e);
    } finally {
      timer();
    }
  }
  // basic 规则提取（零成本；无历史时返回空 focus）
  const focus = inferFocusRules(historyText);
  if (focus.length > 0) return { progress: { focus }, mode: 'basic' };
  return { progress: null, mode: 'basic' };
}

// 阶段 B：工作区文件检索（fs 扫描 + 名称/内容命中 → Top-3 摘要；2s 超时降级）
// v2.0.7：fs 契约修正——listDir/readText 接收 FsTarget（resolve 产出），条目 shape 为
// {name, type:'file'|'directory', target}；不再传字符串路径。
async function v2SearchWorkspace(services, keywords, cfg) {
  const fsSvc = services.fs;
  const root = services.sandboxPolicy && services.sandboxPolicy.workspaceRoot;
  if (!fsSvc || !root || typeof fsSvc.listDir !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.resolve !== 'function') return [];
  const depth = cfg.context.workspace.depth || 2;
  const maxFiles = cfg.context.workspace.maxFiles || 3;
  let aborted = false;
  const timer = services.timer.timeout(() => { aborted = true; }, 2000);
  try {
    let rootTarget;
    try {
      rootTarget = await fsSvc.resolve(root);
    } catch (e) {
      hlog('[enhance] v2 workspace resolve-root failed', e && e.message ? e.message : e);
      return [];
    }
    const files = [];
    const walk = async (target, rel, level) => {
      if (aborted || files.length >= 2000 || level > depth) return;
      let entries;
      try {
        entries = await fsSvc.listDir(target);
      } catch (e) { return; }
      for (const en of entries || []) {
        if (aborted) return;
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
    if (aborted) { hlog('[enhance] v2 workspace scan timeout'); return []; }
    hlog('[enhance] v2 workspace scanned files=' + files.length);
    // 名称匹配 → 候选
    const candidates = rankFiles(files, keywords, 10).map((c) => c.path);
    if (candidates.length === 0) {
      hlog('[enhance] v2 workspace no-name-match files=' + files.length + ' kws=' + JSON.stringify(keywords));
      return [];
    }
    // 内容命中加分 → 排序 Top-maxFiles
    const scored = [];
    for (const rel of candidates) {
      if (aborted) break;
      if (shouldIgnoreFile(rel)) continue;
      let text = '';
      try {
        const target = await fsSvc.resolve(rel, { cwd: root });
        text = await fsSvc.readText(target);
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
    return top.map((f) => ({ path: f.path, snippet: snippetFromLines(f.lines, keywords, 800) }));
  } finally {
    timer();
  }
}

// 阶段 B3：会话事件检索（增强；searchEvents 契约：{sessionId,query,limit} → {items:[{snippet}]}；失败跳过）
async function v2SearchEvents(services, sessionId, keywords) {
  const sq = services.sessionQuery;
  const kws = (keywords || []).filter((k) => typeof k === 'string' && k.trim() !== '');
  if (!sq || typeof sq.searchEvents !== 'function' || kws.length === 0) {
    hlog('[enhance] v2 searchEvents skipped kws=' + kws.length);
    return [];
  }
  try {
    const page = await sq.searchEvents({ sessionId, query: kws.join(' '), limit: 3 });
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
  }
}

// 阶段 A/B/C 汇总：返回 { block, log }（全部不可用 → { block: '', log: 'none' }）
// v2.0.5：listEvents 仅返回元数据（无文本）——历史文本改用 filterEvents seq 范围取文档。
async function buildV2ContextBlock(services, sessionId, text, cfg) {
  let events = [];
  let historyText = '';
  const sq = services.sessionQuery;
  if (sq && typeof sq.listEvents === 'function' && typeof sq.filterEvents === 'function') {
    try {
      const records = await sq.listEvents(sessionId);
      // 尾部反向找最近的消息事件 seq（listEvents 升序，无文本；seq 用于 filterEvents 范围过滤）
      const msgSeqs = [];
      for (let i = records.length - 1; i >= 0 && msgSeqs.length < 16; i--) {
        const r = records[i];
        const t = String(r && r.type || '');
        if (t === 'user/message' || t === 'assistant/message') msgSeqs.push(r && r.seq);
      }
      if (msgSeqs.length > 0) {
        const minSeq = msgSeqs[msgSeqs.length - 1];
        const docs = await sq.filterEvents(sessionId, [{ kind: 'seq', from: minSeq }]);
        events = extractHistory(docs, 12);
        historyText = events.map((e) => (e.type === 'user' ? '[用户] ' : '[助手] ') + e.text).join('\n');
        hlog('[enhance] v2 history raw=' + records.length + ' msgSeqs=' + msgSeqs.length + ' minSeq=' + minSeq + ' docs=' + (docs ? docs.length : 'null') + ' events=' + events.length + ' chars=' + historyText.length + ' firstType=' + (events.length ? events[0].type : '-'));
      } else {
        hlog('[enhance] v2 history raw=' + records.length + ' msgSeqs=0 tailTypes=' + JSON.stringify(records.slice(-3).map((e) => e && e.type)));
      }
    } catch (e) {
      hlog('[enhance] v2 listEvents/filterEvents failed', e && e.message ? e.message : e);
    }
  } else {
    hlog('[enhance] v2 sessionQuery unavailable');
  }
  const root = services.sandboxPolicy && services.sandboxPolicy.workspaceRoot;
  hlog('[enhance] v2 workspaceRoot=' + (root || '(none)') + ' fs=' + (services.fs ? 'yes' : 'no'));
  // 阶段 A
  const { progress, mode } = await v2ResolveProgress(services, historyText, cfg);
  // 阶段 B
  const focus = progress && Array.isArray(progress.focus) ? progress.focus : [];
  const keywords = extractKeywords(text, focus);
  const files = await v2SearchWorkspace(services, keywords, cfg);
  const eventsHits = await v2SearchEvents(services, sessionId, keywords);
  // 阶段 C
  const budget = cfg.context.budgetChars || 0;
  const block = buildContextBlock(progress, files, eventsHits, budget);
  const ctxLog = block === ''
    ? 'none'
    : (mode + ' files=' + files.length + ' events=' + eventsHits.length + ' chars=' + block.length);
  return { block, log: ctxLog };
}

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
      // v23（D6）：模型链 = cfg.fallback 按序（每条独立 reasoningEffort）；
      // 链为空 → 自适应解析当前环境默认链（不再区分 main/fallback）
      const chain = buildTryChain(cfg.fallback, await resolveAdaptiveChain(ctx.get('llm'), ctx.get('agentDefaultModel')));
      // v2.0.0（H2）：引擎分支——V2 阶段 A/B/C 在优化超时计时器启动前执行（各自独立超时，不占 timeoutMs 预算）
      let v2Block = '';
      let v2Log = 'none';
      let system = cfg.templateMode === 'custom' && cfg.templateText.trim() !== '' ? cfg.templateText.trim() : SYSTEM_PROMPT;
      if (shouldInjectV2(cfg.engine, cfg.context.budgetChars)) {
        const v2 = await buildV2ContextBlock({
          llm: ctx.get('llm'),
          sessionQuery: ctx.get('sessionQuery'),
          sandboxPolicy: ctx.get('sandboxPolicy'),
          fs: ctx.get('fs'),
          timer: ctx.timer,
          chain,
        }, sessionId, text, cfg);
        v2Block = v2.block;
        v2Log = v2.log;
        if (v2Block !== '') system = system + '\n\n' + CONTEXT_GUARD;
      }
      const timeoutMs = cfg.timeoutMs;
      const maxTokens = cfg.maxTokens;
      const outputLimit = cfg.outputLimit;
      const userText = v2Block !== '' ? v2Block + '\n\n' + wrapUserText(text) : wrapUserText(text);
      hlog('[enhance] cfg session=' + sessionId + ' engine=' + cfg.engine + ' ctx=' + v2Log + ' chain=' + (chain.length > 0 ? chain.map((f) => f.provider + '/' + f.model).join(',') : '-') + ' timeout=' + timeoutMs + ' maxTokens=' + maxTokens + ' outputLimit=' + outputLimit + ' template=' + (system === SYSTEM_PROMPT ? 'builtin' : (system.indexOf(CONTEXT_GUARD) !== -1 ? 'custom+v2guard' : 'custom')));

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
              content: [{ type: 'text', text: userText }],
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