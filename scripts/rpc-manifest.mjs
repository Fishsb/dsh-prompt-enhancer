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
import { emitRingState, installCrashGuard, installStdoutHygiene } from './lib/ring-state.mjs';

installCrashGuard('rpc');
installStdoutHygiene();   // 本环 --json 的 stdout 是机读数据面 ⇒ 契约行不得污染它
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const args = process.argv.slice(2);

/**
 * 注册面派生：插件双半部的 harness.handle 并集。
 *
 * ⚠ P2-3（2026-10-13 拆分批）：`lib/index.cjs` 已拆为「薄装配入口 + 按域 lib/*.cjs」，
 *   **原生注册面随实现分布在多个文件**（config/* → lib/rpc-config.cjs；voice/* → lib/rpc-voice.cjs）。
 *   若此处仍只扫 `lib/index.cjs`，`native` 会**静默变 0**（随后有人改数字锁 = 改浅）。
 *   ⇒ 派生面改为**枚举 lib/ 下全部非生成 .cjs**（排除构建产物 client.cjs —— 那是 client 半部，
 *   不注册 host RPC；含 `harness.handle('x'` 即计入）。`native` 的**语义与数字（4）不变**。
 */
function deriveLiveMethods() {
  const grab = (f) => [...read(f).matchAll(/harness\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
  const generated = new Set(['client.cjs']);   // 构建产物：非 host 注册面（`node scripts/build-client.mjs`）
  const native = fs.readdirSync(path.join(ROOT, 'lib'))
    .filter((f) => f.endsWith('.cjs') && !generated.has(f))
    .sort()
    .flatMap((f) => grab('lib/' + f));
  const bundled = grab('plugin-host.js');
  const live = [...new Set([...native, ...bundled])].sort();
  const intersection = native.filter((x) => bundled.includes(x));
  // ⚠ P2 复核处置批（2026-10-13 · F7）：`derivedFrom` 一度是**硬编码字面量**
  //   `['lib/index.cjs','plugin-host.js']`，与拆分后的真实派生面（枚举整个 lib/）不符。
  //   现由**派生代码同源产出**，不留字面量 ⇒ 扫描面再变时读数自动跟随。
  const nativeFiles = fs.readdirSync(path.join(ROOT, 'lib'))
    .filter((f) => f.endsWith('.cjs') && !generated.has(f))
    .sort()
    .map((f) => 'lib/' + f);
  const derivedFrom = [...nativeFiles, 'plugin-host.js'];
  return { native, bundled, live, intersection, derivedFrom };
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
  'enhance/progress': 'A 只读：查询优化进度（不存在的 seq 返回空）',
  cancel: 'A 只读：取消信号（无匹配时静默成功）',
  // B 桶：有入参但**保持宽松**——补校验会改变已发布对外行为，须单列 BREAKING 后由用户拍板
  'models/resolve': 'B 有参（provider/model）保持宽松：非法值由下游 resolveModelInfo 兜底，收紧急属 BREAKING',
};

/**
 * 文档「当前清单」提取（T3 · 2026-10-13 · 判据单向 → 双向）。
 *
 * 背景：旧判据只判 `missingInDoc`（线上有、文档无 = 漏写），**不判反向**（文档有、线上无 = 幽灵）
 *   ⇒ RPC 退役后文档条目静默留存，而门禁五环全绿（CHG-029 一类：用户可读处不得描述不存在的能力）。
 *
 * ⚠ 难点：文档**合法地**会出现已退役方法名（历史版本对照 / 「已退役」说明 / 删除线）⇒ 判据必须
 *   能区分「当前清单」与「历史/说明」。采用的区分方案（**刻意选窄、宁漏不误报**）：
 *     只取 **`### host RPC` 小节内、行首为 `|` 的表格行**、且取**第一列反引号内的名字**。
 *     —— 理由：① 历史/说明条目一律写成 `> 注：…` / `> ⚠ 历史…`（**blockquote**，行首是 `>`，不匹配）；
 *     ② 删除线形态 `~~…~~` 不在表格行首单元格内（现档为 blockquote 内）；
 *     ③ 「宁漏」可接受：本判据补的是**表格（当前清单的正式载体）**；blockquote 里散落的旧名不再逐字判
 *        （那会与"历史对照合法"直接冲突）——**覆盖边界如实声明，不冒充全覆盖**。
 *   ⇒ 本判据 = 「**§2 当前 RPC 表里列出的每个方法名都必须在线上**」。
 */
function deriveCurrentDocMethods() {
  const lines = read('docs/compatibility-matrix.md').split('\n');
  const start = lines.findIndex((l) => /^###\s+host RPC/.test(l));
  if (start < 0) return { ok: false, methods: [] };
  const out = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^###\s/.test(l) || /^##\s/.test(l)) break;      // 下一个小节即止
    if (!l.startsWith('|')) continue;                       // 只取表格行（行首 |），排除 > 引注
    const first = l.slice(1).split('|')[0];                  // 第一列
    for (const m of first.matchAll(/`([^`]+)`/g)) {
      const name = m[1];
      if (/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/.test(name)) out.add(name);   // 只收 RPC 名形态
    }
  }
  return { ok: true, methods: [...out].sort() };
}

const { native, bundled, live, intersection, derivedFrom } = deriveLiveMethods();
const schemas = schemaKeys();
const doc = read('docs/compatibility-matrix.md');
/**
 * 文档面判定（P2 复核处置批 2026-10-13 · 处置 F6：两方向**口径对称**）。
 *
 * 病历：`missingInDoc` 用**全文** `doc.includes(...)`，而 `ghostInDoc` 用**§2 小节表格** ⇒ 不对称。
 *   后果（复核实证）：把 §2「当前清单」表格里的一行删掉**不报警** —— 因为那 9 条无 schema 的
 *   方法在下面的「具名申报表」里**另有一份具名条目**，全文匹配仍被满足 ⇒ 当前清单表可以被删空
 *   而不触发任何判据。
 * ⇒ 现改为**双口径**：① `missingInDoc`（**全文**，保留作兜底——覆盖 blockquote / 正文里的提及）；
 *   ② `missingInTable`（**§2 当前清单表内**，与 `ghostInDoc` 的解析面**完全同一小节同一张表** ⇒ 对称）。
 *   两者任一非空即 FAIL，失败信息**分别点名**是哪种缺失，避免互相遮蔽。
 *
 * ⚠ 本判据**不覆盖什么**（如实声明）：
 *   · 不判「§2 表格里的**说明文字**是否准确」（只判方法名存在性）；
 *   · 不判 blockquote 历史区里的方法名（那里合法保留已退役条目，见 `deriveCurrentDocMethods`）；
 *   · 不判 §2 之外的其它小节（如 §4.1 客户端依赖表）。
 */
const missingInDoc = live.filter((m) => !doc.includes('`' + m + '`'));
const currentDoc = deriveCurrentDocMethods();
// 正向判据（**表格内**，与反向同口径）：线上每条方法名都必须出现在 §2 当前清单表内
const missingInTable = live.filter((m) => !currentDoc.methods.includes(m));
// 反向判据：文档「当前清单」小节里列出的方法名，必须在线上
const ghostInDoc = currentDoc.methods.filter((m) => !live.includes(m));
const gap = live.filter((m) => !schemas.includes(m));
const declared = Object.keys(DECLARED_NO_SCHEMA).sort();
const orphanSchema = schemas.filter((m) => !live.includes(m));

const fails = [];
if (native.length === 0 || bundled.length === 0) fails.push('注册面解析为空（lib/index.cjs 或 plugin-host.js 未匹配到 harness.handle）');
if (intersection.length) fails.push('双半部注册面交集非空（接线错误）: ' + intersection.join(', '));
if (missingInDoc.length) fails.push('线上方法未出现在 docs/compatibility-matrix.md（全文）: ' + missingInDoc.join(', '));
if (missingInTable.length) fails.push('线上方法未出现在 docs/compatibility-matrix.md 的 **§2 当前清单表**内（漏写/被删行）: ' + missingInTable.join(', '));
if (!currentDoc.ok) fails.push('文档当前 RPC 清单小节未找到（### host RPC）——解析口径失效，须先对齐');
else if (ghostInDoc.length) fails.push('文档当前清单含线上不存在的方法（幽灵条目）: ' + ghostInDoc.join(', '));
const undeclared = gap.filter((m) => !declared.includes(m));
const stale = declared.filter((m) => !gap.includes(m));
if (undeclared.length) fails.push('线上无 schema 且未申报（禁止静默增长）: ' + undeclared.join(', '));
if (stale.length) fails.push('申报已过期（声明了但线上已不缺）: ' + stale.join(', '));
if (orphanSchema.length) fails.push('schema 有、线上无的孤儿条目: ' + orphanSchema.join(', '));

const manifest = {
  derivedFrom,   // ⚠ P2 复核处置批（F7）：由 deriveLiveMethods() 同源产出，非字面量
  counts: { native: native.length, bundled: bundled.length, live: live.length, schema: schemas.length, gap: gap.length },
  live, schemaCovered: live.filter((m) => schemas.includes(m)), noSchema: gap,
  docCurrent: currentDoc.methods, ghostInDoc, missingInTable,
};

if (args.includes('--json')) console.log(JSON.stringify(manifest, null, 2));
else {
  console.log('RPC 事实源（由注册面派生）');
  console.log('  注册面: lib/index.cjs ' + native.length + ' + plugin-host.js ' + bundled.length + ' = 去重 ' + live.length + '（交集 ' + intersection.length + '）');
  console.log('  schema 覆盖: ' + manifest.schemaCovered.length + '/' + live.length + '；显式申报无校验: ' + gap.length);
  console.log('  文档面 docs/compatibility-matrix.md 覆盖: ' + (live.length - missingInDoc.length) + '/' + live.length);
  console.log('  双向判据: 漏写(全文) ' + missingInDoc.length + ' 条 · 漏写(§2 表内) ' + missingInTable.length + ' 条 · 幽灵（文档当前清单有、线上无）' + ghostInDoc.length + ' 条 / 文档当前清单 ' + currentDoc.methods.length + ' 条');
}

if (args.includes('--check')) {
  if (fails.length) {
    console.error('\n✗ RPC 事实源一致性未通过：');
    for (const f of fails) console.error('  · ' + f);
    // 状态行在 exit 之前打：退出码与状态**同源**（fails 为同一份裁决），且不得因 exit 丢读数。
    emitRingState('rpc', 'FAIL', fails.length + ' 条不变量失败：' + fails.map((f) => f.split('：')[0].split(':')[0]).join(' / '));
    process.exit(1);
  }
  console.log('\n✓ RPC 事实源一致：' + live.length + ' 条线上方法 / ' + schemas.length + ' 条有校验 / ' + gap.length + ' 条已具名申报不校验 / 0 孤儿 / 文档 100% 覆盖（含双向：' + currentDoc.methods.length + ' 条文档当前清单全部在线）');
  emitRingState('rpc', 'PASS',
    live.length + ' 条线上方法一致 / schema ' + schemas.length + ' / 具名申报 ' + gap.length + ' / 0 孤儿 / 文档 100% 覆盖（双向 ' + currentDoc.methods.length + ' 条）');
} else {
  // 本环只在 --check 下做判定：无该旗时退出码不反映判定，**不得记 PASS**（如实报 SKIP）。
  emitRingState('rpc', 'SKIP', '未带 --check（清单/--json 为报表形态，未判一致性）');
}
