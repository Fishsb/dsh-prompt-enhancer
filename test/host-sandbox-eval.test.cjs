'use strict';

// 目标模式 §五 第 1 批完成判据：「plugin-host.js 仍可在无 Node 模块的环境中求值」。
//
// 为什么需要这条：既有测试用 `new Function('harness', BODY)`，那是**Node 全局作用域**——
// `require` / `process` / `Buffer` 都还在。若产物里混进 `require('node:fs')` 之类，
// 在 Node 里照样跑得通，只有真装进 DSH 宿主才会炸。所以判据必须在一个
// **确实没有模块系统**的上下文里求值。
//
// 做法：`vm.createContext(Object.create(null))` 建空上下文，先自证环境里
// require/module/process/Buffer/__dirname 全为 undefined，再求值产物。
// 顺序很重要：先自证环境、再求值，否则「求值失败」会被误读成「产物有问题」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HOST = path.join(ROOT, 'plugin-host.js');

function makeSandbox() {
  const sandbox = Object.create(null);
  vm.createContext(sandbox);
  return sandbox;
}

function evaluateIn(sandbox) {
  const body = fs.readFileSync(HOST, 'utf8');
  // 产物是**语句序列**（`const __DSH_HOST_APP__ = ...; return ...;`），
  // 与 lib/index.cjs 同款：包成函数体再求值。
  const factory = vm.runInContext(
    '(function (harness) {\n' + body + '\n})',
    sandbox,
    { filename: 'plugin-host.sandbox.js' },
  );
  return factory;
}

test('HSE-01 沙箱环境自证：上下文内没有 Node 模块系统（否则本文件无判别力）', () => {
  const sandbox = makeSandbox();
  const probe = vm.runInContext(
    '[typeof require, typeof module, typeof exports, typeof process, typeof Buffer, typeof __dirname, typeof __filename].join(",")',
    sandbox,
  );
  assert.equal(probe, 'undefined,undefined,undefined,undefined,undefined,undefined,undefined',
    '沙箱里必须没有任何 Node 模块系统符号；否则后续「求值通过」不构成自包含证据');
});

test('HSE-02 产物在无 Node 模块的环境中可求值，且返回带 apply 的插件对象', () => {
  const sandbox = makeSandbox();
  const harness = {
    handle() {},
    probeEnv() { return null; },
    readPluginVersion() { return '0.0.0-test'; },
    pluginRuntimeDir() { return ROOT; },
  };
  const factory = evaluateIn(sandbox);
  const plugin = factory(harness);
  assert.equal(typeof plugin, 'object', '产物求值必须返回对象');
  assert.equal(typeof plugin.apply, 'function', '产物必须暴露 apply(ctx)');
});

test('HSE-03 apply() 在沙箱内注册全部 host 半部 RPC（12 条，与注册面同源）', () => {
  const sandbox = makeSandbox();
  const registered = [];
  const harness = {
    handle(method, fn) {
      if (typeof method === 'string' && typeof fn === 'function') registered.push(method);
    },
    probeEnv() { return null; },
    readPluginVersion() { return '0.0.0-test'; },
    pluginRuntimeDir() { return ROOT; },
  };
  const plugin = evaluateIn(sandbox)(harness);
  plugin.apply({ get() { return undefined; }, effect() {}, timer() { return () => {}; } });

  const methods = registered.slice().sort();
  assert.equal(methods.length, 12,
    'host 半部应注册 12 条 RPC（原生 3 条在 lib/index.cjs，不在本产物内），实得 ' + methods.length);
  for (const required of ['enhance', 'enhance/progress', 'cancel', 'voice/correct',
    'models/list', 'models/resolve', 'models/current', 'models/autochain',
    'models/test', 'models/stats', 'logs/last', 'template/default']) {
    assert.ok(methods.includes(required), 'RPC 缺失：' + required);
  }
});

test('HSE-04 产物内不引用宿主环境能力（结构面，与 HSE-02 互为佐证）', () => {
  const body = fs.readFileSync(HOST, 'utf8');
  // 只数「真调用」形态，注释里的说明文字不算（与 R5 同口径：先剥注释）
  const { codeOnly } = require('../scripts/lib/code-only.mjs');
  const code = codeOnly(body);

  // ⚠ 口径澄清：产物**必然**含 `module.exports = ...` —— 那是打包器给每个内联模块
  //   准备的**内部封装**（`function (exports, module, __load) { ... }`），是自包含的
  //   实现细节，不是对 Node 模块系统的依赖。判据要判的是「有没有向**外部**要东西」。
  //   ⇒ 正确的判据是：不得有 require(...) 调用、不得读 process、不得读 __dirname。
  assert.equal((code.match(/\brequire\s*\(/g) || []).length, 0, '产物不得含 require( 调用');
  assert.equal((code.match(/\bprocess\.(env|argv|cwd|platform)\b/g) || []).length, 0, '产物不得读 process');
  assert.equal((code.match(/\b__dirname\b/g) || []).length, 0, '产物不得引用 __dirname');
  assert.equal((code.match(/\b__filename\b/g) || []).length, 0, '产物不得引用 __filename');

  // 正向对照（防「把整个模块系统删掉」式假绿）：内部封装必须在位
  assert.ok(/function \(exports, module, __load\)/.test(body),
    '打包器的内部模块封装必须在位（否则 HSE-02 的求值对象不是真产物）');
});

test('HSE-05 判别力自证：产物若真需要外部模块 ⇒ 沙箱求值必失败', () => {
  // ⚠ 注入点必须在**会执行到的位置**。直接追加到 body 末尾会被 `return` 之后挡住，
  //   那样「没抛错」并不能证明沙箱安全（本次实测踩到）。这里把 require 放到最前面。
  const sandbox = makeSandbox();
  const body = fs.readFileSync(HOST, 'utf8');
  const poisoned = 'require("node:fs");\n' + body;
  const factory = vm.runInContext(
    '(function (harness) {\n' + poisoned + '\n})',
    sandbox,
    { filename: 'poisoned.js' },
  );
  let err = null;
  try {
    factory({ handle() {}, probeEnv() { return null; } });
  } catch (e) {
    err = e;
  }
  assert.ok(err, '注入可执行的 require 后必须抛错——否则说明沙箱其实提供了模块系统，HSE-02 的证据无效');
  assert.match(String(err && err.message), /require is not defined/,
    '抛错原因必须是「require 未定义」（证明是沙箱缺模块系统，而不是别的错）');
});
