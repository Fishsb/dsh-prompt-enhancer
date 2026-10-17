#!/usr/bin/env node
// scripts/settings-layout-audit.mjs —— 设置页「可见文案 ↔ 布局挤压」量测装置
//
// 用途（本批 §2「须给量测，不得只凭眼看」的落点）：
//   对设置页**每一处含文案的行**给出「可用宽度 vs 文本实际宽度」读数（scrollWidth/clientWidth +
//   getBoundingClientRect），并**在最坏情况下**测：把每条文案替换成该键的「最长现实取值」，
//   再替换成一条**病态超长**取值（200 字），比较同行控件宽度是否随文案长度变化。
//
// 判据（任一条成立即 FAIL，与作业书 §2.1 一致）：
//   ① 文本 scrollWidth > clientWidth（被截断/溢出）
//   ② 同行控件宽度随文案变长而**变小**（被压缩）
//   ③ 文案异常换行导致行高跳变
//   ④ 出现省略号（overflow/ellipsis 生效）
//
// 装置形态与**已知边界（如实声明，勿当"真机"读）**：
//   · 真实 CSS：直接取 src/client/styles.js 的 CSS 字符串（逐字）；
//   · 真实 DOM 结构：直接执行 src/client/**.js 的 chunk 源码（经 scripts/lib/chunk-decode.mjs 解码），
//     由 scripts/lib/settings-layout-driver.mjs 的最小 React shim 产出**真实 DOM**
//     （类名、内联样式、文本逐字同源）；
//   · 真实往返：Windows 侧 Chrome --headless=new（WSL 下探测 /mnt/<盘符>），--dump-dom 取回读数；
//   · 边界 1：headless ≠ 用户真机（无 GPU、DPI 与字体回退可能不同）⇒ 只比较**相对**关系
//     （同一装置内"文案变长 ⇒ 控件宽度是否变"），不把绝对 px 当用户的字面值；
//   · 边界 2：React 由 shim 替代（不跑真实 React 调和）——布局只由 DOM 结构 + CSS 决定，
//     而两者都取自真实源码；React 版次差异带来的细节（如 Fragment 包裹层级）不在覆盖面内；
//   · 边界 3：数据源桩（host.call 返回的模型链、officialVoiceBridge.snapshot 等）是**数据**桩，
//     不替代任何**布局**代码；每类状态由 scenarios 显式列出。
//
// 用法：
//   node scripts/settings-layout-audit.mjs                 # 全场景量测 + 判据（PASS/FAIL），exit 0/1
//   node scripts/settings-layout-audit.mjs --json <path>   # 另存原始读数
//   node scripts/settings-layout-audit.mjs --root <dir>    # 在另一棵树上量测（变异自证/负控用）
//   node scripts/settings-layout-audit.mjs --only <s>      # 只跑某场景
//   node scripts/settings-layout-audit.mjs --no-browser    # 不做量测（不构成判据）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeChunk, REPO_ROOT } from './lib/chunk-decode.mjs';
import { DRIVER } from './lib/settings-layout-driver.mjs';

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const has = (k) => args.includes(k);
const ROOT = path.resolve(argOf('--root', REPO_ROOT));
const JSON_OUT = argOf('--json', '');
const ONLY = argOf('--only', '');

const CHUNKS = [
  'src/client/i18n.js',
  'src/client/constants.js',
  'src/client/model-helpers.js',
  'src/client/helpers.js',
  'src/client/voice/state.js',
  'src/client/components/collapsible-section.js',
  'src/client/components/marquee-select.js',
  'src/client/components/model-main-section.js',
  'src/client/components/fallback-row.js',
  'src/client/components/model-config-tab.js',
  'src/client/components/params-tab.js',
  'src/client/components/model-plugins-section.js',
  'src/client/voice/voice-section.js',
  'src/client/styles.js',
];

function readChunk(rel) {
  // ⚠ decodeChunk(file, opts) 的第二参是 { root }（不是裸路径）。传裸路径会**静默**回落到本仓根
  //   —— 那样 --root 失效，变异/负控会量到错的树（本席实测踩到过：M 系列曾量到工作树）。
  return decodeChunk(rel, { root: ROOT });
}

// ── 「最长现实取值」表（§2.1②：不得只测"当前恰好短"那一态）──
const REALISTIC_MAX = {
  voiceAutoEnhance: '自动增强', voiceCorrectionShort: '语音纠错', voiceRefineShort: '清口水词',
  voiceVadShort: '静音监测', voiceAutoEnhanceOn: '开', voiceAutoEnhanceOff: '关',
  voiceHotkeyCombo: '热键', voiceHotkeyClear: '清除', voiceHotkeyNone: '未设置',
  voiceHotkeyCapturing: '请按组合键…（Esc 取消）',
  voiceVadSilenceUnit: '秒', voiceVadSilenceLabel: '静音时长',
  voiceSilenceOff: '静音监测已关闭（按你的设置，不做静音判定也不自动停）',
  voiceStatusReady: '就绪', voiceStatusNotReady: '语音识别服务未就绪',
  voiceRefineEnabled: '清口水词', voiceRefineCleaned: '已清理', voiceRefineSkipped: '未清理（开关关闭）',
  voiceRefineLegacy: '已清理旧版规整配置（含密钥）', voiceRefineLegacyNone: '无旧版规整配置',
  voiceRefineSection: '清口水词',
  voiceOfficialDiagTitle: '官方录音路径（增值对齐）',
  voiceOfficialArmed: '已就绪（等待官方录音）', voiceOfficialActive: '官方采集进行中',
  voiceOfficialDisabled: '增值桥已停用（可关闭开关/环境标志）',
  voiceOfficialVerified: '已观测到官方采集（共 99 次）',
  voiceOfficialStartMissed: '未能派发点击官方开始按钮（按钮未找到或不可用）',
  voiceOfficialFeedback: '官方识别未完成（官方失败出口）',
  voiceOfficialFeedbackSeen: '上次官方会话以失败收场（官方失败出口）',
  voiceOfficialMissed: '未观测到官方采集（自动停未生效）',
  voiceOfficialAbandon: '自动停已降级（请手动停止）（stop-click-dispatch-failed）',
  voiceOfficialSelfCapture: '外部自建采集声明中（本桥不介入该采集）',
  voiceCorrectionSection: '语音纠错', voiceCorrectionArmed: '已就绪（等待语音识别完成）',
  voiceCorrectionChanged: '已纠错', voiceCorrectionNoChange: '已纠错（未改动）',
  voiceCorrectionOff: '未纠错（开关关闭）（因开关关闭跳过 ×99）',
  voiceCorrectionSkipped: '因开关关闭跳过', voiceCorrectionFailed: '纠错失败（LAST_CODE_LONG ×99）',
  voiceSectionTitle: '🎙 语音识别',
  secMain: '模型配置', secFallbackCount: '99 模型 · 按序尝试', secFallbackEmpty: '暂无模型（使用内置链）',
  cfgAddFallback: '＋ 添加模型', cfgRestoreDefaults: '恢复默认', cfgRemoveInvalid: '清理失效条目',
  cfgChainHasInvalid: '模型链中存在失效条目（模型/提供方已不可用），建议清理',
  cfgRestoreNote: '「恢复默认」将模型链重置为官方默认模型（自定义模型会被替换）',
  cfgReasoningWarn: '⚠ 高推理强度会极大增加优化所需时间（思考模式耗时可数倍于普通模式），请按需选择强度。',
  cfgTest: '测试连通性', cfgTesting: '测试中…',
  cfgTestOk: '✓ 可用 · 99999ms', cfgTestFail: '✗ 模型连接失败（网络或配置错误）',
  cfgMeasureLive: '实测：首 token 59m59s · 999 tok/s · 基础模式预计约 59m59s · 轻量模式预计约 59m59s',
  cfgMeasureLiveOk: '实测：可用', cfgMeasureLiveFail: '实测：模型连接失败（网络或配置错误）',
  cfgMeasureHist: '历史：首 token 59m59s · 999 tok/s · 基础模式预计约 59m59s · 轻量模式预计约 59m59s',
  cfgMeasureHistEmpty: '历史：暂无有效历史数据',
  cfgRowInvalid: '当前不可用', cfgInherited: '已继承当前使用模型（含推理等级）',
  pluginsClientPending: '激活中', cfgNoProvider: '未配置 LLM 提供方',
  navModelPlugins: '提示词增强', secPluginsIntro: '模型链、优化参数与插件管理的统一设置入口，修改即时保存。',
  tabModels: '模型配置', tabParams: '优化参数',
  cfgMode: '优化模式', cfgMemory: '记忆功能', cfgContextBudget: '上下文预算',
  cfgTimeout: '超时时间', cfgMaxTokens: '输出 Token 上限', cfgOutputLimit: '输出字符上限',
  cfgTemplateMode: '模板',
  cfgModeHintPublish: '粗略想法 → 检索同类项目 + 工作区参考，一键生成完整开发规格（九章）；多轮补充可逐步细化（上下文预算需 > 0 才启用检索）',
  cfgModeHintStandard: '规则理解 + 工作区文件与会话事件检索注入，零额外 LLM 成本',
  cfgMemoryNote: '开启后，多轮优化累积为记忆链并代入后续优化；关闭后不再读取/写入。发送消息会清空记忆链。',
  cfgContextNote: '上下文预算控制本模式可注入的参考量：0 = 不注入；预算越大，会话/文档检索范围越广',
  cfgParamsModeDefault: '当前模式默认：超时 240s · Token 16000 · 输出上限 50000',
  tplNote: '每模式可选内置「默认」（只重述不扩展）或「增量」（保守补充缺失的大逻辑）；或自定义模板（≤4000 字符）。',
  tplAddCustom: '+ 新建自定义模板', tplRemoveCustom: '删除该模板', tplName: '模板名称',
  tplNamePlaceholder: '模板名称（≤40 字符）', cfgTemplateTextFor: '自定义模板内容（当前模式：标准）',
  cfgHint: '配置保存在本地浏览器（localStorage），仅对当前实例生效。',
  cfgSaved: '✓ 已保存', cfgSaving: '保存中…', cfgSaveFailed: '✗ 保存失败，请重试', cfgLoadFailed: '加载模型列表失败',
  cfgReasoningOn: '开', cfgReasoningOff: '关',
  cfgNewerVersion: '当前配置由更新版本的插件创建，本版本暂以默认配置运行；你的配置未被改动',
  cfgUnlimited: '无限制', cfgContextBudget0: '0（关闭注入）',
  modeLabelBase: '基础模式', modeLabelPublish: '一键发布',
  tplDefault: '默认模板', tplIncrement: '增量模板', tplCustom: '自定义：自定义模板 1',
  dismiss: '知道了',
};

const BASE_VOICE = {
  autoEnhance: false, correction: { enabled: false }, filler: { enabled: false },
  vad: { enabled: true, silenceMs: 3000 }, hotkey: { enabled: false, combo: '' },
};
const BASE_CFG = {
  mode: 'standard', memory: false, fallback: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
  customModels: [], order: [], params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
  context: { mode: 'smart', budgetChars: 4000 },
  template: { pick: { standard: 'default' }, custom: { standard: [] } },
};
const PROVIDERS = [{ provider: 'deepseek-official', name: 'DeepSeek 官方', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }] }];

function scenarios() {
  const out = [];
  const push = (id, extra) => out.push(Object.assign({ id, cfg: BASE_CFG, voice: BASE_VOICE, providers: PROVIDERS, save: { phase: 'idle' } }, extra));
  push('voice-vad-off', { voice: Object.assign({}, BASE_VOICE, { vad: { enabled: false, silenceMs: 3000 } }) });
  push('voice-vad-on-1', { voice: Object.assign({}, BASE_VOICE, { vad: { enabled: true, silenceMs: 1000 } }) });
  push('voice-vad-on-5', { voice: Object.assign({}, BASE_VOICE, { vad: { enabled: true, silenceMs: 5000 } }) });
  push('voice-hotkey-set', { voice: Object.assign({}, BASE_VOICE, { hotkey: { enabled: true, combo: 'Control+Shift+Alt+Meta+KeyQ' } }) });
  push('voice-all-on', { voice: { autoEnhance: true, correction: { enabled: true }, filler: { enabled: true }, vad: { enabled: true, silenceMs: 5000 }, hotkey: { enabled: true, combo: 'Control+Shift+KeyA' } } });
  push('diag-normal', { diag: { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 3, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 0, lastSessionFailed: false }, filler: { runs: 5, cleaned: 2, removedTotal: 7, skipped: 0, lastRemoved: [], legacyChecked: true, legacyCleaned: false }, correction: { runs: 3, ok: 3, changed: 1, failed: 0, skipped: 0, lastCode: '', lastSkipReason: '' } });
  push('diag-abandon', { diag: { installed: true, abandonReason: 'stop-click-dispatch-failed', selfCapture: false, startMissed: 0, sessionsStarted: 1, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 0, lastSessionFailed: false } });
  push('diag-startmissed', { diag: { installed: true, abandonReason: '', selfCapture: false, startMissed: 2, sessionsStarted: 0, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 0, lastSessionFailed: false } });
  push('diag-feedback', { diag: { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 1, endedInFeedback: true, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 1, feedbackMessage: '未识别到语音', lastSessionFailed: true } });
  push('diag-sessionfailed', { diag: { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 2, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 1, lastSessionFailed: true } });
  push('diag-sessionfailed-old', { diag: { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 2, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 1, lastSessionFailed: true, lastSessionFailedAt: Date.now() - 40 * 86400000 } });   // 40 天前
  push('diag-sessionfailed-recent', { diag: { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 2, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 1, lastSessionFailed: true, lastSessionFailedAt: Date.now() - 10 * 60000 } });      // 10 分钟前
  push('diag-sessionfailed-recovered', { diag: { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 3, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 1, lastSessionFailed: false } });
  push('diag-missed', { diag: { installed: true, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 1, endedInFeedback: false, sessionsMissed: 1, vadEnabled: true, recording: false, feedbackSeen: 0, lastSessionFailed: false } });
  push('diag-disabled', { diag: { installed: false, abandonReason: '', selfCapture: false, startMissed: 0, sessionsStarted: 0, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 0, lastSessionFailed: false } });
  push('diag-selfcapture', { diag: { installed: true, abandonReason: '', selfCapture: true, startMissed: 0, sessionsStarted: 0, endedInFeedback: false, sessionsMissed: 0, vadEnabled: true, recording: false, feedbackSeen: 0, lastSessionFailed: false } });
  push('diag-notready', { providers: [], status: { ok: true, speech: { available: false, providers: [] } } });
  push('model-test-area', { tab: 'models', testState: { provider: 'deepseek-official', model: 'deepseek-v4-flash', ms: 99999 } });
  push('model-invalid', { tab: 'models', cfg: Object.assign({}, BASE_CFG, { fallback: [{ provider: 'gone', model: 'retired-model-name' }] }) });
  push('model-empty', { tab: 'models', cfg: Object.assign({}, BASE_CFG, { fallback: [] }) });
  push('model-pending', { tab: 'models', providers: null });
  push('model-loadfail', { tab: 'models', providers: [], loadFail: true });
  for (const m of ['base', 'lite', 'standard', 'smart', 'publish']) push('params-' + m, { tab: 'params', cfg: Object.assign({}, BASE_CFG, { mode: m }) });
  push('params-custom-tpl', { tab: 'params', cfg: Object.assign({}, BASE_CFG, { template: { pick: { standard: 'custom:0' }, custom: { standard: [{ name: '自定义模板 1', text: 'x' }] } } }) });
  push('params-saved', { tab: 'params', save: { phase: 'saved' } });
  push('params-saving', { tab: 'params', save: { phase: 'saving' } });
  push('params-savefailed', { tab: 'params', save: { phase: 'failed' } });
  push('tab-root', {});
  return ONLY ? out.filter((s) => s.id === ONLY) : out;
}

const IS_WIN = process.platform === 'win32';
const IS_WSL = (() => {
  if (IS_WIN) return false;
  try { return /microsoft|wsl/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
})();
function wslMounts() {
  const out = [];
  try { for (const n of fs.readdirSync('/mnt')) if (/^[a-z]$/i.test(n)) out.push('/mnt/' + n); } catch (e) { /* 无 /mnt */ }
  return out;
}
function candidates() {
  const out = [];
  if (IS_WIN) {
    out.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else {
    for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/snap/bin/chromium']) out.push(p);
  }
  if (IS_WSL) for (const r of wslMounts()) {
    out.push(path.join(r, 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));
    out.push(path.join(r, 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  return out;
}
function findBrowser() {
  for (const p of candidates()) { try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (e) { /* ignore */ } }
  return null;
}
function nativePath(browser, p) {
  if (!(IS_WSL && /^\/mnt\/[a-z]\//i.test(browser))) return p;
  const r = spawnSync('wslpath', ['-w', p], { encoding: 'utf8' });
  return String((r && r.stdout) || '').trim() || p;
}

function buildPage() {
  const chunks = {};
  for (const rel of CHUNKS) chunks[rel] = readChunk(rel);
  // styles chunk 的源码是 JS（const CSS = [...].join('\n')）——必须**求值**才拿到 CSS 文本，
  // 不能把 JS 源码直接塞进 <style>（那样一条样式都不生效，量到的是浏览器默认盒 = 假绿）。
  const cssSrc = chunks['src/client/styles.js'];
  delete chunks['src/client/styles.js'];
  const css = new Function(cssSrc + '\n;return CSS;')();
  if (typeof css !== 'string' || css.length < 500) throw new Error('styles chunk 未产出 CSS 字符串（实得 ' + typeof css + '）');
  const payload = { chunks, realisticMax: REALISTIC_MAX, scenarios: scenarios() };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>' + css + '</style></head><body>'
    + '<div id="root"></div>'
    + '<script id="payload" type="application/json">' + json + '<' + '/script>'
    + '<script>' + DRIVER + '<' + '/script></body></html>';
}

function runBrowser(page) {
  const browser = findBrowser();
  if (!browser) { console.error('FAIL | browser-found | 未找到可用浏览器（platform=' + process.platform + (IS_WSL ? ' / WSL' : '') + '）'); return null; }
  const dir = path.join(os.tmpdir(), 'settings-layout-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, page);
  const target = nativePath(browser, file);
  const r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--virtual-time-budget=8000', '--dump-dom', target], { encoding: 'utf8', timeout: 180000, maxBuffer: 256 * 1024 * 1024 });
  const dom = String(r.stdout || '');
  const m = dom.match(/<script type="application\/json" id="result">([\s\S]*?)<\/script>/);
  if (!m) { console.error('FAIL | result-extract | 浏览器未产出读数（stdout ' + dom.length + ' B，stderr: ' + String(r.stderr || '').slice(0, 800) + '）'); return null; }
  return JSON.parse(m[1]);
}

// 判据分级（⚠ 分级口径写死在这里，报告 §3 逐条对照，不靠"看着像"）：
//   REAL  = 真实语言态（zh / en）× 最长现实取值（worst）下出现的问题 ⇒ **本批必须为 0**
//   PATH  = 仅病态超长（200 字，现实中不可能出现）⇒ **不计入缺陷**，只用来证明"构造上不会挤压"
//   DEGEN = 场景没有该行/该控件（两态行数不一致）⇒ 单独列出，不混进缺陷数
function cmp(rep) {
  const real = [], path = [], degen = [];
  const push = (arr, o) => arr.push(o);
  for (const s of rep.scenarios) {
    for (const tag of ['base', 'en', 'worst', 'pathological']) {
      const scn = s[tag];
      if (!scn) continue;
      const bucket = tag === 'pathological' ? path : real;
      const label = tag === 'pathological' ? 'pathological' : tag;
      for (const tx of scn.texts) {
        if (tx.ellipsis) push(bucket, { scen: s.id, variant: label, kind: 'text-ellipsis', row: tx.row, cls: tx.cls, text: tx.text, scrollW: tx.scrollW, clientW: tx.clientW });
      }
      if (scn.rootOverflow.scrollW > scn.rootOverflow.clientW + 1) {
        push(bucket, { scen: s.id, variant: label, kind: 'root-overflow', scrollW: scn.rootOverflow.scrollW, clientW: scn.rootOverflow.clientW });
      }
    }
    // 控件压缩 / 行高：以 base 为参照，对 en / worst / pathological 各判一次
    for (const tag of ['en', 'worst', 'pathological']) {
      const o = s[tag];
      if (!o) continue;
      const bucket = tag === 'pathological' ? path : real;
      if (o.rows.length !== s.base.rows.length) {
        push(degen, { scen: s.id, variant: tag, kind: 'row-count-mismatch', baseRows: s.base.rows.length, otherRows: o.rows.length });
        continue;
      }
      for (let i = 0; i < s.base.rows.length; i++) {
        const b = s.base.rows[i], w = o.rows[i];
        if (b.controls.length !== w.controls.length) {
          push(degen, { scen: s.id, variant: tag, kind: 'control-count-mismatch', row: i, rowCls: b.cls, base: b.controls.length, other: w.controls.length });
          continue;
        }
        for (let c = 0; c < b.controls.length; c++) {
          const cb = b.controls[c], cw = w.controls[c];
          if (cb.tag === 'button' && /dsh-plg-btn-icononly/.test(cb.cls)) continue;
          if (tag === 'pathological') {
            // PATH：**构造证明**口径 —— 控件不得低于自身 min-width（下限与文案无关）。
            if (cw.w < (cb.minW || 0) - 0.5) {
              push(bucket, { scen: s.id, variant: tag, kind: 'control-below-floor', row: i, rowCls: b.cls, control: cb.tag + ' ' + cb.cls, minW: cb.minW, got: cw.w });
            }
          } else if (cw.w < cb.w - 0.5) {
            // REAL：**相对**口径 —— 真实语言态/最长现实取值下，控件宽度不得比当前 ZH 基线更窄。
            push(bucket, { scen: s.id, variant: tag, kind: 'control-squeezed', row: i, rowCls: b.cls, control: cb.tag + ' ' + cb.cls, base: cb.w, other: cw.w, minW: cb.minW });
          }
        }
        // 行高跳变：**只判"横向行"**（flex row / grid）。
        //   纵向堆叠容器（flex-direction: column，如自定义模板编辑区）里段落换行后变高是**正常排版**，
        //   不是挤压 —— 把它算成缺陷会得出"文案不能换行"的荒谬结论。
        const vertical = /column/.test(String(b.flexDirection || '')) || /column/.test(String(b.display || ''));
        if (!vertical && b.controls.length > 0 && b.h > 0 && w.h > b.h + 1 && w.controls.length > 0) {
          push(bucket, { scen: s.id, variant: tag, kind: 'row-height-jump', row: i, rowCls: b.cls, baseH: b.h, otherH: w.h });
        }
      }
    }
  }
  return { real, path, degen };
}

async function main() {
  if (has('--no-browser')) { console.log('SKIP | 未做量测（不构成判据）'); return 3; }
  const page = buildPage();
  const rep = runBrowser(page);
  if (!rep) return 3;
  if (rep.errors.length) {
    console.error('FAIL | scenario-error | ' + rep.errors.length + ' 个场景求值失败：');
    for (const e of rep.errors.slice(0, 10)) console.error('  · ' + e.id + ' → ' + e.err);
    return 1;
  }
  const { real, path, degen } = cmp(rep);
  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify({ raw: rep, real, path, degen }, null, 1)); console.log('JSON → ' + JSON_OUT); }
  const tally = (arr) => { const m = {}; for (const f of arr) m[f.kind] = (m[f.kind] || 0) + 1; return Object.keys(m).length ? Object.entries(m).map((kv) => kv[0] + '=' + kv[1]).join(' · ') : '无'; };
  console.log('场景 ' + rep.scenarios.length + ' 条 × 4 态（base(zh) / en / worst(最长现实取值) / pathological(200 字)）');
  console.log('REAL（zh/en × 最长现实取值）: ' + real.length + ' 条 → ' + tally(real));
  console.log('PATH（仅病态超长 · 判「控件不得低于自身下限」）: ' + path.length + ' 条 → ' + tally(path));
  console.log('DEGEN（两态行/控件数不一致，单列不混算）: ' + degen.length + ' 条 → ' + tally(degen));
  for (const f of real.slice(0, 120)) console.log('  REAL | ' + (f.scen || '') + ' | ' + f.kind + ' | ' + JSON.stringify(f));
  for (const f of degen.slice(0, 20)) console.log('  DEGEN | ' + (f.scen || '') + ' | ' + f.kind + ' | ' + JSON.stringify(f));
  if (real.length) { console.log('FAIL | squeeze-audit | 真实语言态 × 最长现实取值 下存在挤压/溢出（' + real.length + ' 条）'); return 1; }
  console.log('PASS | squeeze-audit | 真实语言态（zh/en）× 最长现实取值：无文本溢出 / 无控件被文案压缩 / 无行高跳变');
  if (path.length) console.log('NOTE | 病态 200 字下仍有 ' + path.length + ' 条越界读数（现实中不可能出现，仅作构造保证的观察面，不计缺陷）');
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((e) => { console.error('FAIL | harness | ' + ((e && e.stack) || e)); process.exitCode = 1; });
