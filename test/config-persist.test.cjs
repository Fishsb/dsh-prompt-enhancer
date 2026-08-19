// config 磁盘持久化契约测试（v3.2.4 · Issue #1 修复审查补充）
// 覆盖：① lib/rpc-schema.cjs 的 config/get·config/set 参数校验行为
//       ② src/host/rpc-schema.js（源）与 lib/rpc-schema.cjs（运行时副本）双份同步防漂移
//       ③ lib/index.cjs 注册 config/get·config/set（防未来重构删除无感）
//       ④ plugin-client.js 产物含 syncConfigFromHost/hostSync（client 逻辑构建注入防漂移）
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const libSchema = require('../lib/rpc-schema.cjs');

test('CFG-P01 config/get 无参数校验通过', () => {
  assert.equal(libSchema.validateRpcArgs('config/get', {}).ok, true);
});

test('CFG-P02 config/set 对象配置通过', () => {
  assert.equal(libSchema.validateRpcArgs('config/set', { config: { version: 2 } }).ok, true);
});

test('CFG-P03 config/set 非对象（字符串/数组/null）拒绝', () => {
  assert.equal(libSchema.validateRpcArgs('config/set', { config: 'x' }).ok, false);
  assert.equal(libSchema.validateRpcArgs('config/set', { config: [1, 2] }).ok, false);
  assert.equal(libSchema.validateRpcArgs('config/set', { config: null }).ok, false);
});

test('CFG-P04 config/set 缺 config 拒绝（MISSING_ARG）', () => {
  const r = libSchema.validateRpcArgs('config/set', {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MISSING_ARG');
});

test('CFG-P05 src/host/rpc-schema.js 源与 lib 副本均含 config/*（双份同步防漂移）', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'host', 'rpc-schema.js'), 'utf8');
  const m = src.match(/module\.exports = \"([\s\S]*)\"\s*;?\s*$/);
  const body = m ? m[1] : src;
  assert.ok(body.includes("'config/get'"), 'src/host 源缺 config/get');
  assert.ok(body.includes("'config/set'"), 'src/host 源缺 config/set');
  assert.ok(body.includes("required: ['config']"), 'src/host 源 config/set 缺 required 校验');
  // lib 副本行为由 CFG-P01~P04 覆盖
});

test('CFG-P06 lib/index.cjs 注册 config/get·config/set RPC', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'index.cjs'), 'utf8');
  assert.ok(src.includes("harness.handle('config/get'"), 'lib/index.cjs 未注册 config/get');
  assert.ok(src.includes("harness.handle('config/set'"), 'lib/index.cjs 未注册 config/set');
  assert.ok(src.includes('dsh-prompt-enhancer.config.json'), '配置文件路径常量缺失');
  assert.ok(src.includes('renameSync'), '原子写（renameSync）缺失');
});

test('CFG-P07 plugin-client.js 产物含 syncConfigFromHost/hostSync（构建注入防漂移）', () => {
  const s = readFileSync(join(__dirname, '..', 'plugin-client.js'), 'utf8');
  assert.ok(s.includes('syncConfigFromHost'), 'client 产物缺 syncConfigFromHost');
  assert.ok(s.includes('hostSync'), 'client 产物缺 hostSync 状态机');
});
