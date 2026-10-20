#!/usr/bin/env node
// scripts/split-identity.mjs —— 环 `cross: pkg-identity`（拆包前置批 · 2026-10-20）
//
// 判据（一句话）：**同一套 identity 不得被两个包共用**。四项逐一判，任一撞即红：
//   ① loader entry id（`cordis.patch.yml`）② client 模块 id（`lib/client.cjs`）
//   ③ RPC 路由前缀（`lib/index.cjs`）④ RPC 方法名（双半部 `harness.handle`）
//
// 为什么它必须存在（CHG-289 §3.3 实测，**静默面**）：
//   两包若用同一 loader entry id，宿主 `composeEntries` 实测输出
//       same id twice -> [{…},{…}] warns= []
//   —— 不报错、不告警、`warns= []`。⇒ 撞了也全链零红 ⇒ **只能仓内机检拦**。
//
// ⚠ 「拆包前后同一判据」怎么成立：本环读的是**发现面**上的**全部** identity 条目，
//   拆包前该面上只有 1 个包（条目去重后 = 1，不撞 ⇒ 绿），拆包后自动变成 2 个包。
//   ⚠ 绿**不是空跑**：`--json` 与通过行都会报 `observed`（实际扫到的条目数），
//     且分母有**下限**断言（见 MIN_OBSERVED）——扫得少 ⇒ 红，不是绿。
//
// 用法：node scripts/split-identity.mjs [--check] [--json]

import fs from 'node:fs';
import path from 'node:path';
import { emitRingState, installCrashGuard } from './lib/ring-state.mjs';
import {
  patchEntryIdentities, clientModuleIds, rpcRoutePrefixes, rpcMethods,
  findCollisions, libCjsFiles, REPO_ROOT,
} from './lib/split-identity.mjs';

installCrashGuard('pkg-identity');
const args = process.argv.slice(2);
const read = (rel) => { try { return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); } catch (e) { return null; } };

/**
 * 分母下限（fail-closed）。**低于任一项即红**，⛔ 不许「扫得少所以都相等」。
 * 依据（2026-10-20 实测）：patch 1 条 insert · client 产物 1 个 id · RPC 前缀 1 处 ·
 *   线上方法 15 条（`rpc-manifest` 同源读数）。取**下限**而非等值，拆包后自动容纳 2 套。
 */
const MIN_OBSERVED = { 'loader entry id': 1, 'client 模块 id': 1, 'RPC 路由前缀': 1, 'RPC 方法名': 15 };

const patchText = read('cordis.patch.yml');
const clientText = read('lib/client.cjs');
const indexText = read('lib/index.cjs');

const entries = patchText === null ? [] : patchEntryIdentities(patchText);
const libFiles = libCjsFiles(REPO_ROOT);
const allHostText = libFiles.map((f) => read(f) || '').join('\n') + '\n' + (read('plugin-host.js') || '');

const groups = [
  { label: 'loader entry id', values: entries.map((e) => e.id) },
  { label: 'client 模块 id', values: clientText === null ? [] : clientModuleIds(clientText) },
  { label: 'RPC 路由前缀', values: indexText === null ? [] : rpcRoutePrefixes(indexText) },
  // ⚠ **不得先去重再判重**（本批负控 D 实测踩到）：`[...new Set(...)]` 会把"两处注册同名方法"
  //   这一**缺陷本身**先消掉 ⇒ 判据恒绿。判重必须用**注册点**的原样列表；
  //   去重后的条数只用于 `observed` 的非空跑断言（见下方 `distinct`）。
  { label: 'RPC 方法名', values: rpcMethods(allHostText) },
];

const fails = [];
if (patchText === null) fails.push('cordis.patch.yml 缺位（无扫描面 ⇒ 不得判绿）');
if (clientText === null) fails.push('lib/client.cjs 缺位（无扫描面 ⇒ 不得判绿）');
if (indexText === null) fails.push('lib/index.cjs 缺位（无扫描面 ⇒ 不得判绿）');
if (libFiles.length === 0) fails.push('lib/*.cjs 枚举为空（无扫描面 ⇒ 不得判绿）');

const { ok, duplicates, observed } = findCollisions(groups);
// ⚠ 分母口径用**去重后**的条数（`distinct`）：注册点原样列表会把"同名两处"算成 2 项，
//   用它会掩盖"方法太少但恰好重复"的情形。两者分工：`values` 判撞车，`distinct` 判分母。
const distinct = {};
for (const g of groups) distinct[g.label] = new Set(g.values).size;
for (const [label, min] of Object.entries(MIN_OBSERVED)) {
  const got = distinct[label] === undefined ? new Set(groups.find((g) => g.label === label).values).size : distinct[label];
  if (got < min) fails.push(`分母不足（fail-closed）：${label} 仅 ${got} 项，下限 ${min}`);
}
for (const d of duplicates) fails.push(`identity 撞车：${d.label} 出现 ${d.count} 次 —— ${JSON.stringify(d.value)}`);

// 语义重复（不同 label 却同一个值）——同一字符串既是 entry id 又是 client id 是**正常**的
// （同一包的两个面本来同名）。⚠ 故此处**只登记不判红**，避免把正常形态判成缺陷。
const crossLabel = [];
for (const a of groups) for (const b of groups) {
  if (a.label >= b.label) continue;
  for (const v of a.values) if (b.values.includes(v)) crossLabel.push({ a: a.label, b: b.label, value: v });
}

const report = { groups: groups.map((g) => ({ label: g.label, count: g.values.length, distinct: new Set(g.values).size, values: [...new Set(g.values)] })), observed, distinct, duplicates, crossLabel, fails };

if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log('identity 面（cross: pkg-identity）');
  for (const g of groups) console.log('  ' + g.label.padEnd(16) + g.values.length + ' 次 / ' + new Set(g.values).size + ' 唯一  ' + JSON.stringify([...new Set(g.values)]));
  console.log('  跨面同名（正常形态，只登记）：' + (crossLabel.length ? JSON.stringify(crossLabel) : '无'));
}

if (args.includes('--check')) {
  if (fails.length) {
    console.error('\n✗ identity 判据未通过：');
    for (const f of fails) console.error('  · ' + f);
    emitRingState('pkg-identity', 'FAIL', fails.length + ' 条：' + fails.slice(0, 2).join(' / '));
    process.exit(1);
  }
  const total = groups.reduce((n, g) => n + new Set(g.values).size, 0);
  console.log('\n✓ identity 不撞：4 面共 ' + total + ' 项唯一值（' + groups.map((g) => g.label + '=' + new Set(g.values).size).join(' · ') + '）');
  emitRingState('pkg-identity', 'PASS', '4 面 ' + total + ' 项 identity 无重：' + groups.map((g) => g.label + '=' + new Set(g.values).size).join('/'));
} else {
  emitRingState('pkg-identity', 'SKIP', '未带 --check（报表形态，未判 identity）');
}
