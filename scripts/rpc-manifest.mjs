#!/usr/bin/env node
// scripts/rpc-manifest.mjs —— RPC 契约**事实源派生器**（P2 · 2026-09-19 · 关 RC-A「无单一事实源」）
//
// 背景：RPC 面曾有三处并存——线上注册面（34）/ 死层 src/host/protocol.js 声明（21，已于 P1b 删除）/
// 参数校验面 lib/rpc-schema.cjs（17）。死层删掉后，「哪些方法是线上真值」此前仍靠人工清点。
// 本脚本把事实源改为**由注册面派生**（静态扫描插件双半部的 harness.handle），并 `--check` 锁死四不变量：
//   ① 两处注册面非空且**交集为 0**（双半部各管一段，重叠即接线错误）
//   ② 派生出的每一条都必须出现在文档事实源 docs/compatibility-matrix.md 中
//   ③ 参数校验空缺集必须与 DECLARED_NO_SCHEMA **完全相等**（新增线上方法却不申报 → FAIL；申报过期 → FAIL）
//   ④ 不得存在「schema 有、线上无」的孤儿条目
//
// 用法：node scripts/rpc-manifest.mjs [--check] [--json]
//   不带 --check 打印清单；--json 输出机器可读；--check 退出码 0/1。
//
// ⚠ 为什么不补那 17 条校验：补校验会把既有「静默容忍」的调用变成 400，属**已发布对外行为变更**，
//   须单列并标 BREAKING 由用户拍板（圆桌决策 A 的边界）。故本轮只做**显式声明**，不做运行时收紧。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const args = process.argv.slice(2);

/** 注册面派生：插件双半部的 harness.handle 并集 */
function deriveLiveMethods() {
  const grab = (f) => [...read(f).matchAll(/harness\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
  const native = grab('lib/index.cjs');
  const bundled = grab('plugin-host.js');
  const live = [...new Set([...native, ...bundled])].sort();
  const intersection = native.filter((x) => bundled.includes(x));
  return { native, bundled, live, intersection };
}

/** schema 面：lib/rpc-schema.cjs 的 schemas 对象顶层键 */
function schemaKeys() {
  return [...read('lib/rpc-schema.cjs').matchAll(/^\s{2}'([^']+)':\s*\{/gm)].map((m) => m[1]).sort();
}

/**
 * 显式声明的「无参数校验」清单（P2 处置声明）。
 * 分两桶，理由必须写清——**禁止按类别笼统豁免**，新增项必须具名申报。
 */
const DECLARED_NO_SCHEMA = {
  // A 桶：无参 / 只读 / 无副作用入参——校验无可校验之物
  'models/list': 'A 无参只读：列举 provider 与模型',
  'models/current': 'A 无参只读：读当前选择的模型',
  'models/autochain': 'A 入参仅 noCache 布尔，宽松语义即契约',
  'models/stats': 'A 入参仅 provider/model/inputChars 展示用，非法值退化为空统计（无副作用）',
  'logs/last': 'A 无参只读：返回日志环',
  'template/default': 'A 无参只读：返回内置模板目录',
  'plugins/inventory': 'A 只读：列举插件清单',
  'enhance/progress': 'A 只读：查询优化进度（不存在的 seq 返回空）',
  cancel: 'A 只读：取消信号（无匹配时静默成功）',
  'update/restartNeeded': 'A 只读：文件 mtime 比对，无副作用',
  'voice/deployRuntime': 'A 无参动作：部署本地 ASR worker（固定流程，无用户入参）',
  'voice/deployStatus': 'A 无参只读：本地 worker 部署态',
  // B 桶：有入参但**保持宽松**——补校验会改变已发布对外行为，须单列 BREAKING 后由用户拍板
  'models/resolve': 'B 有参（provider/model）保持宽松：非法值由下游 resolveModelInfo 兜底，收紧急属 BREAKING',
  'plugins/stop': 'B 有参（pluginId）保持宽松：非法 id 由插件面自行返回 not-found',
  'plugins/undefine': 'B 有参（pluginId）保持宽松：同上',
  'update/executorEnsure': 'B 有参（port）保持宽松：非法端口由执行器侧拒绝',
  'update/pull': 'B 有参（repo/sessionId）保持宽松：本仓无调用点（handler 按决策保留），收紧收益为零',
};

const { native, bundled, live, intersection } = deriveLiveMethods();
const schemas = schemaKeys();
const doc = read('docs/compatibility-matrix.md');
const missingInDoc = live.filter((m) => !doc.includes('`' + m + '`'));
const gap = live.filter((m) => !schemas.includes(m));
const declared = Object.keys(DECLARED_NO_SCHEMA).sort();
const orphanSchema = schemas.filter((m) => !live.includes(m));

const fails = [];
if (native.length === 0 || bundled.length === 0) fails.push('注册面解析为空（lib/index.cjs 或 plugin-host.js 未匹配到 harness.handle）');
if (intersection.length) fails.push('双半部注册面交集非空（接线错误）: ' + intersection.join(', '));
if (missingInDoc.length) fails.push('线上方法未出现在 docs/compatibility-matrix.md: ' + missingInDoc.join(', '));
const undeclared = gap.filter((m) => !declared.includes(m));
const stale = declared.filter((m) => !gap.includes(m));
if (undeclared.length) fails.push('线上无 schema 且未申报（禁止静默增长）: ' + undeclared.join(', '));
if (stale.length) fails.push('申报已过期（声明了但线上已不缺）: ' + stale.join(', '));
if (orphanSchema.length) fails.push('schema 有、线上无的孤儿条目: ' + orphanSchema.join(', '));

const manifest = {
  derivedFrom: ['lib/index.cjs', 'plugin-host.js'],
  counts: { native: native.length, bundled: bundled.length, live: live.length, schema: schemas.length, gap: gap.length },
  live, schemaCovered: live.filter((m) => schemas.includes(m)), noSchema: gap,
};

if (args.includes('--json')) console.log(JSON.stringify(manifest, null, 2));
else {
  console.log('RPC 事实源（由注册面派生）');
  console.log('  注册面: lib/index.cjs ' + native.length + ' + plugin-host.js ' + bundled.length + ' = 去重 ' + live.length + '（交集 ' + intersection.length + '）');
  console.log('  schema 覆盖: ' + manifest.schemaCovered.length + '/' + live.length + '；显式申报无校验: ' + gap.length);
  console.log('  文档面 docs/compatibility-matrix.md 覆盖: ' + (live.length - missingInDoc.length) + '/' + live.length);
}

if (args.includes('--check')) {
  if (fails.length) {
    console.error('\n✗ RPC 事实源一致性未通过：');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
  }
  console.log('\n✓ RPC 事实源一致：' + live.length + ' 条线上方法 / ' + schemas.length + ' 条有校验 / ' + gap.length + ' 条已具名申报不校验 / 0 孤儿 / 文档 100% 覆盖');
}
