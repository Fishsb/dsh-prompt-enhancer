'use strict';

// 客户端插件装配入口普通模块（构建期由打包器内联）。
// apply 的注册顺序、槽位 ID、标签与卸载行为不变。
function createClientApp(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const styles = d.styles;
  const CSS = d.CSS;
  const ZH = d.ZH;
  const EN = d.EN;
  const timerRef = d.timerRef;
  let timerSvc = d.timerSvc || null;
  let dynFace = null;
  const officialVoiceBridge = d.officialVoiceBridge;
  const ModelPluginsSection = d.ModelPluginsSection;
  const CordisBadgePlaceholder = d.CordisBadgePlaceholder;
  const EnhanceButton = d.EnhanceButton;
  const VoiceHotkeyHost = d.VoiceHotkeyHost;
  const EnhanceBar = d.EnhanceBar;
  return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    styles.insert(CSS);
    timerSvc = ctx.get('timer') || null;
    if (typeof timerRef !== 'undefined' && timerRef) timerRef.value = timerSvc;
    // P2-补做（2026-10-13 · CHG-011 / §4.6.2.6 · UD-0014 选 B）：官方录音路径增值桥——
    // 静音监测（自动停）+ 自动增强挂到官方录音路径上（只观测不改行为）。
    // 安装必须在 apply 阶段完成：官方采集期间插件的 conversation.input.right 被官方隐藏
    // （client-ui-conversation 的 `hidden: activity`）⇒ React 组件此刻并未挂载，
    // 录音监测**不能**寄居其中（厦门实证：standardControls[hidden]{display:none}）。
    ctx.effect(() => {
      if (typeof officialVoiceBridge === 'undefined' || !officialVoiceBridge) return () => {};
      officialVoiceBridge.setTimer(timerSvc);
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
