// ============================================================================
// DSH「提示词优化」插件 · Client 半部（v2.4.7：自定义模板每模式独立 + 默认预填）
// v2.6.2（继续优化·未发布迭代）：新增 s.optimized 标记（成功应用 ≥1 轮置 true、撤回重置
// false）——空闲态非空且已优化过 → 按钮纯文字「继续优化」（无 ✨ 图标，hover titleContinue）；
// 首次优化 → ✨ + 模式短标签；优化中 / 完成撤回 / 空输入记忆开关 / 守卫禁用等状态不变。
// v2.6.1（记忆链·未发布迭代）：记忆由单轮对升级为 rounds 链（s.memoryRounds，最多
// MEMORY_ROUNDS_MAX 轮）——每次结果应用后追加 {input, output} 并截断；req.memory 传
// { rounds }，host 以真多轮消息注入并感知本轮修改方向；撤回只弹出最后一轮（更早轮次
// 仍有效）；首次 seed / reload 标记 / R1 写入条件语义不变。
// v2.4.7：① config.template 新增 texts（base/lite/standard/smart 各一份）；旧 text
//         （v2）与 templateText（v1）迁移到全部 4 模式；text 字段保留兼容；
//         ② ParamsTab 自定义模板区：切「自定义」且当前模式无内容 → host
//         template/default 预填默认（非空白）；模式切换时 textarea 跟随当前模式；
//         编辑只写当前模式（互不干扰）；label 带当前模式名（cfgTemplateTextFor）；
//         ③ 新增 i18n cfgTemplateTextFor/cfgTemplateNote（ZH/EN）。
// v2.4.6：① ParamsTab 顶部「优化模式」与「模板」两个下拉合并为同一行双字段
//         （.dsh-plg-row-duo + .dsh-plg-field，各占一半、窄屏自动换行；
//          label 不再强制 96px 以免挤占 select）；自定义模板内容区仍独占一行；
//         ② 模式 hint 文案位置不变（紧随同行行下方）。
// v2.4.5：① MODE_OPTIONS lite hint 与 cfgModeHintLite 文案改「缺失项保守提示明确化」
//         （原「缺失自动补全强化」与 host v2.4.5 analyzeInputRules 保守化措辞冲突，
//         会误导用户以为 lite 会臆造补全内容；行为无变化，仅文案对齐）；
//         ② 头部版本注释同步 v2.4.5。
// v2.4.3：① CollapsibleSection 默认展开（useState(true)）——模型配置栏打开即见完整内容；
//         ② PluginsSection 版本选择——受控 select（缺省=当前版本），选中非当前版本显示
//            「当前 → 目标」核对行（pluginsSwitch 确认后 plugins/run update，取消还原）。
// v2.4.1-fix（2026-08-14 实测修复）：动态 client 沙箱将全局 fetch 替换为教学 trap
// （抛错重定向到 host.call）——doCheck/doPull 的 3 处 fetch() 改为 window.fetch()，
// 绕过参数遮蔽直达页面主 realm（CORS 直连 GitHub API 实测 200）。
// v2.4.1-fix2（2026-08-14）：locale.register 在 update 场景抛 duplicate（旧实例残留、
// single occupant）导致 client-half-failed——safeRegister 吞冲突，字典未变沿用旧注册。
// v2.4.1（方案「插件版本检测与一键更新方案.md」§9-T5/T6 实测回填）：
// ① 数据获取移至浏览器：host 无出网能力（web.fetch 无 provider）——本半部直连
//    api.github.com（CORS 实测 200）取 tags/release 载荷与 contents API 文件
//    （base64 → atob 解码），host 只做解析/校验/写入；新增 updRepoNotFound 错误文案；
// ② RPC 携带 sessionId——host 经会话策略解析沙箱边界（写入限定会话工作区）；
// ③ UPDATER_MANIFEST 与 host PURE 区段同步（validateManifestFiles 为权威校验）。
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

// @dsh-client-constants-inject

const configState = { value: { ...CONFIG_DEFAULTS }, listeners: new Set(), fresh: true };

function cloneDefaults() {
  return {
    version: 2,
    main: { provider: '', model: '', reasoning: { enabled: false, effort: '' } },
    fallback: [],
    customModels: [],
    order: [],
    params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
    template: { mode: 'builtin', text: '', texts: { base: '', lite: '', standard: '', smart: '', publish: '' } },
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
  // v2.4.7（每模式独立自定义模板）：
  // ① texts（4 模式键白名单，各 ≤4000）为新结构；
  // ② 无 texts 时旧 text 迁移到全部 4 模式（保持"全局一份"语义不丢内容）；
  // ③ text 字段保留兼容（host validateConfig 双兼容，读旧值也 OK）
  if (typeof t.text === 'string' && t.text.length <= 4000) v.template.text = t.text;
  if (t.texts && typeof t.texts === 'object') {
    // v2.7.0：白名单动态化（MODE_VALUES 含 publish——修复 publish 自定义模板被丢弃，
    // 与 v2.5.3 同类问题的 publish 复发）
    for (const key of MODE_VALUES) {
      if (typeof t.texts[key] === 'string' && t.texts[key].length <= 4000) v.template.texts[key] = t.texts[key];
    }
  } else if (typeof v.template.text === 'string' && v.template.text !== '') {
    for (const key of MODE_VALUES) v.template.texts[key] = v.template.text;
  }
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
  // v2.8.2（用户需求）：一键发布模式记忆默认开启且不可关闭
  if (v.mode === 'publish') v.memory = true;
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
  // v2.4.7：v1 平铺 templateText → 迁移到全部模式 texts（v2.7.0：键 = MODE_VALUES，含 publish）
  if (typeof parsed.templateText === 'string' && parsed.templateText.length <= 4000) {
    v.template.text = parsed.templateText;
    for (const key of MODE_VALUES) v.template.texts[key] = parsed.templateText;
  }
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

// v2.7.0：保存状态机——设置改动后 1s（防抖）执行真实校验（localStorage 读回对比），
// 校验过程伴随转圈动效（保底 0.5s），已落实 → 「已保存」/ 未落实 → 「保存失败」。
const saveStatus = { phase: 'idle', seq: 0, listeners: new Set() };
function subscribeSaveStatus(fn) {
  saveStatus.listeners.add(fn);
  return () => { saveStatus.listeners.delete(fn); };
}
function notifySaveStatus() {
  for (const fn of [...saveStatus.listeners]) fn();
}
// timer 服务化延迟（动态 client 无全局 setTimeout——经 ctx timer 服务；无服务 → 立即 resolve）
function timerDelay(ms) {
  return new Promise((resolve) => {
    if (timerSvc && typeof timerSvc.timeout === 'function') { timerSvc.timeout(resolve, ms); return; }
    if (timerSvc && typeof timerSvc.interval === 'function') {
      const d = timerSvc.interval(() => { try { d(); } catch (e) { /* ignore */ } resolve(); }, ms);
      return;
    }
    resolve();
  });
}
// 真实校验：localStorage 中的配置与当前 configState 逐字一致（写入即 JSON.stringify）
function verifyConfigSaved() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw !== null && raw === JSON.stringify(configState.value);
  } catch (e) { return false; }
}
function finishSaveCheck(seq, ok) {
  if (seq !== saveStatus.seq) return;
  saveStatus.phase = ok ? 'saved' : 'failed';
  notifySaveStatus();
  // 3s 后回到 idle（提示消失）
  timerDelay(3000).then(() => {
    if (seq === saveStatus.seq && saveStatus.phase !== 'saving') {
      saveStatus.phase = 'idle';
      notifySaveStatus();
    }
  });
}
async function runSaveCheck(seq) {
  if (seq !== saveStatus.seq) return;
  const started = Date.now();
  const ok = verifyConfigSaved();
  const remain = Math.max(0, 500 - (Date.now() - started)); // 转圈保底 0.5s
  if (remain > 0) await timerDelay(remain);
  finishSaveCheck(seq, ok);
}
function scheduleSaveCheck(seq) {
  if (!timerSvc) return; // 无 timer 服务 → 不启动状态机（保持即时行为）
  timerDelay(1000).then(() => { // 改动 1s 后执行真实检查（防抖：过期检查由 seq 丢弃）
    if (seq === saveStatus.seq) runSaveCheck(seq);
  });
}

function saveConfig(patch) {
  configState.value = { ...configState.value, ...patch };
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(configState.value)); } catch (e) { /* 忽略 */ }
  }
  // v2.7.0：保存校验状态机——saving（转圈）→ 1s 后真实校验 → saved/failed
  if (timerSvc) {
    const seq = ++saveStatus.seq;
    saveStatus.phase = 'saving';
    notifySaveStatus();
    scheduleSaveCheck(seq);
  }
  for (const fn of [...configState.listeners]) fn();
}

function subscribeConfig(fn) {
  configState.listeners.add(fn);
  return () => { configState.listeners.delete(fn); };
}

loadConfigFromStorage();

// @dsh-client-i18n-inject

const EN = {
  enhanceButton: 'Optimize',
  enhancing: 'Optimizing',
  result: '✓ Optimized · Undo',
  titleIdle: 'Optimize the prompt with an independent LLM call',
  // v2.6.2（继续优化）：已优化过一轮后修改草稿的按钮文字与提示
  btnContinue: 'Continue',
  titleContinue: 'Continue optimizing: a previous round exists; refine based on your edits (independent LLM call)',
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
  // v2.4.3：version switch confirmation
  pluginsTarget: 'Target version',
  pluginsSwitch: 'Confirm switch',
  // v2.4.3-fix：incomplete package marker
  pluginsIncomplete: ' (incomplete)',
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
  // v2.7.0：更新未重启提醒
  updRestartNeeded: '⚠️ Plugin files were updated but the service has not restarted — restart to activate the new version. Restart command: ',
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
  updRepoNotFound: 'Repository not found or unreachable (HTTP 404)',
  // v2.5.0 (one-click update & restart + environment check)
  envBtn: 'Check env',
  envChecking: 'Checking…',
  envTitle: 'Environment',
  envOk: 'OK',
  envService: 'Service',
  envServiceMissing: 'Service not found — set updater.serviceName in the plugin config',
  envSvcType: 'Service start type',
  envSvcTypeDisabled: 'Service disabled — enable it first (sc config <svc> start= auto)',
  envSvcBin: 'Service executable',
  envSvcBinMissing: 'Service program file missing (nssm Application) — check the service configuration',
  envSvcImageMissing: 'Service program file missing (ImagePath) — check the service configuration',
  envSvcNoService: 'Service not found — cannot check the service program',
  // v2.7.0（重启工具可用性检查）
  envTools: 'Restart tools',
  envToolsMissing: 'Missing restart commands (sc/netstat/reg) — check the system directory',
  // v2.7.1（网络预检 + 工具不可达降级）
  envNet: 'Network (GitHub)',
  envNetUnreachable: 'GitHub unreachable — one-click update install may fail (check network/proxy)',
  envToolUnreachable: 'System tools unreachable (PATH broken) — results unreliable, check the system environment',
  // v2.7.0（更新端口独立检查——显示名用「更新」口径，避免内部术语「执行器」）
  envExecPort: 'Update port independent',
  envExecPortSame: 'Update port equals the service port — the updater cannot listen; change updater.executorPort',
  envExecPortOccupied: 'Update port is held by another process — the updater may be unavailable; free it or change updater.executorPort',
  envExecPortNoPort: 'Cannot resolve the service port — cannot confirm update-port independence',
  updApply: '⚡ Update & restart',
  updApplyConfirm: 'Confirm service restart?',
  updApplying: 'Installing update… (10–60s)',
  updApplyStaging: 'Downloading update resources…',
  updApplyEnvcheck: 'Checking environment…',
  updApplyPreparing: 'Preparing install…',
  updApplyRollingBack: 'Restart failed — rolling back to previous version…',
  updApplyRolledBack: '✓ Rolled back to the previous version — refresh the page',
  updApplyRestarting: 'Restarting service… (attempt {round} · {sec}s left)',
  updApplyRetry: 'Attempt {n} did not recover — executor auto-retrying…',
  updApplyRestartFailed: 'Still down after 5 attempts — run `net start dsh-web` manually, then refresh',
  updApplyExecutorDown: 'Update executor unavailable — ensure bundle install (port 3081)',
  updApplyDone: '✓ Restarted — refresh the page',
  updApplyReload: 'Refresh',
  updApplyInstalledManual: 'Installed — restart the service manually',
  updApplyUnsupported: 'Dynamic install does not support one-click update; use bundle install',
  updApplyBlocked: 'Environment check failed, resolve first: ',
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
  // v2.4.7（per-mode）：label 带当前模式名；hint 说明独立与回退语义
  cfgTemplateTextFor: 'Custom template text (current mode: {mode})',
  cfgTemplateNote: 'Each mode keeps its own copy; when the current mode has no custom text, the built-in template is used.',
  cfgSaved: '✓ Saved',
  // v2.7.0：保存校验状态（转圈/失败）
  cfgSaving: 'Saving…',
  cfgSaveFailed: '✗ Save failed, please retry',
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
  cfgPublishMemoryLocked: 'Memory is forced ON in Publish mode (needed for iterative expansion) and cannot be disabled.',
  cfgMode: 'Mode',
  cfgMemory: 'Memory',
  cfgMemoryNote: 'When on, iterative rounds (optimize → edit → re-optimize) accumulate into a memory chain (persistent memory: fixed window of the latest 4 input/output pairs, rolling; sending or clearing the composer does NOT clear it — deleting content may signal a direction change; only Undo drops the last round). Each re-optimization replays the chain as a multi-turn conversation and senses your edit direction (added/removed); first run falls back to Lite automatically; when off, memory is never read or written',
  cfgModeHintBase: 'Direct optimization, no context, fastest',
  cfgModeHintLite: 'Local rule analysis of the input (goal/constraints/format/example); missing elements are clarified conservatively only when inferable; no external context is injected',
  cfgModeHintStandard: 'Rule understanding + file & session retrieval, no extra LLM call',
  cfgModeHintSmart: 'LLM task analysis + full retrieval, best understanding',
  // v2.7.0（一键发布）：网络检索 + 工作区检索 + 九章规格生成
  cfgModeHintPublish: 'Feed a rough idea (e.g. "I want to make a card game") → web-search similar project structures + workspace references, generate a complete implementable dev spec in one click (9 chapters: goal/core loop/numbers/data/mechanics/UI/tech/roadmap/acceptance); iterative refinements keep improving it (memory forced ON; context budget must be > 0 to enable retrieval)',
  cfgContextBudget: 'Context budget',
  cfgContextBudget0: '0 (no injection)',
  cfgContextNote: 'V2 analyzes task progress and retrieves relevant workspace files before optimizing; budget 0 = no injection (equivalent to basic)',
  cfgPublishNoLimit: 'Publish mode has no output limits: token/character caps are released (provider default) and timeout is auto ≥240s — these three options do not apply to publish mode (they only affect other modes); context budget still applies (> 0 enables retrieval)',
  // v2.3（§7.2/§7.3）：模式短标签 + 步骤进度文案 + 记忆开关
  modeShortBase: 'Basic',
  modeShortLite: 'Lite',
  modeShortStandard: 'Standard',
  modeShortSmart: 'Smart',
  modeShortPublish: 'Publish',
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
    s = { phase: 'idle', backup: '', enhanced: '', error: null, seq: 0, listeners: new Set(), memoryRounds: [], optimized: false };
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
// v2.6.1（记忆链）：返回 { mode, seed, memory }；memory = { rounds: s.memoryRounds }（供 host
// 以真多轮消息注入）；记忆开 + 无链 + 无标记（真正首次）→ 轻量兜底。
function resolveActualMode(sessionId, cfg) {
  const s = storeFor(sessionId);
  let mode = cfg.mode;
  let seed = false;
  let memory = null;
  if (cfg.memory) {
    if (s.memoryRounds && s.memoryRounds.length > 0) {
      // 记忆开 + 有记忆链 → 当前模式 + rounds 链（host 真多轮注入）
      memory = { rounds: s.memoryRounds };
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
  // v2.2（§6.3）：实际模式判定（纯模式 + 记忆开关/首次兜底）——实际 mode、seed、记忆链随请求传给 host
  const actual = resolveActualMode(sessionId, config);
  const req = { sessionId, seq, text: parts.body, config, mode: actual.mode };
  if (actual.seed) req.seed = true;
  if (actual.memory) req.memory = actual.memory;
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
        // v2.6.2（继续优化标记）：成功应用过结果 → 后续修改草稿时按钮显示「继续优化」
        s.optimized = true;
        // v2.2（§6.5/R1）：仅结果已应用且记忆开关开启时写入记忆（斜杠命令存正文）并打标；
        // v2.6.1（记忆链）：追加本轮 {input, output} 并截断到最近 MEMORY_ROUNDS_MAX 轮
        if (config.memory) {
          s.memoryRounds.push({ input: parts.body, output: r.text });
          if (s.memoryRounds.length > MEMORY_ROUNDS_MAX) s.memoryRounds.shift();
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
  // v2.1（§2.4）：撤回 = 放弃上轮结果 = 清除其记忆（语义一致）；
  // v2.6.1（记忆链）：只弹出最后一轮——更早轮次仍属本轮迭代历史，继续有效
  s.memoryRounds.pop();
  // v2.6.2（继续优化标记）：撤回 = 回到起点，重新开始算「首次优化」
  s.optimized = false;
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

  // v2.7.0：发送（提交后 composer 清空）/ 手动清空输入框 → 恢复初始优化形态
  // （optimized 重置 → 按钮回「优化」而非「继续优化」）；后台记忆链（memoryRounds）
  // 保留——用户删除内容可能表示方向调整或反馈方向不正确，不清除（持续记忆）。
  React.useEffect(() => {
    if (typeof draft !== 'string' || draft.trim() !== '') return;
    const s = storeFor(sessionId);
    if (s.optimized === true) {
      s.optimized = false;
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
      // v2.6.2（继续优化）：已成功应用过 ≥1 轮 → hover 提示区分（首次/继续）
      const isContinue = !!s && s.optimized === true;
      title = ok ? (isContinue ? t('titleContinue') : t('titleIdle'))
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
    // v2.6.2（继续优化）：已优化过一轮且草稿已修改 → 纯文字「继续优化」（无 ✨ 图标）；
    // 首次 → ✨ + 模式短标签（记忆饱和度仅作用于 ✨，continue 态无图标故不受影响）
    phase === 'result' ? null
      : (s && s.optimized === true)
        ? React.createElement('span', { className: 'dsh-enh-mode' }, t('btnContinue'))
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
// v2.4.1（实测回填 §9-T6）：host 侧无出网能力（web.fetch 无 provider）——**数据获取移到浏览器**：
// GitHub API 支持 CORS（实机验证 200）；本组件直连 api.github.com 取 tags/release 载荷与
// contents API 文件（base64 → atob 解码），host 只做解析/校验/写入（update/check、update/pull）。
// @dsh-client-updater-inject

function UpdaterCard(props) {
  const t = makeT(props);
  const [repoInput, setRepoInput] = React.useState(updaterRepoOf(configState.value));
  const [dirInput, setDirInput] = React.useState((configState.value.updater && configState.value.updater.targetDir) || '');
  const [checking, setChecking] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [pullRes, setPullRes] = React.useState(null);
  const [error, setError] = React.useState(null);
  // v2.5.0：环境检测（null=未检测；host 侧 60s 缓存）
  const [envItems, setEnvItems] = React.useState(null);
  const [envChecking, setEnvChecking] = React.useState(false);
  const [envError, setEnvError] = React.useState(null);
  // v2.5.0：一键更新（idle|confirm|applying|restarting|done|rolledback）
  const [applyPhase, setApplyPhase] = React.useState('idle');
  const [applyErr, setApplyErr] = React.useState(null);
  const [applyStatus, setApplyStatus] = React.useState(null);
  // v2.5.5：重启自检倒计时（秒）与重试轮次（首次 1 / 自动重试 2）
  const [restartLeft, setRestartLeft] = React.useState(0);
  const [restartRound, setRestartRound] = React.useState(1);
  // v2.7.0：更新未重启提醒（null=无提醒；命中显示横幅 + 重启命令）
  const [restartNotice, setRestartNotice] = React.useState(null);

  // v2.4.1（§9-T5）：RPC 携带 sessionId——host 需经会话解析 sandboxPolicy（写入边界=会话工作区）
  const sessionId = props.useSessions ? props.useSessions((s) => s.current) : undefined;

  // v2.7.0：更新未重启提醒——挂载时检测磁盘插件文件是否晚于本进程加载
  // （dsh plugin add/update 装了新版本但服务没重启 → 提醒重启 + 给出命令）
  React.useEffect(() => {
    let disposed = false;
    host.call('update/restartNeeded', { serviceName }).then((r) => {
      if (!disposed && r && r.needed === true) setRestartNotice(r);
    }).catch(() => { /* 旧 host/动态形态无此 RPC → 静默 */ });
    return () => { disposed = true; };
  }, []);

  const repo = updaterRepoOf({ updater: { repo: repoInput, targetDir: '' } });
  // v2.5.0：可配置服务名/profile（config.updater，缺省 dsh-web / web）
  const updaterCfg = configState.value && configState.value.updater ? configState.value.updater : {};
  const serviceName = typeof updaterCfg.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(updaterCfg.serviceName) ? updaterCfg.serviceName : 'dsh-web';
  const profile = typeof updaterCfg.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(updaterCfg.profile) ? updaterCfg.profile : 'web';

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
    // v2.4.1（§9-T6）：浏览器直连 GitHub API（CORS），host 只做解析/比较
    Promise.all([
      window.fetch(updaterTagsUrl(repo)).then((r) => r.status === 200 ? r.text() : Promise.reject(new Error('tags HTTP ' + r.status))),
      window.fetch(updaterReleaseUrl(repo)).then((r) => r.text()), // 404 属正常（无 release），透传载荷
    ]).then(([tagsText, releaseText]) => {
      return host.call('update/check', { repo, sessionId, tagsPayload: tagsText, releasePayload: releaseText });
    }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok !== true) {
        setError(r.message || t('updError'));
      } else {
        setResult(r);
        if (dirInput === '' && typeof r.defaultDir === 'string' && r.defaultDir) {
          setDirInput(r.defaultDir);
        }
      }
    }).catch((e) => {
      // 404 = 仓库不存在（tags 接口）；其余网络/解析失败统一提示
      setError(e && e.message && e.message.indexOf('HTTP 404') !== -1 ? t('updRepoNotFound') : t('updError'));
    }).then(() => {
      setChecking(false);
    });
  };

  const doPull = () => {
    if (pulling || !result || !result.remoteTag) return;
    setPulling(true);
    setError(null);
    // v2.4.1（§9-T6）：浏览器直连 contents API 拉取 6 文件（base64 → atob 解码）→ host 校验写入
    Promise.all(UPDATER_MANIFEST.map((name) =>
      window.fetch(updaterContentsUrl(repo, result.remoteTag, name)).then((r) => {
        if (r.status !== 200) throw new Error(name + ' HTTP ' + r.status);
        return r.json();
      }).then((meta) => {
        if (!meta || meta.encoding !== 'base64' || typeof meta.content !== 'string') throw new Error(name + ' bad payload');
        if (typeof meta.size === 'number' && meta.size > 1000000) throw new Error(name + ' too large');
        return { name, content: atob(meta.content) };
      }),
    )).then((files) => {
      return host.call('update/pull', { repo, tag: result.remoteTag, dir: dirInput, sessionId, files });
    }).then((res) => {
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

  // v2.5.0：环境检测（只读；host 60s 缓存）；v2.7.0：带执行器端口供 exec-port 检查
  const doEnvCheck = () => {
    if (envChecking) return;
    setEnvChecking(true);
    setEnvError(null);
    host.call('update/envcheck', { serviceName, executorPort: executorPort() }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok !== true) {
        setEnvItems(null);
        setEnvError(r.message || t('updError'));
      } else {
        setEnvItems(r.items || []);
      }
    }).catch(() => {
      setEnvError(t('updError'));
    }).then(() => {
      setEnvChecking(false);
    });
  };

  // v2.6.0：一键更新——确认态 → 前置环境校验 → executorEnsure（拉起独立执行器）→
  // 执行器 apply（安装 + 后台重启循环，3s 缓冲 / 5 次健康检查重试）→ 轮询 status。
  // 执行器独立于 dsh-web 进程：服务重启期间它存活，client 全程可查询进度/倒计时。
  const startApply = () => {
    if (applyPhase !== 'idle') return;
    setApplyPhase('confirm');
  };
  const cancelApply = () => {
    if (applyPhase === 'confirm') setApplyPhase('idle');
  };
  const executorPort = () => {
    const p = configState.value && configState.value.updater && Number.isInteger(configState.value.updater.executorPort)
      ? configState.value.updater.executorPort : 3081;
    return p;
  };
  // status 轮询（每 2s；倒计时每轮 10s；每轮结束反馈「第 N 次未恢复，自动重试中」）
  const pollExecutorStatus = (port) => {
    let localLeft = 10;
    setRestartLeft(localLeft);
    setRestartRound(1);
    const tick = () => {
      executor.call('status', {}, port).then((st) => {
        const s = st && typeof st === 'object' ? st : {};
        if (s.phase === 'healthy') {
          setApplyErr(null);
          if (/rolled back/i.test(s.message || '')) {
            setApplyStatus(t('updApplyRolledBack'));
            setApplyPhase('rolledback');
          } else {
            setApplyStatus(null);
            setApplyPhase('done');
          }
          return;
        }
        if (s.phase === 'failed') {
          setApplyErr(s.message || t('updApplyRestartFailed'));
          setApplyStatus(null);
          setApplyPhase('idle');
          return;
        }
        const phaseStatus = {
          validating: t('updApplyStaging'),
          staging: t('updApplyStaging'),
          envcheck: t('updApplyEnvcheck'),
          preparing: t('updApplyPreparing'),
          installing: t('updApplying'),
          rollback: t('updApplyRollingBack'),
        };
        if (phaseStatus[s.phase]) {
          setApplyErr(null);
          setApplyStatus(phaseStatus[s.phase]);
          setApplyPhase('applying');
          setTimeout(tick, 2000);
          return;
        }
        // restarting
        setApplyErr(null);
        setApplyStatus(null);
        setApplyPhase('restarting');
        setRestartRound(s.attempt || 1);
        localLeft -= 2;
        if (localLeft <= 0) {
          // 每轮倒计时结束反馈（执行器内部自动重试，这里仅展示进度）
          setApplyErr(t('updApplyRetry').replace('{n}', String(s.attempt || 1)));
          localLeft = 10;
        }
        setRestartLeft(localLeft);
        setTimeout(tick, 2000);
      }).catch(() => {
        // 执行器暂时不可达（服务重启窗口或执行器重启中）——继续轮询
        localLeft -= 2;
        if (localLeft <= 0) {
          setApplyErr(t('updApplyRetry').replace('{n}', String('?')));
          localLeft = 10;
        }
        setRestartLeft(localLeft);
        setTimeout(tick, 2000);
      });
    };
    tick();
  };
  const runApply = () => {
    if (applyPhase !== 'confirm') return;
    setApplyPhase('applying');
    setApplyErr(null);
    setApplyStatus(null);
    // 前置校验：先环境检测（host 60s 缓存），block 级失败 → 阻止并列出缺失项
    host.call('update/envcheck', { serviceName, executorPort: executorPort() }).then((envRes) => {
      const er = envRes && typeof envRes === 'object' ? envRes : {};
      if (er.ok === true && Array.isArray(er.blockMissing) && er.blockMissing.length > 0) {
        const names = er.blockMissing
          .map((k) => { const def = ENV_ITEMS.find((i) => i.key === k); return def ? t(def.label) : k; })
          .join('、');
        setApplyErr(t('updApplyBlocked') + ' ' + names);
        setEnvItems(er.items || null);
        setApplyPhase('idle');
        return null;
      }
      if (er.ok === true && Array.isArray(er.items)) setEnvItems(er.items);
      // v2.6.0：确保独立执行器运行（拉起/版本对齐），返回其端口
      return host.call('update/executorEnsure', { port: executorPort() });
    }).then((ensureRes) => {
      if (!ensureRes) return; // 被前置校验阻止
      const en = ensureRes && typeof ensureRes === 'object' ? ensureRes : {};
      if (en.ok !== true) {
        setApplyErr((en.message ? en.message + ' ' : '') + t('updError'));
        setApplyPhase('idle');
        return null;
      }
      // 执行器 apply：安装 + 后台重启（accepted 立即返回）
      return executor.call('apply', { repo, tag: result.remoteTag, profile, serviceName, port: en.port }, en.port);
    }).then((applyRes) => {
      if (!applyRes) return;
      const ar = applyRes && typeof applyRes === 'object' ? applyRes : {};
      if (ar.ok !== true) {
        setApplyErr((ar.message ? ar.message + ' ' : '') + t('updError'));
        setApplyPhase('idle');
        return;
      }
      // 轮询执行器状态（倒计时 + 每轮反馈；执行器独立存活，服务重启不断连）
      setApplyStatus(t('updApplying'));
      pollExecutorStatus(executorPort());
    }).catch(() => {
      setApplyErr(t('updApplyExecutorDown'));
      setApplyPhase('idle');
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
    // v2.7.0：更新未重启提醒横幅（装新版本未重启时显示，含重启命令）
    restartNotice
      ? React.createElement('div', { className: 'dsh-plg-restart-notice', role: 'status' },
          React.createElement('span', { className: 'dsh-plg-restart-text' }, t('updRestartNeeded')),
          React.createElement('code', { className: 'dsh-plg-restart-cmd' }, restartNotice.command || ''),
        )
      : null,
    // 行 1：repo 输入 + 检测按钮 + 环境检测按钮（v2.5.0，样式同检测按钮）
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
      React.createElement('button', {
        type: 'button',
        className: 'dsh-plg-btn dsh-plg-btn-primary',
        disabled: checking || pulling || envChecking,
        onClick: doEnvCheck,
      }, envChecking ? t('envChecking') : t('envBtn')),
    ),
    // v2.5.0：环境检测结果区（✓ 绿 / ⚠ 黄灰 / ✗ 红 + 指引）
    envItems || envError
      ? React.createElement('div', { className: 'dsh-plg-env' },
          React.createElement('div', { className: 'dsh-plg-row' },
            React.createElement('span', { className: 'dsh-plg-label' }, t('envTitle')),
          ),
          envError
            ? React.createElement('div', { className: 'dsh-plg-error', role: 'status' }, envError)
            : null,
          envItems
            ? React.createElement('div', { className: 'dsh-plg-env-list' },
                ENV_ITEMS.map((def) => {
                  const it = envItems.find((x) => x.key === def.key);
                  if (!it) return null;
                  const cls = it.ok ? 'ok' : (it.warn ? 'warn' : 'fail');
                  const detailKey = ENV_DETAIL_TEXT[it.detail] || 'envOk';
                  return React.createElement('div', { key: def.key, className: 'dsh-plg-env-item dsh-plg-env-' + cls },
                    React.createElement('span', { className: 'dsh-plg-env-mark' }, it.ok ? '✓' : (it.warn ? '⚠' : '✗')),
                    React.createElement('span', { className: 'dsh-plg-env-label' }, t(def.label)),
                    React.createElement('span', { className: 'dsh-plg-env-detail' }, t(detailKey)),
                  );
                }),
              )
            : null,
        )
      : null,
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
    // v2.5.0：一键更新并重启（仅 outdated；确认态 → 执行 → done 提供刷新按钮）
    result && result.status === 'outdated'
      ? React.createElement('div', { className: 'dsh-plg-row' },
          React.createElement('button', {
            type: 'button',
            className: 'dsh-plg-btn ' + (applyPhase === 'confirm' ? 'dsh-plg-btn-danger' : 'dsh-plg-btn-primary'),
            disabled: applyPhase === 'applying' || applyPhase === 'restarting' || checking || pulling || envChecking,
            onClick: applyPhase === 'confirm' ? runApply : startApply,
          }, applyPhase === 'confirm' ? t('updApplyConfirm')
            : applyPhase === 'applying' ? t('updApplying')
            : applyPhase === 'restarting' ? t('updApplyRestarting').replace('{sec}', String(restartLeft)).replace('{round}', String(restartRound))
            : applyPhase === 'done' ? t('updApplyDone')
            : applyPhase === 'rolledback' ? t('updApplyRolledBack')
            : t('updApply')),
          applyPhase === 'confirm'
            ? React.createElement('button', {
                type: 'button',
                className: 'dsh-plg-btn',
                onClick: cancelApply,
              }, t('cancel'))
            : null,
          applyPhase === 'done'
            ? React.createElement('button', {
                type: 'button',
                className: 'dsh-plg-btn dsh-plg-btn-primary',
                onClick: () => window.location.reload(),
              }, t('updApplyReload'))
            : null,
        )
      : null,
    applyStatus
      ? React.createElement('div', { className: 'dsh-plg-status', role: 'status' }, applyStatus)
      : null,
    applyErr
      ? React.createElement('div', { className: 'dsh-plg-error', role: 'status' }, applyErr)
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
  // v2.4.3：版本选择与确认切换——选中非当前版本时显示「当前 → 目标」核对行，确认后执行 update
  const [selVersion, setSelVersion] = React.useState({});

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
      const versions = (p.packages || []).map((pkg) => {
        // v2.4.3-fix：残缺包（缺 host/client 半部）禁用并标注，防误切导致 UI 消失
        const complete = pkg.hasHostHalf !== false && pkg.hasClientHalf !== false;
        return React.createElement('option', {
          key: pkg.packageId,
          value: pkg.packageId,
          disabled: !complete,
        }, pkg.name + ' · ' + pkg.packageId + (complete ? '' : t('pluginsIncomplete')));
      });
      const running = p.activeRun !== undefined;
      // v2.4.3：受控版本选择（缺省=当前版本）；选中非当前版本 → 显示核对行
      const curId = p.currentPackageId || (p.packages && p.packages[0] && p.packages[0].packageId) || '';
      const sel = selVersion[p.pluginId] || curId;
      const switching = sel !== '' && sel !== curId;
      const switchMode = p.currentPackageId ? 'update' : 'run';
      return React.createElement('div', { key: p.pluginId, className: 'dsh-plg-card' },
        React.createElement('div', { className: 'dsh-plg-head' },
          React.createElement('span', { className: 'dsh-plg-name' }, p.pluginId + ' ' + p.name),
          React.createElement('span', { className: 'dsh-plg-state' }, stateText),
        ),
        React.createElement('div', { className: 'dsh-plg-row' },
          React.createElement('label', { className: 'dsh-plg-label' }, t('pluginsVersion')),
          React.createElement('select', {
            className: 'dsh-plg-select',
            value: sel,
            onChange: (e) => setSelVersion({ ...selVersion, [p.pluginId]: e.target.value }),
          }, versions),
        ),
        p.currentPackageId
          ? React.createElement('div', { className: 'dsh-plg-row' },
              React.createElement('span', { className: 'dsh-plg-label' }, t('pluginsCurrent')),
              React.createElement('span', { className: 'dsh-plg-muted' }, p.currentPackageId),
            )
          : null,
        // v2.4.3：切换确认行——展示当前版本与目标版本供核对，确认后 plugins/run（update）
        switching
          ? React.createElement('div', { className: 'dsh-plg-row dsh-plg-switch' },
              React.createElement('span', { className: 'dsh-plg-muted' }, t('pluginsCurrent') + ' ' + (p.currentPackageId || '-')),
              React.createElement('span', { className: 'dsh-plg-muted' }, '→'),
              React.createElement('span', { className: 'dsh-plg-switch-target' }, t('pluginsTarget') + ' ' + sel),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-plg-btn dsh-plg-btn-primary',
                disabled: busy !== null,
                onClick: () => {
                  act('run', p.pluginId, { packageId: sel, mode: switchMode });
                  setSelVersion({ ...selVersion, [p.pluginId]: curId });
                },
              }, t('pluginsSwitch')),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-plg-btn',
                disabled: busy !== null,
                onClick: () => setSelVersion({ ...selVersion, [p.pluginId]: curId }),
              }, t('cancel')),
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
  // v2.4.3：默认展开（需求：模型配置栏打开即见完整内容）
  const [open, setOpen] = React.useState(true);
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
  // v2.4.7（每模式独立自定义模板 + 默认预填）+ v2.5.3 修复：
  // 切到「自定义模板」且当前优化模式无内容时 → host template/default 取该模式默认预填；
  // 索引键 = cfg.mode（优化模式 base/lite/standard/smart），非 cfg.template.mode（模板模式 custom/builtin）——
  // v2.5.2 及以前误用 template.mode 索引 texts/defaults（恒 undefined），预填与显示全部失效。
  const [prefillBusy, setPrefillBusy] = React.useState(false);
  React.useEffect(() => {
    if (cfg.template.mode !== 'custom' || prefillBusy) return;
    const cur = (cfg.template.texts && cfg.template.texts[cfg.mode]) || '';
    if (cur.trim() !== '') return; // 已有内容不覆盖
    setPrefillBusy(true);
    host.call('template/default').then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      const def = r.ok && r.defaults && typeof r.defaults[cfg.mode] === 'string'
        ? r.defaults[cfg.mode] : '';
      if (def !== '') {
        save({ template: { ...cfg.template, texts: { ...(cfg.template.texts || {}), [cfg.mode]: def } } });
      }
    }).catch(() => { /* 预填失败：保持空白，用户可手填；host 侧仍按模式回退内置 */ }).then(() => {
      setPrefillBusy(false);
    });
    // prefillBusy 入依赖：快速切换优化模式时（前一个模式预填进行中），完成后自动补预填当前模式
  }, [cfg.template.mode, cfg.mode, prefillBusy]);
  const curText = (cfg.template.texts && cfg.template.texts[cfg.mode]) || '';
  const curLabel = t('cfgTemplateTextFor').replace('{mode}', modeShortLabel(t, cfg.mode));
  // v2.8.0（实测修正）：发布模式不设输出限制（host 硬覆盖）——三项参数置灰的依据
  const isPublishMode = cfg.mode === 'publish';
  // v2.8.2（用户需求）：一键发布模式记忆默认开启且不可关闭
  const memoryLocked = isPublishMode;
  const memoryValue = memoryLocked ? true : cfg.memory;
  return React.createElement(React.Fragment, null,
    // v2.2（§6.6）：优化模式下拉（4 模式，记忆模式已删除）
    // v2.4.6（布局）：优化模式与模板合并为同一行双字段（两控件均属「优化行为」配置、
    // 宽度不大，并排省一行纵向空间；窄屏自动换行，见 .dsh-plg-field flex-wrap）
    React.createElement('div', { className: 'dsh-plg-row dsh-plg-row-duo' },
      React.createElement('div', { className: 'dsh-plg-field' },
        React.createElement('label', { className: 'dsh-plg-label' }, t('cfgMode')),
        React.createElement('select', {
          className: 'dsh-plg-select',
          value: cfg.mode,
          onChange: (e) => {
            const next = e.target.value;
            // v2.8.2：切到一键发布时同步把记忆置为开启
            save(next === 'publish' ? { mode: next, memory: true } : { mode: next });
          },
          children: MODE_OPTIONS.map((m) => React.createElement('option', { key: m.value, value: m.value }, m.label)),
        }),
      ),
      React.createElement('div', { className: 'dsh-plg-field' },
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
    ),
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgModeHint' + cfg.mode.charAt(0).toUpperCase() + cfg.mode.slice(1))),
    // v2.2（§6.2/§6.6）：记忆功能独立开关（所有模式可开/关，即时准确切换）
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgMemory')),
      React.createElement('select', {
        className: 'dsh-plg-select dsh-plg-select-thinking',
        value: memoryValue ? 'on' : 'off',
        disabled: memoryLocked,
        onChange: (e) => { if (!memoryLocked) save({ memory: e.target.value === 'on' }); },
        children: [
          React.createElement('option', { key: 'on', value: 'on' }, t('cfgReasoningOn')),
          React.createElement('option', { key: 'off', value: 'off' }, t('cfgReasoningOff')),
        ],
      }),
    ),
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgMemoryNote')),
    memoryLocked ? React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgPublishMemoryLocked')) : null,
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
    // v2.8.0（实测修正）：发布模式「不设输出限制」为 host 硬覆盖（超时 ≥240s、maxTokens 省略、
    // outputLimit=0）——超时/输出 Token 上限/输出字符上限三项对本模式不生效；置灰 + 说明，
    // 避免「调整后状态没有更新」的误导（此前可编辑但实际无效）
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgTimeout')),
      React.createElement('select', Object.assign({ className: 'dsh-plg-select', disabled: isPublishMode }, selectProps('timeoutMs', TIMEOUT_OPTIONS.map((v) => React.createElement('option', { key: v, value: String(v) }, (v / 1000) + 's'))))),
    ),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgMaxTokens')),
      React.createElement('select', Object.assign({ className: 'dsh-plg-select', disabled: isPublishMode }, selectProps('maxTokens', MAXTOKENS_OPTIONS.map((v) => React.createElement('option', { key: v, value: String(v) }, String(v)))))),
    ),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label' }, t('cfgOutputLimit')),
      React.createElement('select', Object.assign({ className: 'dsh-plg-select', disabled: isPublishMode }, selectProps('outputLimit', OUTPUTLIMIT_OPTIONS.map((v) => React.createElement('option', { key: v, value: String(v) }, String(v)))))),
    ),
    isPublishMode
      ? React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgPublishNoLimit'))
      : null,
    // v2.4.6（布局）：模板模式下拉已并入上方与优化模式同一行；此处仅保留自定义模板内容区
    // v2.4.7（每模式独立）：textarea 显示当前模式文本；编辑只写当前模式；切模式跟随
    cfg.template.mode === 'custom'
      ? React.createElement('div', { className: 'dsh-plg-col' },
          React.createElement('label', { className: 'dsh-plg-label' }, curLabel),
          React.createElement('textarea', {
            className: 'dsh-plg-textarea',
            value: curText,
            rows: 12,
            placeholder: t('cfgTemplateText'),
            onChange: (e) => save({ template: { ...cfg.template, texts: { ...(cfg.template.texts || {}), [cfg.mode]: e.target.value.slice(0, 4000) } } }),
          }),
          React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgTemplateNote')),
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
  // v2.7.0：保存状态订阅（saving 转圈 / saved ✓ / failed ✗）
  React.useEffect(() => subscribeSaveStatus(() => force((v) => v + 1)), []);

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
    // v2.7.0：保存状态——saving 转圈 / saved ✓ / failed ✗ / idle 隐藏；
    // 无 timer 服务（降级）→ 保持旧常驻「已保存」提示
    !timerSvc
      ? React.createElement('div', { className: 'dsh-plg-saved', role: 'status' }, t('cfgSaved'))
      : saveStatus.phase === 'saving'
        ? React.createElement('div', { className: 'dsh-plg-save dsh-plg-save-busy', role: 'status' },
            React.createElement('span', { className: 'dsh-enh-spin', 'aria-hidden': true }),
            React.createElement('span', null, t('cfgSaving')))
        : saveStatus.phase === 'failed'
          ? React.createElement('div', { className: 'dsh-plg-save dsh-plg-save-fail', role: 'status' }, t('cfgSaveFailed'))
          : saveStatus.phase === 'saved'
            ? React.createElement('div', { className: 'dsh-plg-save dsh-plg-save-ok', role: 'status' }, t('cfgSaved'))
            : null,
  );
}

function CordisBadgePlaceholder() {
  return null;
}

const CSS = [
  // v2.3.3（§7.10）：font-weight:500 对齐 DSH ModelSelect trigger 样式
  // v2.4.3-c（统一样式）：容器对齐模型 trigger——无边框、24px 胶囊、label-secondary 灰字、
  // hover 更深色椭圆背景 rgba(38,49,72,.06)（trigger 实测同值）、padding 0 8px 0 4px（左4右8，用户指定）；
  // busy/result 保留状态色（追加淡色背景表达）；emoji ✨ 与字重 600 保留（用户确认项）
  '.dsh-enh-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px 0 4px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px;cursor:pointer;transition:background-color .15s ease;white-space:nowrap}',
  '.dsh-enh-btn:hover:not(:disabled){background:rgba(38,49,72,.06)}',
  // v2.3.2（§7.2）：空输入不再降低按钮饱和度——disabled 仅保留点击无效提示，无 opacity 变暗
  '.dsh-enh-btn:disabled{cursor:not-allowed}',
  // v2.4.0（方案 §10.2）：三态文字显式字体锚点——13px/500/20px 与模型 trigger 对齐（实机实测），
  // idle/busy/result 均携带 dsh-enh-btn-text 类；子文本继承，不再依赖隐式继承链
  // v2.4.3（等线）：font-family 从 inherit 改为显式系统栈，并在 Microsoft YaHei 前插入 DengXian
  // （等线 = 微软官方屏显中文字体，笔画细、与 Segoe UI 视觉统一；中文不再回退到粗体雅黑）
  // v2.4.3-b（等线加粗）：font-weight 500→600——等线笔画细，600 下视觉更清晰（用户要求）
  // v2.4.3-c（统一样式）：文字锚点不再声明 padding（曾以 padding:0 覆盖容器 0 8px 0 4px，
  // 导致 hover 椭圆背景零留白贴文字）——padding 由容器统一承载（左4右8，用户指定）
  '.dsh-enh-btn-text{font-size:13px;font-weight:600;line-height:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","DengXian","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif}',
  // v2.3（§7.2）：idle 态 = emoji ✨ + 模式短标签（emoji 系统彩色，不承担状态色）
  // v2.3.2（§7.2）：记忆状态 → 图标饱和度——开=正常（无 dim）/ 关=低饱和（saturate(.2)，文字不受影响）
  '.dsh-enh-icon{font-size:14px;line-height:20px}',
  '.dsh-enh-icon-dim{filter:saturate(.2)}',
  // v2.4.0（方案 §10.2）：模式短标签不再独立声明字号——继承 .dsh-enh-btn-text 锚点（13px/500/20px）
  // v2.4.3-c（统一样式）：busy/result 去边框后以状态文字色 + 淡色背景表达（hover 时统一为深灰蓝椭圆反馈）
  '.dsh-enh-btn-busy{color:var(--dsw-alias-state-warn-primary);background:rgba(245,158,11,.06)}',
  '.dsh-enh-btn-result{color:var(--dsw-alias-state-success-primary);background:rgba(34,197,94,.06)}',
  // v2.3.3（§7.10）：busy hover 闪烁修复——progress 文档流占位（宽度恒定），
  // cancel absolute 覆盖其上，hover 只切 opacity（无尺寸抖动，hover 判定区不变）
  '.dsh-enh-btn-busy .dsh-enh-status{position:relative;display:inline-block;text-align:center}',
  '.dsh-enh-btn-busy .dsh-enh-progress{transition:opacity .12s ease}',
  '.dsh-enh-btn-busy .dsh-enh-cancel{position:absolute;inset:0;display:block;white-space:nowrap;opacity:0;color:var(--dsw-alias-state-error-primary);transition:opacity .12s ease}',
  '.dsh-enh-btn-busy:hover .dsh-enh-progress{opacity:0}',
  '.dsh-enh-btn-busy:hover .dsh-enh-cancel{opacity:1}',
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
  // v2.4.6（布局）：同行双字段——优化模式 + 模板合并一行；field 各占一半，
  // 窄屏自动换行（flex-wrap）；label 不再强制 96px 以免挤占 select 空间
  '.dsh-plg-row-duo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
  '.dsh-plg-field{display:flex;align-items:center;gap:6px;flex:1 1 200px;min-width:0}',
  '.dsh-plg-field .dsh-plg-label{min-width:0;flex:none}',
  '.dsh-plg-col{display:flex;flex-direction:column;gap:6px}',
  '.dsh-plg-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);flex:none;min-width:96px}',
  '.dsh-plg-muted{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  '.dsh-plg-select{flex:1;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:4px 6px}',
  '.dsh-plg-textarea{flex:1;min-width:0;min-height:180px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:6px 8px;resize:vertical;font-family:inherit}',
  '.dsh-plg-approval{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:16px;flex-wrap:wrap}',
  '.dsh-plg-actions{display:flex;gap:8px;justify-content:flex-end}',
  // v2.4.3：切换确认行——目标版本高亮便于核对
  '.dsh-plg-switch{flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-plg-switch-target{color:var(--dsw-alias-brand-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:3px 10px;cursor:pointer}',
  '.dsh-plg-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
  '.dsh-plg-btn:disabled{opacity:.45;cursor:not-allowed}',
  '.dsh-plg-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
  '.dsh-plg-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0}',
  '.dsh-plg-saved{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px}',
  // v2.7.0：保存状态机样式（转圈复用 dsh-enh-spin；saved/failed 状态色）
  '.dsh-plg-save{display:flex;align-items:center;gap:6px;font-size:12px;line-height:16px;margin-top:8px}',
  '.dsh-plg-save-ok{color:var(--dsw-alias-state-success-primary)}',
  '.dsh-plg-save-fail{color:var(--dsw-alias-state-error-primary)}',
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
  // v2.7.0：更新未重启提醒横幅（警告黄底 + 命令 code）
  '.dsh-plg-restart-notice{display:flex;flex-direction:column;gap:4px;margin:8px 0;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:8px 10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-restart-cmd{font-family:Consolas,Menlo,monospace;font-size:12px;line-height:16px;color:var(--dsw-alias-state-warn-primary);word-break:break-all}',
  '.dsh-plg-upd-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-upd-body{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;max-height:64px;overflow:auto;white-space:pre-wrap;word-break:break-all}',
  '.dsh-plg-upd-done{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-upd-apply{display:flex;flex-direction:column;gap:2px}',
  // v2.5.0：环境检测结果区 + 一键更新危险态
  '.dsh-plg-env{display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-plg-env-list{display:flex;flex-direction:column;gap:3px}',
  '.dsh-plg-env-item{display:flex;align-items:baseline;gap:6px;font-size:12px;line-height:16px}',
  '.dsh-plg-env-mark{flex:none;width:14px;text-align:center}',
  '.dsh-plg-env-label{flex:none;color:var(--dsw-alias-label-primary);min-width:88px}',
  '.dsh-plg-env-detail{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
  '.dsh-plg-env-ok .dsh-plg-env-mark{color:var(--dsw-alias-state-success-primary)}',
  '.dsh-plg-env-warn .dsh-plg-env-mark{color:var(--dsw-alias-state-warn-primary)}',
  '.dsh-plg-env-fail .dsh-plg-env-mark{color:var(--dsw-alias-state-error-primary)}',
  '.dsh-plg-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
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
      // v2.4.1-fix2（2026-08-14）：update 场景页面残留旧实例的 locale 命名空间
      // （single occupant 硬约束抛 duplicate 导致 client-half-failed）——
      // 字典未变时沿用旧注册即可：吞掉冲突、正常路径保留 disposer（卸载不误删他人）。
      const safeRegister = (ns, lang, dict) => {
        try {
          return locale.register(ns, lang, dict);
        } catch (e) {
          return null;
        }
      };
      ctx.effect(() => safeRegister('enhance', 'zh', ZH));
      ctx.effect(() => safeRegister('enhance', 'en', EN));
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
    // 注册幂等/唯一 id：本插件在 sidebar.footer.action 仅需占位（不渲染任何内容），
    // id 改用插件语义唯一值 cordis-panel-enh，回避与基座 dsh-client-ui-cordis 的
    // CordisPanel（id: 'cordis-panel'）冲突——同槽位同 id 触发 single-occupant duplicate，
    // 导致 update/重挂时 "Failed to load plugins"。历史 v2.4.1-fix2 同类问题即由此来。
    // （v2.4.5 曾无记录回退为 cordis-panel；v2.4.8 恢复本修复，见 CHANGELOG。）
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'cordis-panel-enh', order: 0 },
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