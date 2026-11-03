'use strict';

// 语音配置状态普通模块（构建期由客户端运行时内联）。
// 默认值、存储、host RPC、定时器与清口水词状态均由调用方显式注入。
function createVoiceState(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const host = d.host || null;
  // 归一化入口由装配层注入（与 host 共用契约实现）；未注入时使用契约默认值兜底。
  const normalizeVadSilenceMs = typeof d.normalizeVadSilenceMs === 'function'
    ? d.normalizeVadSilenceMs
    : (value) => {
      const n = typeof value === 'number' ? value : NaN;
      if (Number.isInteger(n)) {
        if (n >= 1000 && n <= 5000 && n % 1000 === 0) return n;
        if (n >= 1 && n <= 5) return n * 1000;
      }
      return VOICE_CFG_DEFAULTS.vad.silenceMs;
    };
  const storage = d.storage !== undefined
    ? d.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null);
  const timerSvc = d.timerSvc || null;
  const fillerState = d.fillerState || null;
  const consoleSvc = d.console || (typeof console !== 'undefined' ? console : null);
  const VOICE_CFG_DEFAULTS = JSON.parse(JSON.stringify(d.defaults || {}));
  const VOICE_CFG_KEY = 'dsh.prompt-enhancer.voice';


  function vadSilenceMsOf(v) {
    return normalizeVadSilenceMs(v && v.vad ? v.vad.silenceMs : undefined);
  }

  function vadRequiredQuiet(silenceMs) {
    const ms = normalizeVadSilenceMs(silenceMs);
    const poll = 100; // = 录音轮询粒度（内部实现，不对外暴露）
    return Math.max(1, Math.round(ms / poll));
  }

  const voiceCfgState = {
    value: { ...VOICE_CFG_DEFAULTS },
    listeners: new Set(),
    synced: false,
    syncing: false,
    syncPromise: null,
  };

  const VOICE_HOST_SYNC_MAX_ATTEMPTS = 10;
  const VOICE_HOST_SYNC_RETRY_MS = 2000;

  function mergeVoice(v) {
    const r = v && v.filler && typeof v.filler === 'object' ? v.filler : {};
    const vd = v && v.vad && typeof v.vad === 'object' ? v.vad : {};
    const hk = v && v.hotkey && typeof v.hotkey === 'object' ? v.hotkey : {};
    return {
      filler: { enabled: r.enabled !== false },
      vad: { enabled: vd.enabled !== false, silenceMs: normalizeVadSilenceMs(vd.silenceMs) },
      hotkey: {
        enabled: hk.enabled === true,
        combo: typeof hk.combo === 'string' && hk.combo ? hk.combo : '',
      },
      autoEnhance: (v && v.autoEnhance === true) ? true : false,
      correction: { enabled: (v && v.correction && v.correction.enabled === true) ? true : false },
    };
  }

  try {
    const raw = storage ? storage.getItem(VOICE_CFG_KEY) : null;
    if (raw) {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') voiceCfgState.value = mergeVoice(v);
    }
  } catch (e) { /* 损坏忽略 */ }

  function persistVoiceLocal() {
    try {
      if (storage) storage.setItem(VOICE_CFG_KEY, JSON.stringify(voiceCfgState.value));
    } catch (e) { /* 忽略 */ }
  }

  function notifyVoice() {
    for (const fn of [...voiceCfgState.listeners]) fn();
  }

  function syncVoiceFromHost() {
    if (voiceCfgState.syncing === true) return voiceCfgState.syncPromise;
    voiceCfgState.syncing = true;
    let attempt = 0;
    const settle = () => { voiceCfgState.syncing = false; };
    const scheduleRetry = () => {
      attempt += 1;
      if (attempt >= VOICE_HOST_SYNC_MAX_ATTEMPTS) {
        voiceCfgState.synced = true;
        settle();
        return null;
      }
      const again = () => { try { runAttempt(); } catch (e) { settle(); } };
      if (timerSvc && typeof timerSvc.timeout === 'function') {
        timerSvc.timeout(again, VOICE_HOST_SYNC_RETRY_MS);
        return null;
      }
      if (typeof setTimeout === 'function') {
        setTimeout(again, VOICE_HOST_SYNC_RETRY_MS);
        return null;
      }
      voiceCfgState.synced = true;
      settle();
      return null;
    };
    const runAttempt = () => {
      if (!host || typeof host.call !== 'function') return scheduleRetry();
      const p = host.call('config/get', {}).then((res) => {
        const r = res && typeof res === 'object' ? res : {};
        if (!r.ok) return scheduleRetry();
        const diskCfg = (r.config && typeof r.config === 'object') ? r.config : null;
        if (diskCfg && diskCfg.voice && typeof diskCfg.voice === 'object') {
          voiceCfgState.value = mergeVoice(diskCfg.voice);
        }
        voiceCfgState.synced = true;
        persistVoiceLocal();
        notifyVoice();
        settle();
        try { cleanupLegacyRefine(diskCfg); } catch (e) { /* 清理失败不影响同步 */ }
        return null;
      }).catch(() => scheduleRetry());
      return p;
    };
    voiceCfgState.syncPromise = runAttempt();
    return voiceCfgState.syncPromise;
  }

  function saveVoiceCfg(patch) {
    voiceCfgState.value = mergeVoice({ ...voiceCfgState.value, ...(patch || {}) });
    persistVoiceLocal();
    const disk = { voice: JSON.parse(JSON.stringify(voiceCfgState.value)) };
    if (host && typeof host.call === 'function') {
      host.call('config/set', { config: disk }).catch(() => { /* 静默：下次保存重试 */ });
    }
    notifyVoice();
  }

  function cleanupLegacyRefine(diskConfig) {
    if (fillerState) fillerState.legacyChecked = true;
    const cfg = diskConfig && typeof diskConfig === 'object' ? diskConfig : null;
    if (!cfg || !cfg.voice || typeof cfg.voice !== 'object'
      || !Object.prototype.hasOwnProperty.call(cfg.voice, 'refine')) {
      return false;
    }
    const next = JSON.parse(JSON.stringify(cfg));
    delete next.voice.refine;
    try {
      if (host && typeof host.call === 'function') {
        host.call('config/set', { config: next }).then((w) => {
          const ok = !!(w && w.ok);
          if (fillerState) {
            fillerState.legacyCleaned = ok;
            fillerState.legacyAt = Date.now();
          }
          notifyVoice();
          try {
            if (consoleSvc && typeof consoleSvc.log === 'function') {
              consoleSvc.log('[filler] legacy voice.refine cleaned ok=' + ok);
            }
          } catch (e) { /* 忽略 */ }
        }).catch(() => { /* 写失败：保持 legacyCleaned=false */ });
      }
    } catch (e) { /* 忽略 */ }
    return true;
  }

  function subscribeVoiceConfig(fn) {
    voiceCfgState.listeners.add(fn);
    return () => voiceCfgState.listeners.delete(fn);
  }

  const api = {
    VOICE_CFG_KEY,
    VOICE_CFG_DEFAULTS,
    normalizeVadSilenceMs,
    vadSilenceMsOf,
    vadRequiredQuiet,
    voiceCfgState,
    mergeVoice,
    persistVoiceLocal,
    notifyVoice,
    syncVoiceFromHost,
    saveVoiceCfg,
    cleanupLegacyRefine,
    subscribeVoiceConfig,
  };

  if (d.autoSync !== false) syncVoiceFromHost();
  return api;
}

module.exports = { createVoiceState };
