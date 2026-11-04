'use strict';

// 发布物内的契约事实源（纯数据，无环境依赖）。
//
// 集中声明 RPC 名称与参数校验形状、错误码到 i18n 键的映射，以及客户端/宿主共用的
// 模式、预算和配置默认值。`lib/rpc-schema.cjs`、客户端常量、宿主配置归一化与门禁
// 都从这里取数；源码侧 `src/shared/contracts/*` 只做转发。
//
// ⚠ 不改变任何 RPC 名称、参数、返回结构、配置键或用户可见文案；本文件只收敛
//   原先分散在多处的同名事实。发布白名单包含 lib/，运行期可直接读取。

const RPC_METHODS = Object.freeze({
  ENHANCE: 'enhance',
  ENHANCE_PROGRESS: 'enhance/progress',
  CANCEL: 'cancel',
  MODELS_LIST: 'models/list',
  MODELS_CURRENT: 'models/current',
  MODELS_RESOLVE: 'models/resolve',
  MODELS_TEST: 'models/test',
  MODELS_STATS: 'models/stats',
  MODELS_AUTOCHAIN: 'models/autochain',
  TEMPLATE_DEFAULT: 'template/default',
  LOGS_LAST: 'logs/last',
  CONFIG_GET: 'config/get',
  CONFIG_SET: 'config/set',
  VOICE_STATUS: 'voice/status',
  VOICE_CORRECT: 'voice/correct',
});

function rpcRow(name, owner, options) {
  const o = options && typeof options === 'object' ? options : {};
  return Object.freeze({
    name,
    owner,
    schema: o.schema === true,
    required: Object.freeze(Array.isArray(o.required) ? o.required.slice() : []),
    types: Object.freeze(o.types && typeof o.types === 'object' ? { ...o.types } : {}),
    declaredNoSchema: typeof o.declaredNoSchema === 'string' ? o.declaredNoSchema : '',
  });
}

const RPC_REGISTRY = Object.freeze({
  [RPC_METHODS.ENHANCE]: rpcRow(RPC_METHODS.ENHANCE, 'bundle', {
    schema: true, required: ['sessionId', 'text'], types: { sessionId: 'string', text: 'string' },
  }),
  [RPC_METHODS.ENHANCE_PROGRESS]: rpcRow(RPC_METHODS.ENHANCE_PROGRESS, 'bundle', {
    declaredNoSchema: '只读：查询优化进度（不存在的 seq 返回空）',
  }),
  [RPC_METHODS.CANCEL]: rpcRow(RPC_METHODS.CANCEL, 'bundle', {
    declaredNoSchema: '取消信号（无匹配时静默成功）',
  }),
  [RPC_METHODS.MODELS_LIST]: rpcRow(RPC_METHODS.MODELS_LIST, 'bundle', {
    declaredNoSchema: '无参只读：列举 provider 与模型',
  }),
  [RPC_METHODS.MODELS_CURRENT]: rpcRow(RPC_METHODS.MODELS_CURRENT, 'bundle', {
    declaredNoSchema: '无参只读：读当前选择的模型',
  }),
  [RPC_METHODS.MODELS_RESOLVE]: rpcRow(RPC_METHODS.MODELS_RESOLVE, 'bundle', {
    declaredNoSchema: '有参（provider/model）保持宽松：非法值由下游 resolveModelInfo 兜底，收紧急属 BREAKING',
  }),
  [RPC_METHODS.MODELS_TEST]: rpcRow(RPC_METHODS.MODELS_TEST, 'bundle', {
    schema: true, required: ['provider', 'model'], types: { provider: 'string', model: 'string' },
  }),
  [RPC_METHODS.MODELS_STATS]: rpcRow(RPC_METHODS.MODELS_STATS, 'bundle', {
    declaredNoSchema: '入参仅 provider/model/inputChars 展示用，非法值退化为空统计（无副作用）',
  }),
  [RPC_METHODS.MODELS_AUTOCHAIN]: rpcRow(RPC_METHODS.MODELS_AUTOCHAIN, 'bundle', {
    declaredNoSchema: '入参仅 noCache 布尔，宽松语义即契约',
  }),
  [RPC_METHODS.TEMPLATE_DEFAULT]: rpcRow(RPC_METHODS.TEMPLATE_DEFAULT, 'bundle', {
    declaredNoSchema: '无参只读：返回内置模板目录',
  }),
  [RPC_METHODS.LOGS_LAST]: rpcRow(RPC_METHODS.LOGS_LAST, 'bundle', {
    declaredNoSchema: '无参只读：返回日志环',
  }),
  [RPC_METHODS.CONFIG_GET]: rpcRow(RPC_METHODS.CONFIG_GET, 'lib', { schema: true }),
  [RPC_METHODS.CONFIG_SET]: rpcRow(RPC_METHODS.CONFIG_SET, 'lib', {
    schema: true, required: ['config'], types: { config: 'object' },
  }),
  [RPC_METHODS.VOICE_STATUS]: rpcRow(RPC_METHODS.VOICE_STATUS, 'lib', { schema: true }),
  [RPC_METHODS.VOICE_CORRECT]: rpcRow(RPC_METHODS.VOICE_CORRECT, 'bundle', {
    schema: true, required: ['sessionId', 'text'], types: { sessionId: 'string', text: 'string' },
  }),
});

const RPC_METHOD_LIST = Object.freeze(Object.keys(RPC_REGISTRY));
const RPC_SCHEMA_METHOD_LIST = Object.freeze(RPC_METHOD_LIST.filter((name) => RPC_REGISTRY[name].schema));
const RPC_DECLARED_NO_SCHEMA = Object.freeze(Object.fromEntries(
  RPC_METHOD_LIST.filter((name) => RPC_REGISTRY[name].schema !== true)
    .map((name) => [name, RPC_REGISTRY[name].declaredNoSchema]),
));

// 用户可见错误码 → 既有 i18n 键。键名和映射关系保持原样；新增映射才需要改这里。
const ERROR_KEYS = Object.freeze({
  GUARD: 'errGUARD',
  NO_LLM: 'errNO_LLM',
  NO_MODEL: 'errNO_MODEL',
  UNKNOWN_MODEL: 'errUNKNOWN_MODEL',
  NO_ADAPTER: 'errNO_ADAPTER',
  INVALID_CREDENTIAL: 'errINVALID_CREDENTIAL',
  QUOTA: 'errQUOTA',
  CONTEXT_WINDOW_EXCEEDED: 'errCONTEXT_WINDOW_EXCEEDED',
  EMPTY_RESPONSE: 'errEMPTY_RESPONSE',
  OUTPUT_TOO_LONG: 'errOUTPUT_TOO_LONG',
  OUTPUT_TRUNCATED: 'errOUTPUT_TRUNCATED',
  TIMEOUT: 'errTIMEOUT',
  ABORTED: 'errABORTED',
  LLM_FAILED: 'errLLM_FAILED',
  NETWORK: 'errNETWORK',
  ALL_MODELS_UNAVAILABLE: 'errAllModels',
  STREAM_THROW: 'errModelUnreachable',
  VOICE_BUSY: 'errVoiceBusy',
});

function errorKeyOf(code) {
  return ERROR_KEYS[code] || 'errUNKNOWN';
}

// RPC 边界可能返回的机器码（用于契约审计；未映射到 ERROR_KEYS 的码仍按 errUNKNOWN 显示）。
const ERROR_CODES = Object.freeze([
  ...Object.keys(ERROR_KEYS),
  'UNKNOWN', 'BAD_ARGS', 'MISSING_ARG', 'INVALID_ARG',
  'METHOD_NOT_ALLOWED', 'FORBIDDEN_ORIGIN', 'BODY_TOO_LARGE', 'UNKNOWN_METHOD', 'HANDLER_FAILED',
  'NO_RECORD', 'NO_SERVICE', 'EMPTY', 'MODELS_FAILED', 'RESOLVE_FAILED', 'CURRENT_FAILED',
  'AUTOCHAIN_FAILED', 'NO_STATS', 'STATS_FAILED', 'STATS_TIMEOUT',
  'CONFIG_READ_FAILED', 'CONFIG_WRITE_FAILED', 'CONFIG_TOO_LARGE', 'NO_DSH_HOME',
  'VOICE_STATUS_FAILED', 'CORRECTION_DISABLED',
].filter((code, index, list) => list.indexOf(code) === index));

const RPC_ERROR_CODES = Object.freeze(Object.fromEntries(ERROR_CODES.map((code) => [code, code])));

const RESULT_STATUSES = Object.freeze(['changed', 'unchanged', 'skipped', 'failed']);

const DEGRADED_REASONS = Object.freeze([
  'relevance', 'relevance-budget', 'relevance-timeout', 'relevance-truncated', 'relevance-unparsed', 'relevance-failed',
  'intent', 'intent-budget', 'intent-timeout', 'intent-truncated', 'intent-unparsed', 'intent-failed',
  'docs', 'docs-budget', 'docs-timeout', 'docs-truncated', 'docs-unparsed', 'docs-failed',
  'history', 'history-timeout',
  'webplan', 'webplan-budget', 'webplan-timeout', 'webplan-truncated', 'webplan-unparsed', 'webplan-failed',
  'websearch', 'websearch-budget', 'websearch-timeout', 'websearch-failed',
  'v2progress-bad-json', 'v2progress-timeout', 'v2progress-truncated', 'v2progress-empty',
  'v2progress-aborted', 'v2progress-cancelled', 'v2progress-failed',
  'output-truncated',
]);

const CONFIG_KEYS = Object.freeze([
  'version', 'fallback', 'customModels', 'order', 'params', 'template',
  'mode', 'context', 'memory', 'updater', 'voice',
]);

const MODE_KEYS = Object.freeze(['base', 'lite', 'standard', 'smart', 'publish']);
const BUDGET_OPTIONS = Object.freeze([0, 2000, 4000, 8000, 16000, 32000]);
const MODE_BUDGET_OPTIONS = Object.freeze({
  base: Object.freeze([0]),
  lite: Object.freeze([0, 2000, 4000]),
  standard: Object.freeze([0, 2000, 4000, 8000]),
  smart: Object.freeze([0, 2000, 4000, 8000, 16000]),
  publish: Object.freeze([0, 4000, 8000, 16000, 32000]),
});
const MODE_TIMEOUT_OPTIONS = Object.freeze({
  base: Object.freeze([0, 30000, 60000, 120000]),
  lite: Object.freeze([0, 30000, 60000, 120000]),
  standard: Object.freeze([0, 30000, 60000, 120000]),
  smart: Object.freeze([0, 60000, 120000, 240000]),
  publish: Object.freeze([0, 60000, 120000, 240000]),
});
const MODE_MAXTOKENS_OPTIONS = Object.freeze({
  base: Object.freeze([0, 2000, 4000, 8000]),
  lite: Object.freeze([0, 2000, 4000, 8000]),
  standard: Object.freeze([0, 2000, 4000, 8000]),
  smart: Object.freeze([0, 4000, 8000, 16000]),
  publish: Object.freeze([0, 4000, 8000, 16000]),
});
const MODE_OUTPUTLIMIT_OPTIONS = Object.freeze({
  base: Object.freeze([0, 8000, 16000, 32000]),
  lite: Object.freeze([0, 8000, 16000, 32000]),
  standard: Object.freeze([0, 8000, 16000, 32000]),
  smart: Object.freeze([0, 16000, 32000, 50000]),
  publish: Object.freeze([0, 16000, 32000, 50000]),
});
const MODE_PARAMS_DEFAULT = Object.freeze({
  base: Object.freeze({ timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 }),
  lite: Object.freeze({ timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 }),
  standard: Object.freeze({ timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 }),
  smart: Object.freeze({ timeoutMs: 60000, maxTokens: 4000, outputLimit: 16000 }),
  publish: Object.freeze({ timeoutMs: 60000, maxTokens: 4000, outputLimit: 16000 }),
});
const MODE_BUDGET_DEFAULT = Object.freeze({ base: 0, lite: 2000, standard: 4000, smart: 4000, publish: 4000 });
const DEFAULT_MODE = 'base';
const DEFAULT_BUDGET = 4000;
const DEFAULT_MEMORY = false;
const MEMORY_ROUNDS_MAX = 4;
const TEMPLATE_BUILTIN_KEYS = Object.freeze(['default', 'increment']);
const TEMPLATE_CUSTOM_MAX = 10;
const TEMPLATE_TEXT_MAX = 4000;
const TEMPLATE_NAME_MAX = 40;
const CONFIG_VERSION = 2;

const DEFAULT_MODEL_CHAIN = Object.freeze([
  Object.freeze({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
  Object.freeze({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
]);

const CONFIG_DEFAULTS = Object.freeze({
  version: CONFIG_VERSION,
  fallback: Object.freeze([]),
  customModels: Object.freeze([]),
  order: Object.freeze([]),
  params: MODE_PARAMS_DEFAULT.base,
  template: Object.freeze({
    mode: 'builtin',
    text: '',
    texts: Object.freeze({ base: '', lite: '', standard: '', smart: '', publish: '' }),
    pick: Object.freeze({ base: 'default', lite: 'default', standard: 'default', smart: 'default', publish: 'default' }),
    custom: Object.freeze({
      base: Object.freeze([]), lite: Object.freeze([]), standard: Object.freeze([]), smart: Object.freeze([]), publish: Object.freeze([]),
    }),
    touched: Object.freeze([]),
  }),
  mode: DEFAULT_MODE,
  context: Object.freeze({ mode: 'smart', budgetChars: DEFAULT_BUDGET, workspace: Object.freeze({ maxFiles: 3, depth: 2 }) }),
  memory: DEFAULT_MEMORY,
  updater: Object.freeze({ repo: '', targetDir: '' }),
});

module.exports = {
  RPC_METHODS,
  RPC_REGISTRY,
  RPC_METHOD_LIST,
  RPC_SCHEMA_METHOD_LIST,
  RPC_DECLARED_NO_SCHEMA,
  ERROR_KEYS,
  ERROR_CODES,
  RPC_ERROR_CODES,
  errorKeyOf,
  RESULT_STATUSES,
  DEGRADED_REASONS,
  CONFIG_KEYS,
  CONFIG_DEFAULTS,
  CONFIG_VERSION,
  MODE_KEYS,
  BUDGET_OPTIONS,
  MODE_BUDGET_OPTIONS,
  MODE_TIMEOUT_OPTIONS,
  MODE_MAXTOKENS_OPTIONS,
  MODE_OUTPUTLIMIT_OPTIONS,
  MODE_PARAMS_DEFAULT,
  MODE_BUDGET_DEFAULT,
  DEFAULT_MODE,
  DEFAULT_BUDGET,
  DEFAULT_MEMORY,
  MEMORY_ROUNDS_MAX,
  TEMPLATE_BUILTIN_KEYS,
  TEMPLATE_CUSTOM_MAX,
  TEMPLATE_TEXT_MAX,
  TEMPLATE_NAME_MAX,
  DEFAULT_MODEL_CHAIN,
};
