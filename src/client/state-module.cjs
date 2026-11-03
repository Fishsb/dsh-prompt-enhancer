'use strict';

// 客户端配置与会话状态（目标模式：普通 CommonJS，构建期由共享运行时内联）。
// host 显式注入；timer 经可变 timerRef 注入（app apply 时同步），避免跨 chunk 裸全局引用。
const {
  CONFIG_KEY, CONFIG_KEY_V1, CONFIG_DEFAULTS, MODE_VALUES,
  TEMPLATE_CUSTOM_MAX, TEMPLATE_NAME_MAX, TEMPLATE_TEXT_MAX,
} = require('./constants-module.cjs');

function createClientState(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const host = d.host;
  // app apply 时同步同一个可变引用；调用方未注入时保持自持有（单测/独立使用）。
  const timerRef = d.timerRef || { value: null };

const configState = { value: { ...CONFIG_DEFAULTS }, listeners: new Set(), fresh: true, unsupported: false, hostSync: null };

function cloneDefaults() {
  return {
    version: 2,
    fallback: [],
    customModels: [],
    order: [],
    params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
    template: {
      mode: 'builtin',
      text: '',
      texts: { base: '', lite: '', standard: '', smart: '', publish: '' },
      pick: { base: 'default', lite: 'default', standard: 'default', smart: 'default', publish: 'default' },
      custom: { base: [], lite: [], standard: [], smart: [], publish: [] },
      touched: [],
    },
    mode: 'base',
    context: { mode: 'smart', budgetChars: 4000, workspace: { maxFiles: 3, depth: 2 } },
    memory: false,
    updater: { repo: '', targetDir: '' },
  };
}

function sanitizeV2(parsed) {
  const v = cloneDefaults();
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
  if (t.texts && typeof t.texts === 'object') {
    // v2.7.0：白名单动态化（MODE_VALUES 含 publish——修复 publish 自定义模板被丢弃，
    // 与 v2.5.3 同类问题的 publish 复发）
    for (const key of MODE_VALUES) {
      if (typeof t.texts[key] === 'string' && t.texts[key].length <= 4000) v.template.texts[key] = t.texts[key];
    }
    // F7（配置卫生）：texts 存在时不再保留遗留 text 字段（写回即清理；texts 缺失时仍读 text 迁移）
  } else if (typeof t.text === 'string' && t.text.length <= 4000) {
    v.template.text = t.text;
    if (t.text !== '') {
      for (const key of MODE_VALUES) v.template.texts[key] = t.text;
    }
  }
  // F2（配置卫生）：touched 白名单（MODE_VALUES 内键、去重、上限 5）——用户编辑过的模式不再被 prefill 回填
  if (Array.isArray(t.touched)) {
    for (const key of t.touched.slice(0, 5)) {
      if (typeof key === 'string' && MODE_VALUES.includes(key) && !v.template.touched.includes(key)) v.template.touched.push(key);
    }
  }
  // 模板体系扩展（2026-08-17）：pick/custom 解析镜像 host PURE validateConfig——pick 白名单
  // default/supplement/dev/custom:<index>（index 越界回退 default）；custom 每模式 ≤10 条、
  // 每条 {name(≤40), text(≤4000)}；旧配置（无 pick 字段）且 mode==='custom' 时 texts 非空 → 迁为 custom:0。
  const hasNewPick = t.pick && typeof t.pick === 'object';
  const customSrc = t.custom && typeof t.custom === 'object' ? t.custom : null;
  for (const key of MODE_VALUES) {
    const list = Array.isArray(customSrc && customSrc[key]) ? customSrc[key] : [];
    for (const item of list.slice(0, TEMPLATE_CUSTOM_MAX)) {
      if (item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim() !== '' && item.text.length <= TEMPLATE_TEXT_MAX) {
        v.template.custom[key].push({
          name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim().slice(0, TEMPLATE_NAME_MAX) : '自定义模板 ' + (v.template.custom[key].length + 1),
          text: item.text,
        });
      }
    }
  }
  if (!hasNewPick && v.template.mode === 'custom') {
    for (const key of MODE_VALUES) {
      const legacy = v.template.texts[key];
      if (typeof legacy === 'string' && legacy.trim() !== '' && v.template.custom[key].length === 0) {
        v.template.custom[key].push({ name: '自定义模板', text: legacy });
        v.template.pick[key] = 'custom:0';
      }
    }
  } else if (hasNewPick) {
    for (const key of MODE_VALUES) {
      const p = typeof t.pick[key] === 'string' ? t.pick[key] : '';
      if (p === 'supplement' || p === 'dev') v.template.pick[key] = p;
      else if (p.indexOf('custom:') === 0) {
        const idx = parseInt(p.slice(7), 10);
        if (Number.isInteger(idx) && idx >= 0 && idx < v.template.custom[key].length) v.template.pick[key] = 'custom:' + idx;
      }
    }
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
  // v2.8.2 曾强制一键发布记忆开启且不可关闭；2026-08-18（用户指令）取消——记忆跟随开关，publish 不例外
  // v2.4.0（方案 §4）：updater 白名单校验（repo 格式 + 长度；targetDir 长度），旧配置缺字段 → 默认
  const u = parsed.updater && typeof parsed.updater === 'object' ? parsed.updater : {};
  if (typeof u.repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(u.repo) && u.repo.length <= 100) v.updater.repo = u.repo;
  if (typeof u.targetDir === 'string' && u.targetDir.length <= 200) v.updater.targetDir = u.targetDir;
  return v;
}

function migrateFromV1(parsed) {
  const v = cloneDefaults();
  // 2026-08-18（用户指令）：v1 平铺 provider/model 不再迁移（main 死配置字段删除，不维护老用户）
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
        // F3（配置卫生）：版本门控——version>2 的新结构配置不 sanitize、不写回（保护用户数据不被白名单摧毁），
        // 以默认配置运行并提示（configState.unsupported 由 UI 展示）
        if (typeof parsed.version === 'number' && parsed.version > 2) {
          configState.value = cloneDefaults();
          configState.fresh = false;
          configState.unsupported = true;
          return;
        }
        // 2026-08-18（用户指令）：main 死配置字段删除，不再迁移
        configState.value = sanitizeV2(parsed);
        configState.fresh = false;
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify(configState.value)); } catch (e) { /* 忽略 */ }
        return;
      }
    }
    const rawV1 = localStorage.getItem(CONFIG_KEY_V1);
    if (rawV1) {
      const parsed = JSON.parse(rawV1);
      if (parsed && typeof parsed === 'object') {
        configState.value = migrateFromV1(parsed);
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
    if (timerRef.value && typeof timerRef.value.timeout === 'function') { timerRef.value.timeout(resolve, ms); return; }
    if (timerRef.value && typeof timerRef.value.interval === 'function') {
      const d = timerRef.value.interval(() => { try { d(); } catch (e) { /* ignore */ } resolve(); }, ms);
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
  // 3s 后回到 idle（提示消失）；无 timer 服务 → 结果常驻（直到下次改动），保证显式反馈可见
  if (!timerRef.value) return;
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
  if (!timerRef.value) { runSaveCheck(seq); return; } // 无 timer 服务 → 同步立即真实校验（无防抖）
  timerDelay(1000).then(() => { // 改动 1s 后执行真实检查（防抖：过期检查由 seq 丢弃）
    if (seq === saveStatus.seq) runSaveCheck(seq);
  });
}

function saveConfig(patch) {
  configState.value = { ...configState.value, ...patch };
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(configState.value)); } catch (e) { /* 忽略 */ }
  }
  // v3.2.4（Issue #1 修复）：磁盘持久化双写——DSH Desktop 动态端口下 localStorage 按 Origin 隔离
  // 会「丢失」，磁盘配置（$DSH_HOME/dsh-prompt-enhancer.config.json）跨端口共享（fire-and-forget 失败静默）
  //
  // 🔴 P0 修复（2026-10-13 · 用户配置被清空）：**只写本次改动的字段**（patch），不再整份提交。
  //   病灶（实测复现 + 官方 rpc 语义实读）：此处原为 `{ config: configState.value }`（**整份**），
  //   而 lib/rpc-config.cjs 的 `config/set` 是**顶层键级 merge**（`for (const k of Object.keys(patch)) merged[k] = patch[k]`）
  //   ⇒ 整份提交时**每一个**顶层键都会覆盖磁盘值，含页面内可能是默认值的 `fallback`（`cloneDefaults()` 里
  //   `fallback: []`）。实测路径：模型链删到最后一条（`✕`「删除该模型」→ `saveFallback([])`）
  //   ⇒ 磁盘 `fallback` 被写成 `[]`（用户可见损伤：增强报「未配置模型」）。
  //   改为**只提交 patch**后：未改动的键（含 fallback）根本不出现在 payload 里 ⇒ merge 不会触碰。
  //   ⚠ 安全性前提（已全仓取证）：`configState.value` 无任何 `.X = ` 就地改写（grep 零命中），
  //   所有变更都经 saveConfig/sanitizeV2/cloneDefaults 整体赋值 ⇒ patch 语义完备。
  //
  // 自保（防「空覆盖非空」，与上面正交的第二道闸）：磁盘上非空、而本次 payload 把它变成空 ⇒ 跳过该键。
  //   为何不误伤合法清空：**合法清空（用户删掉最后一条模型链）走的也是本函数**，其意图就是置空 ⇒
  //   若一律禁止置空，用户将无法清空模型链。故判据不放「是否变空」，而放**「本次 patch 有没有显式
  //   声明该键」**：显式声明 = 用户动作 ⇒ 放行（哪怕置空）；未声明却出现在 payload 里 = 整份提交的
  //   副作用 ⇒ 拦下。本自保因此只在「有人误退回整份提交」时生效，是**回归保险**而非行为改变。
  if (typeof host !== 'undefined' && host && typeof host.call === 'function') {
    try {
      // 归一化：patch 非对象时退化为空对象（不得把 undefined 当整份提交的借口）
      const payload = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? { ...patch } : {};
      // ⚠ 兼容：调用方可能显式传「以 configState.value 为基准的整份」语义（历史行为）；
      //   本修复后仅提交 payload ⇒ 该语义由下方 merge 语义保证（磁盘既有键原样保留）。
      host.call('config/set', { config: payload }).catch(() => {});
    } catch (e) { /* 忽略 */ }
  }
  // v2.7.0：保存校验状态机——saving（转圈）→ 1s 后真实校验 → saved/failed；
  // 全状况显式反馈：无 timer 服务也启动状态机（同步校验，结果常驻）
  const seq = ++saveStatus.seq;
  saveStatus.phase = 'saving';
  notifySaveStatus();
  scheduleSaveCheck(seq);
  for (const fn of [...configState.listeners]) fn();
}

function subscribeConfig(fn) {
  configState.listeners.add(fn);
  return () => { configState.listeners.delete(fn); };
}

// v3.2.4（Issue #1 修复）：启动时从 host 磁盘同步配置（config/get·config/set，
// $DSH_HOME/dsh-prompt-enhancer.config.json）。DSH Desktop 主进程每次启动动态分配端口，
// localStorage 按 Origin（协议://域名:端口）隔离 → 重启后新 Origin 下 localStorage 为空 →
// 旧逻辑判定 fresh=true 用默认链覆盖用户配置。磁盘配置跨端口共享，hostSync 完成前不做首次继承。
const HOST_SYNC_MAX_ATTEMPTS = 10;
const HOST_SYNC_RETRY_MS = 2000;
let hostSyncAttempt = 0;
function notifyConfig() {
  for (const fn of [...configState.listeners]) fn();
}
function syncConfigFromHost() {
  if (configState.hostSync === true) return;
  const retry = () => {
    if (++hostSyncAttempt >= HOST_SYNC_MAX_ATTEMPTS) {
      configState.hostSync = false;
      notifyConfig();
      return;
    }
    if (timerRef.value && typeof timerRef.value.timeout === 'function') { timerRef.value.timeout(() => syncConfigFromHost(), HOST_SYNC_RETRY_MS); return; }
    if (typeof setTimeout === 'function') { setTimeout(syncConfigFromHost, HOST_SYNC_RETRY_MS); return; }
    configState.hostSync = false;
    notifyConfig();
  };
  if (typeof host === 'undefined' || !host || typeof host.call !== 'function') { retry(); return; }
  host.call('config/get').then((res) => {
    const r = res && typeof res === 'object' ? res : {};
    if (!r.ok) { retry(); return; }
    if (r.config && typeof r.config === 'object') {
      // 磁盘有配置：版本门控同 localStorage 策略（version>2 不 sanitize，防白名单摧毁用户数据）
      if (typeof r.config.version === 'number' && r.config.version > 2) {
        configState.value = cloneDefaults();
        configState.unsupported = true;
      } else {
        configState.value = sanitizeV2(r.config);
      }
      configState.fresh = false;
      configState.hostSync = true;
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify(configState.value)); } catch (e) { /* 忽略 */ }
      }
      notifyConfig();
      return;
    }
    // 磁盘无配置：localStorage 有（固定端口 web 老用户升级）→ 迁移写盘；都空 → 保持 fresh 首次继承
    configState.hostSync = true;
    if (!configState.fresh && typeof localStorage !== 'undefined' && localStorage.getItem(CONFIG_KEY)) {
      try { host.call('config/set', { config: configState.value }).catch(() => {}); } catch (e) { /* 忽略 */ }
    }
    notifyConfig();
  }).catch(() => retry());
}


// 2026-08-17（连通性测试预计耗时）：当前输入框草稿全局同步——设置页测试连通性
// 需要按输入长度动态估算“基础模式默认模板”输出量。
let lastDraft = '';
function setLastDraft(text) {
  lastDraft = typeof text === 'string' ? text : '';
}
function getLastDraft() {
  return lastDraft;
}
loadConfigFromStorage();
syncConfigFromHost();

  return {
    timerRef,
    configState,
    cloneDefaults,
    sanitizeV2,
    migrateFromV1,
    loadConfigFromStorage,
    saveStatus,
    subscribeSaveStatus,
    notifySaveStatus,
    timerDelay,
    verifyConfigSaved,
    finishSaveCheck,
    scheduleSaveCheck,
    saveConfig,
    subscribeConfig,
    HOST_SYNC_MAX_ATTEMPTS,
    HOST_SYNC_RETRY_MS,
    hostSyncAttempt,
    notifyConfig,
    syncConfigFromHost,
    lastDraft,
    setLastDraft,
    getLastDraft,
  };
}

module.exports = { createClientState };
