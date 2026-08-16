'use strict';
/**
 * M3: configuration schema and migration.
 *
 * Lightweight schema without external dependencies. This is the target source
 * of truth for plugin config; it will be replaced/augmented by Schemastery in
 * the full M3 implementation.
 */
const CONFIG_DEFAULTS = {
  version: 2,
  main: { provider: '', model: '', reasoning: { enabled: false, effort: '' } },
  fallback: [],
  customModels: [],
  order: [],
  params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
  // 模板体系扩展（2026-08-17）：pick=每模式选中键（default/supplement/dev/custom:<index>）；
  // custom=每模式多自定义模板列表 [{name,text}]（各 ≤4000、≤10 条）
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

const MODES = ['base', 'lite', 'standard', 'smart', 'publish'];

function cloneDefaults() {
  return JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
}

function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['config must be an object'], value: cloneDefaults() };
  }
  const errors = [];
  const value = cloneDefaults();

  if (raw.version !== undefined && raw.version !== 2) errors.push('unsupported config version: ' + raw.version);
  // F4（语义对齐）：'memory' 历史值 → lite + memory:true（镜像运行时 parseMode/parseMemory）
  const rawMode = raw.mode === 'memory' ? 'lite' : raw.mode;
  if (rawMode !== undefined && !MODES.includes(rawMode)) errors.push('invalid mode: ' + rawMode);
  else if (rawMode !== undefined) value.mode = rawMode;

  if (raw.memory !== undefined) {
    if (typeof raw.memory !== 'boolean') errors.push('memory must be boolean');
    else value.memory = raw.memory;
  }
  if (raw.mode === 'memory') value.memory = true;
  // F4（语义对齐）：一键发布模式记忆强制开启（镜像运行时 v2.8.2 host 兜底）
  if (value.mode === 'publish') value.memory = true;

  // F4（语义对齐）：params 解析镜像运行时——v2 结构（params.*）与 v1 平铺（顶层 timeoutMs/maxTokens/outputLimit）双兼容
  const p = raw.params && typeof raw.params === 'object' ? raw.params : raw;
  if (p.timeoutMs !== undefined) value.params.timeoutMs = Number.isInteger(p.timeoutMs) && p.timeoutMs >= 1000 && p.timeoutMs <= 300000 ? p.timeoutMs : value.params.timeoutMs;
  if (p.maxTokens !== undefined) value.params.maxTokens = Number.isInteger(p.maxTokens) && p.maxTokens >= 100 && p.maxTokens <= 16000 ? p.maxTokens : value.params.maxTokens;
  if (p.outputLimit !== undefined) value.params.outputLimit = Number.isInteger(p.outputLimit) && p.outputLimit >= 500 && p.outputLimit <= 50000 ? p.outputLimit : value.params.outputLimit;

  if (raw.context && typeof raw.context === 'object') {
    if (raw.context.budgetChars !== undefined) value.context.budgetChars = raw.context.budgetChars;
    if (raw.context.mode !== undefined) value.context.mode = raw.context.mode;
  }

  // F4（配置卫生·语义对齐）：main/fallback/customModels/order/template/updater 白名单——
  // 镜像运行时 PURE validateConfig + client sanitizeV2（main 支持 v1 平铺、fallback 去重/上限 8/
  // 条目级校验、effort ≤32、texts 按 MODES 白名单、touched 白名单）。防止脚手架接入运行时后清空模型链。
  const mainSrc = raw.main && typeof raw.main === 'object' ? raw.main : raw;
  if (typeof mainSrc.provider === 'string' && mainSrc.provider.trim() !== '') value.main.provider = mainSrc.provider.trim();
  if (typeof mainSrc.model === 'string' && mainSrc.model.trim() !== '') value.main.model = mainSrc.model.trim();
  const mainEffort = (mainSrc.reasoning && typeof mainSrc.reasoning === 'object' && mainSrc.reasoning.enabled === true &&
      typeof mainSrc.reasoning.effort === 'string' && mainSrc.reasoning.effort.trim() !== '' && mainSrc.reasoning.effort.trim().length <= 32)
    ? mainSrc.reasoning.effort.trim()
    : (typeof mainSrc.reasoningEffort === 'string' && mainSrc.reasoningEffort.trim() !== '' && mainSrc.reasoningEffort.trim().length <= 32 ? mainSrc.reasoningEffort.trim() : '');
  if (mainEffort) value.main.reasoning = { enabled: true, effort: mainEffort };
  if (Array.isArray(raw.fallback)) {
    for (const item of raw.fallback.slice(0, 8)) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
      const provider = item.provider.trim();
      const model = item.model.trim();
      if (!provider || !model) continue;
      if (value.fallback.some((x) => x.provider === provider && x.model === model)) continue;
      const entry = { provider, model };
      if (item.reasoning && typeof item.reasoning === 'object' && item.reasoning.enabled === true &&
          typeof item.reasoning.effort === 'string' && item.reasoning.effort && item.reasoning.effort.length <= 32) {
        entry.reasoning = { enabled: true, effort: item.reasoning.effort };
      }
      value.fallback.push(entry);
    }
  }
  if (Array.isArray(raw.customModels)) {
    for (const item of raw.customModels.slice(0, 20)) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
      const provider = item.provider.trim();
      const model = item.model.trim();
      if (!provider || !model) continue;
      const entry = { provider, model, name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim().slice(0, 40) : model };
      if (item.reasoning && typeof item.reasoning === 'object' && item.reasoning.enabled === true &&
          typeof item.reasoning.effort === 'string' && item.reasoning.effort && item.reasoning.effort.length <= 32) {
        entry.reasoning = { enabled: true, effort: item.reasoning.effort };
      }
      value.customModels.push(entry);
    }
  }
  if (Array.isArray(raw.order)) {
    for (const key of raw.order.slice(0, 50)) {
      if (typeof key === 'string' && key.trim() !== '') {
        const k = key.trim();
        if (!value.order.includes(k)) value.order.push(k);
      }
    }
  }
  // F4（语义对齐）：template 解析镜像运行时——v2 结构（template.mode/text/texts）与 v1 平铺（templateMode/templateText）双兼容
  const tSrc = raw.template && typeof raw.template === 'object' ? raw.template : raw;
  const templateMode = typeof tSrc.templateMode === 'string' ? tSrc.templateMode : tSrc.mode;
  const templateText = typeof tSrc.templateText === 'string' ? tSrc.templateText : (typeof tSrc.text === 'string' ? tSrc.text : '');
  if (templateMode === 'custom' || templateMode === 'builtin') value.template.mode = templateMode;
  const okText = templateText.length <= 4000 ? templateText : '';
  if (tSrc.texts && typeof tSrc.texts === 'object') {
    for (const key of MODES) {
      if (typeof tSrc.texts[key] === 'string' && tSrc.texts[key].length <= 4000) value.template.texts[key] = tSrc.texts[key];
    }
  } else if (okText !== '') {
    value.template.text = okText;
    for (const key of MODES) value.template.texts[key] = okText;
  }
  if (Array.isArray(tSrc.touched)) {
    for (const key of tSrc.touched.slice(0, 5)) {
      if (typeof key === 'string' && MODES.includes(key) && !value.template.touched.includes(key)) value.template.touched.push(key);
    }
  }
  // 模板体系扩展（2026-08-17）：pick/custom 解析镜像运行时 PURE validateConfig——pick 白名单
  // default/supplement/dev/custom:<index>（index 越界回退 default）；custom 每模式 ≤10 条、
  // 每条 {name(≤40), text(≤4000)}；旧配置（无 pick 字段）且 mode==='custom' 时 texts 非空 → 迁为 custom:0。
  const TEMPLATE_CUSTOM_MAX = 10;
  const TEMPLATE_TEXT_MAX = 4000;
  const TEMPLATE_NAME_MAX = 40;
  const hasNewPick = tSrc.pick && typeof tSrc.pick === 'object';
  const customSrc = tSrc.custom && typeof tSrc.custom === 'object' ? tSrc.custom : null;
  for (const key of MODES) {
    const list = Array.isArray(customSrc && customSrc[key]) ? customSrc[key] : [];
    for (const item of list.slice(0, TEMPLATE_CUSTOM_MAX)) {
      if (item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim() !== '' && item.text.length <= TEMPLATE_TEXT_MAX) {
        value.template.custom[key].push({
          name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim().slice(0, TEMPLATE_NAME_MAX) : '自定义模板 ' + (value.template.custom[key].length + 1),
          text: item.text,
        });
      }
    }
  }
  if (!hasNewPick && value.template.mode === 'custom') {
    for (const key of MODES) {
      const legacy = value.template.texts[key];
      if (typeof legacy === 'string' && legacy.trim() !== '' && value.template.custom[key].length === 0) {
        value.template.custom[key].push({ name: '自定义模板', text: legacy });
        value.template.pick[key] = 'custom:0';
      }
    }
  } else if (hasNewPick) {
    for (const key of MODES) {
      const p = typeof tSrc.pick[key] === 'string' ? tSrc.pick[key] : '';
      if (p === 'supplement' || p === 'dev') value.template.pick[key] = p;
      else if (p.indexOf('custom:') === 0) {
        const idx = parseInt(p.slice(7), 10);
        if (Number.isInteger(idx) && idx >= 0 && idx < value.template.custom[key].length) value.template.pick[key] = 'custom:' + idx;
      }
    }
  }
  if (raw.updater && typeof raw.updater === 'object') {
    const u = raw.updater;
    if (typeof u.repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(u.repo) && u.repo.length <= 100) value.updater.repo = u.repo;
    if (typeof u.targetDir === 'string' && u.targetDir.length <= 200) value.updater.targetDir = u.targetDir;
  }

  return { ok: errors.length === 0, errors, value };
}

function migrateLegacyConfig(parsed) {
  if (!parsed || typeof parsed !== 'object') return cloneDefaults();
  const out = cloneDefaults();

  // v1 flat fields -> v2 structure
  if (parsed.provider) out.main.provider = String(parsed.provider);
  if (parsed.model) out.main.model = String(parsed.model);
  // F4（配置卫生）：fallback 条目级校验（去重/上限 8/条目形状），不再原样透传
  if (parsed.fallback && Array.isArray(parsed.fallback)) {
    for (const item of parsed.fallback.slice(0, 8)) {
      if (!item || typeof item !== 'object' || typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
      const provider = item.provider.trim();
      const model = item.model.trim();
      if (!provider || !model) continue;
      if (out.fallback.some((x) => x.provider === provider && x.model === model)) continue;
      const entry = { provider, model };
      if (item.reasoning && typeof item.reasoning === 'object' && item.reasoning.enabled === true &&
          typeof item.reasoning.effort === 'string' && item.reasoning.effort) {
        entry.reasoning = { enabled: true, effort: item.reasoning.effort.slice(0, 32) };
      }
      out.fallback.push(entry);
    }
  }
  if (parsed.mode) out.mode = MODES.includes(parsed.mode) ? parsed.mode : out.mode;
  if (parsed.memory !== undefined) out.memory = parsed.memory === true;

  // v2 passthrough
  if (parsed.main && typeof parsed.main === 'object') out.main = { ...out.main, ...parsed.main };
  if (parsed.params && typeof parsed.params === 'object') out.params = { ...out.params, ...parsed.params };
  if (parsed.template && typeof parsed.template === 'object') out.template = { ...out.template, ...parsed.template };
  if (parsed.context && typeof parsed.context === 'object') out.context = { ...out.context, ...parsed.context };
  if (parsed.updater && typeof parsed.updater === 'object') out.updater = { ...out.updater, ...parsed.updater };

  return out;
}

module.exports = { CONFIG_DEFAULTS, MODES, cloneDefaults, validateConfig, migrateLegacyConfig };
