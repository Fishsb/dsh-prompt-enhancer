'use strict';

// 设置页模型配置组件普通模块（构建期由客户端运行时内联）。
// 迁移只改变代码载体；组件行为、文案、类名与 ARIA 不变。
function createModelMainSection(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const React = d.React;
  const CollapsibleSection = d.CollapsibleSection;
  const makeT = d.makeT;
  const host = d.host;
  const DEFAULT_MODEL_CHAIN = d.DEFAULT_MODEL_CHAIN;
  const getLastDraft = d.getLastDraft;
  const timerSvc = d.timerSvc;
function ModelMainSection(props) {
  const t = makeT(props);
  const providers = props.providers;
  const fallback = props.fallback || [];
  const candidates = props.candidates || [];
  const saveFallback = props.saveFallback;
  // F1（配置卫生）：失效条目 = 不在候选（内置+自定义）中的 provider/model（DSH 侧禁用/模型下线/旧版本残留）
  const invalidIndexes = [];
  fallback.forEach((entry, i) => {
    if (!candidates.some((c) => c.provider === entry.provider && c.model === entry.model)) invalidIndexes.push(i);
  });
  const removeInvalid = () => {
    const next = fallback.filter((entry) => candidates.some((c) => c.provider === entry.provider && c.model === entry.model));
    if (next.length !== fallback.length) saveFallback(next);
    setTestState(null);
  };
  // 测试集中单点状态：{ index, entry, phase:'testing'|'done', result } | null
  const [testState, setTestState] = React.useState(null);

  const addModel = () => {
    const next = fallback.slice();
    const pick = candidates.find((c) => !next.some((x) => x.provider === c.provider && x.model === c.model));
    if (!pick) return;
    next.unshift({ provider: pick.provider, model: pick.model }); // 默认添加到第一个位置（用户需求 2026-08-20）
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
    const removed = next[index];
    next.splice(index, 1);
    saveFallback(next);
    // F5（配置卫生）：测试区按条目身份清空——仅当删除的是被测试条目（删除其他行不再串行错标）
    if (testState && removed && testState.key === removed.provider + '/' + removed.model) setTestState(null);
  };
  const restore = () => {
    // v3.2（用户需求）：恢复默认 → 官方两个模型（1 Flash、2 Pro），可删除可改；
    // 不再走 autochain（恢复默认的语义 = 官方默认链）；增强时链为空仍报 NO_MODEL（非兜底）
    saveFallback(DEFAULT_MODEL_CHAIN.map((b) => ({ provider: b.provider, model: b.model })));
    setTestState(null);
  };
  // v23（D4）：单点测试——点某行 ⛓ → 结果区集中显示该行测试；行内不注入结果
  // v3.1.4（预计耗时）：测试成功后并行读取该模型的 DSH 历史统计，按当前输入长度估算基础模式默认模板耗时。
  // v3.1.5（双模式参考）：同时展示基础模式（默认模板）与轻量模式两个预计耗时；lite 缺失时显示占位。
  // v3.1.6（单位修复）：TTFT 是毫秒，独立用 fmtEstMs 格式化（此前误用 fmtEstSeconds 把毫秒当秒 → 离谱的 78m25s）。
  const fmtEstSeconds = (sec) => {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return '';
    if (sec < 60) return (Math.round(sec * 10) / 10) + 's';
    const whole = Math.round(sec);
    return Math.floor(whole / 60) + 'm' + (whole % 60) + 's';
  };
  const fmtEstMs = (ms) => {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
    if (ms < 1000) return Math.round(ms) + 'ms';
    return fmtEstSeconds(ms / 1000);
  };
  const fmtTps = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
  };
  const fmtModeSeconds = (sec) => {
    const s = fmtEstSeconds(sec);
    return s === '' ? '—' : s;
  };
  const runTest = (index, entry) => {
    if (!entry || !entry.provider || !entry.model) return;
    const key = entry.provider + '/' + entry.model;
    const inputChars = (getLastDraft() || '').length;
    setTestState({ key, index, entry, phase: 'testing', result: null, live: null, hist: { loading: true } });

    // 实测：本次测试测量
    host.call('models/test', { provider: entry.provider, model: entry.model, inputChars }).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      setTestState((prev) => (prev && prev.key === key
        ? {
            ...prev,
            phase: 'done',
            result: r.ok ? { ok: true, latencyMs: r.latencyMs } : { ok: false, message: r.message || r.code || '' },
            live: r.ok && Number.isFinite(r.estimatedBaseSeconds)
              ? {
                  ok: true,
                  ttftMs: r.ttftMs,
                  tokensPerSecond: r.tokensPerSecond,
                  estimateBase: r.estimatedBaseSeconds,
                  estimateLite: Number.isFinite(r.estimatedLiteSeconds) ? r.estimatedLiteSeconds : null,
                }
              : (r.ok ? { ok: true } : { ok: false, message: r.message || r.code || '' }),
          }
        : prev));
    }).catch(() => {
      setTestState((prev) => (prev && prev.key === key
        ? { ...prev, phase: 'done', result: { ok: false, message: t('errNETWORK') }, live: { ok: false, message: t('errNETWORK') } }
        : prev));
    });

    // 历史：始终读取，与实测分开标注
    const applyHist = (sr) => {
      const s = sr && typeof sr === 'object' ? sr : {};
      const valid = s.ok && typeof s.estimatedBaseSeconds === 'number' && Number.isFinite(s.estimatedBaseSeconds);
      setTestState((prev) => (prev && prev.key === key
        ? {
            ...prev,
            hist: valid
              ? {
                  value: {
                    ttftMs: s.ttftMs,
                    tokensPerSecond: s.tokensPerSecond,
                    estimateBase: s.estimatedBaseSeconds,
                    estimateLite: Number.isFinite(s.estimatedLiteSeconds) ? s.estimatedLiteSeconds : null,
                  },
                  unavailable: false,
                }
              : { value: null, unavailable: true },
          }
        : prev));
    };
    const histP = host.call('models/stats', { provider: entry.provider, model: entry.model, inputChars });
    if (timerSvc && typeof timerSvc.timeout === 'function') {
      let dispose = null;
      const timeoutP = new Promise((resolve) => { dispose = timerSvc.timeout(() => resolve({ ok: false, code: 'STATS_TIMEOUT' }), 8000); });
      Promise.race([histP, timeoutP]).then((sr) => { if (dispose) dispose(); applyHist(sr); }).catch(() => {
        if (dispose) dispose();
        setTestState((prev) => (prev && prev.key === key ? { ...prev, hist: { value: null, unavailable: true } } : prev));
      });
    } else {
      histP.then(applyHist).catch(() => {
        setTestState((prev) => (prev && prev.key === key ? { ...prev, hist: { value: null, unavailable: true } } : prev));
      });
    }
  };

  // v23：摘要 = 模型数 + 按序尝试（不再有「主模型」指向）
  const summary = fallback.length > 0 ? t('secFallbackCount').replace('{n}', String(fallback.length)) : t('secFallbackEmpty');
  let body;
  if (providers === null) {
    body = React.createElement('p', { className: 'dsh-plg-note' }, t('pluginsClientPending'));
  } else if (providers.length === 0) {
    body = React.createElement('p', { className: 'dsh-plg-note' }, t('cfgNoProvider'));
  } else {
    // 测试结果集中区（链列表下方、操作按钮上方；空态隐藏）
    let testArea = null;
    if (testState) {
      const p = providers.find((x) => x.provider === testState.entry.provider);
      const curIndex = fallback.findIndex((x) => x.provider === testState.entry.provider && x.model === testState.entry.model);
      const label = '测试 #' + String((curIndex >= 0 ? curIndex : testState.index) + 1) + ' · ' + (p && p.name ? p.name : testState.entry.provider) + ' / ' + testState.entry.model;
      let resultNode;
      let headStatusNode = null;
      if (testState.phase === 'testing') {
        resultNode = React.createElement('span', { className: 'dsh-plg-muted' }, t('cfgTesting'));
      } else {
        const parts = [];
        const result = testState.result || {};
        const live = testState.live;
        const hist = testState.hist || { loading: true };
        // v3.1.8（布局）：✓ 可用/✗ 失败移入头部行（与「测试 #N」同行）；实测/历史各占一行。
        if (result.ok) {
          headStatusNode = React.createElement('span', { className: 'dsh-plg-test-ok' }, t('cfgTestOk').replace('{ms}', String(result.latencyMs)));
        } else {
          headStatusNode = React.createElement('span', { className: 'dsh-plg-test-fail' }, t('cfgTestFail').replace('{msg}', result.message || (live && live.message) || ''));
        }
        if (live) {
          if (live.ok && typeof live.estimateBase === 'number' && Number.isFinite(live.estimateBase)) {
            parts.push(React.createElement('div', { className: 'dsh-plg-test-live' }, t('cfgMeasureLive').replace('{ttft}', fmtEstMs(live.ttftMs)).replace('{tps}', fmtTps(live.tokensPerSecond)).replace('{base}', fmtEstSeconds(live.estimateBase)).replace('{lite}', fmtModeSeconds(live.estimateLite))));
          } else if (live.ok) {
            parts.push(React.createElement('div', { className: 'dsh-plg-test-live' }, t('cfgMeasureLiveOk')));
          } else {
            parts.push(React.createElement('div', { className: 'dsh-plg-test-live dsh-plg-test-fail' }, t('cfgMeasureLiveFail').replace('{msg}', live.message || '')));
          }
        }
        if (hist.loading) {
          parts.push(React.createElement('div', { className: 'dsh-plg-muted' }, t('cfgTesting')));
        } else if (hist.value && typeof hist.value.estimateBase === 'number' && Number.isFinite(hist.value.estimateBase)) {
          parts.push(React.createElement('div', { className: 'dsh-plg-test-hist' }, t('cfgMeasureHist').replace('{ttft}', fmtEstMs(hist.value.ttftMs)).replace('{tps}', fmtTps(hist.value.tokensPerSecond)).replace('{base}', fmtEstSeconds(hist.value.estimateBase)).replace('{lite}', fmtModeSeconds(hist.value.estimateLite))));
        } else {
          parts.push(React.createElement('div', { className: 'dsh-plg-muted' }, t('cfgMeasureHistEmpty')));
        }
        resultNode = React.createElement('div', { className: 'dsh-plg-testresults' }, ...parts);
      }
      testArea = React.createElement('div', { className: 'dsh-plg-testarea', role: 'status' },
        React.createElement('div', { className: 'dsh-plg-testarea-head' },
          React.createElement('span', { className: 'dsh-plg-testarea-title' }, label),
          headStatusNode,
          React.createElement('button', {
            type: 'button',
            className: 'dsh-plg-btn dsh-plg-btn-icononly',
            onClick: () => setTestState(null),
            title: t('dismiss'),
            'aria-label': t('dismiss'),
          }, '✕'),
        ),
        resultNode,
      );
    }
    body = React.createElement(React.Fragment, null,
      fallback.map((entry, index) => React.createElement(FallbackRow, {
        key: index,
        t: t,
        entry: entry,
        index: index,
        count: fallback.length,
        providers: providers,
        candidates: candidates,
        testing: !!(testState && testState.key === entry.provider + '/' + entry.model && testState.phase === 'testing'),
        invalid: invalidIndexes.includes(index),
        onChange: (e) => updateEntry(index, e),
        onMove: (d) => move(index, d),
        onRemove: () => remove(index),
        onTest: () => runTest(index, entry),
      })),
      fallback.length === 0 ? React.createElement('p', { className: 'dsh-plg-note' }, t('secFallbackEmpty')) : null,
      invalidIndexes.length > 0 ? React.createElement('p', { className: 'dsh-plg-note' }, t('cfgChainHasInvalid')) : null,
      testArea,
      React.createElement('div', { className: 'dsh-plg-row' },
        React.createElement('span', { className: 'dsh-plg-num', style: { visibility: 'hidden' } }),
        React.createElement('button', { type: 'button', className: 'dsh-plg-btn', onClick: addModel }, t('cfgAddFallback')),
        React.createElement('button', { type: 'button', className: 'dsh-plg-btn', onClick: restore }, t('cfgRestoreDefaults')),
        invalidIndexes.length > 0 ? React.createElement('button', { type: 'button', className: 'dsh-plg-btn', onClick: removeInvalid }, t('cfgRemoveInvalid')) : null,
      ),
      React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgRestoreNote')),
            // 2026-08-18（用户需求）：任一模型开启思考 → 模型配置栏最下面红色提醒高推理强度耗时
      fallback.some((e) => e && e.reasoning && e.reasoning.enabled === true)
        ? React.createElement('p', { className: 'dsh-plg-reasoning-warn' }, t('cfgReasoningWarn'))
        : null,
    );
  }
  return React.createElement(CollapsibleSection, { title: t('secMain'), summary }, body);
}

// 模型链条目行（v23：统一格式——序号 + 厂家/模型双联动下拉 + 思考开关/等级 + 测试触发 + ↑↓✕；
// 测试结果不注入行内，由父级单点集中显示）

  return ModelMainSection;
}

module.exports = { createModelMainSection };
