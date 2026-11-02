'use strict';

// 目标模式第 1 批：构建器换代的最小契约测试。
// 该测试只验证“源码可正常模块化、产物自包含”这一机制，不切换正式构建入口。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');

async function loadBundler() {
  return import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'module-bundler.mjs')).href);
}

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  return dir;
}

test('MB-01 ESM 相对依赖 + 命名导出被正确打包', async () => {
  const { bundleModules } = await loadBundler();
  const dir = fixture({
    'entry.mjs': "import { add, label } from './lib/math.mjs';\nexport const result = add(2, 3) + ':' + label;\n",
    'lib/math.mjs': "export const label = 'sum';\nexport function add(a, b) { return a + b; }\n",
  });
  const out = bundleModules({ root: dir, entry: 'entry.mjs' });
  const api = new Function('return (' + out.code.replace(/^\/\/[^\n]*\n/, '') + ')')();
  assert.equal(api.result, '5:sum');
  assert.equal(out.code.includes("from './lib/math.mjs'"), false, '产物不得保留源码相对导入');
  assert.deepEqual(out.modules, ['lib/math.mjs', 'entry.mjs']);
});

test('MB-02 CommonJS 相对依赖被正确打包，module.exports 语义保留', async () => {
  const { bundleModules } = await loadBundler();
  const dir = fixture({
    'entry.cjs': "const util = require('./util.cjs');\nmodule.exports = { value: util.twice(4) };\n",
    'util.cjs': 'exports.twice = (n) => n * 2;\n',
  });
  const out = bundleModules({ root: dir, entry: 'entry.cjs' });
  const api = new Function('return (' + out.code.replace(/^\/\/[^\n]*\n/, '') + ')')();
  assert.equal(api.value, 8);
  assert.equal(out.code.includes("require('./util.cjs')"), false, '产物不得保留外部 require');
});

test('MB-03 循环依赖不崩溃：模块先登记、后执行', async () => {
  const { bundleModules } = await loadBundler();
  const dir = fixture({
    'a.mjs': "import { b } from './b.mjs';\nexport const a = 'a';\nexport const seenB = () => b;\n",
    'b.mjs': "import { a } from './a.mjs';\nexport const b = 'b';\nexport const seenA = () => a;\n",
  });
  const out = bundleModules({ root: dir, entry: 'a.mjs' });
  const api = new Function('return (' + out.code.replace(/^\/\/[^\n]*\n/, '') + ')')();
  assert.equal(api.a, 'a');
  assert.equal(api.seenB(), 'b');
});

test('MB-04 无法解析的相对导入必须点名文件并抛错（fail-closed）', async () => {
  const { bundleModules } = await loadBundler();
  const dir = fixture({ 'entry.mjs': "import { x } from './missing.mjs';\nexport const y = x;\n" });
  assert.throws(() => bundleModules({ root: dir, entry: 'entry.mjs' }),
    (e) => /missing\.mjs/.test(e.message) && /entry\.mjs/.test(e.message));
});

test('MB-05 确定性：同一输入两次打包逐字相同', async () => {
  const { bundleModules } = await loadBundler();
  const dir = fixture({
    'entry.mjs': "import { x } from './x.mjs';\nexport const y = x + 1;\n",
    'x.mjs': 'export const x = 41;\n',
  });
  assert.equal(bundleModules({ root: dir, entry: 'entry.mjs' }).code, bundleModules({ root: dir, entry: 'entry.mjs' }).code);
});
test('MB-06 集成：现有共享模块可被新打包器打成自包含表达式', async () => {
  const { bundleModules } = await loadBundler();
  const out = bundleModules({ root: ROOT, entry: 'src/shared/voice/postprocess-plan.cjs' });
  assert.deepEqual(out.modules, ['src/shared/voice/postprocess-plan.cjs']);
  assert.equal(out.code.includes("require('"), false, '产物不得含外部 require');
  const api = new Function('return (' + out.code.replace(/^\/\/[^\n]*\n/, '') + ')')();
  assert.equal(typeof api.planVoicePostprocess, 'function');
  assert.deepEqual(api.planVoicePostprocess({ fillerEnabled: true, correctionEnabled: true }).steps, ['filler', 'correction']);
});