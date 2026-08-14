// ============================================================================
// DSH「提示词优化」插件 · Client 半部（v20：内置兜底链硬编码 DeepSeek 官方模型）
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
};
// v20：内置兜底链硬编码指向 DeepSeek 官方模型（fresh install 补足与「恢复默认」）
const BUILTIN_CHAIN = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
];

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
  return v;
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
        configState.value = sanitizeV2(parsed);
        configState.fresh = false;
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
    configState.fresh = true; // 首次安装：兜底链将继承当前使用模型（§3.3）
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
  titleBusy: '点击取消并恢复原文',
  titleResult: '恢复优化前的原文',
  titleEmpty: '请输入内容后再优化',
  titleCommand: '命令内容为空，无可优化',
  titleBusyInput: '当前输入状态不允许优化',
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
  secMain: '主模型',
  secFallback: '兜底链',
  secCustom: '自定义模型',
  secOrder: '加载顺序',
  secFallbackEmpty: '暂无兜底模型（使用内置链）',
  secCustomEmpty: '暂无自定义模型',
  secOrderEmpty: '暂无模型',
  secFallbackBuiltin: '当前使用内置兜底链（v18 起可在此配置）',
  secFallbackCount: '{n} 个模型（按序尝试）',
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
  cfgAddFallback: '＋ 添加兜底模型',
  cfgRestoreDefaults: '恢复默认',
  cfgCustomName: '显示名',
  cfgAddCustom: '＋ 添加',
  cfgFallbackNote: '主模型失败后按此顺序尝试（可增删改序，每条可单独设置思考）',
  cfgCustomNote: '仅限已有 provider 路由下的模型 ID；添加后自动连通性测试',
  cfgOrderNote: '仅影响模型下拉与候选的展示顺序',
  cfgInherited: '已继承当前使用模型（含推理等级）',
};

const EN = {
  enhanceButton: 'Optimize',
  enhancing: 'Optimizing',
  result: '✓ Optimized · Undo',
  titleIdle: 'Optimize the prompt with an independent LLM call',
  titleBusy: 'Click to cancel and restore the original text',
  titleResult: 'Restore the original text',
  titleEmpty: 'Type something first to optimize',
  titleCommand: 'Empty command, nothing to optimize',
  titleBusyInput: 'Input is not ready',
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
  secMain: 'Main model',
  secFallback: 'Fallback chain',
  secCustom: 'Custom models',
  secOrder: 'Load order',
  secFallbackEmpty: 'No fallback models (built-in chain in effect)',
  secCustomEmpty: 'No custom models',
  secOrderEmpty: 'No models',
  secFallbackBuiltin: 'Built-in fallback chain in effect (configurable from v18)',
  secFallbackCount: '{n} models (tried in order)',
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
  cfgAddFallback: '+ Add fallback model',
  cfgRestoreDefaults: 'Restore defaults',
  cfgCustomName: 'Display name',
  cfgAddCustom: '+ Add',
  cfgFallbackNote: 'Tried in order after the main model fails (reorderable; per-entry thinking settings)',
  cfgCustomNote: 'Model IDs under existing provider routes only; connectivity is tested on add',
  cfgOrderNote: 'Affects dropdown and candidate display order only',
  cfgInherited: 'Inherited from the current model (incl. reasoning level)',
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
    s = { phase: 'idle', backup: '', enhanced: '', error: null, seq: 0, listeners: new Set() };
    sessionStores.set(sessionId, s);
  }
  return s;
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
  host.call('enhance', { sessionId, seq, text: parts.body, config }).then((res) => {
    if (seq !== s.seq) return;
    const r = res && typeof res === 'object' ? res : {};
    if (r.ok && typeof r.text === 'string' && r.text !== '') {
      if (draftRef.current !== s.backup) {
        s.phase = 'idle';
        s.enhanced = '';
        s.error = null;
      } else {
        const finalText = parts.prefix + r.text;
        safeSetDraft(inputActions, finalText);
        s.phase = 'result';
        s.enhanced = finalText;
        s.error = null;
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
  }, [sessionId]);

  if (!inputActions || sessionId === undefined) return null;

  const s = storeFor(sessionId);
  const phase = s.phase;

  let label;
  let onClick;
  let disabled = false;
  let title;
  let cls = 'dsh-enh-btn';

  if (phase === 'enhancing') {
    label = t('enhancing');
    onClick = () => cancelEnhance(sessionId, inputActions);
    title = t('titleBusy');
    cls += ' dsh-enh-btn-busy dsh-enh-btn-text';
  } else if (phase === 'result') {
    label = t('result');
    onClick = () => undo(sessionId, inputActions);
    title = t('titleResult');
    cls += ' dsh-enh-btn-result dsh-enh-btn-text';
  } else {
    label = '✨';
    const ok = guardPasses(draft, input);
    disabled = !ok;
    onClick = () => {
      if (!guardPasses(draft, input)) return;
      enhance(sessionId, draft, inputActions, draftRef);
    };
    title = ok ? t('titleIdle')
      : draft.trim() === '' ? t('titleEmpty')
      : draft.startsWith('/') ? t('titleCommand')
      : t('titleBusyInput');
    cls += ' dsh-enh-btn-icon';
  }

  return React.createElement('button', {
    type: 'button',
    className: cls,
    onClick,
    disabled,
    title,
    'aria-label': t('enhanceButton'),
  },
    phase === 'enhancing'
      ? React.createElement('span', { className: 'dsh-enh-spin', 'aria-hidden': true })
      : null,
    label,
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

// 主模型区块（v18：main.reasoning 结构 + 思考开关/等级（懒加载 efforts）+ 连通性测试）
function ModelMainSection(props) {
  const t = makeT(props);
  const cfg = props.cfg;
  const providers = props.providers;
  const modelOptions = props.modelOptions;
  const saveMain = props.saveMain;
  const saveReasoning = props.saveReasoning;
  const onProvider = props.onProvider;
  const onModel = props.onModel;
  const [reasoning, setReasoning] = React.useState(null);   // {efforts, defaultEffort} | null
  const [resolveError, setResolveError] = React.useState(null);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState(null); // {ok,latencyMs,ttftMs} | {ok:false,code,message} | null

  const reasoningEffort = cfg.main.reasoning.enabled ? cfg.main.reasoning.effort : '';

  // v17：模型变更 → 懒加载 reasoning 元数据（一次一模型）
  React.useEffect(() => {
    setReasoning(null);
    setResolveError(null);
    setTestResult(null);
    if (!cfg.main.provider || !cfg.main.model) return;
    let cancelled = false;
    host.call('models/resolve', { provider: cfg.main.provider, model: cfg.main.model }).then((res) => {
      if (cancelled) return;
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok && r.reasoning && Array.isArray(r.reasoning.efforts) && r.reasoning.efforts.length > 0) {
        setReasoning(r.reasoning);
        // 当前 effort 不在该模型 efforts 中 → 自动重置为默认
        if (cfg.main.reasoning.enabled && !r.reasoning.efforts.some((e) => e.id === cfg.main.reasoning.effort)) {
          saveReasoning({ enabled: true, effort: r.reasoning.defaultEffort || r.reasoning.efforts[0].id });
        }
      } else if (!r.ok) {
        setResolveError(r.message || t('cfgResolveFailed'));
      } else {
        setReasoning(null); // 模型无 reasoning 元数据
      }
    }).catch(() => {
      if (!cancelled) setResolveError(t('cfgResolveFailed'));
    });
    return () => { cancelled = true; };
  }, [cfg.main.provider, cfg.main.model]);

  const runTest = () => {
    if (testing || !cfg.main.provider || !cfg.main.model) return;
    setTesting(true);
    setTestResult(null);
    const effort = reasoningEffort !== '' ? reasoningEffort : undefined;
    host.call('models/test', { provider: cfg.main.provider, model: cfg.main.model, ...(effort ? { reasoningEffort: effort } : {}) }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      setTestResult(r.ok ? { ok: true, latencyMs: r.latencyMs, ttftMs: r.ttftMs, precheck: r.precheck || null } : { ok: false, code: r.code || 'UNKNOWN', message: r.message || '' });
    }).catch(() => {
      setTestResult({ ok: false, code: 'NETWORK', message: t('errNETWORK') });
    }).then(() => setTesting(false));
  };

  const summary = (cfg.main.provider || '—') + ' / ' + (cfg.main.model || '—') + (reasoningEffort !== '' ? ' · ' + reasoningEffort : '');
  let body;
  if (providers === null) {
    body = React.createElement('p', { className: 'dsh-plg-note' }, t('pluginsClientPending'));
  } else if (providers.length === 0) {
    body = React.createElement('p', { className: 'dsh-plg-note' }, t('cfgNoProvider'));
  } else {
    const providerOptions = providers.map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.name || p.provider));
    const effortOn = cfg.main.reasoning.enabled;
    const levelOptions = reasoning ? reasoning.efforts.map((e) => React.createElement('option', { key: e.id, value: e.id }, e.name)) : [];
    const levelValue = effortOn ? cfg.main.reasoning.effort : (reasoning ? (reasoning.defaultEffort || reasoning.efforts[0].id) : '');
    const onReasoningToggle = (e) => {
      const next = e.target.value === 'on';
      if (next) saveReasoning({ enabled: true, effort: (reasoning && reasoning.defaultEffort) || (reasoning && reasoning.efforts[0] && reasoning.efforts[0].id) || '' });
      else saveReasoning({ enabled: false, effort: '' });
    };
    let testLine = null;
    if (testResult) {
      if (testResult.ok) {
        testLine = React.createElement('div', { className: 'dsh-plg-row', role: 'status' },
          React.createElement('span', { className: 'dsh-plg-test-ok' }, t('cfgTestOk').replace('{ms}', String(testResult.latencyMs))),
          React.createElement('span', { className: 'dsh-plg-muted' }, t('cfgTestTtft').replace('{ms}', String(testResult.ttftMs))),
        );
      } else {
        testLine = React.createElement('div', { className: 'dsh-plg-row', role: 'status' },
          React.createElement('span', { className: 'dsh-plg-test-fail' }, t('cfgTestFail').replace('{msg}', testResult.message || testResult.code || '')),
        );
      }
    }
    body = React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dsh-plg-row' },
        React.createElement('label', { className: 'dsh-plg-label' }, t('cfgProvider')),
        React.createElement('select', { className: 'dsh-plg-select', value: cfg.main.provider, onChange: onProvider }, providerOptions),
      ),
      React.createElement('div', { className: 'dsh-plg-row' },
        React.createElement('label', { className: 'dsh-plg-label' }, t('cfgModel')),
        modelOptions.length === 0
          ? React.createElement('span', { className: 'dsh-plg-muted' }, t('cfgEmptyModels'))
          : React.createElement('select', { className: 'dsh-plg-select', value: cfg.main.model, onChange: onModel, children: modelOptions.map((m) => React.createElement('option', { key: m.id, value: m.id }, m.name || m.id)) }),
      ),
      reasoning
        ? React.createElement('div', { className: 'dsh-plg-row' },
            React.createElement('label', { className: 'dsh-plg-label' }, t('cfgReasoning')),
            React.createElement('select', { className: 'dsh-plg-select dsh-plg-select-narrow', value: effortOn ? 'on' : 'off', onChange: onReasoningToggle, children: [React.createElement('option', { key: 'off', value: 'off' }, t('cfgReasoningOff')), React.createElement('option', { key: 'on', value: 'on' }, t('cfgReasoningOn'))] }),
            React.createElement('label', { className: 'dsh-plg-label' }, t('cfgReasoningLevel')),
            React.createElement('select', { className: 'dsh-plg-select dsh-plg-select-narrow', value: levelValue, disabled: !effortOn, onChange: (e) => saveReasoning({ enabled: true, effort: e.target.value }), children: levelOptions }),
          )
        : resolveError
          ? React.createElement('p', { className: 'dsh-plg-note' }, resolveError)
          : React.createElement('p', { className: 'dsh-plg-note' }, t('cfgNoReasoning')),
      React.createElement('div', { className: 'dsh-plg-row' },
        React.createElement('button', {
          type: 'button',
          className: 'dsh-plg-btn',
          disabled: testing || !cfg.main.provider || !cfg.main.model,
          onClick: runTest,
        }, testing ? t('cfgTesting') : t('cfgTest')),
        testLine,
      ),
    );
  }
  return React.createElement(CollapsibleSection, { title: t('secMain'), summary }, body);
}

// 兜底链条目行（v18：模型选择 + 独立思考开关/等级（懒加载 efforts）+ 上移/下移/删除）
function FallbackRow(props) {
  const t = makeT(props);
  const entry = props.entry;
  const index = props.index;
  const count = props.count;
  const candidates = props.candidates;
  const onChange = props.onChange;
  const onMove = props.onMove;
  const onRemove = props.onRemove;
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
  const value = entry.provider + '/' + entry.model;

  return React.createElement('div', { className: 'dsh-plg-row' },
    React.createElement('span', { className: 'dsh-plg-muted' }, String(index + 1)),
    React.createElement('select', {
      className: 'dsh-plg-select',
      value,
      onChange: (e) => {
        const sep = e.target.value.indexOf('/');
        const provider = e.target.value.slice(0, sep);
        const model = e.target.value.slice(sep + 1);
        onChange({ provider, model, reasoning: { enabled: false, effort: '' } });
      },
      children: candidates.map((c) => React.createElement('option', { key: c.provider + '/' + c.model, value: c.provider + '/' + c.model }, c.name + (c.custom ? '（自定义）' : ''))),
    }),
    reasoning
      ? React.createElement(React.Fragment, null,
          React.createElement('select', {
            className: 'dsh-plg-select dsh-plg-select-narrow',
            value: effortOn ? 'on' : 'off',
            onChange: (e) => {
              const next = e.target.value === 'on';
              onChange({ ...entry, reasoning: next ? { enabled: true, effort: (reasoning.defaultEffort || (reasoning.efforts[0] && reasoning.efforts[0].id) || '') } : { enabled: false, effort: '' } });
            },
            children: [React.createElement('option', { key: 'off', value: 'off' }, t('cfgReasoningOff')), React.createElement('option', { key: 'on', value: 'on' }, t('cfgReasoningOn'))],
          }),
          React.createElement('select', {
            className: 'dsh-plg-select dsh-plg-select-narrow',
            value: levelValue,
            disabled: !effortOn,
            onChange: (e) => onChange({ ...entry, reasoning: { enabled: true, effort: e.target.value } }),
            children: levelOptions,
          }),
        )
      : null,
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', disabled: index === 0, onClick: () => onMove(-1), title: '↑' }, '↑'),
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', disabled: index === count - 1, onClick: () => onMove(1), title: '↓' }, '↓'),
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', onClick: onRemove, title: '✕' }, '✕'),
  );
}

// 兜底链区块（v18：独立配置项，可增删改序，每条单独设置 reasoning）
function ModelFallbackSection(props) {
  const t = makeT(props);
  const fallback = props.fallback || [];
  const candidates = props.candidates || [];
  const saveFallback = props.saveFallback;

  const addFallback = () => {
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
  };
  const restore = () => {
    // v19：恢复默认 → 优先自适应链（host 解析当前环境默认模型），失败才用静态链
    host.call('models/autochain').then((auto) => {
      const a = auto && typeof auto === 'object' && Array.isArray(auto.chain) && auto.chain.length > 0
        ? auto.chain : BUILTIN_CHAIN;
      saveFallback(a.map((b) => ({ provider: b.provider, model: b.model })));
    }).catch(() => {
      saveFallback(BUILTIN_CHAIN.map((b) => ({ ...b })));
    });
  };

  const summary = fallback.length > 0 ? t('secFallbackCount').replace('{n}', String(fallback.length)) : t('secFallbackEmpty');
  const body = React.createElement(React.Fragment, null,
    fallback.map((entry, index) => React.createElement(FallbackRow, {
      key: index,
      t: t,
      entry: entry,
      index: index,
      count: fallback.length,
      candidates: candidates,
      onChange: (e) => updateEntry(index, e),
      onMove: (d) => move(index, d),
      onRemove: () => remove(index),
    })),
    fallback.length === 0 ? React.createElement('p', { className: 'dsh-plg-note' }, t('secFallbackEmpty')) : null,
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('button', { type: 'button', className: 'dsh-plg-btn', onClick: addFallback }, t('cfgAddFallback')),
      React.createElement('button', { type: 'button', className: 'dsh-plg-btn', onClick: restore }, t('cfgRestoreDefaults')),
    ),
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgFallbackNote')),
  );
  return React.createElement(CollapsibleSection, { title: t('secFallback'), summary }, body);
}

// 自定义模型区块（v18：表单添加即连通性测试；列表可删除）
function ModelCustomSection(props) {
  const t = makeT(props);
  const providers = props.providers || [];
  const customModels = props.customModels || [];
  const saveCustom = props.saveCustom;
  const [form, setForm] = React.useState({ provider: '', model: '', name: '' });
  const [testingKey, setTestingKey] = React.useState(null);
  const [tests, setTests] = React.useState({});

  const addCustom = () => {
    const provider = form.provider || (providers[0] && providers[0].provider) || '';
    const model = form.model.trim();
    if (!provider || !model) return;
    if (model.indexOf('/') !== -1) return; // 模型 ID 不允许包含 /
    if (customModels.some((c) => c.provider === provider && c.model === model)) return;
    const next = customModels.slice();
    next.push({ provider, model, name: form.name.trim() || model });
    saveCustom(next);
    setForm({ provider, model: '', name: '' });
    setTestingKey(provider + '/' + model);
    host.call('models/test', { provider, model }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      setTests((prev) => ({ ...prev, [provider + '/' + model]: r.ok ? { ok: true, latencyMs: r.latencyMs } : { ok: false, message: r.message || r.code || '' } }));
    }).catch(() => {
      setTests((prev) => ({ ...prev, [provider + '/' + model]: { ok: false, message: t('errNETWORK') } }));
    }).then(() => setTestingKey(null));
  };

  const summary = customModels.length > 0 ? String(customModels.length) + ' 个' : t('secCustomEmpty');
  const body = React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('select', {
        className: 'dsh-plg-select dsh-plg-select-narrow',
        value: form.provider || (providers[0] && providers[0].provider) || '',
        onChange: (e) => setForm({ ...form, provider: e.target.value }),
        children: providers.map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.name || p.provider)),
      }),
      React.createElement('input', {
        className: 'dsh-plg-input',
        placeholder: '模型 ID',
        value: form.model,
        onChange: (e) => setForm({ ...form, model: e.target.value }),
      }),
      React.createElement('input', {
        className: 'dsh-plg-input',
        placeholder: t('cfgCustomName'),
        value: form.name,
        onChange: (e) => setForm({ ...form, name: e.target.value }),
      }),
      React.createElement('button', { type: 'button', className: 'dsh-plg-btn', onClick: addCustom }, t('cfgAddCustom')),
    ),
    customModels.map((c) => {
      const key = c.provider + '/' + c.model;
      const test = tests[key];
      const testing = testingKey === key;
      return React.createElement('div', { key: key, className: 'dsh-plg-row' },
        React.createElement('span', { className: 'dsh-plg-muted' }, c.provider + '/' + c.model + (c.name && c.name !== c.model ? '（' + c.name + '）' : '')),
        testing ? React.createElement('span', { className: 'dsh-plg-muted' }, t('cfgTesting'))
          : test
            ? test.ok
              ? React.createElement('span', { className: 'dsh-plg-test-ok' }, t('cfgTestOk').replace('{ms}', String(test.latencyMs)))
              : React.createElement('span', { className: 'dsh-plg-test-fail' }, t('cfgTestFail').replace('{msg}', test.message || ''))
            : null,
        React.createElement('button', {
          type: 'button',
          className: 'dsh-plg-btn dsh-plg-btn-icononly',
          onClick: () => saveCustom(customModels.filter((x) => !(x.provider === c.provider && x.model === c.model))),
        }, '✕'),
      );
    }),
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgCustomNote')),
  );
  return React.createElement(CollapsibleSection, { title: t('secCustom'), summary }, body);
}

// 加载顺序区块（v18：全量模型（目录+自定义）上移/下移，仅影响展示）
function ModelOrderSection(props) {
  const t = makeT(props);
  const candidates = props.candidates || [];
  const order = props.order || [];
  const saveOrder = props.saveOrder;

  const move = (key, delta) => {
    const full = order.slice();
    for (const c of candidates) {
      const k = c.provider + '/' + c.model;
      if (!full.includes(k)) full.push(k);
    }
    const i = full.indexOf(key);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= full.length) return;
    const tmp = full[i];
    full[i] = full[j];
    full[j] = tmp;
    saveOrder(full);
  };

  const summary = candidates.length > 0 ? t('secFallbackCount').replace('{n}', String(candidates.length)) : t('secOrderEmpty');
  const list = candidates.slice().sort((a, b) => {
    const ka = a.provider + '/' + a.model;
    const kb = b.provider + '/' + b.model;
    const ia = order.indexOf(ka);
    const ib = order.indexOf(kb);
    return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
  });
  const body = React.createElement(React.Fragment, null,
    list.map((c) => {
      const key = c.provider + '/' + c.model;
      const pos = list.indexOf(c);
      return React.createElement('div', { key: key, className: 'dsh-plg-row' },
        React.createElement('span', { className: 'dsh-plg-muted' }, c.name + (c.custom ? '（自定义）' : '')),
        React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', disabled: pos === 0, onClick: () => move(key, -1) }, '↑'),
        React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', disabled: pos === list.length - 1, onClick: () => move(key, 1) }, '↓'),
      );
    }),
    candidates.length === 0 ? React.createElement('p', { className: 'dsh-plg-note' }, t('secOrderEmpty')) : null,
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgOrderNote')),
  );
  return React.createElement(CollapsibleSection, { title: t('secOrder'), summary }, body);
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
        const cfg = configState.value;
        const withModels = r.providers.filter((p) => p.models && p.models.length > 0);
        if (withModels.length > 0) {
          const current = r.providers.find((p) => p.provider === cfg.main.provider);
          if (!current || (current.models && current.models.length === 0)) {
            const first = withModels[0];
            saveConfig({ main: { ...cfg.main, provider: first.provider, model: first.models[0].id } });
          } else if (!cfg.main.model || !current.models.some((m) => m.id === cfg.main.model)) {
            saveConfig({ main: { ...cfg.main, model: current.models[0].id } });
          }
        }
        // v18/v19：fresh install → 兜底链继承当前使用模型（含推理等级）+ 自适应链补足
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
              // autochain 失败 → 静态链补齐（尽量先保证有兜底）
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
  const currentProvider = providers && providers.find((p) => p.provider === cfg.main.provider);
  const modelOptions = currentProvider ? currentProvider.models : [];
  const candidates = buildCandidates(providers, cfg.customModels, cfg.order);
  const saveMain = (patch) => saveConfig({ main: { ...cfg.main, ...patch } });
  const saveReasoning = (r) => saveConfig({ main: { ...cfg.main, reasoning: { ...cfg.main.reasoning, ...r } } });
  const saveFallback = (fallback) => saveConfig({ fallback });
  const saveCustom = (customModels) => saveConfig({ customModels });
  const saveOrder = (order) => saveConfig({ order });
  const onProvider = (e) => {
    const provider = e.target.value;
    const p = providers.find((x) => x.provider === provider);
    const first = p && p.models && p.models[0] ? p.models[0].id : '';
    saveMain({ provider, model: first, reasoning: { enabled: false, effort: '' } });
  };
  const onModel = (e) => saveMain({ model: e.target.value, reasoning: { enabled: false, effort: '' } });

  return React.createElement(React.Fragment, null,
    error ? React.createElement('div', { className: 'dsh-plg-error', role: 'status' }, error) : null,
    inherited ? React.createElement('p', { className: 'dsh-plg-note dsh-plg-inherit' }, t('cfgInherited')) : null,
    React.createElement(ModelMainSection, { t: t, cfg: cfg, providers: providers, modelOptions: modelOptions, saveMain: saveMain, saveReasoning: saveReasoning, onProvider: onProvider, onModel: onModel }),
    React.createElement(ModelFallbackSection, { t: t, fallback: cfg.fallback, candidates: candidates, saveFallback: saveFallback }),
    React.createElement(ModelCustomSection, { t: t, providers: providers || [], customModels: cfg.customModels, saveCustom: saveCustom }),
    React.createElement(ModelOrderSection, { t: t, candidates: candidates, order: cfg.order, saveOrder: saveOrder }),
  );
}

function ParamsTab(props) {
  const t = makeT(props);
  const cfg = configState.value;
  const save = (patch) => { saveConfig(patch); };
  const onNumber = (key) => (e) => save({ params: { ...cfg.params, [key]: Number(e.target.value) } });
  const selectProps = (key, options) => ({ className: 'dsh-plg-select', value: String(cfg.params[key]), onChange: onNumber(key), children: options });
  return React.createElement(React.Fragment, null,
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
  '.dsh-enh-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;transition:background-color .15s ease,border-color .15s ease;white-space:nowrap}',
  '.dsh-enh-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
  '.dsh-enh-btn:disabled{opacity:.45;cursor:not-allowed}',
  '.dsh-enh-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-enh-btn-icon{width:30px;justify-content:center;font-size:14px;line-height:20px;padding:0}',
  '.dsh-enh-btn-text{padding:0 10px}',
  '.dsh-enh-btn-busy{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
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
  '.dsh-plg-row{display:flex;align-items:center;gap:8px}',
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
  '.dsh-plg-btn-icononly{min-width:26px;padding:3px 4px}',
  '.dsh-plg-inherit{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px}',
].join('\n');

return {
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    styles.insert(CSS);
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