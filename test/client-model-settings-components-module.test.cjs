'use strict';

// 目标模式：设置页模型配置组件的普通模块与产物接线锁。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('../scripts/lib/chunk-decode.mjs');
const fallbackModule = require('../src/client/domains/settings/fallback-row.cjs');
const mainModule = require('../src/client/domains/settings/model-main-section.cjs');
const runtime = require('../src/client/domains/settings/model-settings.cjs');

function createReactStub() {
  let effects = [];
  return {
    Fragment: 'fragment',
    flushEffects() {
      const queued = effects;
      effects = [];
      for (const effect of queued) effect();
    },
    createElement(type, props) {
      return { type, props: props || {}, children: Array.from(arguments).slice(2) };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect(effect) { effects.push(effect); },
  };
}

function createDeps(overrides) {
  const calls = [];
  return Object.assign({
    React: createReactStub(),
    MarqueeSelect: function MarqueeSelect() {},
    CollapsibleSection: function CollapsibleSection(props) {
      return { type: 'section', props };
    },
    makeT: () => (key) => key,
    host: {
      call(method, args) {
        calls.push({ method, args });
        if (method === 'models/resolve') {
          return Promise.resolve({
            ok: true,
            reasoning: {
              efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
              defaultEffort: 'high',
            },
          });
        }
        if (method === 'models/test') return Promise.resolve({ ok: true, latencyMs: 12 });
        if (method === 'models/stats') {
          return Promise.resolve({
            ok: true,
            ttftMs: 120,
            tokensPerSecond: 9.5,
            estimatedBaseSeconds: 2,
            estimatedLiteSeconds: 1,
          });
        }
        return Promise.resolve({ ok: false });
      },
    },
    DEFAULT_MODEL_CHAIN: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
    getLastDraft: () => '草稿',
    timerSvc: null,
    calls,
  }, overrides || {});
}

test('CMSC-01 两个旧 chunk 退役，工厂模块与聚合入口在位', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/fallback-row.js')), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/client/components/model-main-section.js')), false);
  assert.equal(typeof fallbackModule.createFallbackRow, 'function');
  assert.equal(typeof mainModule.createModelMainSection, 'function');
  assert.equal(runtime.createFallbackRow, fallbackModule.createFallbackRow);
  assert.equal(runtime.createModelMainSection, mainModule.createModelMainSection);
});

test('CMSC-02 工厂返回原组件同名函数，显式依赖生效', () => {
  const deps = createDeps();
  const FallbackRow = fallbackModule.createFallbackRow(deps);
  const ModelMainSection = mainModule.createModelMainSection(deps);
  assert.equal(FallbackRow.name, 'FallbackRow');
  assert.equal(ModelMainSection.name, 'ModelMainSection');
  assert.equal(typeof FallbackRow, 'function');
  assert.equal(typeof ModelMainSection, 'function');
});

test('CMSC-03 FallbackRow 保留 provider/model/reasoning/testing 接线', () => {
  const deps = createDeps();
  const FallbackRow = fallbackModule.createFallbackRow(deps);
  const tree = FallbackRow({
    t: (key) => key,
    entry: { provider: 'p1', model: 'm1', reasoning: { enabled: true, effort: 'low' } },
    index: 1,
    count: 3,
    providers: [{ provider: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }] }],
    candidates: [{ provider: 'p1', model: 'm1', custom: false }],
    testing: true,
    invalid: true,
    onChange() {},
    onMove() {},
    onRemove() {},
    onTest() {},
  });
  assert.equal(tree.props.className, 'dsh-plg-row');
  const flat = JSON.stringify(tree);
  assert.ok(flat.includes('dsh-plg-select-provider'));
  assert.ok(flat.includes('dsh-plg-select-model'));
  assert.ok(flat.includes('dsh-plg-testicon'));
  assert.ok(flat.includes('cfgRowInvalid'));
  deps.React.flushEffects();
  assert.ok(deps.calls.some((call) => call.method === 'models/resolve'));
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src/client/domains/settings/fallback-row.cjs'),
    'utf8',
  );
  assert.ok(source.includes("className: 'dsh-plg-select dsh-plg-select-thinking'"));
  assert.ok(source.includes("className: 'dsh-plg-select dsh-plg-select-level'"));
});

test('CMSC-04 ModelMainSection 保留默认链、单点测试状态与折叠区块', () => {
  const deps = createDeps();
  const FallbackRow = fallbackModule.createFallbackRow(deps);
  deps.FallbackRow = FallbackRow;
  const ModelMainSection = mainModule.createModelMainSection(deps);
  const saves = [];
  const tree = ModelMainSection({
    t: (key) => key,
    providers: [{ provider: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }] }],
    fallback: [{ provider: 'p1', model: 'm1' }],
    candidates: [{ provider: 'p1', model: 'm1' }],
    saveFallback(value) {
      saves.push(value);
    },
  });
  assert.equal(tree.type.name, 'CollapsibleSection');
  assert.equal(tree.props.title, 'secMain');
  const flat = JSON.stringify(tree);
  const rows = tree.children[0].children[0];
  assert.equal(rows[0].type, FallbackRow, '模型链行必须由显式注入的组件渲染');
  assert.ok(flat.includes('cfgAddFallback'));
  assert.ok(flat.includes('cfgRestoreDefaults'));
  assert.ok(flat.includes('cfgRestoreNote'));

  // CollapsibleSection 收到的是 createElement 的位置参数 children。
  const sectionBody = tree.children[0];
  assert.ok(sectionBody, '前置：折叠区块须携带正文');
  const restoreButton = sectionBody.children.find((child) =>
    child && child.props && child.props.className === 'dsh-plg-row');
  const restore = restoreButton.children.find((child) =>
    child && child.children && child.children[0] === 'cfgRestoreDefaults');
  restore.props.onClick();
  assert.deepEqual(saves.at(-1), [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }]);

  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src/client/domains/settings/model-main-section.cjs'),
    'utf8',
  );
  assert.ok(source.includes('host.call(RPC_METHODS.MODELS_TEST'));
  assert.ok(source.includes('host.call(RPC_METHODS.MODELS_STATS'));
  assert.ok(source.includes("className: 'dsh-plg-testarea', role: 'status'"));
});

test('CMSC-05 构建产物内联模型设置运行时，旧 chunk 与相对 require 均不存在', () => {
  const build = fs.readFileSync(path.join(REPO_ROOT, 'scripts/build-client.mjs'), 'utf8');
  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib/client.cjs'), 'utf8');
  assert.ok(build.includes("entry: 'src/client/app.cjs'"));
  assert.ok(client.includes('src/client/domains/settings/model-settings.cjs'));
  assert.ok(client.includes('src/client/domains/settings/fallback-row.cjs'));
  assert.ok(client.includes('src/client/domains/settings/model-main-section.cjs'));
  assert.equal(client.includes('src/client/components/fallback-row.js'), false);
  assert.equal(client.includes('src/client/components/model-main-section.js'), false);
  assert.equal((client.match(/require\(['"]\.\.?\//g) || []).length, 0);
});

test('CMSC-06 布局审计从共享语音契约注入默认值，不再漏定义运行期变量', () => {
  const audit = fs.readFileSync(path.join(REPO_ROOT, 'scripts/settings-layout-audit.mjs'), 'utf8');
  const driver = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lib/settings-layout-driver.mjs'), 'utf8');
  assert.ok(audit.includes("'src/shared/contracts/voice-config.cjs'"));
  assert.ok(driver.includes("voiceConfigFactory = new Function("));
  assert.ok(driver.includes("var __VOICE_CONFIG_DEFAULTS__ = voiceConfig.VOICE_CONFIG_DEFAULTS;"));
  assert.ok(driver.includes("SRC['src/client/domains/voice/state.cjs']"));
  assert.ok(driver.includes("createVoiceState({ host: host, storage: storage"));
  assert.ok(driver.includes("stateFactory(host, localStorageStub, null, null, __VOICE_CONFIG_DEFAULTS__)"));
});
