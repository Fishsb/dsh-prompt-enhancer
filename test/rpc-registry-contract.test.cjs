'use strict';

// 契约单一事实源锁（2026-11-04）：
//   RPC 名称、参数形状、schema 面与「显式无校验」声明都来自 lib/contracts.cjs。
//   本文件锁住三件事：
//     ① 契约表与线上注册面完全一致（新增/退役不会被静默漏掉）；
//     ② 参数校验实现确实从契约派生（不是各写一份）；
//     ③ 错误码映射与配置/模式默认值不再有第二份手写实现。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const contract = require(path.join(ROOT, 'lib', 'contracts.cjs'));
const schema = require(path.join(ROOT, 'lib', 'rpc-schema.cjs'));

function liveManifest() {
  const raw = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'rpc-manifest.mjs'), '--json'], {
    encoding: 'utf8', cwd: ROOT,
  });
  const line = raw.split('\n').find((l) => l.trim().startsWith('{'));
  return JSON.parse(raw.slice(raw.indexOf(line)).trim());
}

test('RCR-01 契约表与线上注册面逐项相等（双向）', () => {
  const m = liveManifest();
  assert.deepEqual([...contract.RPC_METHOD_LIST].sort(), [...m.live].sort());
  assert.equal(contract.RPC_METHOD_LIST.length, 15);
  assert.equal(contract.RPC_METHOD_LIST.length, new Set(contract.RPC_METHOD_LIST).size, '契约表不得有重复方法');
});

test('RCR-02 schema 面与显式无校验声明由同一张表派生（无第二份清单）', () => {
  const m = liveManifest();
  assert.deepEqual([...contract.RPC_SCHEMA_METHOD_LIST].sort(), [...m.schemaCovered].sort());
  assert.deepEqual(Object.keys(contract.RPC_DECLARED_NO_SCHEMA).sort(), [...m.noSchema].sort());
  for (const name of contract.RPC_SCHEMA_METHOD_LIST) {
    assert.equal(typeof schema.schemas[name], 'object', '有 schema 的契约行必须在 rpc-schema 中有实现：' + name);
    assert.deepEqual(schema.schemas[name].required, [...contract.RPC_REGISTRY[name].required]);
  }
  for (const name of Object.keys(contract.RPC_DECLARED_NO_SCHEMA)) {
    assert.equal(schema.schemas[name], undefined, '显式无校验的方法不得偷偷获得 schema：' + name);
  }
});

test('RCR-03 参数校验行为逐项锁住（现有 RPC 契约不变）', () => {
  assert.equal(schema.validateRpcArgs('enhance', { sessionId: 's', text: 'x' }).ok, true);
  assert.equal(schema.validateRpcArgs('enhance', { sessionId: 's', draft: 'x' }).code, 'MISSING_ARG');
  assert.equal(schema.validateRpcArgs('enhance', { sessionId: 1, text: 'x' }).code, 'INVALID_ARG');
  assert.equal(schema.validateRpcArgs('models/test', { provider: 'p' }).code, 'MISSING_ARG');
  assert.equal(schema.validateRpcArgs('config/set', { config: [] }).code, 'INVALID_ARG');
  assert.equal(schema.validateRpcArgs('voice/correct', { sessionId: 's', text: 'x' }).ok, true);
  assert.equal(schema.validateRpcArgs('enhance/progress', { sessionId: 's', seq: 1 }).ok, true, '显式无校验方法保持宽松');
});

test('RCR-04 方法名只出现在契约里：schema 实现不得再写一份字面量表', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'rpc-schema.cjs'), 'utf8');
  assert.equal((src.match(/harness\.handle\(/g) || []).length, 0);
  assert.equal(/['"](?:enhance|config\/get|models\/test|voice\/correct)['"]\s*:\s*\{/.test(src), false,
    'schema 实现不得再写第二份方法字面量表');
  assert.ok(src.includes("require('./contracts.cjs')"), 'schema 必须从契约事实源取数');
});

test('RCR-05 错误码映射与配置/模式默认值只有一份实现', () => {
  const helpers = fs.readFileSync(path.join(ROOT, 'src', 'client', 'helpers-module.cjs'), 'utf8');
  assert.equal(/const\s+ERROR_KEYS\s*=\s*\{/.test(helpers), false, '客户端不得再持有第二份 ERROR_KEYS');
  assert.ok(helpers.includes("contracts/errors.cjs"), '客户端错误映射必须来自共享契约');
  assert.equal(contract.errorKeyOf('TIMEOUT'), 'errTIMEOUT');
  assert.equal(contract.errorKeyOf('UNKNOWN_FUTURE_CODE'), 'errUNKNOWN');
  assert.deepEqual(contract.MODE_KEYS, ['base', 'lite', 'standard', 'smart', 'publish']);
  assert.equal(contract.CONFIG_DEFAULTS.version, 2);
  assert.equal(contract.MODE_PARAMS_DEFAULT.smart.timeoutMs, 60000);
  assert.deepEqual(contract.MODE_BUDGET_OPTIONS.lite, [0, 2000, 4000]);
  const clientState = fs.readFileSync(path.join(ROOT, 'src', 'client', 'state-module.cjs'), 'utf8');
  assert.ok(clientState.includes('return JSON.parse(JSON.stringify(CONFIG_DEFAULTS));'), 'cloneDefaults 必须深拷贝契约默认值');
  assert.equal(/function cloneDefaults\(\)[\s\S]*?timeoutMs:\s*30000/.test(clientState), false,
    '客户端不得再持有第二份完整配置默认值');
  assert.equal(require(path.join(ROOT, 'src', 'host', 'correction-switch.cjs')).CORRECTION_DISABLED_CODE,
    contract.RPC_ERROR_CODES.CORRECTION_DISABLED, '纠错跳过码必须取自契约');
  assert.equal(fs.readFileSync(path.join(ROOT, 'src', 'host', 'correction-switch.cjs'), 'utf8')
    .includes("CORRECTION_DISABLED_CODE = 'CORRECTION_DISABLED'"), false, '不得再手写纠错跳过码字面量');
});

test('RCR-06 RPC 名称不再散落：手改宿主/客户端代码只通过 RPC_METHODS / 注入面取用', () => {
  const roots = ['src', 'lib'];
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.name.endsWith('.cjs')) continue;
      if (ent.name === 'client.cjs') continue;
      files.push(full);
    }
  };
  for (const root of roots) walk(path.join(ROOT, root));
  const offenders = [];
  for (const file of files) {
    if (path.basename(file) === 'contracts.cjs') continue;
    const code = fs.readFileSync(file, 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');
    if (/host\.call\(\s*'|api\.call\(\s*'|harness\.handle\(\s*'/.test(code)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], 'RPC 方法名字面量必须集中在 lib/contracts.cjs：' + offenders.join(', '));
});
