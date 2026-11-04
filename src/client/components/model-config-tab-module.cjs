'use strict';

const { RPC_METHODS } = require('../../shared/contracts/rpc.cjs');

// 设置页模型配置 tab 普通模块（构建期由客户端运行时内联）。
// 只改变代码载体；请求、继承、失效清理与可见行为不变。
function createModelConfigTab(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const React = d.React;
  const makeT = d.makeT;
  const configState = d.configState;
  const subscribeConfig = d.subscribeConfig;
  const host = d.host;
  const DEFAULT_MODEL_CHAIN = d.DEFAULT_MODEL_CHAIN;
  const saveConfig = d.saveConfig;
  const buildCandidates = d.buildCandidates;
  const ModelMainSection = d.ModelMainSection;
  const VoiceSection = d.VoiceSection;

function ModelConfigTab(props) {
  const t = makeT(props);
  const [providers, setProviders] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [inherited, setInherited] = React.useState(false);

  React.useEffect(() => {
    let providersReady = false;
    let inheritedDone = false;
    let off = null;
    const maybeInherit = () => {
      if (!providersReady || inheritedDone) return;
      if (configState.fresh && configState.hostSync === true && configState.value.fallback.length === 0) {
        inheritedDone = true;
        host.call(RPC_METHODS.MODELS_CURRENT).then((res2) => {
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
          chain = fill(DEFAULT_MODEL_CHAIN.map((x) => ({ provider: x.provider, model: x.model })));
          if (chain.length > 0) {
            saveConfig({ fallback: chain });
            configState.fresh = false;
            setInherited(true);
          }
        }).catch(() => {});
      }
    };
    off = subscribeConfig(maybeInherit);
    host.call(RPC_METHODS.MODELS_LIST).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      if (r.ok && Array.isArray(r.providers)) {
        setProviders(r.providers);
        try {
          const cand = buildCandidates(r.providers, configState.value.customModels, configState.value.order);
          const keep = configState.value.order.filter((k) => cand.some((c) => c.provider + '/' + c.model === k));
          if (keep.length !== configState.value.order.length) saveConfig({ order: keep });
        } catch (e) { /* 清理失败静默（下次打开再试） */ }
        providersReady = true;
        maybeInherit();
      } else {
        setError(t('cfgLoadFailed'));
      }
    }).catch(() => setError(t('cfgLoadFailed')));
    return () => { if (off) off(); };
  }, []);

  const cfg = configState.value;
  const candidates = buildCandidates(providers, cfg.customModels, cfg.order);
  const saveFallback = (fallback) => saveConfig({ fallback });

  return React.createElement(React.Fragment, null,
    error ? React.createElement('div', { className: 'dsh-plg-error', role: 'status' }, error) : null,
    configState.unsupported ? React.createElement('p', { className: 'dsh-plg-note dsh-plg-inherit' }, t('cfgNewerVersion')) : null,
    inherited ? React.createElement('p', { className: 'dsh-plg-note dsh-plg-inherit' }, t('cfgInherited')) : null,
    React.createElement(ModelMainSection, { t: t, providers: providers, fallback: cfg.fallback, candidates: candidates, saveFallback: saveFallback }),
    React.createElement(VoiceSection, { t: t }),
  );
}

  return ModelConfigTab;
}

module.exports = { createModelConfigTab };
