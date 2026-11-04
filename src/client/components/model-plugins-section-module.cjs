'use strict';

// 设置页容器普通组件（构建期由客户端运行时内联）。
// tab 键盘导航、面板关联、保存状态与用户可见结构保持不变。
function createModelPluginsSection(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const React = d.React;
  const makeT = d.makeT;
  const dshEnhId = d.dshEnhId;
  const subscribeConfig = d.subscribeConfig;
  const subscribeSaveStatus = d.subscribeSaveStatus;
  const saveStatus = d.saveStatus;
  const ModelConfigTab = d.ModelConfigTab;
  const ParamsTab = d.ParamsTab;

function ModelPluginsSection(props) {
  const t = makeT(props);
  const [tab, setTab] = React.useState('models');
  const [, force] = React.useState(0);
  const tabsId = React.useState(() => dshEnhId('dsh-plg-tabs'))[0];
  const tabRefs = React.useRef([]);
  React.useEffect(() => subscribeConfig(() => force((v) => v + 1)), []);
  React.useEffect(() => subscribeSaveStatus(() => force((v) => v + 1)), []);

  const tabs = [
    ['models', t('tabModels')],
    ['params', t('tabParams')],
  ];
  const body = tab === 'models' ? React.createElement(ModelConfigTab, props)
    : React.createElement(ParamsTab, props);
  const onTabKeyDown = (event, index) => {
    let nextIndex;
    switch (event.key) {
      case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break;
      case 'ArrowLeft': nextIndex = (index - 1 + tabs.length) % tabs.length; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setTab(tabs[nextIndex][0]);
    const nextTab = tabRefs.current[nextIndex];
    if (nextTab) nextTab.focus();
  };

  return React.createElement('div', { className: 'dsh-plg-root' },
    React.createElement('h2', { className: 'dsh-plg-title' }, t('navModelPlugins')),
    React.createElement('p', { className: 'dsh-plg-intro' }, t('secPluginsIntro')),
    React.createElement('div', { className: 'dsh-cfg-tabs', role: 'tablist', 'aria-label': t('navModelPlugins') },
      tabs.map((entry, index) => React.createElement('button', {
        key: entry[0],
        ref: (element) => { tabRefs.current[index] = element; },
        id: tabsId + '-tab-' + entry[0],
        type: 'button',
        role: 'tab',
        'aria-selected': tab === entry[0],
        'aria-controls': tabsId + '-panel-' + entry[0],
        tabIndex: tab === entry[0] ? 0 : -1,
        className: 'dsh-cfg-tab' + (tab === entry[0] ? ' dsh-cfg-tab-active' : ''),
        onClick: () => setTab(entry[0]),
        onKeyDown: (event) => onTabKeyDown(event, index),
      }, entry[1])),
    ),
    React.createElement('div', {
      id: tabsId + '-panel-' + tab,
      role: 'tabpanel',
      'aria-labelledby': tabsId + '-tab-' + tab,
    }, body),
    saveStatus.phase === 'saving'
        ? React.createElement('div', { className: 'dsh-plg-save dsh-plg-save-busy', role: 'status' },
            React.createElement('span', { className: 'dsh-enh-spin', 'aria-hidden': true }),
            React.createElement('span', null, t('cfgSaving')))
        : saveStatus.phase === 'failed'
          ? React.createElement('div', { className: 'dsh-plg-save dsh-plg-save-fail', role: 'status' }, t('cfgSaveFailed'))
          : saveStatus.phase === 'saved'
            ? React.createElement('div', { className: 'dsh-plg-save dsh-plg-save-ok', role: 'status' }, t('cfgSaved'))
            : null,
  );
}

  return { ModelPluginsSection };
}

module.exports = { createModelPluginsSection };
