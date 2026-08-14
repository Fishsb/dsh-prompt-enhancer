// ============================================================================
// DSH「提示词优化」插件 · Client 半部（v2.4.0：版本检测与一键更新 + 输入框按钮字体对齐）
// v2.4.0（方案「插件版本检测与一键更新方案.md」）：
// ① 插件管理 tab 顶部新增「版本检测与更新」卡片（UpdaterCard）——repo 输入 + 检测版本按钮 →
//    本地/远端版本与状态徽标（outdated 显示「一键拉取更新」）→ 目标目录（默认 host 计算的
//    defaultDir）→ 拉取结果 + 应用指引；repo 变更清空陈旧结果（方案 §4/§10）；
// ② config v2 新增 updater: { repo, targetDir }（sanitizeV2 白名单校验，旧配置兼容）；
// ③ 字体对齐（方案 §10.2）：.dsh-enh-btn-text 显式声明 13px/500/20px 三态共用锚点，
//    移除 .dsh-enh-mode 独立字号声明（继承锚点），杜绝继承链失效。
// v2.3（方案「提示词优化方案.md」§7）：
// ① EnhanceButton idle = emoji ✨ + 模式短标签（MODE_OPTIONS.short / i18n modeShort* 键），
//    订阅 configState——模式切换即时同步；
// ② enhancing = spinner + 步骤进度文案（500ms 轮询 enhance/progress，stage→i18n 文案，
//    轮询失败静默降级「优化中…」）+ hover 切「取消」（错误红）；
// ③ 记忆状态（v2.3.2 §7.9）：移除输入区记忆开关模块；记忆开/关只影响 ✨ 图标饱和度
//    （开=正常彩色 / 关=低饱和 dsh-enh-icon-dim），文字（模式短标签）饱和度不变；
//    空输入时按钮不再降低饱和度（disabled 仅保留点击无效与 cursor）。
// v2.3.3（§7.10）：① font-weight:500 对齐 DSH ModelSelect trigger（按钮与短标签）；
//    ② 空输入时按钮 = 记忆开关（disabled=false，点击 toggle config.memory，title 提示当前状态）；
//    ③ busy hover 闪烁修复——progress 文档流占位（宽度恒定）+ cancel absolute 覆盖 + opacity 切换。
// v2.3.1：动态 client 半部无浏览器 timer 全局（setInterval 不可用）——声明 inject:['timer']，
//    轮询改经 timerSvc.interval(callback, 500)，disposer 由 effect cleanup 调用；
//    timer 服务不可用时静默降级默认「优化中…」文案。
// v2.2（方案「提示词优化方案.md」§0.2/§2/§6）：
// ① 模式体系收敛 4 模式（base/lite/standard/smart）——记忆模式删除；
// ② 记忆功能改为所有模式可开/关的独立开关（config.memory，缺省 false）；
// ③ 配置迁移：mode='memory' → mode='lite' + memory=true；autoMemory → memory；
// ④ 实际模式由 resolveActualMode 判定（记忆开+有记忆→当前模式+记忆对；首次→lite 兜底 seed；
//    reload 有标记→当前模式原样），随请求传 host；dirty 标志删除；
// ⑤ 记忆写入条件（R1）：仅结果已应用且记忆开关开启时写入 + 打标；撤回清除记忆。
// v16：整合「模型与插件」单入口（三区 tab + 折叠区块）+ 斜杠命令守卫修复
// v17：思考开关/等级 + 连通性测试
// v18：① config 升级 v2（键 dsh.enhance.config.v2；v1 自动迁移写回并清理）：
//      main{provider,model,reasoning} / fallback[]（独立配置项，每条可设 reasoning）/
//      customModels[]（添加即连通性测试）/ order[]（仅展示顺序）/ params / template
//      ② 兜底链区块：增删改序 + 恢复默认 + 每行思考开关/等级（懒加载 efforts）
//      ③ 自定义模型区块：表单添加即测试；加载顺序区块：全量模型上移/下移
//      ④ fresh install：models/current 继承当前使用模型（含推理等级）初始化兜底链
// v19：fresh install / 恢复默认的链补足改经 host models/autochain（自适应解析）
// v20：内置兜底链（BUILTIN_CHAIN）硬编码指向 DeepSeek 官方模型（deepseek-official），
//      供「恢复默认」与 autochain 失败兜底使用；host 侧 autochain 亦返回 DeepSeek 官方链。
// v21：P1-3 修复 sessionStores 内存泄漏——组件卸载且状态空闲时 releaseStoreIfIdle 释放条目
// v22：① 移除「自定义模型」「加载顺序」模块（config 字段保留兼容）；
//      ② 兜底链并入主模型区块（子分区，不再独立折叠）；
//      ③ FallbackRow 按厂家区分：provider/model 双联动下拉；
//      ④ 每条兜底末尾加测试连通性小图标（行内结果）；
//      ⑤ 优化按钮不可选中（tabIndex=-1，无焦点环），仅点击触发。
// v23：① 主模型与兜底链整合为单一「模型配置」链——所有行同构，无主/兜之分；
//      ② 移除独立主模型表单区（厂家/模型/思考/等级/主测试按钮）；
//      ③ 测试结果块内固定单点集中显示（链列表下方、操作按钮上方），行结构测试前后不变；
//      ④ 单行元素宽度合理分配（厂家弹性 / 模型主体 / 思考等级固定 / 图标固定）；
//      ⑤ 老 v2 main 配置首次加载迁移为链首条（migrateMainIntoChain），此后忽略 main。
// v23.1：UI 视觉协调——厂家/模型下拉加宽（厂家 130–220px、模型保底 120px，箭头完全可见）；
//      行 gap 8→6px、思考开关 64px/等级 56px、图标按钮 22px 收紧，让位主下拉。
// v23.2：布局再分配——思考开关宽 2/3（43px）、厂家减 1/5（136px）、模型吃满整行剩余；
//      字体与字号恢复默认设置（移除 font-family:inherit 强制统一）。
// v2.0.0（v24）：V1/V2 引擎共存——config 新增 engine（v1 默认）/context{mode,budgetChars}；
//      优化参数栏新增「优化引擎」切换（V2 选中显示上下文理解/预算子配置）；
//      恢复默认只重置模型链，不动 engine/context。
// ============================================================================

const CONFIG_KEY = 'dsh.enhance.config.v2';
const CONFIG_KEY_V1 = 'dsh.enhance.config.v1';
const CONFIG_DEFAULTS = {
  version: 2,
  main: { provider: '', model: '', reasoning: { enabled: false, effort: '' } },
  fallback: [],
  customModels: [],
  order: [],
  params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
  template: { mode: 'builtin', text: '' },
  // v2.2（§6.2/§6.4）：4 模式（base 默认）+ 记忆独立开关（缺省 false，行为零变化）
  mode: 'base',
  context: { mode: 'smart', budgetChars: 4000, workspace: { maxFiles: 3, depth: 2 } },
  memory: false,
  // v2.4.0（方案 §4）：版本检测与更新配置（repo 空 = 默认仓库；targetDir 空 = 使用 defaultDir）
  updater: { repo: '', targetDir: '' },
};
// v20：内置兜底链硬编码指向 DeepSeek 官方模型（fresh install 补足与「恢复默认」）
const BUILTIN_CHAIN = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
];
// v2.2（§4.3/§6.6）：模式选项单点（4 模式，记忆模式已删除——记忆为独立开关）
// v2.3（§7.2）：short = 模式短标签（idle 按钮内显示；i18n modeShort* 键优先，此字段为回退）
const MODE_OPTIONS = [
  { value: 'base', label: '基础模式', short: '基础', hint: '直发优化，不读取任何上下文，全体系最快最省' },
  { value: 'lite', label: '轻量模式', short: '轻量', hint: '仅本地规则分析输入，不注入上下文，速度接近基础' },
  { value: 'standard', label: '标准模式', short: '标准', hint: '规则理解 + 工作区文件与会话事件检索注入，零额外 LLM 成本' },
  { value: 'smart', label: '智能模式', short: '智能', hint: 'LLM 分析任务进度 + 全量检索注入，上下文理解最准' },
];
const MODE_VALUES = MODE_OPTIONS.map((m) => m.value);
// v2.3（§7.2）：模式短标签解析——i18n 键（modeShort+Cap）优先（EN 正确），MODE_OPTIONS.short 回退
function modeShortLabel(t, mode) {
  const key = 'modeShort' + (mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : '');
  const localized = t(key);
  if (localized !== key) return localized;
  const row = MODE_OPTIONS.find((m) => m.value === mode);
  return row && row.short ? row.short : '';
}
// 已优化标记键（§2.4）：localStorage 按会话布尔标记（区分首次与 reload；仅记忆开启期打标）
const SEEN_KEY_PREFIX = 'dsh.enhance.seen.';

const configState = { value: { ...CONFIG_DEFAULTS }, listeners: new Set(), fresh: true };

function cloneDefaults() {
  return {
    version: 2,
    main: { provider: '', model: '', reasoning: { enabled: false, effort: '' } },
    fallback: [],
    customModels: [],
    order: [],
    params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
    template: { mode: 'builtin', text: '' },
    mode: 'base',
    context: { mode: 'smart', budgetChars: 4000, workspace: { maxFiles: 3, depth: 2 } },
    memory: false,
    updater: { repo: '', targetDir: '' },
  };
}

function sanitizeV2(parsed) {
  const v = cloneDefaults();
  const m = parsed.main && typeof parsed.main === 'object' ? parsed.main : {};
  if (typeof m.provider === 'string' && m.provider) v.main.provider = m.provider;
  if (typeof m.model === 'string' && m.model) v.main.model = m.model;
  if (m.reasoning && typeof m.reasoning === 'object') {
    if (m.reasoning.enabled === true) v.main.reasoning.enabled = true;
    if (typeof m.reasoning.effort === 'string' && m.reasoning.effort && m.reasoning.effort.length <= 32) v.main.reasoning.effort = m.reasoning.effort;
  }
  if (Array.isArray(parsed.fallback)) {
    for (const item of parsed.fallback.slice(0, 8)) {
      if (!item || typeof item !== 'object' || typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
      if (!item.provider || !item.model) continue;
      const entry = { provider: item.provider, model: item.model };
      if (item.reasoning && typeof item.reasoning === 'object' && item.reasoning.enabled === true && typeof item.reasoning.effort === 'string' && item.reasoning.effort) {
        entry.reasoning = { enabled: true, effort: item.reasoning.effort.slice(0, 32) };
      }
      if (!v.fallback.some((x) => x.provider === entry.provider && x.model === entry.model)) v.fallback.push(entry);
    }
  }
  if (Array.isArray(parsed.customModels)) {
    for (const item of parsed.customModels.slice(0, 20)) {
      if (!item || typeof item !== 'object' || typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
      if (!item.provider || !item.model) continue;
      const entry = { provider: item.provider, model: item.model, name: typeof item.name === 'string' && item.name ? item.name.slice(0, 40) : item.model };
      if (item.reasoning && typeof item.reasoning === 'object' && item.reasoning.enabled === true && typeof item.reasoning.effort === 'string' && item.reasoning.effort) {
        entry.reasoning = { enabled: true, effort: item.reasoning.effort.slice(0, 32) };
      }
      v.customModels.push(entry);
    }
  }
  if (Array.isArray(parsed.order)) {
    for (const key of parsed.order.slice(0, 50)) {
      if (typeof key === 'string' && key && !v.order.includes(key)) v.order.push(key);
    }
  }
  const p = parsed.params && typeof parsed.params === 'object' ? parsed.params : {};
  if (Number.isInteger(p.timeoutMs) && p.timeoutMs >= 1000 && p.timeoutMs <= 300000) v.params.timeoutMs = p.timeoutMs;
  if (Number.isInteger(p.maxTokens) && p.maxTokens >= 100 && p.maxTokens <= 16000) v.params.maxTokens = p.maxTokens;
  if (Number.isInteger(p.outputLimit) && p.outputLimit >= 500 && p.outputLimit <= 50000) v.params.outputLimit = p.outputLimit;
  const t = parsed.template && typeof parsed.template === 'object' ? parsed.template : {};
  if (t.mode === 'custom' || t.mode === 'builtin') v.template.mode = t.mode;
  if (typeof t.text === 'string' && t.text.length <= 4000) v.template.text = t.text;
  const ctxCfg = parsed.context && typeof parsed.context === 'object' ? parsed.context : {};
  // v2.2（§6.4）：mode 解析（4 模式白名单；'memory' 历史值 → lite + memory:true）
  const rawMode = parsed.mode === 'memory' ? 'lite' : parsed.mode;
  if (typeof rawMode === 'string' && MODE_VALUES.includes(rawMode)) {
    v.mode = rawMode;
  } else if (parsed.engine === 'v2') {
    const legacy = ctxCfg.mode;
    if (legacy === 'basic') v.mode = 'standard';
    else if (legacy === 'smart') v.mode = 'smart';
  }
  if ([0, 2000, 4000, 8000].includes(ctxCfg.budgetChars)) v.context.budgetChars = ctxCfg.budgetChars;
  if (ctxCfg.workspace && typeof ctxCfg.workspace === 'object') {
    if (Number.isInteger(ctxCfg.workspace.maxFiles) && ctxCfg.workspace.maxFiles >= 1 && ctxCfg.workspace.maxFiles <= 10) v.context.workspace.maxFiles = ctxCfg.workspace.maxFiles;
    if (Number.isInteger(ctxCfg.workspace.depth) && ctxCfg.workspace.depth >= 1 && ctxCfg.workspace.depth <= 4) v.context.workspace.depth = ctxCfg.workspace.depth;
  }
  // v2.2（§6.4）：记忆开关——mode='memory' 显式选择优先，autoMemory 并入；缺省 false
  v.memory = parsed.mode === 'memory' || parsed.autoMemory === true || parsed.memory === true;
  // v2.4.0（方案 §4）：updater 白名单校验（repo 格式 + 长度；targetDir 长度），旧配置缺字段 → 默认
  const u = parsed.updater && typeof parsed.updater === 'object' ? parsed.updater : {};
  if (typeof u.repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(u.repo) && u.repo.length <= 100) v.updater.repo = u.repo;
  if (typeof u.targetDir === 'string' && u.targetDir.length <= 200) v.updater.targetDir = u.targetDir;
  return v;
}

// v23（D7）：老 v2 `main` → 模型链首条迁移（链中已含该组合则不重复；迁移后清空 main 供 UI 忽略）
function migrateMainIntoChain(cfg) {
  const m = cfg.main && typeof cfg.main === 'object' ? cfg.main : null;
  if (m && typeof m.provider === 'string' && m.provider && typeof m.model === 'string' && m.model) {
    if (!cfg.fallback.some((x) => x.provider === m.provider && x.model === m.model)) {
      const entry = { provider: m.provider, model: m.model };
      if (m.reasoning && typeof m.reasoning === 'object' && m.reasoning.enabled === true && typeof m.reasoning.effort === 'string' && m.reasoning.effort) {
        entry.reasoning = { enabled: true, effort: m.reasoning.effort };
      }
      cfg.fallback = [entry].concat(cfg.fallback || []);
    }
  }
  cfg.main = { provider: '', model: '', reasoning: { enabled: false, effort: '' } };
  return cfg;
}

function migrateFromV1(parsed) {
  const v = cloneDefaults();
  if (typeof parsed.provider === 'string' && parsed.provider) v.main.provider = parsed.provider;
  if (typeof parsed.model === 'string' && parsed.model) v.main.model = parsed.model;
  if (typeof parsed.reasoningEffort === 'string' && parsed.reasoningEffort) {
    v.main.reasoning = { enabled: true, effort: parsed.reasoningEffort.slice(0, 32) };
  }
  if (Number.isInteger(parsed.timeoutMs) && parsed.timeoutMs >= 1000 && parsed.timeoutMs <= 300000) v.params.timeoutMs = parsed.timeoutMs;
  if (Number.isInteger(parsed.maxTokens) && parsed.maxTokens >= 100 && parsed.maxTokens <= 16000) v.params.maxTokens = parsed.maxTokens;
  if (Number.isInteger(parsed.outputLimit) && parsed.outputLimit >= 500 && parsed.outputLimit <= 50000) v.params.outputLimit = parsed.outputLimit;
  if (parsed.templateMode === 'custom' || parsed.templateMode === 'builtin') v.template.mode = parsed.templateMode;
  if (typeof parsed.templateText === 'string' && parsed.templateText.length <= 4000) v.template.text = parsed.templateText;
  return v;
}

function loadConfigFromStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // v23（D7）：老 v2 main → 链首条迁移（写回，此后 main 置空不再使用）
        configState.value = migrateMainIntoChain(sanitizeV2(parsed));
        configState.fresh = false;
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify(configState.value)); } catch (e) { /* 忽略 */ }
        return;
      }
    }
    const rawV1 = localStorage.getItem(CONFIG_KEY_V1);
    if (rawV1) {
      const parsed = JSON.parse(rawV1);
      if (parsed && typeof parsed === 'object') {
        configState.value = migrateMainIntoChain(migrateFromV1(parsed));
        configState.fresh = false;
        try {
          localStorage.setItem(CONFIG_KEY, JSON.stringify(configState.value));
          localStorage.removeItem(CONFIG_KEY_V1);
        } catch (e) { /* 忽略 */ }
        return;
      }
    }
    configState.value = cloneDefaults();
    configState.fresh = true; // 首次安装：模型链将继承当前使用模型
  } catch (e) {
    configState.value = cloneDefaults();
    configState.fresh = true;
  }
}

function saveConfig(patch) {
  configState.value = { ...configState.value, ...patch };
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(configState.value)); } catch (e) { /* 忽略 */ }
  }
  for (const fn of [...configState.listeners]) fn();
}

function subscribeConfig(fn) {
  configState.listeners.add(fn);
  return () => { configState.listeners.delete(fn); };
}

loadConfigFromStorage();

const ZH = {
  enhanceButton: '优化',
  enhancing: '优化中',
  result: '✓ 已优化，可撤回',
  titleIdle: '一键优化提示词（独立 LLM 调用）',
  titleBusy: '点击取消优化并恢复原文',
  titleResult: '恢复优化前的原文',
  titleEmpty: '请输入内容后再优化',
  titleCommand: '命令内容为空，无可优化',
  titleBusyInput: '当前输入状态不允许优化',
  // v2.3.3（§7.10）：空输入时按钮 = 记忆开关（点击切换记忆）
  titleMemoryOn: '记忆开关：点击切换记忆功能（当前：开）',
  titleMemoryOff: '记忆开关：点击切换记忆功能（当前：关）',
  errorPrefix: '优化失败：',
  dismiss: '知道了',
  cancel: '取消',
  errGUARD: '空输入或斜杠命令不支持优化',
  errNO_LLM: 'LLM 服务不可用',
  errUNKNOWN_MODEL: '优化模型不可用（不在服务目录中）',
  errNO_ADAPTER: 'LLM 提供方未启用',
  errINVALID_CREDENTIAL: 'API 密钥无效或缺失',
  errQUOTA: '模型额度不足',
  errCONTEXT_WINDOW_EXCEEDED: '输入超出模型上下文窗口',
  errEMPTY_RESPONSE: '模型返回了空响应',
  errOUTPUT_TOO_LONG: '优化结果超出长度限制',
  errTIMEOUT: '请求超时，已恢复原文',
  errABORTED: '请求已取消',
  errLLM_FAILED: '优化请求异常，请重试',
  errNETWORK: '优化请求失败（网络错误）',
  errUNKNOWN: '优化失败',
  navPlugins: '插件管理',
  pluginsEmpty: '还没有定义任何插件',
  pluginsLoadFailed: '读取插件清单失败',
  pluginsRunning: '运行中',
  pluginsStopped: '已停止',
  pluginsDefined: '未运行',
  pluginsAwaiting: '等待审批',
  pluginsFailed: '失败',
  pluginsClientPending: '激活中',
  pluginsWaiting: '等待服务',
  pluginsVersion: '版本',
  pluginsCurrent: '当前',
  pluginsRun: '运行',
  pluginsStop: '停止',
  pluginsRemove: '删除',
  pluginsApprove: '批准',
  pluginsDecline: '拒绝',
  pluginsApproveOnce: '批准（仅此版本）',
  pluginsActionFailed: '操作失败',
  pluginsRefresh: '刷新',
  // v2.4.0（方案 §4）：版本检测与更新卡片
  updTitle: '版本检测与更新',
  updRepo: 'GitHub 仓库',
  updCheck: '检测版本',
  updChecking: '检测中…',
  updLocal: '本地',
  updRemote: '远端',
  updOutdated: '发现新版本',
  updCurrent: '已是最新',
  updAhead: '本地已领先',
  updUnknown: '状态未知',
  updDir: '目标目录',
  updPull: '一键拉取更新',
  updPulling: '拉取中…',
  updDone: '✓ 已拉取',
  updApplyTitle: '应用更新（运行中的插件不可自替换，请按需选择）：',
  updApplyBundle: 'bundle 安装：dsh plugin --profile web update dsh-prompt-enhancer 后重启 dsh web',
  updApplyDynamic: '动态安装：让 agent 读取新文件后 cordis_define 新包并 cordis_run（update）',
  updApplyCopy: '脚本分发：用拉取结果覆盖本地副本目录',
  updError: '操作失败，请重试',
  cfgNav: '优化配置',
  cfgProvider: '模型提供方',
  cfgModel: '模型',
  cfgTimeout: '超时时间',
  cfgMaxTokens: '输出 Token 上限',
  cfgOutputLimit: '输出字符上限',
  cfgTemplateMode: '模板',
  cfgTemplateBuiltin: '内置模板',
  cfgTemplateCustom: '自定义模板',
  cfgTemplateText: '自定义模板内容',
  cfgSaved: '✓ 已保存',
  cfgLoadFailed: '加载模型列表失败',
  cfgEmptyModels: '该提供方暂无可用模型',
  cfgNoProvider: '未配置 LLM 提供方',
  cfgHint: '配置保存在本地浏览器（localStorage），仅对当前实例生效；主题请使用 Harness 原生外观设置。',
  cfgLogs: '诊断日志',
  cfgLogsEmpty: '暂无日志（执行优化后生成）',
  navModelPlugins: '模型与插件',
  tabModels: '模型配置',
  tabParams: '优化参数',
  tabPlugins: '插件管理',
  secMain: '模型配置',
  secFallback: '兜底链',
  secCustom: '自定义模型',
  secOrder: '加载顺序',
  secFallbackEmpty: '暂无模型（使用内置链）',
  secCustomEmpty: '暂无自定义模型',
  secOrderEmpty: '暂无模型',
  secFallbackBuiltin: '当前使用内置链',
  secFallbackCount: '{n} 模型 · 按序尝试',
  cfgReasoning: '思考能力',
  cfgReasoningLevel: '思考等级',
  cfgReasoningOn: '开',
  cfgReasoningOff: '关',
  cfgNoReasoning: '该模型不支持思考能力',
  cfgResolveFailed: '读取模型能力失败',
  cfgTest: '测试连通性',
  cfgTesting: '测试中…',
  cfgTestOk: '✓ 可用 · {ms}ms',
  cfgTestTtft: '（TTFT {ms}ms）',
  cfgTestFail: '✗ {msg}',
  cfgAddFallback: '＋ 添加模型',
  cfgRestoreDefaults: '恢复默认',
  cfgCustomName: '显示名',
  cfgAddCustom: '＋ 添加',
  cfgFallbackNote: '按顺序逐一尝试，失败则用下一条（可增删改序，每条可设思考）',
  cfgCustomNote: '仅限已有 provider 路由下的模型 ID；添加后自动连通性测试',
  cfgOrderNote: '仅影响模型下拉与候选的展示顺序',
  cfgInherited: '已继承当前使用模型（含推理等级）',
  // v2.2（§0.2/§6.6）：模式体系文案（MODE_OPTIONS hint 由 cfgModeHint 提供）
  cfgMode: '优化模式',
  cfgMemory: '记忆功能',
  cfgMemoryNote: '开启后，上一轮优化结果将作为记忆注入下一轮（所有模式可用，首次自动走轻量模式；关闭后完全不再读取/写入记忆）',
  cfgModeHintBase: '直发优化，不读取任何上下文，全体系最快最省',
  cfgModeHintLite: '仅本地规则分析输入，不注入上下文，速度接近基础',
  cfgModeHintStandard: '规则理解 + 工作区文件与会话事件检索注入，零额外 LLM 成本',
  cfgModeHintSmart: 'LLM 分析任务进度 + 全量检索注入，上下文理解最准',
  cfgContextBudget: '上下文预算',
  cfgContextBudget0: '0（关闭注入）',
  cfgContextNote: 'V2 按任务进度与提示词主题检索工作区相关文件后注入优化参考；预算 0 = 不注入（等价基础优化）',
  // v2.3（§7.2/§7.3）：模式短标签 + 步骤进度文案 + 记忆开关
  modeShortBase: '基础',
  modeShortLite: '轻量',
  modeShortStandard: '标准',
  modeShortSmart: '智能',
  stagePrepare: '准备中…',
  stageHistory: '读取会话…',
  stageAnalyze: '分析任务…',
  stageFiles: '检索文件…',
  stageEvents: '检索会话…',
  stageContext: '组装上下文…',
  stageLlm: 'LLM 优化中…',
  stageDone: '✓',
};

const EN = {
  enhanceButton: 'Optimize',
  enhancing: 'Optimizing',
  result: '✓ Optimized · Undo',
  titleIdle: 'Optimize the prompt with an independent LLM call',
  titleBusy: 'Click to cancel optimization and restore the original text',
  titleResult: 'Restore the original text',
  titleEmpty: 'Type something first to optimize',
  titleCommand: 'Empty command, nothing to optimize',
  titleBusyInput: 'Input is not ready',
  // v2.3.3（§7.10）：空输入时按钮 = 记忆开关（点击切换记忆）
  titleMemoryOn: 'Memory toggle: click to switch (currently on)',
  titleMemoryOff: 'Memory toggle: click to switch (currently off)',
  errorPrefix: 'Optimize failed: ',
  dismiss: 'Dismiss',
  cancel: 'Cancel',
  errGUARD: 'Empty input or slash command is not supported',
  errNO_LLM: 'LLM service unavailable',
  errUNKNOWN_MODEL: 'Optimize model unavailable (not in the catalog)',
  errNO_ADAPTER: 'LLM provider not enabled',
  errINVALID_CREDENTIAL: 'Invalid or missing API key',
  errQUOTA: 'Model quota exceeded',
  errCONTEXT_WINDOW_EXCEEDED: 'Input exceeds the context window',
  errEMPTY_RESPONSE: 'Model returned an empty response',
  errOUTPUT_TOO_LONG: 'Optimization exceeds the length limit',
  errTIMEOUT: 'Request timed out, original text restored',
  errABORTED: 'Request cancelled',
  errLLM_FAILED: 'Optimize failed, please retry',
  errNETWORK: 'Network error',
  errUNKNOWN: 'Optimize failed',
  navPlugins: 'Cordis plugins',
  pluginsEmpty: 'No plugins defined yet',
  pluginsLoadFailed: 'Reading the plugin inventory failed',
  pluginsRunning: 'Running',
  pluginsStopped: 'Stopped',
  pluginsDefined: 'Not running',
  pluginsAwaiting: 'Awaiting approval',
  pluginsFailed: 'Failed',
  pluginsClientPending: 'Activating',
  pluginsWaiting: 'Waiting for services',
  pluginsVersion: 'Version',
  pluginsCurrent: 'Current',
  pluginsRun: 'Run',
  pluginsStop: 'Stop',
  pluginsRemove: 'Remove',
  pluginsApprove: 'Approve',
  pluginsDecline: 'Decline',
  pluginsApproveOnce: 'Approve (this version only)',
  pluginsActionFailed: 'Operation failed',
  pluginsRefresh: 'Refresh',
  // v2.4.0（方案 §4）：版本检测与更新卡片
  updTitle: 'Version check & update',
  updRepo: 'GitHub repo',
  updCheck: 'Check version',
  updChecking: 'Checking…',
  updLocal: 'Local',
  updRemote: 'Remote',
  updOutdated: 'New version available',
  updCurrent: 'Up to date',
  updAhead: 'Local is ahead',
  updUnknown: 'Unknown',
  updDir: 'Target directory',
  updPull: 'Pull update',
  updPulling: 'Pulling…',
  updDone: '✓ Pulled',
  updApplyTitle: 'Apply (a running plugin cannot replace itself; pick one):',
  updApplyBundle: 'Bundle install: dsh plugin --profile web update dsh-prompt-enhancer, then restart dsh web',
  updApplyDynamic: 'Dynamic install: have an agent read the new files, cordis_define a new package and cordis_run (update)',
  updApplyCopy: 'Script copy: overwrite the local distribution folder with the pulled files',
  updError: 'Operation failed, please retry',
  cfgNav: 'Optimize settings',
  cfgProvider: 'Provider',
  cfgModel: 'Model',
  cfgTimeout: 'Timeout',
  cfgMaxTokens: 'Max output tokens',
  cfgOutputLimit: 'Output character limit',
  cfgTemplateMode: 'Template',
  cfgTemplateBuiltin: 'Built-in',
  cfgTemplateCustom: 'Custom',
  cfgTemplateText: 'Custom template text',
  cfgSaved: '✓ Saved',
  cfgLoadFailed: 'Failed to load models',
  cfgEmptyModels: 'No models available for this provider',
  cfgNoProvider: 'No LLM provider configured',
  cfgHint: 'Preferences are stored locally in this browser (localStorage) and apply to this instance only. Theme is handled by the native Harness appearance settings.',
  cfgLogs: 'Diagnostics log',
  cfgLogsEmpty: 'No logs yet (they appear after optimizations)',
  navModelPlugins: 'Models & plugins',
  tabModels: 'Models',
  tabParams: 'Optimization',
  tabPlugins: 'Plugins',
  secMain: 'Model chain',
  secFallback: 'Fallback chain',
  secCustom: 'Custom models',
  secOrder: 'Load order',
  secFallbackEmpty: 'No models (built-in chain in effect)',
  secCustomEmpty: 'No custom models',
  secOrderEmpty: 'No models',
  secFallbackBuiltin: 'Built-in chain in effect',
  secFallbackCount: '{n} models · tried in order',
  cfgReasoning: 'Thinking',
  cfgReasoningLevel: 'Reasoning level',
  cfgReasoningOn: 'On',
  cfgReasoningOff: 'Off',
  cfgNoReasoning: 'This model does not support thinking',
  cfgResolveFailed: 'Failed to read model capabilities',
  cfgTest: 'Test connectivity',
  cfgTesting: 'Testing…',
  cfgTestOk: '✓ OK · {ms}ms',
  cfgTestTtft: '（TTFT {ms}ms）',
  cfgTestFail: '✗ {msg}',
  cfgAddFallback: '+ Add model',
  cfgRestoreDefaults: 'Restore defaults',
  cfgCustomName: 'Display name',
  cfgAddCustom: '+ Add',
  cfgFallbackNote: 'Tried in order; the next entry is used when one fails (reorderable; per-entry thinking settings)',
  cfgCustomNote: 'Model IDs under existing provider routes only; connectivity is tested on add',
  cfgOrderNote: 'Affects dropdown and candidate display order only',
  cfgInherited: 'Inherited from the current model (incl. reasoning level)',
  // v2.0.0（C3）：引擎与上下文配置文案
  cfgEngine: 'Engine',
  cfgMode: 'Mode',
  cfgMemory: 'Memory',
  cfgMemoryNote: 'When on, the previous optimization result is injected into the next round as memory (all modes; first run falls back to Lite automatically; when off, memory is never read or written)',
  cfgModeHintBase: 'Direct optimization, no context, fastest',
  cfgModeHintLite: 'Local rule analysis only, no injection',
  cfgModeHintStandard: 'Rule understanding + file & session retrieval, no extra LLM call',
  cfgModeHintSmart: 'LLM task analysis + full retrieval, best understanding',
  cfgContextBudget: 'Context budget',
  cfgContextBudget0: '0 (no injection)',
  cfgContextNote: 'V2 analyzes task progress and retrieves relevant workspace files before optimizing; budget 0 = no injection (equivalent to basic)',
  // v2.3（§7.2/§7.3）：模式短标签 + 步骤进度文案 + 记忆开关
  modeShortBase: 'Basic',
  modeShortLite: 'Lite',
  modeShortStandard: 'Standard',
  modeShortSmart: 'Smart',
  stagePrepare: 'Preparing…',
  stageHistory: 'Reading history…',
  stageAnalyze: 'Analyzing task…',
  stageFiles: 'Searching files…',
  stageEvents: 'Searching events…',
  stageContext: 'Assembling context…',
  stageLlm: 'Optimizing…',
  stageDone: '✓',
};

function errorKey(code) {
  const map = {
    GUARD: 'errGUARD',
    NO_LLM: 'errNO_LLM',
    UNKNOWN_MODEL: 'errUNKNOWN_MODEL',
    NO_ADAPTER: 'errNO_ADAPTER',
    INVALID_CREDENTIAL: 'errINVALID_CREDENTIAL',
    QUOTA: 'errQUOTA',
    CONTEXT_WINDOW_EXCEEDED: 'errCONTEXT_WINDOW_EXCEEDED',
    EMPTY_RESPONSE: 'errEMPTY_RESPONSE',
    OUTPUT_TOO_LONG: 'errOUTPUT_TOO_LONG',
    TIMEOUT: 'errTIMEOUT',
    ABORTED: 'errABORTED',
    LLM_FAILED: 'errLLM_FAILED',
    NETWORK: 'errNETWORK',
  };
  return map[code] || 'errUNKNOWN';
}

function makeT(props) {
  if (typeof props.t === 'function') return props.t;
  return (key) => ZH[key] || key;
}

const sessionStores = new Map();

function storeFor(sessionId) {
  let s = sessionStores.get(sessionId);
  if (!s) {
    s = { phase: 'idle', backup: '', enhanced: '', error: null, seq: 0, listeners: new Set(), memory: null };
    sessionStores.set(sessionId, s);
  }
  return s;
}

// v2.1（§2.4）：已优化标记（localStorage 按会话布尔，区分首次与 reload；无内容、不涉隐私）
function seenKey(sessionId) {
  return SEEN_KEY_PREFIX + sessionId;
}
function readSeen(sessionId) {
  try { return localStorage.getItem(seenKey(sessionId)) === '1'; } catch (e) { return false; }
}
function writeSeen(sessionId) {
  try { localStorage.setItem(seenKey(sessionId), '1'); } catch (e) { /* 忽略 */ }
}

function subscribe(sessionId, fn) {
  const s = storeFor(sessionId);
  s.listeners.add(fn);
  return () => { s.listeners.delete(fn); };
}

function notify(sessionId) {
  const s = storeFor(sessionId);
  for (const fn of [...s.listeners]) fn();
}

// v21（P1-3）：组件卸载且状态空闲时释放 store 条目，防止 sessionStores 无限增长（内存泄漏修复）
function releaseStoreIfIdle(sessionId) {
  const s = sessionStores.get(sessionId);
  if (!s) return;
  if (s.phase === 'idle' && s.listeners.size === 0 && s.error === null) {
    sessionStores.delete(sessionId);
  }
}

function safeSetDraft(inputActions, text) {
  if (!inputActions || typeof inputActions.setDraft !== 'function') return;
  try { inputActions.setDraft(text); } catch (e) { /* 忽略 */ }
}

function cancelEnhance(sessionId, inputActions) {
  const s = storeFor(sessionId);
  if (s.phase !== 'enhancing') return;
  const seq = s.seq;
  s.seq += 1;
  safeSetDraft(inputActions, s.backup);
  s.phase = 'idle';
  s.enhanced = '';
  s.error = null;
  notify(sessionId);
  host.call('cancel', { sessionId, seq }).catch(() => {});
}

// v16：斜杠命令拆分——保留「/命令 前缀」，仅优化其后正文（§3.6）
function splitCommand(draft) {
  const m = /^(\/\S+)(\s+)([\s\S]*)$/.exec(draft);
  if (m) return { prefix: m[1] + m[2], body: m[3] };
  return { prefix: '', body: draft };
}

// v2.2（§6.3/§6.5）：实际模式判定——纯模式选择 + 记忆开关/首次兜底（dirty/auto 已删除）。
// 返回 { mode, seed, memory }：seed = 首次轻量兜底标记；memory = 记忆对（供 host 叠加注入）。
function resolveActualMode(sessionId, cfg) {
  const s = storeFor(sessionId);
  let mode = cfg.mode;
  let seed = false;
  let memory = null;
  if (cfg.memory) {
    if (s.memory && s.memory.prevInput) {
      // 记忆开 + 有记忆 → 当前模式 + 记忆对（host 叠加）
      memory = s.memory;
    } else if (!readSeen(sessionId)) {
      // 记忆开 + 无记忆 + 无标记（真正首次）→ 轻量兜底（任何模式），完成后建记忆
      mode = 'lite';
      seed = true;
    }
    // 记忆开 + 无记忆 + 有标记（reload）→ 当前模式原样（不强制轻量）
  }
  return { mode, seed, memory };
}

function enhance(sessionId, draft, inputActions, draftRef) {
  const s = storeFor(sessionId);
  if (s.phase === 'enhancing') {
    const old = s.seq;
    s.seq += 1;
    host.call('cancel', { sessionId, seq: old }).catch(() => {});
  }
  s.backup = draft;
  s.seq += 1;
  const seq = s.seq;
  s.phase = 'enhancing';
  s.enhanced = '';
  s.error = null;
  notify(sessionId);

  const parts = splitCommand(draft);
  const config = configState.value;
  // v2.2（§6.3）：实际模式判定（纯模式 + 记忆开关/首次兜底）——实际 mode、seed、记忆对随请求传给 host
  const actual = resolveActualMode(sessionId, config);
  const req = { sessionId, seq, text: parts.body, config, mode: actual.mode };
  if (actual.seed) req.seed = true;
  if (actual.memory) req.memory = { prevInput: actual.memory.prevInput, prevOutput: actual.memory.prevOutput };
  host.call('enhance', req).then((res) => {
    if (seq !== s.seq) return;
    const r = res && typeof res === 'object' ? res : {};
    if (r.ok && typeof r.text === 'string' && r.text !== '') {
      if (draftRef.current !== s.backup) {
        // 结果被丢弃（增强中用户编辑草稿）：不替换、不写记忆、不打标记（L1）
        s.phase = 'idle';
        s.enhanced = '';
        s.error = null;
      } else {
        const finalText = parts.prefix + r.text;
        safeSetDraft(inputActions, finalText);
        s.phase = 'result';
        s.enhanced = finalText;
        s.error = null;
        // v2.2（§6.5/R1）：仅结果已应用且记忆开关开启时写入记忆（斜杠命令存正文）并打标
        if (config.memory) {
          s.memory = { prevInput: parts.body, prevOutput: r.text };
          writeSeen(sessionId);
        }
      }
    } else {
      safeSetDraft(inputActions, s.backup);
      s.phase = 'idle';
      s.enhanced = '';
      s.error = r.code && errorKey(r.code) !== 'errUNKNOWN' ? r.code : 'UNKNOWN';
    }
    notify(sessionId);
  }).catch(() => {
    if (seq !== s.seq) return;
    safeSetDraft(inputActions, s.backup);
    s.phase = 'idle';
    s.enhanced = '';
    s.error = 'NETWORK';
    notify(sessionId);
  });
}

function undo(sessionId, inputActions) {
  const s = storeFor(sessionId);
  if (s.phase !== 'result') return;
  safeSetDraft(inputActions, s.backup);
  s.phase = 'idle';
  s.enhanced = '';
  s.error = null;
  // v2.1（§2.4）：撤回 = 放弃上轮结果 = 清除其记忆（语义一致）
  s.memory = null;
  notify(sessionId);
}

function guardPasses(draft, input) {
  if (typeof draft !== 'string') return false;
  const t = draft.trim();
  if (t === '') return false;
  // v16（§3.6）：/命令 + 正文 → 允许（enhance 时保留前缀只优化正文）；纯 /命令 → 禁用
  if (t.startsWith('/') && !/^\/\S+\s+\S+/.test(t)) return false;
  if (!input) return false;
  // 提交/裁定窗口为真实锁定期；claimed（@引用/命令占位）放行
  if (input.phase === 'adjudicating' || input.phase === 'submitting') return false;
  return true;
}

function EnhanceButton(props) {
  const t = makeT(props);
  const sessionId = props.session && props.session.sessionId;
  const input = props.input || {};
  const draft = typeof input.draft === 'string' ? input.draft : '';
  const inputActions = props.inputActions;

  const [, setVersion] = React.useState(0);
  const draftRef = React.useState({ current: draft })[0];
  draftRef.current = draft;

  React.useEffect(() => subscribe(sessionId, () => setVersion((v) => v + 1)), [sessionId]);

  // v2.3（§7.2/T25）：订阅配置——模式/记忆切换后按钮标签即时同步
  const [, setCfg] = React.useState(0);
  React.useEffect(() => subscribeConfig(() => setCfg((v) => v + 1)), []);

  React.useEffect(() => {
    const s = storeFor(sessionId);
    if (s.phase === 'result' && draft !== s.enhanced) {
      s.phase = 'idle';
      s.enhanced = '';
      s.error = null;
      notify(sessionId);
    }
  }, [draft, sessionId]);

  React.useEffect(() => () => {
    const s = storeFor(sessionId);
    if (s.phase === 'enhancing') {
      const seq = s.seq;
      s.seq += 1;
      host.call('cancel', { sessionId, seq }).catch(() => {});
      s.phase = 'idle';
      s.enhanced = '';
      s.error = null;
      notify(sessionId);
    }
    // v21（P1-3）：卸载后空闲即释放，防内存泄漏
    releaseStoreIfIdle(sessionId);
  }, [sessionId]);

  // v2.3（§7.3）：enhancing 期间轮询 enhance/progress（500ms），stage → 本地进度文案
  // （hooks 必须位于条件提前 return 之前，保持每次渲染顺序稳定）
  const s = sessionId !== undefined ? storeFor(sessionId) : null;
  const phase = s ? s.phase : 'idle';
  const [stage, setStage] = React.useState(null);
  React.useEffect(() => {
    if (sessionId === undefined) return undefined;
    const st = storeFor(sessionId);
    if (st.phase !== 'enhancing') { setStage(null); return undefined; }
    let disposed = false;
    const seq = st.seq;
    setStage(null);
    // v2.3.1：动态 client 无浏览器 timer 全局——经 ctx timer 服务（inject:['timer']）；
    // 服务不可用时静默降级为默认「优化中…」文案（§7.3）
    if (!timerSvc || typeof timerSvc.interval !== 'function') return undefined;
    const disposer = timerSvc.interval(() => {
      host.call('enhance/progress', { sessionId, seq }).then((r) => {
        if (disposed || !r || r.ok !== true) return;
        if (typeof r.stage === 'string') setStage(r.stage);
      }).catch(() => { /* 轮询失败静默降级为默认「优化中…」文案（§7.3） */ });
    }, 500);
    return () => { disposed = true; disposer(); };
  }, [phase, sessionId, s ? s.seq : 0]);

  if (!inputActions || sessionId === undefined) return null;

  let onClick;
  let disabled = false;
  let title;
  let cls = 'dsh-enh-btn';

  if (phase === 'enhancing') {
    // 进度文案：stage → i18n 键（stage+Cap）；未知/缺键回退「优化中…」
    let prog = t('enhancing');
    if (stage) {
      const key = 'stage' + stage.charAt(0).toUpperCase() + stage.slice(1);
      const localized = t(key);
      if (localized !== key) prog = localized;
    }
    onClick = () => cancelEnhance(sessionId, inputActions);
    title = t('titleBusy');
    cls += ' dsh-enh-btn-busy dsh-enh-btn-text';
    return React.createElement('button', {
      type: 'button',
      className: cls,
      onClick,
      title,
      tabIndex: -1,
      'aria-label': t('enhanceButton'),
    },
      React.createElement('span', { className: 'dsh-enh-spin', 'aria-hidden': true }),
      // v2.3.3（§7.10）：hover 闪烁修复——progress 文档流占位（宽度恒定），
      // cancel absolute 覆盖其上，hover 只切 opacity（无尺寸抖动）
      React.createElement('span', { className: 'dsh-enh-status', 'aria-hidden': true },
        React.createElement('span', { className: 'dsh-enh-progress' }, prog),
        React.createElement('span', { className: 'dsh-enh-cancel' }, t('cancel')),
      ),
    );
  }
  if (phase === 'result') {
    onClick = () => undo(sessionId, inputActions);
    title = t('titleResult');
    cls += ' dsh-enh-btn-result dsh-enh-btn-text';
  } else {
    // v2.3.3（§7.10）：空输入时按钮 = 记忆开关（点击切换 config.memory，外观不变——
    // ✨ 图标饱和度已表达记忆状态；非空时守卫/优化逻辑照旧）
    const ok = guardPasses(draft, input);
    const empty = draft.trim() === '';
    if (empty) {
      disabled = false;
      onClick = () => { saveConfig({ memory: !configState.value.memory }); };
      title = configState.value.memory ? t('titleMemoryOn') : t('titleMemoryOff');
    } else {
      disabled = !ok;
      onClick = () => {
        if (!guardPasses(draft, input)) return;
        enhance(sessionId, draft, inputActions, draftRef);
      };
      title = ok ? t('titleIdle')
        : draft.startsWith('/') ? t('titleCommand')
        : t('titleBusyInput');
    }
    cls += ' dsh-enh-btn-text';
  }

  return React.createElement('button', {
    type: 'button',
    className: cls,
    onClick,
    disabled,
    title,
    // v22（C6）：不可选中（不可 Tab 聚焦），仅支持点击触发
    tabIndex: -1,
    'aria-label': t('enhanceButton'),
  },
    phase === 'result' ? null
      : React.createElement(React.Fragment, null,
          // v2.3.2（§7.2）：记忆状态 → 图标饱和度（仅影响 ✨，文字饱和度不变）：
          // 记忆开=正常彩色（无 dim 类）/ 记忆关=低饱和（dsh-enh-icon-dim，filter:saturate(.2)）
          React.createElement('span', {
            className: 'dsh-enh-icon' + (configState.value.memory === true ? '' : ' dsh-enh-icon-dim'),
            'aria-hidden': true,
          }, '✨'),
          React.createElement('span', { className: 'dsh-enh-mode' }, modeShortLabel(t, configState.value.mode)),
        ),
    phase === 'result' ? t('result') : null,
  );
}

function EnhanceBar(props) {
  const t = makeT(props);
  const sessionId = props.session && props.session.sessionId;
  const input = props.input || {};
  const draft = typeof input.draft === 'string' ? input.draft : '';
  const inputActions = props.inputActions;

  const [, setVersion] = React.useState(0);
  React.useEffect(() => subscribe(sessionId, () => setVersion((v) => v + 1)), [sessionId]);

  // v21（P1-3）：卸载后空闲即释放，防内存泄漏（与 EnhanceButton 对称）
  React.useEffect(() => () => {
    const s = storeFor(sessionId);
    if (s.phase === 'enhancing') {
      const seq = s.seq;
      s.seq += 1;
      host.call('cancel', { sessionId, seq }).catch(() => {});
      s.phase = 'idle';
      s.enhanced = '';
      s.error = null;
      notify(sessionId);
    }
    releaseStoreIfIdle(sessionId);
  }, [sessionId]);

  React.useEffect(() => {
    const s = storeFor(sessionId);
    if (s.phase === 'result' && draft !== s.enhanced) {
      s.phase = 'idle';
      s.enhanced = '';
      s.error = null;
      notify(sessionId);
    }
  }, [draft, sessionId]);

  if (!inputActions || sessionId === undefined) return null;
  const s = storeFor(sessionId);
  if (s.error === null) return null;

  const errText = t(errorKey(s.error));
  return React.createElement('div', { className: 'dsh-enh-bar dsh-enh-bar-error', role: 'status' },
    React.createElement('span', null, t('errorPrefix') + errText),
    React.createElement('button', {
      type: 'button',
      className: 'dsh-enh-bar-btn',
      onClick: () => { s.error = null; notify(sessionId); },
    }, t('dismiss')),
  );
}

let dynFace = null;
// v2.3.1：动态 client 半部无浏览器 timer 全局（setInterval 不可用）——
// 轮询定时器改经 ctx timer 服务（inject:['timer']），apply 时赋值
let timerSvc = null;

function stateKey(state) {
  const map = {
    'awaiting-approval': 'pluginsAwaiting',
    'client-pending': 'pluginsClientPending',
    failed: 'pluginsFailed',
    waiting: 'pluginsWaiting',
    running: 'pluginsRunning',
    stopped: 'pluginsStopped',
    defined: 'pluginsDefined',
  };
  return map[state] || 'pluginsDefined';
}

// v2.4.0（方案「插件版本检测与一键更新方案.md」§4）：版本检测与更新卡片——
// repo 输入 + 检测版本 → 本地/远端/状态徽标 → 目标目录 + 一键拉取更新 → 拉取结果 + 应用指引。
// 状态机：repo 变更即清空陈旧结果（防误拉）；检测/拉取中按钮 busy 置灰。
const UPDATER_DEFAULT_REPO = 'Fishsb/dsh-prompt-enhancer';

function updaterRepoOf(cfg) {
  const r = cfg && cfg.updater && typeof cfg.updater.repo === 'string' ? cfg.updater.repo.trim() : '';
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r) && r.length <= 100 ? r : UPDATER_DEFAULT_REPO;
}

function UpdaterCard(props) {
  const t = makeT(props);
  const [repoInput, setRepoInput] = React.useState(updaterRepoOf(configState.value));
  const [dirInput, setDirInput] = React.useState((configState.value.updater && configState.value.updater.targetDir) || '');
  const [checking, setChecking] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [pullRes, setPullRes] = React.useState(null);
  const [error, setError] = React.useState(null);

  const repo = updaterRepoOf({ updater: { repo: repoInput, targetDir: '' } });

  const persist = (nextRepo, nextDir) => {
    saveConfig({ updater: { repo: nextRepo, targetDir: nextDir } });
  };

  const onRepoChange = (value) => {
    setRepoInput(value);
    // 方案 §4（L6）：repo 变更 → 清空陈旧结果与拉取态
    setResult(null);
    setPullRes(null);
    setError(null);
    persist(value, dirInput);
  };

  const onDirChange = (value) => {
    setDirInput(value);
    persist(repoInput, value);
  };

  const doCheck = () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    setPullRes(null);
    host.call('update/check', { repo }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok !== true) {
        setError(r.message || t('updError'));
      } else {
        setResult(r);
        if (dirInput === '' && typeof r.defaultDir === 'string' && r.defaultDir) {
          setDirInput(r.defaultDir);
        }
      }
    }).catch(() => {
      setError(t('updError'));
    }).then(() => {
      setChecking(false);
    });
  };

  const doPull = () => {
    if (pulling || !result || !result.remoteTag) return;
    setPulling(true);
    setError(null);
    host.call('update/pull', { repo, tag: result.remoteTag, dir: dirInput }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok !== true) {
        setError((r.message ? r.message + ' ' : '') + t('updError'));
      } else {
        setPullRes(r);
      }
    }).catch(() => {
      setError(t('updError'));
    }).then(() => {
      setPulling(false);
    });
  };

  let statusNode = null;
  if (result) {
    const text = result.status === 'outdated' ? t('updOutdated')
      : result.status === 'current' ? (result.ahead ? t('updAhead') : t('updCurrent'))
      : t('updUnknown');
    statusNode = React.createElement('span', {
      className: result.status === 'outdated' ? 'dsh-plg-upd-outdated' : 'dsh-plg-upd-ok',
    }, text);
  }

  return React.createElement('div', { className: 'dsh-plg-card dsh-plg-upd' },
    React.createElement('div', { className: 'dsh-plg-head' },
      React.createElement('span', { className: 'dsh-plg-name' }, t('updTitle')),
    ),
    // 行 1：repo 输入 + 检测按钮
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('updRepo')),
      React.createElement('input', {
        className: 'dsh-plg-input',
        value: repoInput,
        spellCheck: false,
        placeholder: UPDATER_DEFAULT_REPO,
        onChange: (e) => onRepoChange(e.target.value),
      }),
      React.createElement('button', {
        type: 'button',
        className: 'dsh-plg-btn dsh-plg-btn-primary',
        disabled: checking || pulling,
        onClick: doCheck,
      }, checking ? t('updChecking') : t('updCheck')),
    ),
    // 行 2：结果区（本地/远端/状态；release 元数据仅同名时展示）
    result
      ? React.createElement('div', { className: 'dsh-plg-row' },
          React.createElement('span', { className: 'dsh-plg-muted' }, t('updLocal') + ' v' + result.local),
          React.createElement('span', { className: 'dsh-plg-muted' }, t('updRemote') + ' v' + result.remote),
          statusNode,
        )
      : null,
    result && result.body
      ? React.createElement('div', { className: 'dsh-plg-upd-body' }, result.body)
      : null,
    // 行 3：目标目录 + 一键拉取（仅 outdated 可用）
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('updDir')),
      React.createElement('input', {
        className: 'dsh-plg-input',
        value: dirInput,
        spellCheck: false,
        placeholder: result && result.defaultDir ? result.defaultDir : '',
        onChange: (e) => onDirChange(e.target.value),
      }),
      React.createElement('button', {
        type: 'button',
        className: 'dsh-plg-btn dsh-plg-btn-primary',
        disabled: pulling || !result || result.status !== 'outdated',
        onClick: doPull,
      }, pulling ? t('updPulling') : t('updPull')),
    ),
    // 行 4：拉取结果 + 应用指引
    pullRes
      ? React.createElement('div', { className: 'dsh-plg-upd-done' },
          React.createElement('div', null, t('updDone') + ' ' + pullRes.tag + ' → ' + pullRes.dir),
          React.createElement('div', { className: 'dsh-plg-muted' },
            (pullRes.files || []).map((f) => f.name + ' (' + f.bytes + 'B)').join(' · ')),
          React.createElement('div', { className: 'dsh-plg-upd-apply' },
            React.createElement('div', { className: 'dsh-plg-label' }, t('updApplyTitle')),
            React.createElement('div', { className: 'dsh-plg-hint' }, t('updApplyBundle')),
            React.createElement('div', { className: 'dsh-plg-hint' }, t('updApplyDynamic')),
            React.createElement('div', { className: 'dsh-plg-hint' }, t('updApplyCopy')),
          ),
        )
      : null,
    error ? React.createElement('div', { className: 'dsh-plg-error', role: 'status' }, error) : null,
  );
}

function PluginsSection(props) {
  const t = makeT(props);
  const [plugins, setPlugins] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [approvals, setApprovals] = React.useState(null);
  const [logsOpen, setLogsOpen] = React.useState(false);
  const [logs, setLogs] = React.useState(null);

  const sessionId = props.useSessions ? props.useSessions((s) => s.current) : undefined;

  const loadLogs = React.useCallback(() => {
    host.call('logs/last').then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok && Array.isArray(r.lines)) setLogs(r.lines);
      else setLogs([]);
    }).catch(() => setLogs([]));
  }, []);

  const toggleLogs = () => {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next && logs === null) loadLogs();
  };

  const load = React.useCallback(() => {
    if (sessionId === undefined) return;
    host.call('plugins/inventory', { sessionId }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok && Array.isArray(r.plugins)) {
        setPlugins(r.plugins);
        setError(null);
      } else {
        setError(r.message || t('pluginsLoadFailed'));
      }
    }).catch(() => {
      setError(t('pluginsLoadFailed'));
    });
  }, [sessionId]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!dynFace || typeof dynFace.activeRuns !== 'object') return;
    const sync = () => {
      setApprovals(new Map(dynFace.activeRuns.getSnapshot()));
    };
    sync();
    return dynFace.activeRuns.subscribe(sync);
  }, []);

  const act = (action, pluginId, extra) => {
    const key = pluginId + ':' + action;
    setBusy(key);
    setError(null);
    const args = { sessionId, pluginId };
    if (extra) Object.assign(args, extra);
    host.call('plugins/' + action, args).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (!r.ok) setError((r.message ? r.message + ' ' : '') + t('pluginsActionFailed'));
      load();
    }).catch(() => {
      setError(t('pluginsActionFailed'));
    }).then(() => {
      setBusy(null);
    });
  };

  const approve = (requestId, future) => {
    if (!dynFace) return;
    dynFace.approve(requestId, future).catch(() => {});
  };
  const decline = (requestId) => {
    if (!dynFace) return;
    dynFace.decline(requestId).catch(() => {});
  };

  let content;
  if (plugins === null) {
    content = React.createElement('p', { className: 'dsh-plg-note' }, t('pluginsClientPending'));
  } else if (plugins.length === 0) {
    content = React.createElement('p', { className: 'dsh-plg-note' }, t('pluginsEmpty'));
  } else {
    const rows = plugins.map((p) => {
      const stateText = t(stateKey(p.state));
      const approval = approvals && approvals.get(p.pluginId);
      const versions = (p.packages || []).map((pkg) =>
        React.createElement('option', { key: pkg.packageId, value: pkg.packageId }, pkg.name + ' · ' + pkg.packageId),
      );
      const running = p.activeRun !== undefined;
      return React.createElement('div', { key: p.pluginId, className: 'dsh-plg-card' },
        React.createElement('div', { className: 'dsh-plg-head' },
          React.createElement('span', { className: 'dsh-plg-name' }, p.pluginId + ' ' + p.name),
          React.createElement('span', { className: 'dsh-plg-state' }, stateText),
        ),
        React.createElement('div', { className: 'dsh-plg-row' },
          React.createElement('label', { className: 'dsh-plg-label' }, t('pluginsVersion')),
          React.createElement('select', {
            className: 'dsh-plg-select',
            defaultValue: p.currentPackageId || (p.packages && p.packages[0] && p.packages[0].packageId) || '',
          }, versions),
        ),
        p.currentPackageId
          ? React.createElement('div', { className: 'dsh-plg-row' },
              React.createElement('span', { className: 'dsh-plg-label' }, t('pluginsCurrent')),
              React.createElement('span', { className: 'dsh-plg-muted' }, p.currentPackageId),
            )
          : null,
        (approval || p.pendingApproval)
          ? React.createElement('div', { className: 'dsh-plg-row dsh-plg-approval' },
              React.createElement('span', null, t('pluginsAwaiting')),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-plg-btn dsh-plg-btn-primary',
                disabled: busy !== null,
                onClick: () => approve(approval ? approval.requestId : undefined, false),
              }, t('pluginsApproveOnce')),
              approval
                ? React.createElement('button', {
                    type: 'button',
                    className: 'dsh-plg-btn',
                    disabled: busy !== null,
                    onClick: () => decline(approval.requestId),
                  }, t('pluginsDecline'))
                : null,
            )
          : null,
        React.createElement('div', { className: 'dsh-plg-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dsh-plg-btn dsh-plg-btn-primary',
            disabled: busy !== null,
            onClick: () => {
              if (running) act('stop', p.pluginId);
              else act('run', p.pluginId, { packageId: p.currentPackageId || (p.packages && p.packages[0] && p.packages[0].packageId), mode: 'run' });
            },
          }, running ? t('pluginsStop') : t('pluginsRun')),
          React.createElement('button', {
            type: 'button',
            className: 'dsh-plg-btn',
            disabled: busy !== null,
            onClick: () => act('undefine', p.pluginId),
          }, t('pluginsRemove')),
        ),
      );
    });
    content = React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dsh-plg-toolbar' },
        React.createElement('button', {
          type: 'button',
          className: 'dsh-plg-btn',
          disabled: busy !== null,
          onClick: load,
        }, t('pluginsRefresh')),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-plg-btn',
          disabled: busy !== null,
          onClick: toggleLogs,
        }, t('cfgLogs')),
      ),
      rows,
    );
  }

  return React.createElement('div', { className: 'dsh-plg-root' },
    // v2.4.0（方案 §4）：版本检测与更新卡片（置于插件清单上方，与清单状态无关）
    React.createElement(UpdaterCard, props),
    error ? React.createElement('div', { className: 'dsh-plg-error', role: 'status' }, error) : null,
    content,
    logsOpen
      ? React.createElement('div', { className: 'dsh-plg-logs' },
          React.createElement('div', { className: 'dsh-plg-logs-head' },
            React.createElement('span', { className: 'dsh-plg-label' }, t('cfgLogs')),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-plg-btn',
              onClick: loadLogs,
            }, t('pluginsRefresh')),
          ),
          logs === null || logs.length === 0
            ? React.createElement('p', { className: 'dsh-plg-note' }, t('cfgLogsEmpty'))
            : React.createElement('pre', { className: 'dsh-plg-logs-pre' }, logs.join('\n')),
        )
      : null,
  );
}

const TIMEOUT_OPTIONS = [10000, 30000, 60000, 120000];
const MAXTOKENS_OPTIONS = [500, 1000, 2000, 4000];
const OUTPUTLIMIT_OPTIONS = [2000, 4000, 8000, 16000];

// v16：可折叠区块（点击标题展开/收起，默认收起；行尾摘要 + 行首 chevron）
function CollapsibleSection(props) {
  const [open, setOpen] = React.useState(false);
  return React.createElement('div', { className: 'dsh-cfg-sec' },
    React.createElement('button', {
      type: 'button',
      className: 'dsh-cfg-sec-head',
      onClick: () => setOpen(!open),
      'aria-expanded': open,
    },
      React.createElement('span', { className: 'dsh-cfg-chev' + (open ? ' dsh-cfg-chev-open' : '') }, '▸'),
      React.createElement('span', { className: 'dsh-cfg-sec-title' }, props.title),
      props.summary ? React.createElement('span', { className: 'dsh-cfg-sec-summary' }, props.summary) : null,
    ),
    open ? React.createElement('div', { className: 'dsh-cfg-sec-body' }, props.children) : null,
  );
}

// 模型配置区块（v23：主模型/兜底整合为单一模型链——所有行同构，无主/兜之分；
// 测试结果块内固定单点集中显示，行结构测试前后不变）
function ModelMainSection(props) {
  const t = makeT(props);
  const providers = props.providers;
  const fallback = props.fallback || [];
  const candidates = props.candidates || [];
  const saveFallback = props.saveFallback;
  // 测试集中单点状态：{ index, entry, phase:'testing'|'done', result } | null
  const [testState, setTestState] = React.useState(null);

  const addModel = () => {
    const next = fallback.slice();
    const pick = candidates.find((c) => !next.some((x) => x.provider === c.provider && x.model === c.model));
    if (!pick) return;
    next.push({ provider: pick.provider, model: pick.model });
    saveFallback(next);
  };
  const updateEntry = (index, entry) => {
    const next = fallback.slice();
    next[index] = entry;
    saveFallback(next);
  };
  const move = (index, delta) => {
    const j = index + delta;
    if (j < 0 || j >= fallback.length) return;
    const next = fallback.slice();
    const tmp = next[index];
    next[index] = next[j];
    next[j] = tmp;
    saveFallback(next);
  };
  const remove = (index) => {
    const next = fallback.slice();
    next.splice(index, 1);
    saveFallback(next);
    // 删除正在测试的行 → 清空结果区
    if (testState && testState.index === index) setTestState(null);
  };
  const restore = () => {
    // 恢复默认 → 优先自适应链（host 解析当前环境默认模型），失败才用静态链
    host.call('models/autochain').then((auto) => {
      const a = auto && typeof auto === 'object' && Array.isArray(auto.chain) && auto.chain.length > 0
        ? auto.chain : BUILTIN_CHAIN;
      saveFallback(a.map((b) => ({ provider: b.provider, model: b.model })));
    }).catch(() => {
      saveFallback(BUILTIN_CHAIN.map((b) => ({ ...b })));
    });
    setTestState(null);
  };
  // v23（D4）：单点测试——点某行 ⛓ → 结果区集中显示该行测试；行内不注入结果
  const runTest = (index, entry) => {
    if (!entry || !entry.provider || !entry.model) return;
    setTestState({ index, entry, phase: 'testing', result: null });
    host.call('models/test', { provider: entry.provider, model: entry.model }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      setTestState({
        index,
        entry,
        phase: 'done',
        result: r.ok
          ? { ok: true, latencyMs: r.latencyMs, ttftMs: r.ttftMs }
          : { ok: false, message: r.message || r.code || '' },
      });
    }).catch(() => {
      setTestState({ index, entry, phase: 'done', result: { ok: false, message: t('errNETWORK') } });
    });
  };

  // v23：摘要 = 模型数 + 按序尝试（不再有「主模型」指向）
  const summary = fallback.length > 0 ? t('secFallbackCount').replace('{n}', String(fallback.length)) : t('secFallbackEmpty');
  let body;
  if (providers === null) {
    body = React.createElement('p', { className: 'dsh-plg-note' }, t('pluginsClientPending'));
  } else if (providers.length === 0) {
    body = React.createElement('p', { className: 'dsh-plg-note' }, t('cfgNoProvider'));
  } else {
    // 测试结果集中区（链列表下方、操作按钮上方；空态隐藏）
    let testArea = null;
    if (testState) {
      const p = providers.find((x) => x.provider === testState.entry.provider);
      const label = '测试 #' + String(testState.index + 1) + ' · ' + (p && p.name ? p.name : testState.entry.provider) + ' / ' + testState.entry.model;
      let resultNode;
      if (testState.phase === 'testing') {
        resultNode = React.createElement('span', { className: 'dsh-plg-muted' }, t('cfgTesting'));
      } else if (testState.result && testState.result.ok) {
        resultNode = React.createElement('span', { className: 'dsh-plg-test-ok' }, t('cfgTestOk').replace('{ms}', String(testState.result.latencyMs)));
      } else {
        resultNode = React.createElement('span', { className: 'dsh-plg-test-fail' }, t('cfgTestFail').replace('{msg}', (testState.result && testState.result.message) || ''));
      }
      testArea = React.createElement('div', { className: 'dsh-plg-testarea', role: 'status' },
        React.createElement('span', { className: 'dsh-plg-muted' }, label),
        resultNode,
        React.createElement('button', {
          type: 'button',
          className: 'dsh-plg-btn dsh-plg-btn-icononly',
          onClick: () => setTestState(null),
          title: '✕',
          'aria-label': t('dismiss'),
        }, '✕'),
      );
    }
    body = React.createElement(React.Fragment, null,
      fallback.map((entry, index) => React.createElement(FallbackRow, {
        key: index,
        t: t,
        entry: entry,
        index: index,
        count: fallback.length,
        providers: providers,
        candidates: candidates,
        testing: !!(testState && testState.index === index && testState.phase === 'testing'),
        onChange: (e) => updateEntry(index, e),
        onMove: (d) => move(index, d),
        onRemove: () => remove(index),
        onTest: () => runTest(index, entry),
      })),
      fallback.length === 0 ? React.createElement('p', { className: 'dsh-plg-note' }, t('secFallbackEmpty')) : null,
      testArea,
      React.createElement('div', { className: 'dsh-plg-row' },
        React.createElement('button', { type: 'button', className: 'dsh-plg-btn', onClick: addModel }, t('cfgAddFallback')),
        React.createElement('button', { type: 'button', className: 'dsh-plg-btn', onClick: restore }, t('cfgRestoreDefaults')),
      ),
      React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgFallbackNote')),
    );
  }
  return React.createElement(CollapsibleSection, { title: t('secMain'), summary }, body);
}

// 模型链条目行（v23：统一格式——序号 + 厂家/模型双联动下拉 + 思考开关/等级 + 测试触发 + ↑↓✕；
// 测试结果不注入行内，由父级单点集中显示）
function FallbackRow(props) {
  const t = makeT(props);
  const entry = props.entry;
  const index = props.index;
  const count = props.count;
  const providers = props.providers;       // [{provider, name, models:[{id,name}]}]
  const candidates = props.candidates;     // 跨厂家候选（含自定义，兼容存量）
  const testing = props.testing;           // 本行是否测试中（父级单点状态）
  const onChange = props.onChange;
  const onMove = props.onMove;
  const onRemove = props.onRemove;
  const onTest = props.onTest;
  const [reasoning, setReasoning] = React.useState(null);

  React.useEffect(() => {
    setReasoning(null);
    if (!entry.provider || !entry.model) return;
    let cancelled = false;
    host.call('models/resolve', { provider: entry.provider, model: entry.model }).then((res) => {
      if (cancelled) return;
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok && r.reasoning && r.reasoning.efforts && r.reasoning.efforts.length > 0) setReasoning(r.reasoning);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [entry.provider, entry.model]);

  const effortOn = !!(entry.reasoning && entry.reasoning.enabled);
  const levelOptions = reasoning ? reasoning.efforts.map((e) => React.createElement('option', { key: e.id, value: e.id }, e.name)) : [];
  const levelValue = effortOn ? entry.reasoning.effort : (reasoning ? (reasoning.defaultEffort || reasoning.efforts[0].id) : '');

  // v22（C4）/v23：按厂家区分——厂家下拉选项 = providers；模型下拉 = 当前厂家模型 + 该厂家自定义候选
  const currentProvider = providers && providers.find((p) => p.provider === entry.provider);
  const modelOptions = (currentProvider ? currentProvider.models || [] : [])
    .concat(candidates ? candidates.filter((c) => c.custom && c.provider === entry.provider).map((c) => ({ id: c.model, name: c.name })) : []);
  const onProviderChange = (e) => {
    const provider = e.target.value;
    const p = providers && providers.find((x) => x.provider === provider);
    const first = p && p.models && p.models[0] ? p.models[0].id : '';
    onChange({ provider, model: first, reasoning: { enabled: false, effort: '' } });
  };

  return React.createElement('div', { className: 'dsh-plg-row' },
    React.createElement('span', { className: 'dsh-plg-muted dsh-plg-num' }, String(index + 1)),
    React.createElement('select', {
      className: 'dsh-plg-select dsh-plg-select-provider',
      value: entry.provider || '',
      onChange: onProviderChange,
      children: (providers || []).map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.name || p.provider)),
    }),
    React.createElement('select', {
      className: 'dsh-plg-select dsh-plg-select-model',
      value: entry.model || '',
      onChange: (e) => onChange({ provider: entry.provider, model: e.target.value, reasoning: { enabled: false, effort: '' } }),
      children: modelOptions.map((m) => React.createElement('option', { key: m.id, value: m.id }, m.name || m.id)),
    }),
    reasoning
      ? React.createElement(React.Fragment, null,
          React.createElement('select', {
            className: 'dsh-plg-select dsh-plg-select-thinking',
            value: effortOn ? 'on' : 'off',
            onChange: (e) => {
              const next = e.target.value === 'on';
              onChange({ ...entry, reasoning: next ? { enabled: true, effort: (reasoning.defaultEffort || (reasoning.efforts[0] && reasoning.efforts[0].id) || '') } : { enabled: false, effort: '' } });
            },
            children: [React.createElement('option', { key: 'off', value: 'off' }, t('cfgReasoningOff')), React.createElement('option', { key: 'on', value: 'on' }, t('cfgReasoningOn'))],
          }),
          React.createElement('select', {
            className: 'dsh-plg-select dsh-plg-select-level',
            value: levelValue,
            disabled: !effortOn,
            onChange: (e) => onChange({ ...entry, reasoning: { enabled: true, effort: e.target.value } }),
            children: levelOptions,
          }),
        )
      : null,
    // v23（D4）：测试触发图标（结果由父级集中显示）
    React.createElement('button', {
      type: 'button',
      className: 'dsh-plg-btn dsh-plg-btn-icononly dsh-plg-testicon',
      disabled: testing || !entry.provider || !entry.model,
      onClick: onTest,
      title: t('cfgTest'),
      'aria-label': t('cfgTest'),
    }, testing ? '…' : '⛓'),
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', disabled: index === 0, onClick: () => onMove(-1), title: '↑' }, '↑'),
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', disabled: index === count - 1, onClick: () => onMove(1), title: '↓' }, '↓'),
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', onClick: onRemove, title: '✕' }, '✕'),
  );
}
// 模型配置 tab（v18：helpers + fresh install 继承 + 四区块）
function buildCandidates(providers, customModels, order) {
  const list = [];
  if (providers) {
    for (const p of providers) {
      for (const m of p.models || []) list.push({ provider: p.provider, model: m.id, name: m.name || m.id, custom: false });
    }
  }
  for (const c of customModels || []) list.push({ provider: c.provider, model: c.model, name: c.name || c.model, custom: true });
  const orderIndex = new Map();
  (order || []).forEach((k, i) => orderIndex.set(k, i));
  list.sort((a, b) => {
    const ia = orderIndex.has(a.provider + '/' + a.model) ? orderIndex.get(a.provider + '/' + a.model) : 1e9;
    const ib = orderIndex.has(b.provider + '/' + b.model) ? orderIndex.get(b.provider + '/' + b.model) : 1e9;
    if (ia !== ib) return ia - ib;
    return (a.custom ? 1 : 0) - (b.custom ? 1 : 0);
  });
  return list;
}

function ModelConfigTab(props) {
  const t = makeT(props);
  const [providers, setProviders] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [inherited, setInherited] = React.useState(false);

  React.useEffect(() => {
    host.call('models/list').then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok && Array.isArray(r.providers)) {
        setProviders(r.providers);
        // v18/v19：fresh install → 模型链继承当前使用模型（含推理等级）+ 自适应链补足
        if (configState.fresh && configState.value.fallback.length === 0) {
          // 先取当前默认模型作首项（含推理等级），再用自适应链 / 静态链做补足
          host.call('models/current').then((res2) => {
            const r2 = res2 && typeof res2 === 'object' ? res2 : {};
            let chain = [];
            if (r2.ok && r2.provider && r2.model) {
              const entry = { provider: r2.provider, model: r2.model };
              if (r2.reasoningEffort) entry.reasoning = { enabled: true, effort: r2.reasoningEffort };
              chain.push(entry);
            }
            const fill = (src) => {
              for (const b of src) {
                if (!b || typeof b.provider !== 'string' || typeof b.model !== 'string') continue;
                if (!chain.some((x) => x.provider === b.provider && x.model === b.model)) chain.push({ provider: b.provider, model: b.model });
              }
              return chain;
            };
            // 优先自适应链（browser 环境限制，改从 host 解析）
            host.call('models/autochain').then((auto) => {
              const a = auto && typeof auto === 'object' && Array.isArray(auto.chain) ? auto.chain : BUILTIN_CHAIN;
              chain = fill(a.map((x) => ({ provider: x.provider, model: x.model })));
              if (chain.length > 0) { saveConfig({ fallback: chain }); configState.fresh = false; setInherited(true); }
            }).catch(() => {
              // autochain 失败 → 静态链补齐（尽量先保证有模型链）
              chain = fill(BUILTIN_CHAIN);
              if (chain.length > 0) { saveConfig({ fallback: chain }); configState.fresh = false; setInherited(true); }
            });
          }).catch(() => {});
        }
      } else {
        setError(t('cfgLoadFailed'));
      }
    }).catch(() => setError(t('cfgLoadFailed')));
  }, []);

  const cfg = configState.value;
  const candidates = buildCandidates(providers, cfg.customModels, cfg.order);
  const saveFallback = (fallback) => saveConfig({ fallback });

  return React.createElement(React.Fragment, null,
    error ? React.createElement('div', { className: 'dsh-plg-error', role: 'status' }, error) : null,
    inherited ? React.createElement('p', { className: 'dsh-plg-note dsh-plg-inherit' }, t('cfgInherited')) : null,
    // v23：单一「模型配置」链区块（无主/兜之分；main 已迁移并忽略）
    React.createElement(ModelMainSection, { t: t, providers: providers, fallback: cfg.fallback, candidates: candidates, saveFallback: saveFallback }),
  );
}

function ParamsTab(props) {
  const t = makeT(props);
  const cfg = configState.value;
  const save = (patch) => { saveConfig(patch); };
  const onNumber = (key) => (e) => save({ params: { ...cfg.params, [key]: Number(e.target.value) } });
  const selectProps = (key, options) => ({ className: 'dsh-plg-select', value: String(cfg.params[key]), onChange: onNumber(key), children: options });
  return React.createElement(React.Fragment, null,
    // v2.2（§6.6）：优化模式下拉（4 模式，记忆模式已删除）
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgMode')),
      React.createElement('select', {
        className: 'dsh-plg-select',
        value: cfg.mode,
        onChange: (e) => save({ mode: e.target.value }),
        children: MODE_OPTIONS.map((m) => React.createElement('option', { key: m.value, value: m.value }, m.label)),
      }),
    ),
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgModeHint' + cfg.mode.charAt(0).toUpperCase() + cfg.mode.slice(1))),
    // v2.2（§6.2/§6.6）：记忆功能独立开关（所有模式可开/关，即时准确切换）
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgMemory')),
      React.createElement('select', {
        className: 'dsh-plg-select dsh-plg-select-thinking',
        value: cfg.memory ? 'on' : 'off',
        onChange: (e) => save({ memory: e.target.value === 'on' }),
        children: [
          React.createElement('option', { key: 'on', value: 'on' }, t('cfgReasoningOn')),
          React.createElement('option', { key: 'off', value: 'off' }, t('cfgReasoningOff')),
        ],
      }),
    ),
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgMemoryNote')),
    // 预算下拉（全模式可见；0 = 不注入）
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgContextBudget')),
      React.createElement('select', {
        className: 'dsh-plg-select',
        value: String(cfg.context.budgetChars),
        onChange: (e) => save({ context: { ...cfg.context, budgetChars: Number(e.target.value) } }),
        children: [0, 2000, 4000, 8000].map((v) => React.createElement('option', { key: String(v), value: String(v) }, v === 0 ? t('cfgContextBudget0') : String(v))),
      }),
    ),
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgContextNote')),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgTimeout')),
      React.createElement('select', selectProps('timeoutMs', TIMEOUT_OPTIONS.map((v) => React.createElement('option', { key: v, value: String(v) }, (v / 1000) + 's')))),
    ),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgMaxTokens')),
      React.createElement('select', selectProps('maxTokens', MAXTOKENS_OPTIONS.map((v) => React.createElement('option', { key: v, value: String(v) }, String(v))))),
    ),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgOutputLimit')),
      React.createElement('select', selectProps('outputLimit', OUTPUTLIMIT_OPTIONS.map((v) => React.createElement('option', { key: v, value: String(v) }, String(v))))),
    ),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgTemplateMode')),
      React.createElement('select', {
        className: 'dsh-plg-select',
        value: cfg.template.mode,
        onChange: (e) => save({ template: { ...cfg.template, mode: e.target.value } }),
        children: [
          React.createElement('option', { key: 'builtin', value: 'builtin' }, t('cfgTemplateBuiltin')),
          React.createElement('option', { key: 'custom', value: 'custom' }, t('cfgTemplateCustom')),
        ],
      }),
    ),
    cfg.template.mode === 'custom'
      ? React.createElement('div', { className: 'dsh-plg-col' },
          React.createElement('label', { className: 'dsh-plg-label' }, t('cfgTemplateText')),
          React.createElement('textarea', {
            className: 'dsh-plg-textarea',
            value: cfg.template.text,
            rows: 6,
            placeholder: t('cfgTemplateText'),
            onChange: (e) => save({ template: { ...cfg.template, text: e.target.value.slice(0, 4000) } }),
          }),
        )
      : null,
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgHint')),
  );
}

// v16：统一入口「模型与插件」——页内三区 tab（模型配置 / 优化参数 / 插件管理）
function ModelPluginsSection(props) {
  const t = makeT(props);
  const [tab, setTab] = React.useState('models');
  const [, force] = React.useState(0);
  React.useEffect(() => subscribeConfig(() => force((v) => v + 1)), []);

  const tabs = [
    ['models', t('tabModels')],
    ['params', t('tabParams')],
    ['plugins', t('tabPlugins')],
  ];
  const body = tab === 'models' ? React.createElement(ModelConfigTab, props)
    : tab === 'params' ? React.createElement(ParamsTab, props)
    : React.createElement(PluginsSection, props);

  return React.createElement('div', { className: 'dsh-plg-root' },
    React.createElement('div', { className: 'dsh-cfg-tabs', role: 'tablist' },
      tabs.map((entry) => React.createElement('button', {
        key: entry[0],
        type: 'button',
        role: 'tab',
        'aria-selected': tab === entry[0],
        className: 'dsh-cfg-tab' + (tab === entry[0] ? ' dsh-cfg-tab-active' : ''),
        onClick: () => setTab(entry[0]),
      }, entry[1])),
    ),
    body,
    React.createElement('div', { className: 'dsh-plg-saved', role: 'status' }, t('cfgSaved')),
  );
}

function CordisBadgePlaceholder() {
  return null;
}

const CSS = [
  // v2.3.3（§7.10）：font-weight:500 对齐 DSH ModelSelect trigger 样式
  '.dsh-enh-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px;cursor:pointer;transition:background-color .15s ease,border-color .15s ease;white-space:nowrap}',
  '.dsh-enh-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
  // v2.3.2（§7.2）：空输入不再降低按钮饱和度——disabled 仅保留点击无效提示，无 opacity 变暗
  '.dsh-enh-btn:disabled{cursor:not-allowed}',
  // v2.4.0（方案 §10.2）：三态文字显式字体锚点——13px/500/20px 与模型 trigger 对齐（实机实测），
  // idle/busy/result 均携带 dsh-enh-btn-text 类；子文本继承，不再依赖隐式继承链
  '.dsh-enh-btn-text{padding:0 10px;font-size:13px;font-weight:500;line-height:20px;font-family:inherit}',
  // v2.3（§7.2）：idle 态 = emoji ✨ + 模式短标签（emoji 系统彩色，不承担状态色）
  // v2.3.2（§7.2）：记忆状态 → 图标饱和度——开=正常（无 dim）/ 关=低饱和（saturate(.2)，文字不受影响）
  '.dsh-enh-icon{font-size:14px;line-height:20px}',
  '.dsh-enh-icon-dim{filter:saturate(.2)}',
  // v2.4.0（方案 §10.2）：模式短标签不再独立声明字号——继承 .dsh-enh-btn-text 锚点（13px/500/20px）
  '.dsh-enh-btn-busy{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
  // v2.3.3（§7.10）：busy hover 闪烁修复——progress 文档流占位（宽度恒定），
  // cancel absolute 覆盖其上，hover 只切 opacity（无尺寸抖动，hover 判定区不变）
  '.dsh-enh-btn-busy .dsh-enh-status{position:relative;display:inline-block;text-align:center}',
  '.dsh-enh-btn-busy .dsh-enh-progress{transition:opacity .12s ease}',
  '.dsh-enh-btn-busy .dsh-enh-cancel{position:absolute;inset:0;display:block;white-space:nowrap;opacity:0;color:var(--dsw-alias-state-error-primary);transition:opacity .12s ease}',
  '.dsh-enh-btn-busy:hover .dsh-enh-progress{opacity:0}',
  '.dsh-enh-btn-busy:hover .dsh-enh-cancel{opacity:1}',
  '.dsh-enh-btn-result{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
  '.dsh-enh-spin{width:11px;height:11px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-warn-primary);display:inline-block;animation:dsh-enh-rotate .8s linear infinite}',
  '@keyframes dsh-enh-rotate{to{transform:rotate(360deg)}}',
  '@media (prefers-reduced-motion: reduce){.dsh-enh-spin{animation:none}}',
  '.dsh-enh-bar{display:flex;align-items:center;gap:10px;padding:5px 14px;font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary)}',
  '.dsh-enh-bar-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:2px 8px;cursor:pointer}',
  '.dsh-enh-bar-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
  '.dsh-enh-bar-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-plg-root{display:flex;flex-direction:column;gap:10px;padding:2px 0}',
  '.dsh-plg-note{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:0}',
  '.dsh-plg-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}',
  '.dsh-plg-toolbar{display:flex;justify-content:flex-end}',
  '.dsh-plg-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
  '.dsh-plg-head{display:flex;align-items:center;gap:8px;justify-content:space-between}',
  '.dsh-plg-name{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-plg-state{font-size:12px;line-height:16px;color:var(--dsw-alias-state-success-primary);flex:none}',
  '.dsh-plg-row{display:flex;align-items:center;gap:6px}',
  '.dsh-plg-col{display:flex;flex-direction:column;gap:6px}',
  '.dsh-plg-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);flex:none;min-width:96px}',
  '.dsh-plg-muted{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  '.dsh-plg-select{flex:1;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:4px 6px}',
  '.dsh-plg-textarea{flex:1;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:6px 8px;resize:vertical;font-family:inherit}',
  '.dsh-plg-approval{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:16px;flex-wrap:wrap}',
  '.dsh-plg-actions{display:flex;gap:8px;justify-content:flex-end}',
  '.dsh-plg-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:3px 10px;cursor:pointer}',
  '.dsh-plg-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
  '.dsh-plg-btn:disabled{opacity:.45;cursor:not-allowed}',
  '.dsh-plg-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
  '.dsh-plg-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0}',
  '.dsh-plg-saved{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px}',
  '.dsh-plg-logs{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-plg-logs-head{display:flex;align-items:center;gap:8px;justify-content:space-between}',
  '.dsh-plg-logs-pre{margin:0;max-height:220px;overflow:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-all}',
  // v16：页内 tab 条（对齐 Harness：14px、选中下划线）
  '.dsh-cfg-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1);padding:0 4px}',
  '.dsh-cfg-tab{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:20px;padding:8px 12px;cursor:pointer;border-radius:8px 8px 0 0;transition:background-color .15s ease-out,color .15s ease-out}',
  '.dsh-cfg-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
  '.dsh-cfg-tab-active{color:var(--dsw-alias-label-primary);font-weight:500;border-bottom-color:var(--dsw-alias-brand-primary)}',
  '.dsh-cfg-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
  // v16：可折叠区块（标题行 36px、hover 反馈、chevron 旋转）
  '.dsh-cfg-sec{border-radius:8px}',
  '.dsh-cfg-sec-head{display:flex;align-items:center;gap:8px;width:100%;background:transparent;border:none;border-radius:8px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px;font-weight:500;padding:8px 12px;cursor:pointer;text-align:left;transition:background-color .15s ease-out}',
  '.dsh-cfg-sec-head:hover{background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-cfg-sec-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-cfg-chev{font-size:11px;color:var(--dsw-alias-label-tertiary);transition:transform .2s cubic-bezier(.2,0,0,1);flex:none}',
  '.dsh-cfg-chev-open{transform:rotate(90deg)}',
  '.dsh-cfg-sec-title{flex:none}',
  '.dsh-cfg-sec-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;text-align:right}',
  '.dsh-cfg-sec-body{padding:4px 12px 8px;display:flex;flex-direction:column;gap:8px}',
  // v17：思考控件与测试结果（窄下拉 + 状态色强调）
  '.dsh-plg-select-narrow{flex:0 0 auto;min-width:96px}',
  '.dsh-plg-test-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-test-fail{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;font-weight:600}',
  // v18：输入框、图标按钮、继承提示
  '.dsh-plg-input{flex:1;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:4px 6px}',
  '.dsh-plg-btn-icononly{min-width:22px;padding:2px 3px}',
  '.dsh-plg-inherit{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px}',
  // v22（C5）：行内测试连通性小图标（与整体一致：无背景 + token 边框/圆角 + hover 反馈）
  '.dsh-plg-testicon{min-width:22px;padding:2px 3px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
  '.dsh-plg-testicon:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
  // v23.2：布局再分配——思考开关宽 2/3（43px）、厂家减 1/5（136px）、
  // 模型框 flex:1 1 0 吃满整行全部剩余空间；字体字号恢复默认（移除 font-family:inherit 强制统一）
  '.dsh-plg-num{width:18px;text-align:right;flex:none}',
  '.dsh-plg-select-provider{flex:0 1 136px;min-width:104px;max-width:176px}',
  '.dsh-plg-select-model{flex:1 1 0;min-width:120px}',
  '.dsh-plg-select-thinking{flex:0 0 auto;width:43px}',
  '.dsh-plg-select-level{flex:0 0 auto;width:56px}',
  // v23.1（D4）：测试结果集中单点区（链列表下方、操作按钮上方；空态隐藏）
  '.dsh-plg-testarea{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;background:var(--dsw-alias-bg-layer-1)}',
  // v2.4.0（方案 §4）：版本检测与更新卡片样式
  '.dsh-plg-upd-outdated{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-upd-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-upd-body{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;max-height:64px;overflow:auto;white-space:pre-wrap;word-break:break-all}',
  '.dsh-plg-upd-done{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-upd-apply{display:flex;flex-direction:column;gap:2px}',
].join('\n');

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    styles.insert(CSS);
    timerSvc = ctx.get('timer') || null;
    const locale = ctx.get('locale');
    if (locale !== undefined && typeof locale.register === 'function') {
      ctx.effect(() => locale.register('enhance', 'zh', ZH));
      ctx.effect(() => locale.register('enhance', 'en', EN));
    }
    dynFace = ctx.get('dynamicCordisRunner') || null;
    // v16：整合「插件管理」+「优化配置」为单一入口「模型与插件」（页内三区 tab）
    slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: 'model-plugins',
        order: 25,
        label: () => (locale && typeof locale.bind === 'function' ? locale.bind('enhance')('navModelPlugins') : ZH.navModelPlugins),
        locale: 'enhance',
      },
      ModelPluginsSection,
    ));
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'cordis-panel', order: 0 },
      CordisBadgePlaceholder,
    ));
    slots.inject('conversation.input.right', () => slots.register(
      { name: 'conversation.input.right', id: 'prompt-enhance', order: 10, label: '提示词优化', locale: 'enhance' },
      EnhanceButton,
    ));
    slots.inject('conversation.input.dock', () => slots.register(
      { name: 'conversation.input.dock', id: 'prompt-enhance-status', order: 30, label: '优化错误提示', locale: 'enhance' },
      EnhanceBar,
    ));
  },
};