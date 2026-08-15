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
  template: { mode: 'builtin', text: '', texts: { base: '', lite: '', standard: '', smart: '', publish: '' } },
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
  if (raw.mode !== undefined && !MODES.includes(raw.mode)) errors.push('invalid mode: ' + raw.mode);
  else if (raw.mode !== undefined) value.mode = raw.mode;

  if (raw.memory !== undefined) {
    if (typeof raw.memory !== 'boolean') errors.push('memory must be boolean');
    else value.memory = raw.memory;
  }

  if (raw.params && typeof raw.params === 'object') {
    const p = raw.params;
    if (p.timeoutMs !== undefined) value.params.timeoutMs = Number.isInteger(p.timeoutMs) ? p.timeoutMs : value.params.timeoutMs;
    if (p.maxTokens !== undefined) value.params.maxTokens = Number.isInteger(p.maxTokens) ? p.maxTokens : value.params.maxTokens;
    if (p.outputLimit !== undefined) value.params.outputLimit = Number.isInteger(p.outputLimit) ? p.outputLimit : value.params.outputLimit;
  }

  if (raw.context && typeof raw.context === 'object') {
    if (raw.context.budgetChars !== undefined) value.context.budgetChars = raw.context.budgetChars;
    if (raw.context.mode !== undefined) value.context.mode = raw.context.mode;
  }

  return { ok: errors.length === 0, errors, value };
}

function migrateLegacyConfig(parsed) {
  if (!parsed || typeof parsed !== 'object') return cloneDefaults();
  const out = cloneDefaults();

  // v1 flat fields -> v2 structure
  if (parsed.provider) out.main.provider = String(parsed.provider);
  if (parsed.model) out.main.model = String(parsed.model);
  if (parsed.fallback && Array.isArray(parsed.fallback)) out.fallback = parsed.fallback;
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
