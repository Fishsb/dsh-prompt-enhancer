'use strict';

// 增强按钮普通组件（构建期由客户端运行时内联）。
// 依赖通过工厂显式注入；所有文案、ARIA、类名、状态优先级与行为不变。
function createEnhanceButton(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const rpcMethods = d.rpcMethods && typeof d.rpcMethods === 'object' ? d.rpcMethods : {};
  const React = d.React;
  const makeT = d.makeT;
  const dshEnhId = d.dshEnhId;
  const subscribe = d.subscribe;
  const storeFor = d.storeFor;
  const notify = d.notify;
  const releaseStoreIfIdle = d.releaseStoreIfIdle;
  const setLastDraft = d.setLastDraft;
  const subscribeConfig = d.subscribeConfig;
  const subscribeCorrection = d.subscribeCorrection;
  const subscribeVoiceConfig = d.subscribeVoiceConfig;
  const setActiveSession = d.setActiveSession;
  const getActiveSession = d.getActiveSession;
  const safeSetDraft = d.safeSetDraft;
  const clearResultStore = d.clearResultStore;
  const clearSeen = d.clearSeen;
  const guardPasses = d.guardPasses;
  const saveConfig = d.saveConfig;
  const configState = d.configState;
  const enhance = d.enhance;
  const cancelEnhance = d.cancelEnhance;
  const undo = d.undo;
  const modeShortLabel = d.modeShortLabel;
  const prettifyModel = d.prettifyModel;
  const timerSvc = d.timerSvc;
  const host = d.host;
  const correctionSnapshot = d.correctionSnapshot;
  const correctionPhaseOf = d.correctionPhaseOf;
  const CORRECTION_PHASES = d.CORRECTION_PHASES;
  const correctionFailureTicket = d.correctionFailureTicket;
  const consumeCorrectionFailure = d.consumeCorrectionFailure;
  const correctionPhaseView = d.correctionPhaseView;

  // 迁移可测性：保持旧 chunk 的顶层返回值形态，供现有行为测试按真实源码求值。
  function createEnhanceButtonFromLegacy(sourceDeps) {
    return createEnhanceButton(sourceDeps);
  }

function EnhanceButton(props) {
  const t = makeT(props);
  const useSessionHook = typeof props.useSession === 'function' ? props.useSession : null;
  const useInputHook = typeof props.useInput === 'function' ? props.useInput : null;
  const sessionSnap = useSessionHook ? useSessionHook((s) => s) : null;
  const inputSnap = useInputHook ? useInputHook((s) => s) : null;
  const sessionId = (sessionSnap && sessionSnap.sessionId) || (props.session && props.session.sessionId) || props.sessionId;
  const input = inputSnap || props.input || {};
  const draft = typeof input.draft === 'string' ? input.draft : '';
  const inputActions = props.inputActions;

  const inputActionsRef = React.useRef(inputActions);
  inputActionsRef.current = inputActions;
  const [, setVersion] = React.useState(0);
  const draftRef = React.useState({ current: draft })[0];
  draftRef.current = draft;

  React.useEffect(() => { setLastDraft(draft); }, [draft]);
  React.useEffect(() => subscribe(sessionId, () => setVersion((v) => v + 1)), [sessionId]);

  const [, setCfg] = React.useState(0);
  React.useEffect(() => subscribeConfig(() => setCfg((v) => v + 1)), []);
  const [, setCorr] = React.useState(0);
  React.useEffect(() => {
    const offs = [];
    if (typeof subscribeCorrection === 'function') offs.push(subscribeCorrection(() => setCorr((v) => v + 1)));
    if (typeof subscribeVoiceConfig === 'function') offs.push(subscribeVoiceConfig(() => setCorr((v) => v + 1)));
    return function () {
      for (const off of offs) {
        try { off(); } catch (e) { /* 单个订阅者失败不影响其余 */ }
      }
    };
  }, []);
  React.useEffect(() => {
    setActiveSession(sessionId);
    return () => { if (getActiveSession() === sessionId) setActiveSession(null); };
  }, [sessionId]);

  React.useEffect(() => {
    const s = storeFor(sessionId);
    if (!s || s.phase !== 'result') return;
    if (draft === s.enhanced) return;
    if (s.backup !== '' && draft === s.backup) {
      safeSetDraft(inputActionsRef.current, s.enhanced);
      notify(sessionId);
      return;
    }
    s.phase = 'idle';
    s.enhanced = '';
    s.error = null;
    clearResultStore(sessionId);
    notify(sessionId);
  }, [draft, sessionId]);

  const sendSeenRef = React.useRef(false);
  React.useEffect(() => {
    const ph = input && typeof input.phase === 'string' ? input.phase : '';
    if (ph === 'submitting' || ph === 'adjudicating') {
      sendSeenRef.current = true;
    } else if (typeof draft === 'string' && draft.trim() !== '') {
      sendSeenRef.current = false;
    }
    if (typeof draft !== 'string' || draft.trim() !== '') return;
    const s = storeFor(sessionId);
    if (s.optimized === true) {
      s.optimized = false;
      notify(sessionId);
    }
    if (sendSeenRef.current === true) {
      sendSeenRef.current = false;
      if (s.memoryRounds.length > 0) {
        s.memoryRounds = [];
        notify(sessionId);
      }
      clearSeen(sessionId);
    }
  }, [draft, input && input.phase, sessionId]);

  React.useEffect(() => () => {
    releaseStoreIfIdle(sessionId);
  }, [sessionId]);

  const s = sessionId !== undefined ? storeFor(sessionId) : null;
  const phase = s ? s.phase : 'idle';
  const HAS_CORRECTION = (typeof correctionSnapshot === 'function' && typeof correctionPhaseOf === 'function'
    && typeof CORRECTION_PHASES === 'object' && CORRECTION_PHASES !== null);
  const corrSnap = HAS_CORRECTION ? correctionSnapshot() : null;
  const corrPhase = (HAS_CORRECTION && corrSnap) ? correctionPhaseOf(corrSnap, sessionId) : (HAS_CORRECTION ? CORRECTION_PHASES.IDLE : 'idle');
  const corrRunning = HAS_CORRECTION && corrPhase === CORRECTION_PHASES.RUNNING;
  const enhanceBusy = (phase === 'enhancing' || phase === 'result');
  const [prog, setProg] = React.useState(null);
  React.useEffect(() => {
    if (sessionId === undefined) return undefined;
    const st = storeFor(sessionId);
    if (st.phase !== 'enhancing') { setProg(null); return undefined; }
    let disposed = false;
    const seq = st.seq;
    setProg(null);
    if (!timerSvc || typeof timerSvc.interval !== 'function') return undefined;
    const disposer = timerSvc.interval(() => {
      host.call(rpcMethods.ENHANCE_PROGRESS, { sessionId, seq }).then((r) => {
        if (disposed || !r || r.ok !== true) return;
        setProg({
          stage: typeof r.stage === 'string' ? r.stage : '',
          detailKey: typeof r.detailKey === 'string' ? r.detailKey : '',
          detailArgs: r.detailArgs && typeof r.detailArgs === 'object' ? r.detailArgs : null,
          step: typeof r.step === 'number' ? r.step : 0,
          total: typeof r.total === 'number' ? r.total : 0,
          elapsedMs: typeof r.elapsedMs === 'number' ? r.elapsedMs : 0,
          degraded: Array.isArray(r.degraded) ? r.degraded.slice(0, 12) : [],
        });
      }).catch(() => { /* 轮询失败静默降级为默认文案 */ });
    }, 500);
    return () => { disposed = true; disposer(); };
  }, [phase, sessionId, s ? s.seq : 0]);

  if (!inputActions || sessionId === undefined) return null;

  let onClick;
  let disabled = false;
  let title;
  let cls = 'dsh-enh-btn';
  const corrTakesOver = corrRunning && !enhanceBusy;
  if (corrTakesOver) { cls = 'dsh-enh-btn dsh-enh-btn-busy dsh-enh-btn-text'; }
  const corrTicket = (corrSnap && typeof correctionFailureTicket === 'function')
    ? String(correctionFailureTicket(corrSnap, sessionId) || '')
    : '';
  const corrFailedFlash = HAS_CORRECTION && (corrPhase === CORRECTION_PHASES.FAILED) && corrTicket !== '' && !enhanceBusy;
  const [flash, setFlash] = React.useState(false);
  var flashTimerRef = React.useRef(null);
  const clearFlashTimer = function () {
    if (flashTimerRef.current) {
      try { flashTimerRef.current(); } catch (e) { /* 已结算 */ }
      flashTimerRef.current = null;
    }
  };
  React.useEffect(function () {
    if (!corrFailedFlash) return;
    if (typeof consumeCorrectionFailure === 'function') {
      try { consumeCorrectionFailure(corrTicket); } catch (e) { /* 状态机拒绝 */ }
    }
    clearFlashTimer();
    var armed = null;
    if (timerSvc && typeof timerSvc.timeout === 'function') {
      armed = timerSvc.timeout(function () { setFlash(false); }, 4000);
    } else if (typeof setTimeout === 'function') {
      var id = setTimeout(function () { setFlash(false); }, 4000);
      armed = function () { try { clearTimeout(id); } catch (e) { return; } };
    } else {
      setFlash(false);
      return;
    }
    flashTimerRef.current = (typeof armed === 'function') ? armed : null;
    setFlash(true);
  }, [corrTicket, corrFailedFlash, sessionId]);
  React.useEffect(function () {
    if (HAS_CORRECTION && corrPhase === CORRECTION_PHASES.FAILED && !enhanceBusy) return;
    setFlash(false);
    clearFlashTimer();
  }, [corrPhase, enhanceBusy, sessionId]);
  if (flash && !corrTakesOver) {
    var flashView = (HAS_CORRECTION && typeof correctionPhaseView === 'function') ? correctionPhaseView(CORRECTION_PHASES.FAILED) : null;
    cls = 'dsh-enh-btn ' + (flashView && flashView.cls ? flashView.cls : 'dsh-enh-btn-text');
  }

  if (phase === 'enhancing') {
    let progText = t('enhancing');
    const st = prog;
    if (st) {
      if (st.stage) {
        if (st.stage === 'llm' && st.step > 0) {
          progText = (st.step > 1 ? t('enhancingModel') : t('enhancing')).replace('{n}', String(st.step));
        } else {
          const key = 'stage' + st.stage.charAt(0).toUpperCase() + st.stage.slice(1);
          const localized = t(key);
          if (localized !== key) progText = localized;
        }
      }
      if (st.detailKey && st.stage !== 'llm') {
        const dkey = 'stageDetail' + st.detailKey.charAt(0).toUpperCase() + st.detailKey.slice(1);
        let tmpl = t(dkey);
        if (tmpl !== dkey) {
          const a = st.detailArgs || {};
          const cur = a.current != null ? a.current : st.step;
          const tot = a.total != null ? a.total : st.total;
          tmpl = tmpl
            .replace('{current}', String(cur != null ? cur : ''))
            .replace('{total}', String(tot != null ? tot : ''))
            .replace('{query}', String(a.query != null ? a.query : ''));
          progText = tmpl;
        }
      }
      if (st.degraded && st.degraded.length > 0) progText = '⚠ ' + progText;
    }
    onClick = () => cancelEnhance(sessionId, inputActions);
    title = t('titleBusy');
    cls += ' dsh-enh-btn-busy dsh-enh-btn-text';
    return React.createElement('button', {
      type: 'button',
      className: cls,
      onClick,
      title,
      tabIndex: -1,
      'aria-label': t('enhanceButton'),
    },
      React.createElement('span', { className: 'dsh-enh-spin', 'aria-hidden': true }),
      React.createElement('span', { className: 'dsh-enh-status', 'aria-hidden': true },
        React.createElement('span', { className: 'dsh-enh-progress' }, progText),
        React.createElement('span', { className: 'dsh-enh-cancel' }, t('cancel')),
      ),
    );
  }
  if (phase === 'result') {
    onClick = () => undo(sessionId, inputActions);
    title = (s && ((s.degraded && s.degraded.length > 0) || s.truncated === true))
      ? t('degradedPrefix') + t('degradedHint')
      : t('titleResult');
    cls += ' dsh-enh-btn-result dsh-enh-btn-text';
  } else {
    const ok = guardPasses(draft, input);
    const empty = draft.trim() === '';
    if (empty) {
      disabled = false;
      onClick = () => { saveConfig({ memory: !configState.value.memory }); };
      title = configState.value.memory ? t('titleMemoryOn') : t('titleMemoryOff');
    } else {
      disabled = !ok;
      onClick = () => {
        if (!guardPasses(draft, input)) return;
        enhance(sessionId, draft, inputActions, draftRef);
      };
      const isContinue = !!s && s.optimized === true;
      title = ok ? (isContinue ? t('titleContinue') : t('titleIdle'))
        : draft.startsWith('/') ? t('titleCommand')
        : t('titleBusyInput');
    }
    cls += ' dsh-enh-btn-text';
  }

  return React.createElement('button', {
    type: 'button',
    className: cls,
    onClick,
    disabled,
    title,
    tabIndex: -1,
    'aria-label': t('enhanceButton'),
  },
    corrTakesOver
      ? React.createElement(React.Fragment, null,
          React.createElement('span', { className: 'dsh-enh-spin', 'aria-hidden': true }),
          React.createElement('span', { className: 'dsh-enh-status', 'aria-hidden': true },
            React.createElement('span', { className: 'dsh-enh-progress' }, t('voiceCorrectionRunningOnButton')),
          ),
        )
      : flash
        ? React.createElement('span', { className: 'dsh-enh-mode' }, t('voiceCorrectionFailedOnButton'))
        : React.createElement(React.Fragment, null,
            phase === 'result' ? null
            : (s && s.optimized === true)
            ? React.createElement('span', { className: 'dsh-enh-mode' }, t('btnContinue'))
            : React.createElement(React.Fragment, null,
            React.createElement('span', {
            className: 'dsh-enh-icon' + (configState.value.memory === true ? '' : ' dsh-enh-icon-dim'),
            'aria-hidden': true,
            }, '✨'),
            React.createElement('span', { className: 'dsh-enh-mode' }, modeShortLabel(t, configState.value.mode)),
            ),
            phase === 'result' ? (s && s.fallbackUsed === true && s.lastModel ? t('resultFallback').replace('{model}', prettifyModel(s.lastModel)) : t('result')) : null,
          ),
  );
}

  return EnhanceButton;
}

module.exports = { createEnhanceButton };
