'use strict';

// 客户端增强会话模块（普通 CommonJS，构建期由共享运行时内联）。
// 环境能力均由 createClientHelpers 显式注入；组件仍消费同名函数，用户可见契约不变。
const {
  MEMORY_ROUNDS_MAX,
  SEEN_KEY_PREFIX,
} = require('./constants.cjs');
const { RPC_METHODS } = require('../../shared/contracts/rpc.cjs');

const { errorKeyOf: contractErrorKey } = require('../../shared/contracts/errors.cjs');

const MODEL_DISPLAY_NAMES = {
  'deepseek-v4-flash': 'DeepSeek-V4-Flash',
  'deepseek-v4-pro': 'DeepSeek-V4-Pro',
  'mimo-v2.5': 'MiMo-V2.5',
  'mimo-v2.5-pro': 'MiMo-V2.5-Pro',
  'qwen3.7-max': 'Qwen3.7-Max',
  'kimi-k2.7-code': 'Kimi-K2.7-Code',
};

function createClientHelpers(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const host = d.host;
  const configState = d.configState;
  const dictionary = d.dictionary && typeof d.dictionary === 'object' ? d.dictionary : {};
  const resultStatusOf = typeof d.resultStatusOf === 'function'
    ? d.resultStatusOf
    : (result) => (result && result.ok === true ? 'changed' : 'failed');
  const storage = d.storage || (typeof localStorage !== 'undefined' ? localStorage : null);

  let dshEnhIdSeq = 0;

  // 稳定 id 用于 label htmlFor / aria-controls / aria-describedby；
  // 组件以 useState(() => ...) / useRef 固定一次，避免重渲染漂移。
  function dshEnhId(prefix) {
    dshEnhIdSeq += 1;
    return (prefix || 'dsh-enh') + '-' + dshEnhIdSeq;
  }

  function errorKey(code) {
    return contractErrorKey(code);
  }

  function makeT(props) {
    if (props && typeof props.t === 'function') return props.t;
    return (key) => dictionary[key] || key;
  }

  const sessionStores = new Map();
  let activeSessionId = null;

  function resultKey(sessionId) {
    return 'dsh-enh-result:' + sessionId;
  }

  function readStoredResult(sessionId) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      const raw = storage.getItem(resultKey(sessionId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.b === 'string' && typeof parsed.e === 'string' && parsed.e !== '') {
        return parsed;
      }
    } catch (error) { /* 持久化恢复失败时按空闲态启动 */ }
    return null;
  }

  function storeFor(sessionId) {
    let session = sessionStores.get(sessionId);
    if (session) return session;

    session = {
      phase: 'idle',
      backup: '',
      enhanced: '',
      error: null,
      seq: 0,
      listeners: new Set(),
      memoryRounds: [],
      optimized: false,
      lastModel: '',
      fallbackUsed: false,
      degraded: [],
      truncated: false,
    };

    // 整页刷新后恢复尚未消费的增强结果。
    const restored = readStoredResult(sessionId);
    if (restored) {
      session.phase = 'result';
      session.backup = restored.b;
      session.enhanced = restored.e;
      session.optimized = true;
    }
    sessionStores.set(sessionId, session);
    return session;
  }

  function seenKey(sessionId) {
    return SEEN_KEY_PREFIX + sessionId;
  }

  function writeSeen(sessionId) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try { storage.setItem(seenKey(sessionId), '1'); } catch (error) { /* 标记写入失败不阻断增强 */ }
  }

  function clearSeen(sessionId) {
    if (!storage || typeof storage.removeItem !== 'function') return;
    try { storage.removeItem(seenKey(sessionId)); } catch (error) { /* 标记清理失败不阻断发送 */ }
  }

  function subscribe(sessionId, listener) {
    const session = storeFor(sessionId);
    session.listeners.add(listener);
    return () => { session.listeners.delete(listener); };
  }

  function notify(sessionId) {
    const session = storeFor(sessionId);
    for (const listener of [...session.listeners]) listener();
  }

  function setActiveSession(sessionId) {
    activeSessionId = sessionId || null;
  }

  function getActiveSession() {
    return activeSessionId;
  }

  function saveResultStore(sessionId, backup, enhanced) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(resultKey(sessionId), JSON.stringify({ b: backup, e: enhanced }));
    } catch (error) { /* 结果持久化失败不阻断写回 */ }
  }

  function clearResultStore(sessionId) {
    if (!storage || typeof storage.removeItem !== 'function') return;
    try { storage.removeItem(resultKey(sessionId)); } catch (error) { /* 结果清理失败不阻断状态复位 */ }
  }

  function isEnhancing(sessionId) {
    const session = sessionStores.get(sessionId);
    return !!(session && session.phase === 'enhancing');
  }

  function releaseStoreIfIdle(sessionId) {
    const session = sessionStores.get(sessionId);
    if (!session) return;
    if (session.phase === 'idle' && session.listeners.size === 0 && session.error === null) {
      sessionStores.delete(sessionId);
    }
  }

  function safeSetDraft(inputActions, text) {
    if (!inputActions || typeof inputActions.setDraft !== 'function') return;
    try { inputActions.setDraft(text); } catch (error) { /* 输入框卸载竞态不阻断状态复位 */ }
  }

  function cancelEnhance(sessionId, inputActions) {
    const session = storeFor(sessionId);
    if (session.phase !== 'enhancing') return;
    const seq = session.seq;
    session.seq += 1;
    clearResultStore(sessionId);
    safeSetDraft(inputActions, session.backup);
    session.phase = 'idle';
    session.enhanced = '';
    session.error = null;
    clearResultStore(sessionId);
    notify(sessionId);
    host.call(RPC_METHODS.CANCEL, { sessionId, seq }).catch(() => {});
  }

  // 斜杠命令只优化正文，原命令与空白前缀保持不变。
  function splitCommand(draft) {
    const match = /^(\/\S+)(\s+)([\s\S]*)$/.exec(draft);
    if (match) return { prefix: match[1] + match[2], body: match[3] };
    return { prefix: '', body: draft };
  }

  // 记忆只携带历史轮次，不改变用户选择的模式。
  function resolveActualMode(sessionId, cfg) {
    const session = storeFor(sessionId);
    const mode = cfg.mode;
    const seed = false;
    let memory = null;
    if (cfg.memory && session.memoryRounds && session.memoryRounds.length > 0) {
      memory = { rounds: session.memoryRounds };
    }
    return { mode, seed, memory };
  }

  function prettifyModel(id) {
    return MODEL_DISPLAY_NAMES[id] || id;
  }

  function enhance(sessionId, draft, inputActions, draftRef) {
    const session = storeFor(sessionId);
    if (session.phase === 'enhancing') {
      const previousSeq = session.seq;
      session.seq += 1;
      host.call(RPC_METHODS.CANCEL, { sessionId, seq: previousSeq }).catch(() => {});
    }

    session.backup = draft;
    session.seq += 1;
    const seq = session.seq;
    session.phase = 'enhancing';
    clearResultStore(sessionId);
    session.enhanced = '';
    session.error = null;
    notify(sessionId);

    const parts = splitCommand(draft);
    const config = configState.value;
    const actual = resolveActualMode(sessionId, config);
    const request = { sessionId, seq, text: parts.body, config, mode: actual.mode };
    if (actual.seed) request.seed = true;
    if (actual.memory) request.memory = actual.memory;
    if (session.optimized && actual.memory && actual.memory.rounds.length > 0) request.continue = true;

    host.call(RPC_METHODS.ENHANCE, request).then((response) => {
      if (seq !== session.seq) return;
      const result = response && typeof response === 'object' ? response : {};
      const resultStatus = resultStatusOf({ ok: result.ok === true, text: result.text, before: session.backup, skipped: result.skipped === true });

      if (result.ok && typeof result.text === 'string' && result.text !== '') {
        const sessionChanged = getActiveSession() !== sessionId;
        if (!sessionChanged && draftRef.current !== session.backup) {
          // 增强期间用户已编辑草稿：迟到结果丢弃，不写记忆、不打优化标记。
          session.phase = 'idle';
          session.enhanced = '';
          session.error = null;
          clearResultStore(sessionId);
        } else {
          const finalText = parts.prefix + result.text;
          if (!sessionChanged) safeSetDraft(inputActions, finalText);
          saveResultStore(sessionId, session.backup, finalText);
          session.phase = 'result';
          session.enhanced = finalText;
          session.error = null;
          session.optimized = true;
          session.lastModel = result.model || '';
          session.fallbackUsed = result.fallbackUsed === true;
          session.degraded = Array.isArray(result.degraded) ? result.degraded.slice(0, 12) : [];
          session.truncated = result.truncated === true;
          session.resultStatus = resultStatus;

          if (config.memory) {
            session.memoryRounds.push({ input: parts.body, output: result.text });
            if (session.memoryRounds.length > MEMORY_ROUNDS_MAX) session.memoryRounds.shift();
            writeSeen(sessionId);
          }
        }
      } else {
        safeSetDraft(inputActions, session.backup);
        session.phase = 'idle';
        session.enhanced = '';
        session.error = result.code && errorKey(result.code) !== 'errUNKNOWN' ? result.code : 'UNKNOWN';
        clearResultStore(sessionId);
      }
      notify(sessionId);
    }).catch(() => {
      if (seq !== session.seq) return;
      safeSetDraft(inputActions, session.backup);
      session.phase = 'idle';
      session.enhanced = '';
      session.error = 'NETWORK';
      clearResultStore(sessionId);
      notify(sessionId);
    });
  }

  function undo(sessionId, inputActions) {
    const session = storeFor(sessionId);
    if (session.phase !== 'result') return;
    safeSetDraft(inputActions, session.backup);
    session.phase = 'idle';
    session.enhanced = '';
    session.error = null;
    session.degraded = [];
    session.truncated = false;
    session.memoryRounds.pop();
    session.optimized = false;
    clearResultStore(sessionId);
    notify(sessionId);
  }

  function guardPasses(draft, input) {
    if (typeof draft !== 'string') return false;
    const normalized = draft.trim();
    if (normalized === '') return false;
    if (normalized.startsWith('/') && !/^\/\S+\s+\S+/.test(normalized)) return false;
    if (!input) return false;
    if (input.phase === 'adjudicating' || input.phase === 'submitting') return false;
    return true;
  }

  return {
    dshEnhId,
    errorKey,
    makeT,
    sessionStores,
    storeFor,
    seenKey,
    writeSeen,
    clearSeen,
    subscribe,
    notify,
    setActiveSession,
    getActiveSession,
    resultKey,
    saveResultStore,
    clearResultStore,
    isEnhancing,
    releaseStoreIfIdle,
    safeSetDraft,
    cancelEnhance,
    splitCommand,
    resolveActualMode,
    prettifyModel,
    enhance,
    undo,
    guardPasses,
  };
}

module.exports = { createClientHelpers };
