// scripts/lib/claims-vs-source.mjs —— 正本「可派生事实」逐件对照（`D`）的单一事实源
//
// 由来（正本 §11.6 落地形态表 · §12.13.2 甲-2 · 本仓 `CHG-155` F-3）：
//   正本把「事实登记口径」写进了 `PROJECT.md`，而**正本不被任何机器读取**
//   （`grep -rln "PROJECT.md" scripts/ test/ package.json` = 0，范围 = 工作区源码面）
//   ⇒ 正本里的计数（RPC / 件数 / 行数 / 键数 / 索引行数）**与工作区事实之间没有自动对照**。
//   本模块把该口径落成**可复算对照**：正本所述值 vs 工作区既有事实源实算值。
//
// ⚠ 三条硬约束（逐条对应作业书）：
//   ① **复用既有机制，不新造框架**：件数/行数走既有派生器（`lib-manifest.mjs` 的
//      `libHandwrittenTargets()`）；RPC 计数走**既有派生命令** `node scripts/rpc-manifest.mjs --json`；
//      chunk / 白名单计数走**既有环自己的读数**（`node scripts/dead-code-gate.mjs` 的 R7 / R3 行）
//      —— 不在本文件里重写第二套枚举实现（重写一份正是「同一事实手工多副本」）。
//   ② **期望值从正本读出，不得在本文件里硬编数字**：每条事实只声明**锚点正则**，
//      捕获组 1..n 即正本所述值。⇒ 正本改了数字，对照**自动跟着变**，不会出现
//      「判据里存着旧值 + 正本里存着新值」的第三种副本。
//   ③ **fail-closed**：正本读不到 / 锚点解析不出 / 派生命令不可用 ⇒ 抛错或记 `unjudged`，
//      **绝不静默判绿**（承 `R2` 的「静默回退 ⇒ 假绿」教训 · `CHG-154`）。
//
// ⚠ 范围（硬边界，与正本 §11.6 表格逐字一致）：**只覆盖"可派生的事实"**
//   （RPC 计数 · 件数 · 行数 · 键数 · 索引行数）。⛔ **语义类事实不在此列**
//   （例：「纠错归属 = 语音侧独立一步」「能力是否官方已有」）—— 它们的正确性是**论证与用户拍板**，
//   不是计数，本对照**不判也不试图判**。
//
// ⚠ 本模块**只读**：不写正本、不写任何工作区文件、不参与部署链、不接 `gate` 环。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as libManifest from './lib-manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 工作区根（scripts/lib/ → 上两级）。 */
export const REPO_ROOT = path.join(HERE, '..', '..');

/** 正本（账本区 `PROJECT.md`）**不在本仓内** ⇒ 必须由调用方显式给路径；
 *  本模块**不猜、不提供工作区内缺省**（作业书：不得假设脚本能读到它）。 */
export const PROJECT_ENV = 'PE_LEDGER_PROJECT';

/** 物理行口径（与 `arch-claims` A197-1 / 正本 :68 声明的口径**同口径**）。 */
const PHYS_LINES = (s) => s.split('\n').length;

/** 剥行注释/块注释（只用于"数 assert 调用点"这一读取数，不做语义判定）。 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

// ───────────────────────────── 事实登记（逐条：锚点 + 派生）─────────────────────────────

/**
 * 一条事实 = { id, what, unit, anchor, anchorAt, derive }。
 *  · `anchor`  **只含正则**，捕获组即正本所述值（1..n 个）——⛔ 不得在此写字面数字。
 *  · `derive`  返回 `string[]`（与捕获组**同序同长**）或抛错（fail-closed）。
 */
export const FACTS = [
  {
    id: 'D-1',
    what: '`lib/index.cjs` 物理行数',
    unit: '行',
    anchorAt: '正本 §2 表「Host 入口」行',
    anchor: /`lib\/index\.cjs`（\*\*(\d+) 行\*\*，`split\('\\n'\)` 物理行口径/,
    derive: (root) => [String(PHYS_LINES(fs.readFileSync(path.join(root, 'lib', 'index.cjs'), 'utf8')))],
  },
  {
    id: 'D-2',
    what: '`src/host/` 件数',
    unit: '件',
    anchorAt: '正本 §5.2 后「落地进度」段',
    anchor: /`src\/host\/` 现为 \*\*(\d+) 件 \/ (\d+) 物理行\*\*/,
    derive: (root) => {
      const dir = path.join(root, 'src', 'host');
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
      return [String(files.length), String(files.reduce((s, f) => s + PHYS_LINES(fs.readFileSync(path.join(dir, f), 'utf8')), 0))];
    },
  },
  {
    id: 'D-3',
    what: 'RPC 线上方法合计 / `plugin-host.js` / `lib/` 侧',
    unit: '条',
    anchorAt: '正本 §3「RPC 面（现行）」',
    anchor: /RPC 面（现行）\*\*：\*\*合计 (\d+) 条\*\*（`plugin-host\.js` (\d+) 条 \+ `lib\/` 侧真 CommonJS 模块 (\d+) 条/,
    // 复用既有派生命令（正本 §11.6 表格点名「计数派生」）——不重写注册面枚举。
    derive: (root, ctx) => {
      const j = ctx.deps.rpcManifest(root);
      return [String(j.counts.live), String(j.counts.bundled), String(j.counts.native)];
    },
  },
  {
    id: 'D-4',
    what: '`lib/` 非生成 `.cjs` 件数（派生面）',
    unit: '件',
    anchorAt: '正本 §3「派生面」',
    anchor: /`lib\/` 下全部\*\*非生成\*\* `\.cjs`（现行 \*\*(\d+) 件\*\*）/,
    // 复用既有单一事实源（`lib-manifest.mjs`），不另写一份排除集。
    derive: () => [String(libManifest.libHandwrittenTargets().length)],
  },
  {
    id: 'D-5',
    what: '提示词模板正文数（5 模式 × T1/T2）',
    unit: '个',
    anchorAt: '正本 §8.2「结构」段',
    anchor: /⇒ \*\*共 (\d+) 个模板正文\*\*/,
    derive: (root) => {
      const base = path.join(root, 'prompts', 'enhance');
      const modes = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      let n = 0;
      for (const m of modes) {
        for (const f of fs.readdirSync(path.join(base, m))) if (f === 'system.md' || f === 'increment.md') n += 1;
      }
      return [String(n)];
    },
  },
  {
    id: 'D-6',
    what: 'chunk 数（client+host，递归枚举）',
    unit: '个',
    anchorAt: '正本 §12.13.1 C-10（引 R7 实跑读数）',
    // ⚠ 正本内表格转义：字面量是 `\| R7 \| 29 个 chunk`（表列分隔的转义形态）—— 锚点须含反斜杠。
    anchor: /R7 \\?\| (\d+) 个 chunk/,
    // 复用**环自己的读数**（`dead-code-gate` R7）：它在产物层按浏览器同款求值，
    // 枚举规则（递归 `src/{client,host}/**.js`）只有它一处实现 ⇒ 本模块不重写第二份。
    derive: (root, ctx) => [String(ctx.deps.gateReading(root, 'R7').n)],
  },
  {
    id: 'D-7',
    what: '`package.json` `files` 白名单条数',
    unit: '条',
    anchorAt: '正本 §12.13.1 C-19（引 R3 实跑读数）',
    anchor: /R3 \\?\| (\d+) 条白名单全部在位/,
    derive: (root, ctx) => [String(ctx.deps.gateReading(root, 'R3').n)],
  },
];

// ───────────────────────────── 派生依赖（复用既有命令，逐一给出依据）─────────────────────────────

function runJson(root, script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  if (r.error) throw new Error(`${script} 不可执行：${r.error.message}`);
  if (r.status !== 0) throw new Error(`${script} exit ${r.status}（派生源本身未通过 ⇒ 无从对照）`);
  try { return JSON.parse(r.stdout); } catch (e) { throw new Error(`${script} 的 --json 输出不可解析：${String(e.message).slice(0, 60)}`); }
}

/**
 * 默认依赖：全部是**既有**命令/模块。测试可用 `deps` 注入替身（不触碰真实派生源）。
 */
export function defaultDeps() {
  const gateCache = new Map();
  return {
    rpcManifest: (root) => runJson(root, path.join('scripts', 'rpc-manifest.mjs'), ['--json']),
    /** 环自报读数：解析 `PASS | R<n> | <数> 个 …`，取第一个整数。取不到 ⇒ 抛错（fail-closed）。 */
    gateReading: (root, id) => {
      if (!gateCache.has(root)) {
        const r = spawnSync(process.execPath, [path.join('scripts', 'dead-code-gate.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
        if (r.error) throw new Error(`dead-code-gate 不可执行：${r.error.message}`);
        gateCache.set(root, String(r.stdout || '') + String(r.stderr || ''));
      }
      const out = gateCache.get(root);
      const m = out.match(new RegExp('\\| ' + id + ' \\| (\\d+) '));
      if (!m) throw new Error(`未能在 dead-code-gate 输出里解析出 ${id} 的读数（环改文案即失配 ⇒ 不判绿）`);
      return { n: Number(m[1]) };
    },
  };
}

// ───────────────────────────── 对照主流程 ─────────────────────────────

/**
 * 逐条对照正本 vs 工作区事实源。
 *
 * @param {{projectPath?: string, root?: string, deps?: object, projectText?: string}} opts
 *   `projectPath` 正本路径（**必须显式给**；或经 `PE_LEDGER_PROJECT`）；`projectText` 供测试直接喂文本。
 * @returns {{ok:boolean, projectPath:string|null, rows:Array, problems:Array<{kind:string,id:string,msg:string}>}}
 *   `problems` 非空 ⇒ 调用方**不得**判绿。
 */
export function compareClaims(opts = {}) {
  const root = opts.root || REPO_ROOT;
  const deps = opts.deps || defaultDeps();
  const problems = [];
  let text = opts.projectText;
  let projectPath = opts.projectPath || process.env[PROJECT_ENV] || null;

  if (text === undefined) {
    if (!projectPath) {
      problems.push({ kind: 'unjudged', id: 'D-0', msg: `未给正本路径：须显式 --project <path> 或 ${PROJECT_ENV}（正本在账本区、工作区之外，不得猜缺省）` });
      return { ok: false, projectPath: null, rows: [], problems };
    }
    if (!fs.existsSync(projectPath)) {
      problems.push({ kind: 'unjudged', id: 'D-0', msg: `正本不存在：${projectPath}（fail-closed，不判绿）` });
      return { ok: false, projectPath, rows: [], problems };
    }
    text = fs.readFileSync(projectPath, 'utf8');
  }
  if (!text || !text.trim()) {
    problems.push({ kind: 'unjudged', id: 'D-0', msg: `正本为空：${projectPath || '(文本入参)'}` });
    return { ok: false, projectPath, rows: [], problems };
  }

  const rows = [];
  for (const f of FACTS) {
    const m = text.match(f.anchor);
    if (!m) {
      // ⚠ 锚点失配**不是**「正本没错」——是判据读不到该事实 ⇒ fail-closed 记 unjudged。
      rows.push({ id: f.id, what: f.what, unit: f.unit, anchorAt: f.anchorAt, said: null, got: null, verdict: 'unjudged' });
      problems.push({ kind: 'unjudged', id: f.id, msg: `正本内未解析到锚点（${f.anchorAt}）：正本措辞已变或该事实已删 ⇒ 无从对照，不判绿` });
      continue;
    }
    const said = m.slice(1);
    let got;
    try {
      got = f.derive(root, { deps });
    } catch (e) {
      rows.push({ id: f.id, what: f.what, unit: f.unit, anchorAt: f.anchorAt, said, got: null, verdict: 'unjudged' });
      problems.push({ kind: 'unjudged', id: f.id, msg: `派生失败（${f.unit}）：${String(e.message).slice(0, 160)}` });
      continue;
    }
    if (!Array.isArray(got) || got.length !== said.length) {
      rows.push({ id: f.id, what: f.what, unit: f.unit, anchorAt: f.anchorAt, said, got, verdict: 'unjudged' });
      problems.push({ kind: 'unjudged', id: f.id, msg: `锚点捕获 ${said.length} 个值、派生给出 ${Array.isArray(got) ? got.length : 0} 个 ⇒ 口径失配，不判绿` });
      continue;
    }
    const same = said.every((s, i) => String(s) === String(got[i]));
    rows.push({ id: f.id, what: f.what, unit: f.unit, anchorAt: f.anchorAt, said, got, verdict: same ? 'same' : 'differ' });
    if (!same) problems.push({ kind: 'differ', id: f.id, msg: `正本说 ${said.join('/')} ${f.unit}，实算 ${got.join('/')} ${f.unit}` });
  }

  return { ok: problems.length === 0, projectPath, rows, problems };
}

// ───────────────────────────── 断言级强度读数（作业书 ⑤）─────────────────────────────

/**
 * 「断言级强度」的可复算读数：`test/**` 内**断言调用点**逐文件计数。
 *
 * ⚠ 为什么要有它（第 17 例的直接成因）：`npm test` 报的 tests 数是**测试函数条数**
 *   ⇒ 「一条 test 内删掉 3 个 `assert`」在**任何既有读数上都不留痕**（实测发生过：
 *   布局批改写 `VADSL-P14` 时误删 3 条断言，而测试条数反而 1 → 5 **上升**）。
 *   ⇒ 本函数给一个**源码文本可复算**的计数，使"删断言"在一个数上可见。
 *
 * ⚠ 边界（如实声明，不得让读数看起来比实际更强）：
 *   ① 口径 = **源码文本里的断言调用点**，**不是执行期断言数**（循环/条件里的断言只算 1 处）；
 *   ② 只认具名形态（`assert.*(` / `t.assert*` / `ok(` 等白名单），**不认**动态构造的断言；
 *   ③ ⛔ **它不是门禁、不设阈值**：计数下降只表示"该去看 diff"，**不自动判红** ——
 *      设阈值会激励"为凑读数加空断言"，正是作业书禁止的「把断言写松」；
 *   ④ ⛔ 它**读不到「一条断言被改浅」**（如 `deepEqual` → `ok`）：那需要判据语义比对，
 *      属**语义类**、不在本读数范围。⇒ 本读数**不能**替代逐条核断言强度。
 */
export function countAssertSites(root = REPO_ROOT) {
  const dir = path.join(root, 'test');
  if (!fs.existsSync(dir)) throw new Error('test/ 目录不在位（断言读数无扫描面）');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).sort();
  const RE = /\bassert\s*\.\s*[A-Za-z_$][\w$]*\s*\(|\bassert\s*\(|\.\s*assert\s*\.\s*[A-Za-z_$][\w$]*\s*\(/g;
  const rows = [];
  let total = 0;
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
    const n = (code.match(RE) || []).length;
    rows.push({ file: 'test/' + f, sites: n });
    total += n;
  }
  return { total, files: rows.length, rows };
}
