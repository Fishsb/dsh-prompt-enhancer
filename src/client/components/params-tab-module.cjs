'use strict';

const { RPC_METHODS } = require('../../shared/contracts/rpc.cjs');

// 设置页优化参数 tab 普通模块（构建期由客户端运行时内联）。
// 依赖由构建器显式注入；所有可见文案、ARIA、类名与配置写入不变。
function createParamsTab(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const React = d.React;
  const MarqueeSelect = d.MarqueeSelect;
  const makeT = d.makeT;
  const dshEnhId = d.dshEnhId;
  const configState = d.configState;
  const saveConfig = d.saveConfig;
  const host = d.host;
  const MODE_OPTIONS = d.MODE_OPTIONS;
  const MODE_TIMEOUT_OPTIONS = d.MODE_TIMEOUT_OPTIONS;
  const MODE_MAXTOKENS_OPTIONS = d.MODE_MAXTOKENS_OPTIONS;
  const MODE_OUTPUTLIMIT_OPTIONS = d.MODE_OUTPUTLIMIT_OPTIONS;
  const MODE_BUDGET_OPTIONS = d.MODE_BUDGET_OPTIONS;
  const MODE_PARAMS_DEFAULT = d.MODE_PARAMS_DEFAULT;
  const MODE_BUDGET_DEFAULT = d.MODE_BUDGET_DEFAULT;
  const modeShortLabel = d.modeShortLabel;
  const modeLabel = d.modeLabel;
  const TEMPLATE_BUILTIN_KEYS = d.TEMPLATE_BUILTIN_KEYS;
  const TEMPLATE_CUSTOM_MAX = d.TEMPLATE_CUSTOM_MAX;
  const TEMPLATE_TEXT_MAX = d.TEMPLATE_TEXT_MAX;
  const TEMPLATE_NAME_MAX = d.TEMPLATE_NAME_MAX;
  const customPickIndex = d.customPickIndex;

function ParamsTab(props) {
  const t = makeT(props);
  const ids = React.useState(() => ({
    mode: dshEnhId('dsh-enh-mode'),
    modeHint: dshEnhId('dsh-enh-mode-hint'),
    tpl: dshEnhId('dsh-enh-tpl'),
    memory: dshEnhId('dsh-enh-memory'),
    memoryHint: dshEnhId('dsh-enh-memory-hint'),
    budget: dshEnhId('dsh-enh-budget'),
    budgetHint: dshEnhId('dsh-enh-budget-hint'),
    timeout: dshEnhId('dsh-enh-timeout'),
    maxTokens: dshEnhId('dsh-enh-maxtokens'),
    outputLimit: dshEnhId('dsh-enh-outputlimit'),
    template: dshEnhId('dsh-enh-template'),
    templateNote: dshEnhId('dsh-enh-template-note'),
    templateName: dshEnhId('dsh-enh-template-name'),
  }))[0];
  const cfg = configState.value;
  const save = (patch) => { saveConfig(patch); };
  const onNumber = (key) => (e) => save({ params: { ...cfg.params, [key]: Number(e.target.value) } });
  const modeTimeoutOptions = MODE_TIMEOUT_OPTIONS[cfg.mode] || MODE_TIMEOUT_OPTIONS.base;
  const modeMaxTokensOptions = MODE_MAXTOKENS_OPTIONS[cfg.mode] || MODE_MAXTOKENS_OPTIONS.base;
  const modeOutputLimitOptions = MODE_OUTPUTLIMIT_OPTIONS[cfg.mode] || MODE_OUTPUTLIMIT_OPTIONS.base;
  const pDef = MODE_PARAMS_DEFAULT[cfg.mode] || MODE_PARAMS_DEFAULT.base;
  const clampParamDisplay = (value, opts, modeDefault) => {
    if (opts.includes(value)) return String(value);
    if (modeDefault !== undefined && opts.includes(modeDefault)) return String(modeDefault);
    const pick = opts.filter((v) => v <= value).pop();
    return String(typeof pick === 'number' ? pick : opts[0]);
  };
  const pickValue = (cfg.template.pick && cfg.template.pick[cfg.mode]) || 'default';
  const customAll = (cfg.template.custom && typeof cfg.template.custom === 'object') ? cfg.template.custom : {};
  const customList = Array.isArray(customAll[cfg.mode]) ? customAll[cfg.mode] : [];
  const pickIdx = customPickIndex(pickValue);
  const pickIsCustom = pickIdx >= 0 && pickIdx < customList.length;
  const curEntry = pickIsCustom ? customList[pickIdx] : null;
  const catalogRef = React.useRef(null);
  const ensureCatalog = React.useCallback(() => {
    if (catalogRef.current !== null) return Promise.resolve(catalogRef.current);
    return host.call(RPC_METHODS.TEMPLATE_DEFAULT).then((res) => {
      const r = res && typeof res === 'object' ? res : {};
      catalogRef.current = (r.ok && r.catalog && typeof r.catalog === 'object') ? r.catalog : {};
      return catalogRef.current;
    }).catch(() => { catalogRef.current = {}; return catalogRef.current; });
  }, []);
  const onSelectTemplate = (v) => save({ template: { ...cfg.template, pick: { ...(cfg.template.pick || {}), [cfg.mode]: v } } });
  const onAddCustom = () => {
    if (customList.length >= TEMPLATE_CUSTOM_MAX) return;
    ensureCatalog().then((cat) => {
      let prefill = '';
      if (curEntry) prefill = curEntry.text || '';
      else if (cat && Array.isArray(cat[cfg.mode])) {
        const bi = TEMPLATE_BUILTIN_KEYS.indexOf(pickValue);
        prefill = cat[cfg.mode][bi >= 0 ? bi : 0] || '';
      }
      const entry = { name: '自定义模板 ' + (customList.length + 1), text: prefill.slice(0, TEMPLATE_TEXT_MAX) };
      const newList = customList.concat(entry);
      save({ template: { ...cfg.template, custom: { ...customAll, [cfg.mode]: newList }, pick: { ...(cfg.template.pick || {}), [cfg.mode]: 'custom:' + (newList.length - 1) } } });
    });
  };
  const onEditCustom = (patch) => {
    const newList = customList.map((c, k) => k === pickIdx ? { ...c, ...patch } : c);
    save({ template: { ...cfg.template, custom: { ...customAll, [cfg.mode]: newList } } });
  };
  const onRemoveCustom = () => {
    const newList = customList.filter((_, k) => k !== pickIdx);
    let nextPick = 'default';
    const cur = customPickIndex(pickValue);
    if (cur !== -1 && cur !== pickIdx) nextPick = 'custom:' + (cur > pickIdx ? cur - 1 : cur);
    save({ template: { ...cfg.template, custom: { ...customAll, [cfg.mode]: newList }, pick: { ...(cfg.template.pick || {}), [cfg.mode]: nextPick } } });
  };
  const curText = curEntry ? curEntry.text : '';
  const curLabel = t('cfgTemplateTextFor').replace('{mode}', modeShortLabel(t, cfg.mode));
  const memoryValue = cfg.memory;
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'dsh-plg-row dsh-plg-row-duo' },
      React.createElement('div', { className: 'dsh-plg-field' },
        React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.mode }, t('cfgMode')),
        React.createElement(MarqueeSelect, {
          id: ids.mode,
          'aria-describedby': ids.modeHint,
          className: 'dsh-plg-select',
          value: cfg.mode,
          onChange: (e) => {
            const next = e.target.value;
            const pd = MODE_PARAMS_DEFAULT[next] || MODE_PARAMS_DEFAULT.base;
            const context = { ...(cfg.context || {}), budgetChars: (MODE_BUDGET_DEFAULT[next] !== undefined ? MODE_BUDGET_DEFAULT[next] : 0) };
            const params = { ...(cfg.params || {}), timeoutMs: pd.timeoutMs, maxTokens: pd.maxTokens, outputLimit: pd.outputLimit };
            save({ mode: next, context, params });
          },
          children: MODE_OPTIONS.map((m) => React.createElement('option', { key: m.value, value: m.value }, modeLabel(t, m.value))),
        }),
      ),
      React.createElement('div', { className: 'dsh-plg-field' },
        React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.tpl }, t('cfgTemplateMode')),
        React.createElement(MarqueeSelect, {
          id: ids.tpl,
          className: 'dsh-plg-select',
          value: pickValue,
          onChange: (e) => onSelectTemplate(e.target.value),
          children: [
            ...TEMPLATE_BUILTIN_KEYS.map((k) => React.createElement('option', { key: k, value: k }, t('tpl' + k.charAt(0).toUpperCase() + k.slice(1)))),
            ...customList.map((c, i) => React.createElement('option', { key: 'custom:' + i, value: 'custom:' + i }, t('tplCustom').replace('{name}', c.name || ('自定义模板 ' + (i + 1))))),
          ],
        }),
      ),
    ),
    React.createElement('p', { id: ids.modeHint, className: 'dsh-plg-hint' }, t('cfgModeHint' + cfg.mode.charAt(0).toUpperCase() + cfg.mode.slice(1))),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.memory }, t('cfgMemory')),
      React.createElement(MarqueeSelect, {
        id: ids.memory,
        'aria-describedby': ids.memoryHint,
        className: 'dsh-plg-select dsh-plg-select-thinking',
        value: memoryValue ? 'on' : 'off',
        onChange: (e) => { save({ memory: e.target.value === 'on' }); },
        children: [
          React.createElement('option', { key: 'on', value: 'on' }, t('cfgReasoningOn')),
          React.createElement('option', { key: 'off', value: 'off' }, t('cfgReasoningOff')),
        ],
      }),
    ),
    React.createElement('p', { id: ids.memoryHint, className: 'dsh-plg-hint' }, t('cfgMemoryNote')),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.budget }, t('cfgContextBudget')),
      React.createElement(MarqueeSelect, {
        id: ids.budget,
        'aria-describedby': ids.budgetHint,
        className: 'dsh-plg-select',
        value: String(cfg.context.budgetChars),
        onChange: (e) => save({ context: { ...cfg.context, budgetChars: Number(e.target.value) } }),
        children: (MODE_BUDGET_OPTIONS[cfg.mode] || MODE_BUDGET_OPTIONS.base).map((v, i, arr) =>
          React.createElement('option', { key: String(v), value: String(v) },
            v === 0 ? t('cfgContextBudget0') : (i === arr.length - 1 ? t('cfgUnlimited') : String(v)))),
      }),
    ),
    React.createElement('p', { id: ids.budgetHint, className: 'dsh-plg-hint' }, t('cfgContextNote')),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.timeout }, t('cfgTimeout')),
      React.createElement(MarqueeSelect, {
        id: ids.timeout,
        className: 'dsh-plg-select',
        value: clampParamDisplay(cfg.params.timeoutMs, modeTimeoutOptions, pDef.timeoutMs),
        onChange: onNumber('timeoutMs'),
        children: modeTimeoutOptions.map((v) => React.createElement('option', { key: v, value: String(v) }, v === 0 ? t('cfgUnlimited') : (v / 1000) + 's')),
      }),
    ),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.maxTokens }, t('cfgMaxTokens')),
      React.createElement(MarqueeSelect, {
        id: ids.maxTokens,
        className: 'dsh-plg-select',
        value: clampParamDisplay(cfg.params.maxTokens, modeMaxTokensOptions, pDef.maxTokens),
        onChange: onNumber('maxTokens'),
        children: modeMaxTokensOptions.map((v) => React.createElement('option', { key: v, value: String(v) }, v === 0 ? t('cfgUnlimited') : String(v))),
      }),
    ),
    React.createElement('div', { className: 'dsh-plg-row' },
      React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.outputLimit }, t('cfgOutputLimit')),
      React.createElement(MarqueeSelect, {
        id: ids.outputLimit,
        className: 'dsh-plg-select',
        value: clampParamDisplay(cfg.params.outputLimit, modeOutputLimitOptions, pDef.outputLimit),
        onChange: onNumber('outputLimit'),
        children: modeOutputLimitOptions.map((v) => React.createElement('option', { key: v, value: String(v) }, v === 0 ? t('cfgUnlimited') : String(v))),
      }),
    ),
    React.createElement('p', { className: 'dsh-plg-hint' },
      t('cfgParamsModeDefault')
        .replace('{t}', String(Math.round((Number(pDef.timeoutMs) || 0) / 1000)) + 's')
        .replace('{k}', String(pDef.maxTokens))
        .replace('{o}', String(pDef.outputLimit))),
    React.createElement('div', { className: 'dsh-plg-col' },
      pickIsCustom && curEntry
        ? React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'dsh-plg-row' },
              React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.templateName }, t('tplName')),
              React.createElement('input', {
                id: ids.templateName,
                className: 'dsh-plg-input',
                type: 'text',
                value: curEntry.name || '',
                maxLength: TEMPLATE_NAME_MAX,
                placeholder: t('tplNamePlaceholder'),
                onChange: (e) => onEditCustom({ name: e.target.value.slice(0, TEMPLATE_NAME_MAX) }),
              }),
            ),
            React.createElement('label', { className: 'dsh-plg-label', htmlFor: ids.template }, curLabel),
            React.createElement('textarea', {
              id: ids.template,
              'aria-describedby': ids.templateNote,
              className: 'dsh-plg-textarea',
              value: curText,
              rows: 12,
              placeholder: t('cfgTemplateText'),
              onChange: (e) => onEditCustom({ text: e.target.value.slice(0, TEMPLATE_TEXT_MAX) }),
            }),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-plg-btn dsh-plg-btn-danger',
              onClick: onRemoveCustom,
              children: t('tplRemoveCustom'),
            }),
          )
        : null,
      React.createElement('button', {
        type: 'button',
        className: 'dsh-plg-btn',
        disabled: customList.length >= TEMPLATE_CUSTOM_MAX,
        onClick: onAddCustom,
        children: t('tplAddCustom'),
      }),
      React.createElement('p', { id: ids.templateNote, className: 'dsh-plg-hint' }, t('tplNote')),
    ),
    React.createElement('p', { className: 'dsh-plg-hint' }, t('cfgHint')),
  );
}

  return ParamsTab;
}

module.exports = { createParamsTab };
