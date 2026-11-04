'use strict';

// 目标模式：设置页容器、增强按钮、错误提示普通模块与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createEnhanceButton } = require('../src/client/components/enhance-button-module.cjs');
const { createEnhanceBar } = require('../src/client/components/enhance-bar-module.cjs');
const { createModelPluginsSection } = require('../src/client/components/model-plugins-section-module.cjs');

function createReactStub() {
  const effects = [];
  return {
    Fragment: 'fragment',
    effects,
    createElement(type, props) {
      const kids = Array.from(arguments).slice(2).flat(9).filter((x) => x !== null && x !== undefined && x !== false);
      return { type, props: Object.assign({}, props || {}, kids.length ? { children: kids.length === 1 ? kids[0] : kids } : {}) };
    },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; },
    useRef(initial) { return { current: initial }; },
    useCallback(fn) { return fn; },
    useEffect(fn) { effects.push(fn); },
  };
}

function textOf(node, out) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const item of node) textOf(item, out); return out; }
  if (node.props) textOf(node.props.children, out);
  return out;
}

function makeButtonDeps() {
  return {
    React: createReactStub(),
    makeT: () => (key) => key,
    dshEnhId: (prefix) => prefix + '-id',
    subscribe: () => () => {},
    storeFor: () => ({ phase: 'idle', seq: 0, optimized: false, error: null }),
    notify: () => {},
    releaseStoreIfIdle: () => {},
    setLastDraft: () => {},
    subscribeConfig: () => () => {},
    subscribeCorrection: () => () => {},
    subscribeVoiceConfig: () => () => {},
    setActiveSession: () => {},
    getActiveSession: () => null,
    safeSetDraft: () => {},
    clearResultStore: () => {},
    clearSeen: () => {},
    guardPasses: () => true,
    saveConfig: () => {},
    configState: { value: { memory: false, mode: 'standard' } },
    enhance: () => {},
    cancelEnhance: () => {},
    undo: () => {},
    modeShortLabel: (t, mode) => mode,
    prettifyModel: (model) => model,
    timerSvc: null,
    host: { call: () => Promise.resolve({ ok: false }) },
    correctionSnapshot: () => null,
    correctionPhaseOf: () => 'idle',
    CORRECTION_PHASES: { IDLE: 'idle', RUNNING: 'running', FAILED: 'failed' },
    correctionFailureTicket: () => '',
    consumeCorrectionFailure: () => false,
    correctionPhaseView: () => ({ cls: 'dsh-enh-btn-text' }),
  };
}

test('CESC-01 三个旧交互 chunk 退役，普通工厂模块与聚合入口在位', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/enhance-button.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/enhance-bar.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/model-plugins-section.js')), false);
  assert.equal(typeof createEnhanceButton, 'function');
  assert.equal(typeof createEnhanceBar, 'function');
  assert.equal(typeof createModelPluginsSection, 'function');
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/enhance-components-runtime.cjs')), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/settings-shell-runtime.cjs')), true);
});

test('CESC-02 EnhanceButton 工厂返回同名组件并保留 ARIA/title 结构', () => {
  const deps = makeButtonDeps();
  const EnhanceButton = createEnhanceButton(deps);
  assert.equal(EnhanceButton.name, 'EnhanceButton');
  const tree = EnhanceButton({ sessionId: 's1', inputActions: { setDraft() {} }, input: { draft: '草稿' }, t: (key) => key });
  assert.equal(tree.type, 'button');
  assert.equal(tree.props['aria-label'], 'enhanceButton');
  assert.ok(textOf(tree, []).join(' ').includes('✨'));
});

test('CESC-03 EnhanceBar 工厂返回同名组件并保留错误提示与关闭按钮', () => {
  const deps = makeButtonDeps();
  deps.storeFor = () => ({ phase: 'idle', seq: 0, optimized: false, error: 'NETWORK' });
  deps.errorKey = () => 'errNETWORK';
  const EnhanceBar = createEnhanceBar(deps);
  assert.equal(EnhanceBar.name, 'EnhanceBar');
  const tree = EnhanceBar({ sessionId: 's1', inputActions: { setDraft() {} }, t: (key) => key });
  assert.equal(tree.props.className, 'dsh-enh-bar dsh-enh-bar-error');
  assert.ok(JSON.stringify(tree).includes('dismiss'));
});

test('CESC-04 设置页容器只保留 models/params 两 tab，且两面板均接到同名组件', () => {
  const React = createReactStub();
  const api = createModelPluginsSection({
    React,
    makeT: () => (key) => key,
    dshEnhId: (prefix) => prefix + '-id',
    subscribeConfig: () => () => {},
    subscribeSaveStatus: () => () => {},
    saveStatus: { phase: 'idle' },
    ModelConfigTab: function ModelConfigTab() { return null; },
    ParamsTab: function ParamsTab() { return null; },
  });
  assert.equal(api.ModelPluginsSection.name, 'ModelPluginsSection');
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/client/components/model-plugins-section-module.cjs'), 'utf8');
  assert.ok(source.includes("['models', t('tabModels')]"));
  assert.ok(source.includes("['params', t('tabParams')]"));
  assert.ok(source.includes('React.createElement(ModelConfigTab, props)'));
  assert.ok(source.includes('React.createElement(ParamsTab, props)'));
});

test('CESC-05 产物内联三个交互模块，旧 chunk 与相对 require 均不存在', () => {
  const build = fs.readFileSync(path.join(REPO_ROOT, 'scripts/build-client.mjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(build.includes("entry: 'src/client/app-module.cjs'"));
  assert.ok(build.includes("entry: 'src/client/app-module.cjs'"));
  for (const mod of [
    'src/client/components/enhance-button-module.cjs',
    'src/client/components/enhance-bar-module.cjs',
    'src/client/components/model-plugins-section-module.cjs',
  ]) assert.ok(client.includes(mod), '产物缺模块 ' + mod);
  assert.ok(client.includes('createEnhanceButton({'));
  assert.ok(client.includes('createEnhanceBar({'));
  assert.ok(client.includes('createModelPluginsSection({'));
  assert.equal(client.includes('src/client/components/enhance-button.js'), false);
  assert.equal(client.includes('src/client/components/enhance-bar.js'), false);
  assert.equal(client.includes('src/client/components/model-plugins-section.js'), false);
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
});
