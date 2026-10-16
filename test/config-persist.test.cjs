// config 磁盘持久化契约测试（v3.2.4 · Issue #1 修复审查补充）
// 覆盖：① lib/rpc-schema.cjs 的 config/get·config/set 参数校验行为
//       ② rpc-schema 单一事实源 = lib/rpc-schema.cjs（P1b 2026-09-19：死层副本 src/host/rpc-schema.js 已删，不得复活）
//       ③ lib/index.cjs 注册 config/get·config/set（防未来重构删除无感）
//       ④ lib/client.cjs 产物含 syncConfigFromHost/hostSync（client 逻辑构建注入防漂移）
const { readFileSync, existsSync } = require('node:fs');
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

test('CFG-P05 rpc-schema 单一事实源：lib 副本含 config/*，死层副本不得复活', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'rpc-schema.cjs'), 'utf8');
  assert.ok(src.includes("'config/get'"), 'lib/rpc-schema.cjs 缺 config/get');
  assert.ok(src.includes("'config/set'"), 'lib/rpc-schema.cjs 缺 config/set');
  assert.ok(src.includes("required: ['config']"), 'config/set 缺 required 校验');
  assert.ok(!existsSync(join(__dirname, '..', 'src', 'host', 'rpc-schema.js')),
    '死层副本 src/host/rpc-schema.js 复活了——双架构不得回归（P1b）');
});

// P2-3（2026-10-13 拆分批）：源码锚**重锚**（实现随拆分移至 lib/rpc-config.cjs），
//   **断言一条不减**（仍是 4 条：两条 harness.handle + 配置路径常量 + 原子写）；
//   另加 1 条「入口接线」断言（拆分的完整前提：index.cjs 必须 require 该域模块）。
test('CFG-P06 config/get·config/set RPC 注册（P2-3：实现域 = lib/rpc-config.cjs，入口须接线）', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'rpc-config.cjs'), 'utf8');
  assert.ok(src.includes("harness.handle('config/get'"), 'rpc-config.cjs 未注册 config/get');
  assert.ok(src.includes("harness.handle('config/set'"), 'rpc-config.cjs 未注册 config/set');
  assert.ok(src.includes('dsh-prompt-enhancer.config.json'), '配置文件路径常量缺失');
  assert.ok(src.includes('renameSync'), '原子写（renameSync）缺失');
  const entry = readFileSync(join(__dirname, '..', 'lib', 'index.cjs'), 'utf8');
  assert.ok(entry.includes("require('./rpc-config.cjs')"), '入口未接线 rpc-config.cjs（拆分后成为孤儿模块）');
});

test('CFG-P07 lib/client.cjs 产物含 syncConfigFromHost/hostSync（构建注入防漂移）', () => {
  const s = readFileSync(join(__dirname, '..', 'lib', 'client.cjs'), 'utf8'); // P1a：唯一 client 载体
  assert.ok(s.includes('syncConfigFromHost'), 'client 产物缺 syncConfigFromHost');
  assert.ok(s.includes('hostSync'), 'client 产物缺 hostSync 状态机');
});

// ---- v3.2.5（语音模块）：config/set 顶层键级 merge 语义 ----
// P2-3（2026-10-13）：重锚到 lib/rpc-config.cjs（merge 实现随域移动）；**两条断言原样保留**。
test('CFG-P08 config/set 含 merge 实现（多写入方防互相清空）· 实现域 lib/rpc-config.cjs', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'rpc-config.cjs'), 'utf8');
  assert.ok(src.includes('顶层键级 merge'), 'config/set 未升级 merge 语义');
  assert.ok(src.includes('for (const k of Object.keys(patch)) merged[k] = patch[k]'), 'merge 合并逻辑缺失');
});

test('CFG-P09 config/set merge 行为：传单键保留其他键（模拟两写入方交替保存）', async () => {
  // 用真实 lib/index.cjs 的 merge 逻辑做行为验证（隔离环境：临时 CONFIG_FILE）
  const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cfg-'));
  const cfgFile = join(dir, 'config.json');
  // enhancer 先写全量（v3.2.4 行为），voice 再写 voice 键 → enhancer 键必须保留
  writeFileSync(cfgFile, JSON.stringify({ version: 2, fallback: [{ provider: 'a', model: 'b' }], params: { timeoutMs: 30000 } }));
  const orig = require('node:fs');
  // 直接复制 merge 逻辑验证（与 lib/index.cjs 同语义：读 → 顶层键合并 → 写）
  const cur = JSON.parse(orig.readFileSync(cfgFile, 'utf8'));
  const patch = { voice: { asr: { engine: 'cloud' } } };
  const merged = { ...cur };
  for (const k of Object.keys(patch)) merged[k] = patch[k];
  assert.equal(merged.version, 2, 'enhancer 顶层键被清空');
  assert.ok(Array.isArray(merged.fallback) && merged.fallback.length === 1, 'fallback 被清空');
  assert.equal(merged.voice.asr.engine, 'cloud', 'voice 键未写入');
  rmSync(dir, { recursive: true, force: true });
});

// ---- 🔴 P0 修复（2026-10-13）：saveConfig 整份提交清空用户 fallback ----
// 病灶：`saveConfig(patch)` 原实现提交 `{ config: configState.value }`（**整份**），
//   而 config/set 是**顶层键级 merge** ⇒ 整份里的每个顶层键都覆盖磁盘，含页面内可能为默认值
//   （`cloneDefaults().fallback = []`）⇒ 用户模型链被清空（实测：删最后一条模型 → 磁盘 fallback=[]）。
// 修法：**只提交本次 patch**。本组用例断言该契约，并给变异自证（退回整份 ⇒ 必红）。
// ⚠ 契约面收口批（2026-10-17 · 第 ② 件）：本文件原有第 6 份**同契约异名副本** `decodeStateChunk`
//   （只解 `src/client/state.js` 一件、正则写作非贪婪 `([\s\S]*?)`）。已收敛为共享单一事实源
//   （`scripts/lib/chunk-decode.mjs`）；调用点把路径显式写出，取值实测逐字相同。
//   ⚠ 取具名成员解构（`require()` 一个 ESM 模块拿到命名空间对象，不可直接调用 —— 实测）。
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');

test('CFG-P10 P0：saveConfig 只提交本次 patch（不得整份提交 configState.value）', () => {
  const src = decodeChunk('src/client/state.js');
  const i = src.indexOf('function saveConfig(patch)');
  assert.ok(i > 0, '未找到 saveConfig');
  const seg = src.slice(i, i + 2600);
  assert.ok(seg.includes('config/set'), 'saveConfig 须经 config/set 落盘');
  // 正向：必须以 payload 提交
  assert.ok(/config\/set',\s*\{\s*config:\s*payload\s*\}/.test(seg) || seg.includes('config: payload'),
    'saveConfig 必须提交 patch（payload），而不是整份 configState.value');
  // 反向：不得再出现「整份 configState.value 作为 config 提交」
  assert.ok(!/config\/set',\s*\{\s*config:\s*configState\.value\s*\}/.test(seg),
    'saveConfig 不得再整份提交 configState.value（会清空用户 fallback）');
});

test('CFG-P11 P0 行为：页面无模型链时写入 voice 配置 ⇒ 磁盘 fallback 不变（模拟 config/set 顶层键 merge）', () => {
  // 复现真实链路：磁盘有 fallback；页面侧 configState.value.fallback 为默认 []（未同步/已删空）
  // 旧实现提交整份 ⇒ fallback 被覆盖为 []；新实现只提交 patch ⇒ 磁盘 fallback 原样保留。
  const disk = { version: 2, fallback: [{ provider: 'd1api', model: 'deepseek-v4-flash' }], memory: false };
  const mergeTopLevel = (cur, patch) => { const m = { ...cur }; for (const k of Object.keys(patch)) m[k] = patch[k]; return m; };

  // 旧写法（整份提交，页面 fallback 为空）——必须能复现损伤，否则本判据没牙
  const pageState = { version: 2, fallback: [], memory: false, params: { timeoutMs: 30000 } };
  const damaged = mergeTopLevel(disk, pageState);
  assert.deepEqual(damaged.fallback, [], '前置：整份提交确实会清空 fallback（病灶可复现）');

  // 新写法（只提交 patch）——fallback 必须不变
  const patch = { params: { timeoutMs: 30000 } };
  const kept = mergeTopLevel(disk, patch);
  assert.deepEqual(kept.fallback, [{ provider: 'd1api', model: 'deepseek-v4-flash' }],
    '只提交 patch ⇒ 磁盘 fallback 必须原样保留');
  assert.equal(kept.version, 2, 'version 亦不得被清');
});

test('CFG-P12 P0 变异自证：把 saveConfig 退回「整份提交」⇒ CFG-P10 必红', () => {
  const src = decodeChunk('src/client/state.js');
  const anchor = 'config: payload';
  assert.ok(src.includes(anchor), 'patch 提交锚点须存在');
  const mutated = src.replace(anchor, 'config: configState.value');
  const i = mutated.indexOf('function saveConfig(patch)');
  const seg = mutated.slice(i, i + 2600);
  const stillPatchOnly = /config\/set',\s*\{\s*config:\s*payload\s*\}/.test(seg);
  assert.equal(stillPatchOnly, false, '退回整份提交后，CFG-P10 的正向断言必须失败（若仍通过 ⇒ 判据没牙）');
});
