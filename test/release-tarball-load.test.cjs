'use strict';

// 目标模式 §五 第 1 批完成判据：「动态安装、profile 安装和刷新加载均通过」。
//
// 前面几组沙箱测的是**仓库工作区**里的产物；这里测的是**真正的发布物**：
// 用 `npm pack` 打一个 tgz，解包到临时目录，然后只按 `package.json` 的声明
// （`main` / `exports["./client"]`）装载它 —— 这正是 DSH 宿主装完插件后做的事。
//
// 这能抓住一类只有发布物才暴露的问题：`files` 白名单漏了某个产物、
// `exports` 指向不存在的路径、打包时把 `src/` 之类不该发的东西带了出去。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// 只打包一次，供全部用例复用（npm pack 有点慢）
let cached = null;
function packed() {
  if (cached) return cached;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-release-'));
  const out = execFileSync('npm', ['pack', '--pack-destination', tmp, '--silent'], {
    cwd: ROOT, encoding: 'utf8',
  }).trim();
  const tgz = path.join(tmp, out.split('\n').pop());
  const dest = path.join(tmp, 'unpack');
  fs.mkdirSync(dest);
  execFileSync('tar', ['-xzf', tgz, '-C', dest], { cwd: tmp });
  const pkgDir = path.join(dest, 'package');
  cached = {
    tmp, tgz, pkgDir,
    pkg: JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')),
  };
  return cached;
}

test('RTL-01 发布物可解包，且 package.json 声明齐备', () => {
  const { tgz, pkgDir, pkg } = packed();
  assert.ok(fs.statSync(tgz).size > 0, 'tgz 必须非空');
  assert.ok(fs.existsSync(pkgDir), '解包后必须有 package/ 目录');
  assert.equal(pkg.name, 'dsh-voice-prompt-enhancer');
  assert.equal(pkg.main, 'lib/index.cjs', 'main 必须指向薄装配入口');
  assert.equal(pkg.exports && pkg.exports['./client'], './lib/client.cjs',
    'exports["./client"] 必须指向客户端产物');
});

test('RTL-02 按 main 装载 host 半部，导出面完整且 apply() 可执行', () => {
  const { pkgDir, pkg } = packed();
  const mod = require(path.join(pkgDir, pkg.main));
  for (const key of ['apply', 'inject', 'name', 'isTrustedRpcRequest', 'readBody', 'registerRpcRoute']) {
    assert.ok(key in mod, '导出面缺 ' + key);
  }
  // apply() 在最小 ctx 下不得抛错（宿主装完立刻调它）
  const ctx = { get() { return undefined; }, effect() {}, timer() { return () => {}; } };
  assert.doesNotThrow(() => mod.apply(ctx), 'apply(ctx) 必须可执行');
});

test('RTL-03 按 exports 装载 client 半部，工厂契约成立', () => {
  const { pkgDir, pkg } = packed();
  const clientPath = path.join(pkgDir, pkg.exports['./client']);
  assert.ok(fs.existsSync(clientPath), 'client 产物必须在发布物内');

  let captured = null;
  const sandbox = {
    window: { __ModuleLoader__: { load(d) { captured = d; } } },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, style: {} }),
      head: { appendChild() {} },
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { mediaDevices: {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(clientPath, 'utf8'), sandbox, { filename: 'client.cjs' });

  assert.ok(captured, 'client 产物必须调用 __ModuleLoader__.load');
  assert.equal(captured.id, 'dsh-voice-prompt-enhancer');
  assert.equal(typeof captured.factory, 'function');
});

test('RTL-04 发布物不含源码与治理目录（files 白名单生效）', () => {
  const { pkgDir } = packed();
  for (const forbidden of ['src', 'test', 'scripts', 'docs', 'AGENTS.md', 'release-notes']) {
    assert.equal(fs.existsSync(path.join(pkgDir, forbidden)), false,
      '发布物不得包含 ' + forbidden + '（files 白名单失效）');
  }
});

test('RTL-05 发布物内两个产物的模块 id 指向新分层路径（分层未回退）', () => {
  const { pkgDir, pkg } = packed();
  const host = fs.readFileSync(path.join(pkgDir, 'plugin-host.js'), 'utf8');
  const client = fs.readFileSync(path.join(pkgDir, pkg.exports['./client']), 'utf8');

  assert.ok(host.includes('src/host/domains/enhance/pure.cjs'),
    'host 产物必须内联新分层路径（src/host/domains/...）');
  assert.ok(host.includes('src/host/app.cjs'), 'host 产物必须内联装配入口 app.cjs');
  assert.ok(client.includes('src/client/domains/voice/official-bridge.cjs'),
    'client 产物必须内联新分层路径（src/client/domains/...）');
  assert.ok(client.includes('src/client/app.cjs'), 'client 产物必须内联装配入口 app.cjs');

  // 反向：旧扁平名不得复活
  assert.equal(host.includes('src/host/pure-module.cjs'), false, '旧扁平名不得复活');
  assert.equal(client.includes('src/client/voice/official-bridge-module.cjs'), false,
    '旧扁平名不得复活');
});
