'use strict';

// 目标模式：设置页模型配置 / 优化参数两个 tab 的工厂与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const { createModelConfigTab } = require('../src/client/components/model-config-tab-module.cjs');
const { createParamsTab } = require('../src/client/components/params-tab-module.cjs');

function createReactStub() {
  const effects = [];
  return {
    Fragment: 'fragment',
    effects,
    createElement(type, props) {
      const kids = Array.from(arguments).slice(2).flat(9).filter((v) => v !== null && v !== undefined && v !== false);
      return { type, props: Object.assign({}, props || {}, kids.length ? { children: kids.length === 1 ? kids[0] : kids } : {}) };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useRef(initial) { return { current: initial }; },
    useCallback(fn) { return fn; },
    useEffect(fn) { effects.push(fn); },
  };
}

function flattenText(node, out) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const item of node) flattenText(item, out); return out; }
  if (node.props) flattenText(node.props.children, out);
  return out;
}

const C = {
  CONFIG_DEFAULTS: {},
  DEFAULT_MODEL_CHAIN: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
  MODE_OPTIONS: [
    { value: 'base' },
    { value: 'lite' },
    { value: 'standard' },
    { value: 'smart' },
  ],
  MODE_VALUES: ['base', 'lite', 'standard', 'smart'],
  MODE_BUDGET_OPTIONS: { base: [0, 4000], lite: [0, 4000], standard: [0, 4000], smart: [0, 4000] },
  MODE_TIMEOUT_OPTIONS: { base: [30000, 60000], lite: [30000, 60000], standard: [30000, 60000], smart: [30000, 60000] },
  MODE_MAXTOKENS_OPTIONS: { base: [2000, 4000], lite: [2000, 4000], standard: [2000, 4000], smart: [2000, 4000] },
  MODE_OUTPUTLIMIT_OPTIONS: { base: [8000, 16000], lite: [8000, 16000], standard: [8000, 16000], smart: [8000, 16000] },
  MODE_PARAMS_DEFAULT: {
    base: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
    lite: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
    standard: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
    smart: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 16000 },
  },
  MODE_BUDGET_DEFAULT: { base: 0, lite: 4000, standard: 4000, smart: 4000 },
  modeShortLabel: (t, mode) => 'short-' + mode,
  modeLabel: (t, mode) => 'label-' + mode,
  TEMPLATE_BUILTIN_KEYS: ['default', 'increment'],
  TEMPLATE_CUSTOM_MAX: 10,
  TEMPLATE_TEXT_MAX: 4000,
  TEMPLATE_NAME_MAX: 40,
  customPickIndex: (pick) => pick.indexOf('custom:') === 0 ? Number(pick.slice(7)) : -1,
};

function makeConfig(overrides) {
  return Object.assign({
    mode: 'standard',
    memory: false,
    fallback: [],
    customModels: [],
    order: [],
    params: { timeoutMs: 30000, maxTokens: 2000, outputLimit: 8000 },
    context: { budgetChars: 4000 },
    template: { pick: { standard: 'default' }, custom: {} },
  }, overrides || {});
}

test('CSTAB-01 两个旧 tab chunk 退役，工厂模块在位', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/model-config-tab.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/params-tab.js')), false);
  assert.equal(typeof createModelConfigTab, 'function');
  assert.equal(typeof createParamsTab, 'function');
});

test('CSTAB-02 ModelConfigTab 仍加载模型目录、清理 order 并渲染两级卡片', () => {
  const React = createReactStub();
  const calls = [];
  const saves = [];
  const configState = {
    value: makeConfig({ order: ['p1/m1', 'ghost/model'] }),
    fresh: false,
    hostSync: true,
    unsupported: false,
  };
  const Component = createModelConfigTab({
    React,
    makeT: () => (key) => key,
    configState,
    subscribeConfig: () => () => {},
    host: {
      call(method) {
        calls.push(method);
        if (method === 'models/list') {
          return Promise.resolve({ ok: true, providers: [{ provider: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }] }] });
        }
        return Promise.resolve({ ok: false });
      },
    },
    DEFAULT_MODEL_CHAIN: C.DEFAULT_MODEL_CHAIN,
    saveConfig: (patch) => saves.push(patch),
    buildCandidates: () => [{ provider: 'p1', model: 'm1' }],
    ModelMainSection: function ModelMainSection() { return null; },
    VoiceSection: function VoiceSection() { return null; },
  });
  const tree = Component({ t: (key) => key });
  assert.equal(tree.type, 'fragment');
  assert.deepEqual(tree.props.children.map((x) => x && x.type && x.type.name), ['ModelMainSection', 'VoiceSection']);
  for (const effect of React.effects) effect();
  assert.ok(calls.includes('models/list'));
  return Promise.resolve().then(() => {
    assert.deepEqual(saves, [{ order: ['p1/m1'] }]);
  });
});

test('CSTAB-03 ParamsTab 保留模式默认档、预算档与当前模式模板文本', () => {
  const React = createReactStub();
  const configState = { value: makeConfig() };
  const calls = [];
  const Component = createParamsTab({
    React,
    MarqueeSelect: function MarqueeSelect() { return null; },
    makeT: () => (key) => key,
    dshEnhId: (prefix) => prefix + '-id',
    configState,
    saveConfig: () => {},
    host: { call: (method) => { calls.push(method); return Promise.resolve({ ok: true, catalog: {} }); } },
    ...C,
  });
  const text = flattenText(Component({ t: (key) => key }), []).join(' ');
  assert.ok(text.includes('cfgModeHintStandard'));
  assert.ok(text.includes('cfgParamsModeDefault'));
  assert.ok(text.includes('tplAddCustom'));
  assert.ok(text.includes('tplNote'));
  assert.deepEqual(calls, []);
});

test('CSTAB-04 模式切换同时重置 params 与 context 默认值', () => {
  const React = createReactStub();
  const saves = [];
  const configState = { value: makeConfig() };
  const Component = createParamsTab({
    React,
    MarqueeSelect: function MarqueeSelect() { return null; },
    makeT: () => (key) => key,
    dshEnhId: (prefix) => prefix + '-id',
    configState,
    saveConfig: (patch) => saves.push(patch),
    host: { call: () => Promise.resolve({ ok: true }) },
    ...C,
  });
  const tree = Component({ t: (key) => key });
  const modeSelect = tree.props.children[0].props.children[0].props.children[1];
  modeSelect.props.onChange({ target: { value: 'smart' } });
  assert.equal(saves.length, 1);
  assert.equal(saves[0].mode, 'smart');
  assert.deepEqual(saves[0].params, C.MODE_PARAMS_DEFAULT.smart);
  assert.equal(saves[0].context.budgetChars, C.MODE_BUDGET_DEFAULT.smart);
});

test('CSTAB-05 构建产物内联两个 tab 运行时，旧 chunk 与相对 require 均不存在', () => {
  const build = fs.readFileSync(path.join(REPO_ROOT, 'scripts/build-client.mjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(build.includes("entry: 'src/client/app-module.cjs'"));
  assert.ok(build.includes("entry: 'src/client/app-module.cjs'"));
  assert.ok(client.includes('src/client/components/model-config-tab-module.cjs'));
  assert.ok(client.includes('src/client/components/params-tab-module.cjs'));
  assert.ok(client.includes('createModelConfigTab({'));
  assert.ok(client.includes('createParamsTab({'));
  assert.equal(client.includes('src/client/components/model-config-tab.js'), false);
  assert.equal(client.includes('src/client/components/params-tab.js'), false);
  assert.equal((client.match(/require\(["']\.\.?\//g) || []).length, 0);
});
