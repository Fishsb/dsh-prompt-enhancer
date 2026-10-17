#!/usr/bin/env node
// scripts/claims-vs-source.mjs —— `D`「正本可复算对照」的 CLI（**人工收口显式调用 · 非 gate 环**）
//
// 用法：
//   node scripts/claims-vs-source.mjs --project /home/lk/.dsh/hob-ledgers/prompt-enhancer-release/PROJECT.md
//   PE_LEDGER_PROJECT=<正本路径> node scripts/claims-vs-source.mjs
//   node scripts/claims-vs-source.mjs --project <path> --json
//   node scripts/claims-vs-source.mjs --project <path> --assert-sites   # 附「断言级强度」读数
//
// 退出码：**0 = 逐条一致**；**1 = 有失真 / 有未判**（`unjudged` 与 `differ` 同码退出，
//   理由：本工具的唯一合法职责就是把"没对照上"摆出来 —— 把「未判」折成 0 就是假绿）。
//
// ⚠⚠ 触发点归属（作业书 §1-2 三选一，**逐字**）：
//   **本工具取「丙：如实登记为"人工收口显式调用"并标人载」**。
//   ⚠ 但**不是**"靠人记得跑"就完事 —— 人载在这里对**一处物理事实**成立，逐条给依据：
//     · **为何不能进 `gate` 环（否 甲）**：本对照的**输入在被治理工作区之外**（正本在账本区）。
//       `gate` 链的全部 5 环都设计为"在仓库/治理根内自洽"（`gate.mjs` 的环由 `package.json`
//       的 `gate` 字面量声明）。把账本区路径塞进环 ⇒ 环的扫描面走出工作区 ⇒ 与 `CHG-155`
//       本批自裁「**不移动账本区、不改门禁治理根**」直接冲突，且会让**干净 clone / CI 上必然红**
//       （CI 没有账本区）。**属方案面（改环语义）⇒ 本批不越权**（作业书：若须动 `gate` 环结构 ⇒ 停下上报）。
//     · **为何不能挂部署链（否 乙）**：`A-3`（`CHG-156` 引 `CHG-134`/`CHG-141`）已裁定
//       **「部署链语义不动」**，部署前置一律走**部署批的人工预检清单**（`C-11`）。
//       把本对照挂进 `sync-runtime.mjs` 等于**改部署链语义** ⇒ 与 `A-3` 冲突（作业书要求核这一条）。
//     · **为何为"人载"仍不是新甲类**：甲类的定义是「**机载但无触发点**」（工具在、没人被要求跑）。
//       本工具是**部署/收口**型工具，其触发点**已被既有载体承接** —— 正本 `§12.13.5` 与
//       `C-24` 的签到步原文即「**人工收口时显式调用**」；本 CLI 把那句话**落成一条可跑命令**
//       （此前它只是一句话，**才是**甲-2 的真身）。⇒ 载体从"一句话"升级为"一条命令 + 一个退出码"，
//       而触发点本身**仍归人载批次收口清单**，与 `S-8`（`CHG-139` 裁定：不接环、写成收口步骤）
//       **同构**。⚠ **本席如实登记其残余风险**：它仍依赖执行席在收口时真的跑（与 `C-24` 同病），
//       **不声称已根治**；根治路径 = 把账本区纳入机检面，那属方案面、须用户拍板。
//
// ⚠ fail-closed：正本读不到 / 锚点解析不出 / 派生源不可用 ⇒ **exit 1** 并逐条打印原因。
// ⚠ 本工具**只读**：不写正本（发现失真**只报告**，⛔ 不得自行改正本）、不写工作区、不部署。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareClaims, countAssertSites, PROJECT_ENV, REPO_ROOT } from './lib/claims-vs-source.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const json = has('--json');
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : REPO_ROOT;

const projectPath = valOf('--project') || process.env[PROJECT_ENV] || undefined;
const res = compareClaims({ projectPath, root: ROOT });

const ICON = (v) => (v === 'same' ? '✓' : v === 'differ' ? '✗' : '⤫');

if (json) {
  console.log(JSON.stringify({
    tool: 'claims-vs-source',
    triggerPoint: 'man-made closure (explicit CLI); NOT a gate ring, NOT in the deploy chain',
    scope: 'derivable facts only (RPC counts / file counts / line counts / key counts / index line counts)',
    outOfScope: 'semantic facts (e.g. 纠错归属 / 能力是否官方已有) — not derivable, judged by argument + user decision',
    projectPath: res.projectPath,
    ok: res.ok,
    rows: res.rows,
    problems: res.problems,
    assertSites: has('--assert-sites') ? countAssertSites(ROOT) : undefined,
  }, null, 1));
} else {
  console.log('正本可复算对照（`D` · 复用既有派生机制）· **人工收口显式调用**（非 gate 环 · 非部署链）');
  console.log('范围（硬边界）：**只覆盖可派生的事实** —— RPC 计数 / 件数 / 行数 / 键数 / 索引行数。');
  console.log('  ⛔ 语义类事实（如「纠错归属」「能力是否官方已有」）**不在此列** —— 其正确性判据是论证与用户拍板，不是计数。');
  console.log('  （重复跑不要钱；但"跑不跑"仍是人载环节 —— 见本脚本头注"触发点归属"的逐条依据）');
  console.log('正本：' + (res.projectPath || '（未给 ⇒ 见下方未判）'));
  if (res.projectPath && fs.existsSync(res.projectPath)) {
    const st = fs.statSync(res.projectPath);
    console.log('  指纹 mtimeMs=' + st.mtimeMs + ' size=' + st.size + ' B（正本若变动，请重跑本对照）');
  }
  console.log('');
  console.log('| 事实 | 出处（正本锚点） | 正本所述 | 工作区实算 | 判定 |');
  console.log('|---|---|---|---|---|');
  for (const r of res.rows) {
    console.log(`| ${r.id} ${r.what} | ${r.anchorAt} | ${r.said ? r.said.join(' / ') + ' ' + r.unit : '（未解析到）'} | ${r.got ? r.got.join(' / ') + ' ' + r.unit : '—'} | ${ICON(r.verdict)} ${r.verdict} |`);
  }
  console.log('');
  if (res.problems.length) {
    console.log(`✗ 未判/失真 ${res.problems.length} 条（**fail-closed：不判绿**）：`);
    for (const p of res.problems) console.log(`  · [${p.kind}] ${p.id} ${p.msg}`);
    if (res.problems.some((p) => p.kind === 'differ')) {
      console.log('  ⚠ 「differ」= 正本所述与工作区实算不符 ⇒ **只报告，不得自行改正本**（正本归主持侧面）。');
    }
  } else {
    console.log(`✓ 逐条一致：${res.rows.length} 条可派生事实全部对上（正本所述 == 工作区实算）`);
  }
  if (has('--assert-sites')) {
    const a = countAssertSites(ROOT);
    console.log('');
    console.log(`断言级强度读数（**源码文本口径**，非执行期；${a.files} 个测试文件）：**${a.total}** 处断言调用点`);
    console.log('  ⚠ 口径边界：只认具名 `assert.*(` / `assert(` 形态；循环内断言只计 1 处；**不含**语义强度（"改浅"读不出）。');
    console.log('  ⚠ 它不是门禁、不设阈值：下降只表示"该去逐条核 diff"，不自动判红（设阈值会激励凑读数 = 把断言写松）。');
    if (has('--assert-sites-top')) {
      for (const r of a.rows.slice().sort((x, y) => y.sites - x.sites).slice(0, 10)) console.log(`    ${r.sites}\t${r.file}`);
    }
  }
}

process.exitCode = res.ok ? 0 : 1;
