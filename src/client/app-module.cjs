'use strict';

// 客户端插件装配入口普通模块（构建期由打包器内联）。
// apply 的注册顺序、槽位 ID、标签与卸载行为不变。
const shared = require('./shared-runtime.cjs');
const contracts = require('../shared/contracts/client-runtime.cjs');
const { createClientState } = require('./state-module.cjs');
const { createClientHelpers } = require('./helpers-module.cjs');
const { createVoiceState } = require('./voice/state-module.cjs');
const { createCorrectionState } = require('./voice/correction-module.cjs');
const { createOfficialVoiceBridge } = require('./voice/official-bridge-module.cjs');
const { createVoiceHotkey } = require('./voice/hotkey-module.cjs');
const { createVoiceSection } = require('./voice/voice-section-module.cjs');
const { createCollapsibleSection, createMarqueeSelect } = require('./components/navigation-runtime.cjs');
const { createModelMainSection, createFallbackRow } = require('./components/model-settings-runtime.cjs');
const { createModelConfigTab } = require('./components/model-config-tab-module.cjs');
const { createParamsTab } = require('./components/params-tab-module.cjs');
const { createModelPluginsSection } = require('./components/settings-shell-runtime.cjs');
const { createEnhanceButton, createEnhanceBar } = require('./components/enhance-components-runtime.cjs');
function createClientApp(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const styles = d.styles;
  const CSS = shared.CSS;
  const ZH = shared.ZH;
  const EN = shared.EN;
  // timer 服务在 apply() 时才由宿主注入，而组件工厂在此之前就会捕获 timerSvc。
  // 用同一个可变引用做晚绑定代理，避免工厂捕获 null 后永远失去轮询/防抖能力。
  const timerRef = d.timerRef || { value: d.timerSvc || null };
  const timerSvc = {
    timeout(fn, ms) {
      const t = timerRef.value;
      if (t && typeof t.timeout === 'function') return t.timeout(fn, ms);
      if (typeof setTimeout === 'function') {
        const id = setTimeout(fn, ms);
        return () => { try { clearTimeout(id); } catch (e) { /* 已结算 */ } };
      }
      return () => {};
    },
    interval(fn, ms) {
      const t = timerRef.value;
      if (t && typeof t.interval === 'function') return t.interval(fn, ms);
      if (typeof setInterval === 'function') {
        const id = setInterval(fn, ms);
        return () => { try { clearInterval(id); } catch (e) { /* 已结算 */ } };
      }
      return () => {};
    },
  };
  const storage = d.storage !== undefined
    ? d.storage
    : (d.localStorage !== undefined ? d.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null));
  let dynFace = null;

  // 目标模式：状态/语音/组件的依赖图在此显式装配，替代旧注入标记与隐式全局。
  const configApi = createClientState({ host: d.host, timerRef, storage });
  const configState = configApi.configState;
  const helpers = createClientHelpers({ host: d.host, configState, dictionary: ZH, storage, resultStatusOf: contracts.resultStatusOf });
  const voiceApi = createVoiceState({ host: d.host, storage, timerSvc, fillerState: shared.fillerState, defaults: contracts.VOICE_CONFIG_DEFAULTS, normalizeVadSilenceMs: contracts.normalizeVadSilenceMs, rpcMethods: contracts.RPC_METHODS, console: d.console });
  const voiceCfgState = voiceApi.voiceCfgState;
  const correction = createCorrectionState({ voiceCfgState, correctionStateCore: { CORRECTION_PHASES: shared.CORRECTION_PHASES, correctionPhaseKnown: shared.correctionPhaseKnown, correctionPhaseOf: shared.correctionPhaseOf, correctionFailureTicket: shared.correctionFailureTicket, correctionFailureConsume: shared.correctionFailureConsume } });
  const officialVoiceBridge = createOfficialVoiceBridge({
    window: d.window, document: d.document, navigator: d.navigator, MutationObserver: d.MutationObserver,
    voiceCfgState, vadRequiredQuiet: voiceApi.vadRequiredQuiet, vadSilenceMsOf: voiceApi.vadSilenceMsOf,
  });
  const CollapsibleSection = createCollapsibleSection({ React: d.React, dshEnhId: helpers.dshEnhId });
  const MarqueeSelect = createMarqueeSelect({ React: d.React, window: d.window, document: d.document });
  const VoiceSection = createVoiceSection({
    React: d.React, makeT: helpers.makeT, host: d.host, voiceCfgState,
    subscribeVoiceConfig: voiceApi.subscribeVoiceConfig, saveVoiceCfg: voiceApi.saveVoiceCfg,
    syncVoiceFromHost: voiceApi.syncVoiceFromHost, vadSilenceMsOf: voiceApi.vadSilenceMsOf,
    normalizeVadSilenceMs: voiceApi.normalizeVadSilenceMs, rpcMethods: contracts.RPC_METHODS, CollapsibleSection, officialVoiceBridge,
    voiceHotkeyDisplay: shared.voiceHotkeyDisplay,
    fillerSnapshot: shared.fillerSnapshot, subscribeFiller: shared.subscribeFiller,
    correctionSnapshot: correction.correctionSnapshot, subscribeCorrection: correction.subscribeCorrection,
    setTimeout: d.setTimeout || setTimeout, clearTimeout: d.clearTimeout || clearTimeout, window: d.window,
  }).VoiceSection;
  const FallbackRow = createFallbackRow({ React: d.React, MarqueeSelect, makeT: helpers.makeT, host: d.host });
  const ModelMainSection = createModelMainSection({
    React: d.React, CollapsibleSection, FallbackRow, makeT: helpers.makeT, host: d.host, DEFAULT_MODEL_CHAIN: shared.DEFAULT_MODEL_CHAIN, getLastDraft: configApi.getLastDraft, timerSvc,
  });
  const ModelConfigTab = createModelConfigTab({
    React: d.React, makeT: helpers.makeT, configState, subscribeConfig: configApi.subscribeConfig,
    host: d.host, DEFAULT_MODEL_CHAIN: shared.DEFAULT_MODEL_CHAIN, saveConfig: configApi.saveConfig,
    buildCandidates: shared.buildCandidates, ModelMainSection, VoiceSection,
  });
  const ParamsTab = createParamsTab({
    React: d.React, MarqueeSelect, makeT: helpers.makeT, dshEnhId: helpers.dshEnhId, configState,
    saveConfig: configApi.saveConfig, host: d.host, MODE_OPTIONS: shared.MODE_OPTIONS,
    MODE_TIMEOUT_OPTIONS: shared.MODE_TIMEOUT_OPTIONS, MODE_MAXTOKENS_OPTIONS: shared.MODE_MAXTOKENS_OPTIONS,
    MODE_OUTPUTLIMIT_OPTIONS: shared.MODE_OUTPUTLIMIT_OPTIONS, MODE_BUDGET_OPTIONS: shared.MODE_BUDGET_OPTIONS,
    MODE_PARAMS_DEFAULT: shared.MODE_PARAMS_DEFAULT, MODE_BUDGET_DEFAULT: shared.MODE_BUDGET_DEFAULT,
    modeShortLabel: shared.modeShortLabel, modeLabel: shared.modeLabel, TEMPLATE_BUILTIN_KEYS: shared.TEMPLATE_BUILTIN_KEYS,
    TEMPLATE_CUSTOM_MAX: shared.TEMPLATE_CUSTOM_MAX, TEMPLATE_TEXT_MAX: shared.TEMPLATE_TEXT_MAX,
    TEMPLATE_NAME_MAX: shared.TEMPLATE_NAME_MAX, customPickIndex: shared.customPickIndex,
  });
  const shell = createModelPluginsSection({ React: d.React, makeT: helpers.makeT, dshEnhId: helpers.dshEnhId, subscribeConfig: configApi.subscribeConfig, subscribeSaveStatus: configApi.subscribeSaveStatus, saveStatus: configApi.saveStatus, ModelConfigTab, ParamsTab });
  const ModelPluginsSection = shell.ModelPluginsSection;
  const CordisBadgePlaceholder = shell.CordisBadgePlaceholder;
  const EnhanceButton = createEnhanceButton({
    React: d.React, makeT: helpers.makeT, dshEnhId: helpers.dshEnhId, subscribe: helpers.subscribe, storeFor: helpers.storeFor,
    notify: helpers.notify, releaseStoreIfIdle: helpers.releaseStoreIfIdle, setLastDraft: configApi.setLastDraft,
    subscribeConfig: configApi.subscribeConfig, subscribeCorrection: correction.subscribeCorrection,
    subscribeVoiceConfig: voiceApi.subscribeVoiceConfig, setActiveSession: helpers.setActiveSession,
    getActiveSession: helpers.getActiveSession, safeSetDraft: helpers.safeSetDraft, clearResultStore: helpers.clearResultStore,
    clearSeen: helpers.clearSeen, guardPasses: helpers.guardPasses, saveConfig: configApi.saveConfig, configState,
    enhance: helpers.enhance, cancelEnhance: helpers.cancelEnhance, undo: helpers.undo, modeShortLabel: shared.modeShortLabel,
    prettifyModel: shared.prettifyModel, timerSvc, host: d.host, correctionSnapshot: correction.correctionSnapshot,
    correctionPhaseOf: correction.correctionPhaseOf, CORRECTION_PHASES: correction.CORRECTION_PHASES,
    correctionFailureTicket: correction.correctionFailureTicket, consumeCorrectionFailure: correction.consumeCorrectionFailure,
    correctionPhaseView: correction.correctionPhaseView, rpcMethods: contracts.RPC_METHODS,
  });
  const EnhanceBar = createEnhanceBar({ React: d.React, makeT: helpers.makeT, subscribe: helpers.subscribe, storeFor: helpers.storeFor, notify: helpers.notify, releaseStoreIfIdle: helpers.releaseStoreIfIdle, errorKey: helpers.errorKey });
  // 共享常量/模型工具从共享运行时取，组件不再依赖隐式全局。

  const VoiceHotkeyHost = createVoiceHotkey({
    React: d.React, host: d.host, voiceCfgState, subscribeVoiceConfig: voiceApi.subscribeVoiceConfig,
    isEnhancing: helpers.isEnhancing, subscribe: helpers.subscribe, storeFor: helpers.storeFor, notify: helpers.notify,
    enhance: helpers.enhance, timerSvc, officialVoiceBridge, makeT: helpers.makeT, ZH, MarqueeSelect, CollapsibleSection,
    setInterval: d.setInterval || setInterval, clearInterval: d.clearInterval || clearInterval, setTimeout: d.setTimeout || setTimeout,
    navigator: d.navigator, window: d.window, configState,
    markCorrectionSkipped: correction.markCorrectionSkipped, markCorrectionStarted: correction.markCorrectionStarted,
    markCorrectionSettled: correction.markCorrectionSettled, markCorrectionFailed: correction.markCorrectionFailed,
    notifyCorrection: correction.notifyCorrection, correctionState: correction.correctionState,
    planVoicePostprocess: contracts.planVoicePostprocess, voicePostprocessHas: contracts.voicePostprocessHas,
    stripFillers: shared.stripFillers, runFiller: shared.runFiller, rpcMethods: contracts.RPC_METHODS,
  }).VoiceHotkeyHost;
  return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    styles.insert(shared.CSS);
    timerRef.value = ctx.get('timer') || null;
    officialVoiceBridge.setTimer(timerRef.value);
    // P2-补做（2026-10-13 · CHG-011 / §4.6.2.6 · UD-0014 选 B）：官方录音路径增值桥——
    // 静音监测（自动停）+ 自动增强挂到官方录音路径上（只观测不改行为）。
    // 安装必须在 apply 阶段完成：官方采集期间插件的 conversation.input.right 被官方隐藏
    // （client-ui-conversation 的 `hidden: activity`）⇒ React 组件此刻并未挂载，
    // 录音监测**不能**寄居其中（厦门实证：standardControls[hidden]{display:none}）。
    ctx.effect(() => {
      if (typeof officialVoiceBridge === 'undefined' || !officialVoiceBridge) return () => {};
      try { officialVoiceBridge.install(); } catch (e) { /* 安装失败不得阻断插件其余面 */ }
      return () => {
        try { officialVoiceBridge.uninstall(); } catch (e) { /* HMR 卸载恢复原函数 */ }
      };
    });
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
      ctx.effect(() => safeRegister('enhance', 'zh', shared.ZH));
      ctx.effect(() => safeRegister('enhance', 'en', shared.EN));
    }
    dynFace = ctx.get('dynamicCordisRunner') || null;
    // v16：整合「插件管理」+「优化配置」为单一入口「模型与插件」（页内三区 tab）
    slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: 'model-plugins',
        order: 25,
        // 2026-08-18（用户需求）：导航 label 前曾加 ✨（与输入框优化按钮图标一致）。
        // 2026-10-19（合并回单 tab 批）：**去掉前缀 ✨**。用户逐字：「设置的标题……改成「提示词 · 语音增强」，不要前面的符号了」。
        //   左侧导航项同步去符号（与页内 h2 标题逐字一致）。⚠ 输入框优化按钮的 ✨ 不动（那是另一处、且用户明确保留）。
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
    // P1-a（2026-10-13 缩批）：插件自建 🎤 按钮 UI（VoiceMicButton）已退役 —— 麦克风按钮用官方控件
    // （方案 §4.6.2：不占官方 conversation.input.activity 槽位，不抢 UI 位置）。
    // 热键通道保留：VoiceHotkeyHost 为**无 UI** 接线组件，注册同一 conversation.input.right
    // 槽位（order 11）只为取得本会话的 input/inputActions，从而驱动「热键→录音→识别→填入」。
    slots.inject('conversation.input.right', () => slots.register(
      { name: 'conversation.input.right', id: 'voice-hotkey', order: 11, label: '语音热键', locale: 'enhance' },
      VoiceHotkeyHost,
    ));
    // 2026-10-18（R3 · 纠错状态并入增强按钮）：**原 CHG-184 的独立纠错状态元素已删除**。
    //   用户逐字：「纠错的时候显示正在纠错，纠错完恢复成那个增强按钮的默认状态就可以了」
    //   ⇒ ⛔ 不再注册 conversation.input.right order 12（那个独立胶囊）；
    //     纠错在途期由 ✨ 增强按钮自身临时显示「正在纠错」，结束后自动复原。
    //   ⚠ 「没跑（开关关）」与「跑了但没改」的区分仍在**设置页诊断区**（CorrectionDiag），见报告 §F。
    slots.inject('conversation.input.dock', () => slots.register(
      { name: 'conversation.input.dock', id: 'prompt-enhance-status', order: 30, label: '优化错误提示', locale: 'enhance' },
      EnhanceBar,
    ));
  },
  };
}

module.exports = { createClientApp };
