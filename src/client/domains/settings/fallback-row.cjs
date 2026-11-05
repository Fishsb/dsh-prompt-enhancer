'use strict';

const { RPC_METHODS } = require('../../../shared/contracts/rpc.cjs');

// 设置页模型配置组件普通模块（构建期由客户端运行时内联）。
// 迁移只改变代码载体；组件行为、文案、类名与 ARIA 不变。
function createFallbackRow(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const React = d.React;
  const MarqueeSelect = d.MarqueeSelect;
  const makeT = d.makeT;
  const host = d.host;
function FallbackRow(props) {
  const t = makeT(props);
  const entry = props.entry;
  const index = props.index;
  const count = props.count;
  const providers = props.providers;       // [{provider, name, models:[{id,name}]}]
  const candidates = props.candidates;     // 跨厂家候选（含自定义，兼容存量）
  const testing = props.testing;           // 本行是否测试中（父级单点状态）
  const invalid = props.invalid;           // F1：本行是否失效（不在候选列表中）
  const onChange = props.onChange;
  const onMove = props.onMove;
  const onRemove = props.onRemove;
  const onTest = props.onTest;
  const [reasoning, setReasoning] = React.useState(null);

  React.useEffect(() => {
    setReasoning(null);
    if (!entry.provider || !entry.model) return;
    let cancelled = false;
    // F1（配置卫生）：已启用思考的条目用 noCache 取新鲜能力表，用于 effort 纠偏
    const needFresh = !!(entry.reasoning && entry.reasoning.enabled === true);
    host.call(RPC_METHODS.MODELS_RESOLVE, { provider: entry.provider, model: entry.model, ...(needFresh ? { noCache: true } : {}) }).then((res) => {
      if (cancelled) return;
      const r = res && typeof res === 'object' ? res : {};
      const meta = r.ok && r.reasoning && r.reasoning.efforts && r.reasoning.efforts.length > 0 ? r.reasoning : null;
      if (meta) setReasoning(meta);
      // F1（配置卫生）：effort 自动纠偏——存储 effort 不在模型能力列表 → 修正为默认等级；
      // 模型不支持思考但存储仍启用 → 移除 reasoning（防止失效 effort 随请求发送给 LLM）
      if (r.ok && entry.reasoning && entry.reasoning.enabled === true) {
        if (meta) {
          const valid = meta.efforts.some((e) => String(e.id) === entry.reasoning.effort);
          if (!valid) onChange({ ...entry, reasoning: { enabled: true, effort: String(meta.defaultEffort || meta.efforts[0].id) } });
        } else {
          const fix = { ...entry };
          delete fix.reasoning;
          onChange(fix);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [entry.provider, entry.model]);

  const effortOn = !!(entry.reasoning && entry.reasoning.enabled);
  const levelOptions = reasoning ? reasoning.efforts.map((e) => React.createElement('option', { key: e.id, value: e.id }, e.name)) : [];
  const levelValue = effortOn ? entry.reasoning.effort : (reasoning ? (reasoning.defaultEffort || reasoning.efforts[0].id) : '');

  // v22（C4）/v23：按厂家区分——厂家下拉选项 = providers；模型下拉 = 当前厂家模型 + 该厂家自定义候选
  const currentProvider = providers && providers.find((p) => p.provider === entry.provider);
  const modelOptions = (currentProvider ? currentProvider.models || [] : [])
    .concat(candidates ? candidates.filter((c) => c.custom && c.provider === entry.provider).map((c) => ({ id: c.model, name: c.name })) : []);
  const onProviderChange = (e) => {
    const provider = e.target.value;
    const p = providers && providers.find((x) => x.provider === provider);
    const first = p && p.models && p.models[0] ? p.models[0].id : '';
    // F1（配置卫生）：切换厂家/模型保留 reasoning（不硬重置）——新模型能力纠偏由 resolve effect 接管
    onChange({ ...entry, provider, model: first });
  };

  return React.createElement('div', { className: 'dsh-plg-row' },
    React.createElement('span', { className: 'dsh-plg-muted dsh-plg-num' }, String(index + 1)),
    // 2026-10-19（清债批 D-2）：原 'dsh-plg-badge-invalid' 是**孤儿类**（styles.js 解码全文零规则，
    //   且无 querySelector 依赖）⇒ 该类名不承担任何视觉表达；『当前不可用』的可见标识由本节点自身承载：
    //   ① 内容字形 '⚠' ② title=cfgRowInvalid（悬停/读屏可读）③ 既有类 dsh-plg-upd-outdated 的告警色。
    //   ⛔ 不得删除本节点本身 —— 那会让『无效』变得不可见（产品语义）。
    invalid ? React.createElement('span', { className: 'dsh-plg-upd-outdated', title: t('cfgRowInvalid') }, '⚠') : null,
    React.createElement(MarqueeSelect, {
      className: 'dsh-plg-select dsh-plg-select-provider',
      value: entry.provider || '',
      onChange: onProviderChange,
      children: (providers || []).map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.name || p.provider)),
    }),
    // 2026-10-18（最小改动批 · 模型名截断）：窄行里模型名会被 mselect 的 ellipsis 裁掉，
    //   用户无法确认选的是哪个模型 ⇒ 用 title 承载**完整名**（悬停可见）。
    //   ⚠ 只加 title：不改名称、不改宽度、不改整行分配。
    React.createElement(MarqueeSelect, {
      className: 'dsh-plg-select dsh-plg-select-model',
      value: entry.model || '',
      title: (function () {
        var hit = modelOptions.filter(function (mm) { return mm.id === entry.model; })[0];
        return hit ? (hit.name || hit.id) : (entry.model || '');
      })(),
      onChange: (e) => onChange({ ...entry, model: e.target.value }),
      children: modelOptions.map((m) => React.createElement('option', { key: m.id, value: m.id }, m.name || m.id)),
    }),
    reasoning
      ? React.createElement(React.Fragment, null,
          React.createElement(MarqueeSelect, {
            className: 'dsh-plg-select dsh-plg-select-thinking',
            // 2026-08-18（用户需求）：思考开关 hover 提示（简要介绍）
            title: t('selThinking'),
            value: effortOn ? 'on' : 'off',
            onChange: (e) => {
              const next = e.target.value === 'on';
              if (next) onChange({ ...entry, reasoning: { enabled: true, effort: (reasoning.defaultEffort || (reasoning.efforts[0] && reasoning.efforts[0].id) || '') } });
              else { const fix = { ...entry }; delete fix.reasoning; onChange(fix); } // F7：关闭思考不再写 {enabled:false} 冗余
            },
            children: [React.createElement('option', { key: 'off', value: 'off' }, t('cfgReasoningOff')), React.createElement('option', { key: 'on', value: 'on' }, t('cfgReasoningOn'))],
          }),
          React.createElement(MarqueeSelect, {
            className: 'dsh-plg-select dsh-plg-select-level',
            value: levelValue,
            disabled: !effortOn,
            onChange: (e) => onChange({ ...entry, reasoning: { enabled: true, effort: e.target.value } }),
            children: levelOptions,
          }),
        )
      : null,
    // v23（D4）：测试触发图标（结果由父级集中显示）
    React.createElement('button', {
      type: 'button',
      className: 'dsh-plg-btn dsh-plg-btn-icononly dsh-plg-testicon',
      disabled: testing || !entry.provider || !entry.model,
      onClick: onTest,
      title: t('cfgTest'),
      'aria-label': t('cfgTest'),
    }, testing ? '…' : '⛓'),
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', disabled: index === 0, onClick: () => onMove(-1), title: t('rowUp'), 'aria-label': t('rowUp') }, '↑'),
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', disabled: index === count - 1, onClick: () => onMove(1), title: t('rowDown'), 'aria-label': t('rowDown') }, '↓'),
    React.createElement('button', { type: 'button', className: 'dsh-plg-btn dsh-plg-btn-icononly', onClick: onRemove, title: t('rowRemove'), 'aria-label': t('rowRemove') }, '✕'),
  );
}
// 模型配置 tab（v18：helpers + fresh install 继承 + 四区块）
// @dsh-client-model-helpers-inject


  return FallbackRow;
}

module.exports = { createFallbackRow };
