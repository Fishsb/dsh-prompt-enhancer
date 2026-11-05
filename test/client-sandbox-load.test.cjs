'use strict';

// 目标模式 §五 第 1 批完成判据：「lib/client.cjs 仍按官方工厂契约加载」。
//
// 既有测试在 Node 全局作用域里求值产物，`require` / `process` 都还在 —— 那样即使
// 产物偷偷依赖了 Node 能力也照样跑通。这里在一个**只有浏览器式 API** 的隔离上下文里
// 装载产物：没有 require / module / process / Buffer，只有 window.__ModuleLoader__、
// document、localStorage 等真实浏览器会有的东西。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'lib', 'client.cjs');

function fakeReact() {
  const noop = () => {};
  return {
    createElement: () => null,
    Fragment: 'Fragment',
    useState: (v) => [v, noop],
    useEffect: noop,
    useMemo: (f) => f(),
    useRef: (v) => ({ current: v }),
    useCallback: (f) => f,
  };
}

function makeBrowserSandbox() {
  const captured = { def: null };
  const storage = new Map();
  const sandbox = {
    window: { __ModuleLoader__: { load(def) { captured.def = def; } } },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, style: {} }),
      head: { appendChild() {} },
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    navigator: { mediaDevices: {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  };
  vm.createContext(sandbox);
  return { sandbox, captured };
}

test('CSL-01 沙箱环境自证：只有浏览器式 API，没有 Node 模块系统', () => {
  const { sandbox } = makeBrowserSandbox();
  const probe = vm.runInContext(
    '[typeof require, typeof module, typeof process, typeof Buffer].join(",")',
    sandbox,
  );
  assert.equal(probe, 'undefined,undefined,undefined,undefined',
    '沙箱必须没有 Node 模块系统，否则后续装载通过不构成证据');
});

test('CSL-02 产物按 __ModuleLoader__.load 契约注册工厂，且 id 正确', () => {
  const { sandbox, captured } = makeBrowserSandbox();
  const bundle = fs.readFileSync(CLIENT, 'utf8');
  vm.runInContext(bundle, sandbox, { filename: 'lib/client.cjs' });

  assert.ok(captured.def, '产物必须调用 window.__ModuleLoader__.load(...)');
  assert.equal(typeof captured.def.factory, 'function', '必须提供 factory');
  assert.equal(captured.def.id, 'dsh-voice-prompt-enhancer', '注册 id 必须是当前包名');
});

test('CSL-03 工厂只向宿主要 react，且能返回带 apply/inject 的插件对象', () => {
  const { sandbox, captured } = makeBrowserSandbox();
  const bundle = fs.readFileSync(CLIENT, 'utf8');
  vm.runInContext(bundle, sandbox, { filename: 'lib/client.cjs' });

  const requested = [];
  const plugin = captured.def.factory((name) => {
    requested.push(name);
    if (name === 'react') return fakeReact();
    throw new Error('工厂向宿主索要了额外模块：' + name);
  });

  assert.deepEqual(requested, ['react'],
    '工厂只允许 require("react")（官方工厂契约），实得 ' + JSON.stringify(requested));
  assert.equal(typeof plugin, 'object', '工厂必须返回插件对象');
  assert.equal(typeof plugin.apply, 'function', '插件对象必须暴露 apply(ctx)');
  assert.ok('inject' in plugin, '插件对象必须声明 inject');
});

test('CSL-04 产物内不引用宿主环境能力（与 CSL-02 互为佐证）', () => {
  const { codeOnly } = require('../scripts/lib/code-only.mjs');
  const code = codeOnly(fs.readFileSync(CLIENT, 'utf8'));
  assert.equal((code.match(/\bprocess\.(env|argv|cwd|platform)\b/g) || []).length, 0,
    'client 产物不得读 process');
  assert.equal((code.match(/\b__dirname\b/g) || []).length, 0, 'client 产物不得引用 __dirname');
  assert.equal((code.match(/\brequire\(['"]node:/g) || []).length, 0,
    'client 产物不得 require node: 内建模块');
});

test('CSL-05 判别力自证：注入对 node: 内建的 require ⇒ CSL-03 的「只要 react」判据必红', () => {
  const { sandbox, captured } = makeBrowserSandbox();
  const bundle = fs.readFileSync(CLIENT, 'utf8');
  vm.runInContext(bundle, sandbox, { filename: 'lib/client.cjs' });

  const requested = [];
  captured.def.factory((name) => {
    requested.push(name);
    if (name === 'react') return fakeReact();
    throw new Error('unexpected');
  });
  // 基线：只索要了 react
  assert.deepEqual(requested, ['react']);

  // 负控对照：把产物改造成索要 fs ⇒ 同一判据必须能看出来
  const poisoned = bundle.replace('require("react")', 'require("node:fs"), require("react")');
  if (poisoned === bundle) return; // 产物形态变化时跳过（不制造假红）
  const alt = makeBrowserSandbox();
  vm.runInContext(poisoned, alt.sandbox, { filename: 'poisoned-client.cjs' });
  const seen = [];
  assert.throws(() => alt.captured.def.factory((name) => {
    seen.push(name);
    if (name === 'react') return fakeReact();
    throw new Error('unexpected: ' + name);
  }), /unexpected/);
  assert.ok(seen.includes('node:fs'), '改造后的产物必须被看出多要了 node:fs（判据有牙）');
});
