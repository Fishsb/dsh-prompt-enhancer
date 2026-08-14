// ============================================================================
// DSH「提示词优化」插件 · Host 半部（v2.3：优化按钮交互升级——阶段进度 + 记忆开关可视化）
// v2.3（方案「提示词优化方案.md」§7）：① STAGE_* 常量 + pending 记录 stage 标记
// （prepare→history→analyze→files→events→context→llm），buildV2ContextBlock 注入 onStage 回调；
// ② 新增 enhance/progress 轮询 RPC（client 500ms 轮询展示步骤进度，纯展示、失败静默降级）；
// ③ 记忆状态改由 client 输入区记忆开关自身表达（关=变暗置灰 / 开=高饱和橙），host 无行为变化。
// v2.2（方案「提示词优化方案.md」§0.2/§2/§6）：
// ① 模式体系收敛 4 模式（base/lite/standard/smart），MODE_TABLE 表驱动（阶段 A/B/C 分发）；
// ② 记忆功能改为所有模式可开/关的独立开关（config.memory，缺省 false）——记忆块作为
//    叠加模块注入（shouldInjectMemory），记忆优先占用预算（≤1200），模式块用剩余预算；
// ③ 配置迁移：mode='memory' → mode='lite' + memory=true；autoMemory 并入 memory；
// ④ 日志 mode=base|lite|standard|smart（seed 场景标注 (seed)），ctx 日志含 memory chars=。
// v2.1：记忆模式（5 模式）——v2.2 已删除，历史值迁移见 ②。
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

// ================= v2.2 模式体系 · 常量层与行为表（表驱动，单测切片求值） =================
// 方案「提示词优化方案.md」§4/§6：4 模式 + 记忆独立开关（memoryOn，扩散到所有模式）；
// 记忆模式已删除——记忆块作为叠加模块注入（shouldInjectMemory）。
const BUDGET_OPTIONS = [0, 2000, 4000, 8000];
// 预算 → 扫描上限查表（仅 scanLimit:'by-budget' 模式消费；maxFiles = 注入 Top-N 上限）
const BUDGET_WORKSPACE_TABLE = [
  { budget: 0, maxFiles: 2, depth: 1 },
  { budget: 2000, maxFiles: 2, depth: 1 },
  { budget: 4000, maxFiles: 3, depth: 2 },
  { budget: 8000, maxFiles: 6, depth: 3 },
];
// 阶段 A/B/C 与默认预算；budgetDefault 仅默认值，运行时以 config.budgetChars 为准
const MODE_TABLE = {
  base: { phaseA: 'none', phaseB: 'none', phaseC: 'none', budgetDefault: 0, scanLimit: 'fixed' },
  lite: { phaseA: 'rule', phaseB: 'none', phaseC: 'none', budgetDefault: 0, scanLimit: 'fixed' },
  standard: { phaseA: 'rule', phaseB: 'file+event', phaseC: 'inject', budgetDefault: 4000, scanLimit: 'fixed' },
  smart: { phaseA: 'llm', phaseB: 'file+event', phaseC: 'inject', budgetDefault: 4000, scanLimit: 'by-budget' },
};
const MODE_KEYS = Object.keys(MODE_TABLE);
const DEFAULT_MODE = 'base';
const DEFAULT_BUDGET = 4000;
// 记忆开关默认（§6.4：缺省 false，行为零变化）
const DEFAULT_MEMORY = false;
// 模式 → 扫描上限（fixed 模式固定值）
const FIXED_SCAN_LIMIT = { maxFiles: 3, depth: 2 };
// V2 阶段超时/上限/截断
const V2_PROGRESS_TIMEOUT_MS = 15000;
const V2_PROGRESS_MAX_TOKENS = 400;
const V2_PROGRESS_OUTPUT_LIMIT = 2000;
const V2_HISTORY_MAX_CHARS = 8000;
const V2_HISTORY_LIMIT = 12;
const V2_MSG_SEQ_SCAN = 16;
const V2_MSG_TEXT_MAX = 1200;
const V2_WORKSPACE_TIMEOUT_MS = 2000;
const SCAN_FILE_LIST_MAX = 2000;
const INJECT_FILE_TOP_N = 3;
const KEYWORD_LIMIT = 8;
const SNIPPET_BUDGET = 800;
const CONTEXT_PROGRESS_MAX = 800;
const CONTEXT_EVENT_DIVISOR = 4;
const CONTEXT_FILE_COUNT = 3;
const MEMORY_PREV_INPUT_MAX = 400;
const MEMORY_PREV_OUTPUT_MAX = 800;
// 记忆块预算上限（§6.5：记忆优先占用，合计 ≤1200）
const MEMORY_BLOCK_BUDGET_MAX = MEMORY_PREV_INPUT_MAX + MEMORY_PREV_OUTPUT_MAX;
// 记忆块模板（§2.3）
const MEMORY_BLOCK_TEMPLATE = '【上一轮优化】仅供参考，禁止回显\n原始输入：{prevInput}\n优化输出：{prevOutput}';
// v2.3（§7.3）：优化阶段常量——enhance 请求生命周期 stage 标记（progress RPC 读取）
const STAGE_PREPARE = 'prepare';
const STAGE_HISTORY = 'history';
const STAGE_ANALYZE = 'analyze';
const STAGE_FILES = 'files';
const STAGE_EVENTS = 'events';
const STAGE_CONTEXT = 'context';
const STAGE_LLM = 'llm';
const STAGE_DONE = 'done';
const STAGE_SEQUENCE = [STAGE_PREPARE, STAGE_HISTORY, STAGE_ANALYZE, STAGE_FILES, STAGE_EVENTS, STAGE_CONTEXT, STAGE_LLM, STAGE_DONE];
// stage → 文案映射（单测 U24 断言键一致；client 侧 i18n 同键名独立维护）
const STAGE_LABELS = {
  prepare: { zh: '准备中…', en: 'Preparing…' },
  history: { zh: '读取会话…', en: 'Reading history…' },
  analyze: { zh: '分析任务…', en: 'Analyzing task…' },
  files: { zh: '检索文件…', en: 'Searching files…' },
  events: { zh: '检索会话…', en: 'Searching events…' },
  context: { zh: '组装上下文…', en: 'Assembling context…' },
  llm: { zh: 'LLM 优化中…', en: 'Optimizing…' },
  done: { zh: '✓', en: '✓' },
};

// 模式解析（表驱动）：显式 mode 白名单（4 模式）；旧 engine/context.mode 迁移；缺省/非法 → base
// v2.2：记忆模式已删除——'memory' 值由 validateConfig 迁移为 lite + memory:true（此处落到 base 兜底）
function parseMode(mode, engine, legacyMode) {
  if (typeof mode === 'string' && MODE_KEYS.includes(mode)) return mode;
  if (engine === 'v2') {
    if (legacyMode === 'basic') return 'standard';
    if (legacyMode === 'smart') return 'smart';
  }
  return DEFAULT_MODE; // engine v1 / 缺省 / 非法 → base（行为零变化）
}

// 记忆开关解析（v2.2 §6.4）：优先级 memory = (mode==='memory') || autoMemory===true；缺省 false
function parseMemory(mode, autoMemory) {
  return mode === 'memory' || autoMemory === true;
}

// 记忆注入判定（v2.2 §6.5）：开关开 + 有记忆 + 预算>0 → 注入记忆块（叠加模块，所有模式适用）
function shouldInjectMemory(memoryOn, hasMemory, budgetChars) {
  return memoryOn === true && hasMemory === true && typeof budgetChars === 'number' && budgetChars > 0;
}

// 预算白名单校验（缺省 → 默认值）
function parseBudgetChars(value) {
  return BUDGET_OPTIONS.includes(value) ? value : DEFAULT_BUDGET;
}

// 扫描上限解析：by-budget 查联动表（取不超过预算的最大档），fixed 用固定值
function resolveScanLimit(mode, budgetChars) {
  const row = MODE_TABLE[mode] || MODE_TABLE[DEFAULT_MODE];
  if (row.scanLimit === 'by-budget') {
    let pick = BUDGET_WORKSPACE_TABLE[0];
    for (const entry of BUDGET_WORKSPACE_TABLE) {
      if (entry.budget <= budgetChars) pick = entry;
    }
    return pick;
  }
  return FIXED_SCAN_LIMIT;
}

// 记忆块构建（预算分配：prevInput ≤ 400、prevOutput ≤ 800、合计 ≤ budget；预算 0 或无原文 → 空）
function buildMemoryBlock(prevInput, prevOutput, budgetChars) {
  const budget = typeof budgetChars === 'number' && budgetChars > 0 ? budgetChars : 0;
  if (budget <= 0) return '';
  const pi = String(prevInput || '').slice(0, Math.min(MEMORY_PREV_INPUT_MAX, budget));
  if (!pi) return ''; // 无上一轮原文 → 记忆块无意义
  const po = String(prevOutput || '').slice(0, Math.min(MEMORY_PREV_OUTPUT_MAX, Math.max(0, budget - pi.length)));
  return MEMORY_BLOCK_TEMPLATE.replace('{prevInput}', pi).replace('{prevOutput}', po);
}

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
    // v2.2（§6.4）：4 模式 + 记忆开关（缺省 false，行为零变化）
    mode: DEFAULT_MODE,
    context: { mode: 'smart', budgetChars: DEFAULT_BUDGET, workspace: { maxFiles: 3, depth: 2 } },
    memory: DEFAULT_MEMORY,
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
  // v2.2（§6.4）：mode 解析（4 模式白名单；'memory' 历史值 → lite + memory:true）
  const rawMode = src.mode === 'memory' ? 'lite' : src.mode;
  out.mode = parseMode(rawMode, src.engine, src.context && src.context.mode);
  const ctxCfg = src.context && typeof src.context === 'object' ? src.context : {};
  out.context.budgetChars = parseBudgetChars(ctxCfg.budgetChars);
  // 旧 workspace 字段仅作上限兼容（不超联动值），不再单独生效（§0.2）
  if (ctxCfg.workspace && typeof ctxCfg.workspace === 'object') {
    const lim = resolveScanLimit(out.mode, out.context.budgetChars);
    if (Number.isInteger(ctxCfg.workspace.maxFiles) && ctxCfg.workspace.maxFiles >= 1 && ctxCfg.workspace.maxFiles <= lim.maxFiles) out.context.workspace.maxFiles = ctxCfg.workspace.maxFiles;
    if (Number.isInteger(ctxCfg.workspace.depth) && ctxCfg.workspace.depth >= 1 && ctxCfg.workspace.depth <= lim.depth) out.context.workspace.depth = ctxCfg.workspace.depth;
  }
  // v2.2（§6.4）：记忆开关——显式 memory 字段（client config.memory）最高优先（含 false 关闭）；
  // 无 memory 字段时回退 mode='memory' / autoMemory 历史值；缺省 false
  out.memory = src.memory === true ? true : (src.memory === false ? false : parseMemory(src.mode, src.autoMemory));
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

// V2 分支判定（表驱动 §4.1）：phaseC 非 none 且预算 > 0 才走注入路径
function shouldInjectV2(mode, budgetChars) {
  const row = MODE_TABLE[mode] || MODE_TABLE[DEFAULT_MODE];
  return row.phaseC !== 'none' && typeof budgetChars === 'number' && budgetChars > 0;
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
    out.push({ type: role, text: text.slice(0, V2_MSG_TEXT_MAX) });
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
  return filtered.slice(0, KEYWORD_LIMIT);
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
  return out.slice(0, KEYWORD_LIMIT);
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
  const b = typeof budget === 'number' && budget > 0 ? budget : SNIPPET_BUDGET;
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
  const MAX_PROGRESS = Math.min(CONTEXT_PROGRESS_MAX, budget);
  const MAX_EVENT = Math.min(CONTEXT_PROGRESS_MAX, Math.floor(budget / CONTEXT_EVENT_DIVISOR));
  const MAX_FILE = budget > CONTEXT_PROGRESS_MAX ? Math.min(CONTEXT_PROGRESS_MAX, Math.floor((budget - Math.min(CONTEXT_PROGRESS_MAX, MAX_PROGRESS) - MAX_EVENT) / CONTEXT_FILE_COUNT)) : 0;
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

// 阶段 A：任务进度理解（表驱动 phaseA：none 跳过 / rule 正则 / llm 智能（失败降级 rule）/ memory 读记忆对）
// 返回值：{ progress, mode }；mode: 'smart'|'rule'|'memory'|'none'
async function v2ResolveProgress(services, historyText, cfg) {
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  if (row.phaseA === 'llm' && services.llm && services.chain && services.chain.length > 0 && historyText.trim() !== '') {
    const entry = services.chain[0];
    let timedOut = false;
    const timer = services.timer.timeout(() => { timedOut = true; }, V2_PROGRESS_TIMEOUT_MS);
    try {
      const stream = services.llm.stream({
        provider: entry.provider,
        model: entry.model,
        ...(entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
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
      const result = await collectStream(iterator, V2_PROGRESS_OUTPUT_LIMIT);
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
  let aborted = false;
  const timer = services.timer.timeout(() => { aborted = true; }, V2_WORKSPACE_TIMEOUT_MS);
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
      if (aborted || files.length >= SCAN_FILE_LIST_MAX || level > depth) return;
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
    return top.map((f) => ({ path: f.path, snippet: snippetFromLines(f.lines, keywords, SNIPPET_BUDGET) }));
  } finally {
    timer();
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
// v2.2（§6.5）：4 模式管道（base/lite 空块 / standard/smart 检索）+ 记忆块叠加模块——
// 记忆开 + 有记忆 → block = 模式块 + 记忆块（记忆优先占用预算 ≤1200，模式块用剩余）。
// v2.3（§7.3）：onStage 回调（由 enhance handler 注入，写 pending 记录的 stage 字段；
// 纯函数本体不接触模块状态，回调缺省为 no-op 保持 PURE 区段可切片）。
async function buildV2ContextBlock(services, sessionId, text, cfg, onStage) {
  const mark = typeof onStage === 'function' ? onStage : () => {};
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  const budget = cfg.context.budgetChars || 0;
  // ===== 记忆块（叠加模块，所有模式适用）=====
  let memoryBlock = '';
  const mem = services.memory;
  if (mem && mem.prevInput && budget > 0) {
    memoryBlock = buildMemoryBlock(mem.prevInput, mem.prevOutput, Math.min(budget, MEMORY_BLOCK_BUDGET_MAX));
  }
  const memoryUsed = memoryBlock.length;
  // ===== 模式管道（base/lite：phaseB='none' 无检索 → 空模式块）=====
  let modeBlock = '';
  let modeLog = 'none';
  if (row.phaseC === 'inject') {
    // 历史 + 阶段A + 阶段B
    let events = [];
    let historyText = '';
    const sq = services.sessionQuery;
    if (sq && typeof sq.listEvents === 'function' && typeof sq.filterEvents === 'function') {
      try {
        mark(STAGE_HISTORY);
        const records = await sq.listEvents(sessionId);
        // 尾部反向找最近的消息事件 seq（listEvents 升序，无文本；seq 用于 filterEvents 范围过滤）
        const msgSeqs = [];
        for (let i = records.length - 1; i >= 0 && msgSeqs.length < V2_MSG_SEQ_SCAN; i--) {
          const r = records[i];
          const t = String(r && r.type || '');
          if (t === 'user/message' || t === 'assistant/message') msgSeqs.push(r && r.seq);
        }
        if (msgSeqs.length > 0) {
          const minSeq = msgSeqs[msgSeqs.length - 1];
          const docs = await sq.filterEvents(sessionId, [{ kind: 'seq', from: minSeq }]);
          events = extractHistory(docs, V2_HISTORY_LIMIT);
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
    // 阶段 A（表驱动 phaseA：llm 智能 / rule 正则 / none 跳过）
    mark(STAGE_ANALYZE);
    const { progress, mode } = await v2ResolveProgress(services, historyText, cfg);
    // 阶段 B（表驱动 phaseB：file+event 全量 / none 跳过）
    const focus = progress && Array.isArray(progress.focus) ? progress.focus : [];
    const keywords = extractKeywords(text, focus);
    mark(STAGE_FILES);
    const files = await v2SearchWorkspace(services, keywords, cfg);
    mark(STAGE_EVENTS);
    const eventsHits = await v2SearchEvents(services, sessionId, keywords, cfg);
    // 阶段 C（inject）：模式块使用剩余预算（记忆优先占用）
    modeBlock = buildContextBlock(progress, files, eventsHits, Math.max(0, budget - memoryUsed));
    modeLog = modeBlock === '' ? 'none' : (mode + ' files=' + files.length + ' events=' + eventsHits.length + ' chars=' + modeBlock.length);
  }
  // ===== 汇总：模式块 + 记忆块（叠加）=====
  mark(STAGE_CONTEXT);
  const parts = [];
  if (modeBlock) parts.push(modeBlock);
  if (memoryBlock) parts.push(memoryBlock);
  const block = parts.join('\n\n');
  let ctxLog = 'none';
  if (block !== '') {
    const tags = [];
    if (modeBlock) tags.push(modeLog);
    if (memoryBlock) tags.push('memory chars=' + memoryBlock.length);
    ctxLog = tags.join('+');
  }
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

    // v2.3（§7.3）：优化进度轮询 RPC——从 pending Map 读 stage（纯展示，失败静默降级）
    harness.handle('enhance/progress', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
      const seq = args && typeof args.seq === 'number' ? args.seq : -1;
      const rec = pending.get(requestKey(sessionId, seq));
      if (!rec) return { ok: false, code: 'NO_RECORD' };
      return { ok: true, stage: rec.stage || STAGE_PREPARE };
    });

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

      // v2.3（§7.3）：记录提前创建（入参校验后）——stage 从 prepare 起可被 progress RPC 轮询
      const rec = { cancelled: false, timedOut: false, iterator: null, stage: STAGE_PREPARE };
      pending.set(key, rec);

      const cfg = validateConfig(args && args.config);
      // v2.1（§2.2）：client 已判定实际模式（显式/auto/seed），请求 mode 覆盖解析值
      if (args && typeof args.mode === 'string' && MODE_KEYS.includes(args.mode)) cfg.mode = args.mode;
      // v23（D6）：模型链 = cfg.fallback 按序（每条独立 reasoningEffort）；
      // 链为空 → 自适应解析当前环境默认链（不再区分 main/fallback）
      const chain = buildTryChain(cfg.fallback, await resolveAdaptiveChain(ctx.get('llm'), ctx.get('agentDefaultModel')));
      // v2.2（§6.5）：入口条件——模式注入或记忆叠加（记忆开 + 有记忆时 base/lite 也进入管道）
      let v2Block = '';
      let v2Log = 'none';
      let system = cfg.templateMode === 'custom' && cfg.templateText.trim() !== '' ? cfg.templateText.trim() : SYSTEM_PROMPT;
      const hasMemory = !!(args && args.memory && typeof args.memory === 'object' && args.memory.prevInput);
      if (shouldInjectV2(cfg.mode, cfg.context.budgetChars) || shouldInjectMemory(cfg.memory, hasMemory, cfg.context.budgetChars)) {
        const v2 = await buildV2ContextBlock({
          llm: ctx.get('llm'),
          sessionQuery: ctx.get('sessionQuery'),
          sandboxPolicy: ctx.get('sandboxPolicy'),
          fs: ctx.get('fs'),
          timer: ctx.timer,
          chain,
          memory: args && args.memory && typeof args.memory === 'object' ? args.memory : null,
        }, sessionId, text, cfg, (st) => { rec.stage = st; });
        v2Block = v2.block;
        v2Log = v2.log;
        if (v2Block !== '') system = system + '\n\n' + CONTEXT_GUARD;
      }
      const timeoutMs = cfg.timeoutMs;
      const maxTokens = cfg.maxTokens;
      const outputLimit = cfg.outputLimit;
      const userText = v2Block !== '' ? v2Block + '\n\n' + wrapUserText(text) : wrapUserText(text);
      const modeTag = args && args.seed === true ? cfg.mode + '(seed)' : cfg.mode;
      hlog('[enhance] cfg session=' + sessionId + ' mode=' + modeTag + ' ctx=' + v2Log + ' chain=' + (chain.length > 0 ? chain.map((f) => f.provider + '/' + f.model).join(',') : '-') + ' timeout=' + timeoutMs + ' maxTokens=' + maxTokens + ' outputLimit=' + outputLimit + ' template=' + (system === SYSTEM_PROMPT ? 'builtin' : (system.indexOf(CONTEXT_GUARD) !== -1 ? 'custom+v2guard' : 'custom')));

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
          rec.stage = STAGE_LLM;
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