#!/usr/bin/env node
// scripts/arch-claims.mjs — 结构判据机检：**ADR 承诺 ↔ 代码现状**（P4 · 2026-09-19）
//
// 为什么要有它：本项目的贯穿性根因是「**无结构判据**」——架构决策写进 ADR 之后，
// 承诺有没有兑现、什么时候被后续决策取代，全靠人记。人记的东西会漂：ADR-197 的终局
// 曾被当成"待办"追，而 ADR-230 已把它的轨迹改过一轮却没人知道。本脚本把**每条 PE
// 架构决策**（= 分不分母，见下）的承诺翻成一条可执行断言，命令/期望/实测/判定一并输出。
//
// 分母出处（**不得自拟条数**）：`nav_graph mode=adrs` 全量 37 条中、锚点匹配
//   /pe-f\d|prompt-enhancer/ 的 **7 条** —— ADR-146(feature:pe-f06) ·
//   ADR-194/197/201/234(module:prompt-enhancer) · ADR-224/230(feature:pe-f01)。
//   采集命令与录制时间见 docs/internal/P4-状态归属-2026-09-19.md §一。
//   治理事件日志可读时脚本**自行交叉核对**这个多重集（S-2），不可读则记 SKIP（不记 PASS）。
//   ⚠ 新增一条 PE 决策（nav_decide）后**必须同步加一行判据**，否则 S-2 立即红——判据面随决策面走。
//
// 判据三档（**不可混算**——混算就是又一次代理指标当判据）：
//   REQUIRED 仓库内可机检、必须成立 —— 失败即**冲突**，exit 1
//   LOCAL    本地治理档 / 治理日志（gitignore，CI 与干净 clone 无此文件）—— 缺文件记 **SKIP**，不记 PASS
//   TARGET   终局目标、尚未达成 —— 必须写明**在册依据**（后续 ADR / 决策档），无依据即冲突
//
// 用法：node scripts/arch-claims.mjs [--check] [--json] [--md] [--write]
//   --check  REQUIRED 失败 / 判据面漂移 → exit 1
//   --md     输出 Markdown 判据表（**投影，勿手抄**）
//   --write  把判据表写入治理档标记区（本地档；文件不存在则跳过）
//
// 投影漂移的判定口径（T2 · 2026-09-27，**三态**——本会要的"读数可解释"就落在这里）：
//   投影里「期望/实测/判定」列**是环境的函数**（治理日志可不可读决定 A194-4/S-2 走实判还是 SKIP）。
//   故判据面与环境派生列**分开判**：
//     · 判据面一致 + 档内读数取自**另一种**环境 ⇒ `stale-readings`：陈旧读数，**不判漂移**、打印提示；
//     · 判据面变了（加/删/改断言、表体缺行、指纹被替换） ⇒ `drift`：**exit 1**；
//     · 判据面一致 + **同一种**环境读数却变了 ⇒ `drift`：环境解释不了，仍 exit 1（不放宽）。
//   ⚠ 反面教训（本仓实测 2026-09-27）：只按"档区与本次实算逐字相等"判，则投影必然只对**生成它的
//     那个环境**成立——同一份治理根态投影，带 PE_GOV_ROOT 跑 exit 0、不带则 exit 1（gate 整链跟着红）。
//     那是**假红**（判据表一个字未变），与假绿同属"读数不可解释"。
//   ⚠ `--write` 请**在本形态**跑；跨形态写出的投影会被判 stale-readings（提示刷新，不是失败）。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);

const DOC = 'docs/internal/P4-状态归属-2026-09-19.md';
const MARK_BEGIN = '<!-- ARCH-CLAIMS:BEGIN -->';
const MARK_END = '<!-- ARCH-CLAIMS:END -->';
const GOV_EVENTS = process.env.PE_NAV_EVENTS
  || path.join(process.env.PE_GOV_ROOT || 'D:\\FF', '.internal', 'events.jsonl');
// 读数快照环境标签（T2）：投影里「期望/实测/判定」列**是环境的函数**（治理日志可不可读决定
//   A194-4/S-2 走实判还是 SKIP）。故投影必须自述「这份读数是在哪种环境下取的」——否则读者
//   无法分辨「判据变了」与「只是换了个环境跑」，而那正是本会要的可解释性。
const SNAP_ENV = fs.existsSync(GOV_EVENTS) ? 'gov-readable' : 'gov-unreadable';

const abs = (p) => path.join(ROOT, p);
const exists = (p) => fs.existsSync(abs(p));
const read = (p) => fs.readFileSync(abs(p), 'utf8');
const lines = (p) => read(p).split('\n').length;   // 口径：物理行 = split('\n').length
const occurrences = (s, re) => (s.match(re) || []).length;
const list = (p) => fs.readdirSync(abs(p));

/** 线上 RPC 注册面派生（与 rpc-manifest.mjs 同一规则：扫插件双半部的 harness.handle） */
function liveMethods() {
  const grab = (f) => [...read(f).matchAll(/harness\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
  return { native: grab('lib/index.cjs'), bundled: grab('plugin-host.js') };
}

/** PE-F01 域边界表（ADR-230 的声明面；行范围 [起, 止]，均含端点，物理行口径） */
const PE_F01_DOMAINS = [
  ['D0', 1, 65], ['D1', 66, 386], ['D2', 387, 523], ['D3', 524, 580], ['D4', 581, 668],
  ['D5', 669, 702], ['D6', 703, 752], ['D7', 753, 782], ['D8', 783, 839],
];

/** 一条断言：kind ∈ 行为|结构|门禁|见证|索引|目标；fn 返回 {pass, actual} */
const A = (id, kind, detail, expect, fn) => ({ id, kind, detail, expect, fn });
const ok = (actual) => ({ pass: true, actual });
const no = (actual) => ({ pass: false, actual });
const assert = (cond, actual) => (cond ? ok(actual) : no(actual));

/** 门禁类断言：子进程跑既有门禁，退出码为判据（**不重复实现**对方规则） */
const gate = (id, scriptArgs, detail) => A(
  id, '门禁', detail, `exit 0（node ${scriptArgs.join(' ')}）`,
  () => {
    try {
      execFileSync(process.execPath, scriptArgs, { cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
      return ok('exit 0');
    } catch (e) {
      return no(`exit ${e.status === undefined ? 'ERR:' + String(e.message).slice(0, 60) : e.status}`);
    }
  },
);

/** 见证类断言：断言"更细的行为证据还在"——防止判据引用悬空（证据被删而声称仍验过） */
const witness = (id, file, cases, detail) => A(
  id, '见证', detail, `${file} 含 ${cases.join('/')}`,
  () => {
    if (!exists(file)) return no(`${file} 不存在（证据悬空）`);
    const src = read(file);
    const miss = cases.filter((c) => !src.includes(c));
    return miss.length ? no(`缺 ${miss.join(',')}`) : ok(`${cases.length}/${cases.length} 在册`);
  },
);

// ─────────────── 门禁链 / 行尾：派生读取（F4 · F5 · 2026-09-26 红队修复波 1）───────────────

/** 门禁链**点名面**：本判据表认可的环（每条须写明"本表为何需要它"）。
 *  判据形态 = 点名集合 ≡ package.json 链上实际集合（**双向相等**）。
 *  ⚠ 为何保留点名面而不做"纯派生"：两条负控互斥——"加一环不更新期望→红"要派生侧多出来，
 *    "删掉一环→红"要点名侧仍点名。只从 package.json 取集合的话，删环会把两侧一起缩小，
 *    判据恒绿。故：本表 = 点名面，package.json = 事实面，任一侧单独变动都红。 */
const GATE_RINGS = [
  { id: 'dead-code', script: 'scripts/dead-code-gate.mjs', why: 'R1–R4 死代码 / 装配契约（ADR-224）' },
  { id: 'rpc', script: 'scripts/rpc-manifest.mjs', why: 'RPC 注册面派生一致（ADR-201 / ADR-230）' },
  { id: 'prompts', script: 'scripts/sync-prompts.mjs', why: '提示词生成区不漂移' },
  { id: 'arch-claims', script: 'scripts/arch-claims.mjs', why: '本判据表自身（ADR-234）' },
  { id: 'cards', script: 'scripts/card-arch-consistency.mjs', why: '知识卡 ↔ 架构档一致性（册 A · 2026-09-25 接入）' },
];

/** 从命令串摘出 `node scripts/xxx.mjs [args]`，顺序即链序 */
function parseRings(cmd) {
  const out = [];
  const re = /node\s+(scripts\/[\w.\-]+\.mjs)([^&|]*)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) out.push({ script: m[1], args: (m[2].match(/--[\w-]+/g) || []), pos: m.index });
  return out;
}

/** 摘 `scripts/<名>.mjs` 字面量（首次出现序、去重） */
function ringLiterals(text) {
  const seen = [];
  const re = /scripts\/([\w.\-]+\.mjs)/g;
  let m;
  while ((m = re.exec(text)) !== null) { const s = 'scripts/' + m[1]; if (!seen.includes(s)) seen.push(s); }
  return seen;
}

/** 剥块注释与行注释：入口脚本的头注里普遍写了自身用法（`用法：node scripts/gate.mjs`），
 *  不剥会把入口脚本自己当成一环（未点名 → 假红）。同理，被注释掉的环不算环。 */
function stripCommentLines(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

/** 派生门禁链：① 直接解析 package.json.scripts.gate；② 若该命令只调一个**入口脚本**
 *  （编排器形态，如 `node scripts/gate.mjs`），下探一层读入口脚本，按首次出现序取其内 `scripts/*.mjs`。
 *  ⚠ 波 2（F1 gate.mjs）接口：各环须以 `scripts/<名>.mjs` 字面量出现在入口脚本内，
 *    否则此处置零环 → 判红（fail-closed，不静默取空集）。
 *  ⚠ 归因（2026-09-27 · I4）：零环时**必须说得出零环是怎么来的**。只报「链 0 环」会把读者
 *    引到点名面 / package.json 上找并不存在的问题（真凶在下探面），故一并返回 diag，
 *    归因文案见 chainZeroReason；判定语义不变（零环照样判红）。 */
function gateChain() {
  const cmd = String(require(abs('package.json')).scripts.gate || '');
  let rings = parseRings(cmd);
  let source = 'package.json';
  let nested = false;
  // 归因三态（state）：not-applicable 本条腿不适用（命令里 ≥2 环，无需下探）· nested 下探成功
  //   · zero-literal 入口在但取不到环 · missing 入口不在位 · unparsed 命令里认不出入口
  let diag = { state: 'not-applicable', entryScript: null, entryExists: false, suspicious: false };
  if (rings.length < 2) {
    // ⚠ 入口只从命令里的 `scripts/<名>.mjs` **字面量**取；一条都没有（如 `node "$ENTRY"`、变量拼接）时
    //   **不做「模糊匹配最近路径」的猜测**——猜出来的入口会把读者指到另一个错文件上，等于用第二个
    //   错误回答 I4（这条腿的意义正是不再瞎指）。此时如实说「认不出」，并如实标可疑形态。
    //   本仓 gate 若改用变量拼接调用入口，此腿**照样判红**（零环），正如实报告为「认不出入口」。
    //   ⚠ 形态与 parseRings 同一（必须带 `node ` 前缀）：放宽成「忽略前缀」会让「别名/包装器直接调入口」
    //     这一类命令从判红变成下探成功——那是**语义变更**，不属于本次归因修复的范围。
    const literals = [...cmd.matchAll(/node\s+(scripts\/[\w.\-]+\.mjs)/g)].map((m) => m[1]);
    const entry = literals.find((s) => exists(s)) || literals[0] || null;
    if (entry && exists(entry)) {
      // ⚠ 剥注释再扫：入口脚本的头注里普遍写了自身用法（\`用法：node scripts/gate.mjs\`），
      //   不剥会把入口脚本自己当成一环（未点名 → 假红）。同理，被注释掉的环不算环。
      const seen = ringLiterals(stripCommentLines(read(entry)));
      const self = entry.replace(/^\.\//, '');
      for (let i = seen.length - 1; i >= 0; i -= 1) if (seen[i] === self) seen.splice(i, 1);
      // 编排器形态下旗标由入口脚本自己传（不在 package.json 字面量里），故 args 留空并置 nested。
      // ⚠ 旧实现由此**整体关闭**旗标腿（nested ? [] : …）——那会让 card-arch 的旗丢失一并漏检
      //   （复核席实测的净回归）。现改为：nested 时旗标改从**入口脚本自身文本**取证（见 chainFlags），
      //   只把"字面量里读不到旗"降级为"改看入口脚本"，不放弃这一腿。
      rings = seen.map((s, i) => ({ script: s, args: [], pos: i }));
      // ⚠ 零环也置 source/nested：下探**确实发生过**（读的确实是这份入口脚本），只是它没有字面量。
      //   若此处不置，读数里的「源」会写成 package.json —— 那又是一次错误归因（I4 要关的正是这个）。
      source = entry + '（编排器入口，下探一层）';
      nested = true;
      diag = { state: seen.length ? 'nested' : 'zero-literal', entryScript: entry, entryExists: true, suspicious: false };
    } else if (entry) {
      diag = { state: 'missing', entryScript: entry, entryExists: false, suspicious: false };
    } else {
      // 命令面认不出入口：如实说「认不出」。suspicious = 命令里出现了变量拼接 / 插值 / 字符串拼接形态
      //   （只是提示可能的原因，**不作为入口指认**——没有可指认的入口就写成 null）。
      const suspicious = /\$\{|\$[A-Za-z_][\w]*|%[A-Za-z_][\w]*%|\+\s*["']/.test(cmd);
      diag = { state: 'unparsed', entryScript: null, entryExists: false, suspicious };
    }
  }
  // ⚠ 不再用 `/npm run/.test(cmd)` 判 nested：那会让「命令里带 npm run」把旗标腿整体带偏
  //   （且在编排器下探已成功时属于误判）。nested 只认"下探确实发生"。
  return { cmd, rings, source, nested, entryScript: diag.entryScript, diag };
}

/** 零环归因文案（I4）：把「链上取不到环」回答到**真正的面**上，并给出可执行的检查动作。
 *  两条禁令（都是这条腿存在的理由）：① 认不出入口时**不得猜一个路径**——宁说「认不出」，不给假指向；
 *  ② 措辞不得读起来像「点名面 / package.json 有问题」——零环时点名面根本没被比对过，那是最初的错误归因。
 *  ⚠ 本节只改**归因与措辞**：任何 state 都仍然判红（fail-closed，见 B234-1）。 */
function chainZeroReason(diag) {
  const e = diag.entryScript;
  switch (diag.state) {
    case 'missing':
      return `⚠ 编排器入口不在位：${e}（判据知道它，是因为 package.json.scripts.gate 指向它）`
        + '——链上取不到环来自**入口缺位**（读数里只会剩入口脚本自己，那不是一环），'
        + '不是点名面/package.json 的问题；检查该入口脚本是否已建并已提交（F1 gate.mjs 波次是否落地）';
    case 'zero-literal':
      return `⚠ 编排器入口解析到 0 环：请检查 ${e} 是否以**字面量** \`scripts/<名>.mjs\` 调用各环`
        + '（本判据按下探字面量取环，不解释变量拼接 / shell 展开；零环会一路被误报成点名面问题，真因就在这里）';
    case 'unparsed':
      return '⚠ 认不出编排器入口：package.json.scripts.gate 的命令面里没有 \`node scripts/<名>.mjs\` 字面量'
        + (diag.suspicious ? '（命令含变量拼接/插值形态，疑似入口由变量给出）' : '')
        + '，故无从下探、也无从指认入口；本仓 gate 须以字面量调用入口脚本（编排器形态见 gate 链约定）';
    default:
      return '';
  }
}

/** 环脚本是否**实装** --check：识别 argv 检索的多种真实写法（各环不统一，实测 2026-09-26）：
 *    \`has('--check')\`（arch-claims / card-arch-consistency）· \`args.includes('--check')\`（rpc-manifest）
 *    · \`process.argv.includes('--check')\`（sync-prompts）——变量名任意、接收者须是 args/argv/ARGV 之类。
 *  ⚠ 不得退化成"文中出现 --check 就算实装"：头注/注释里普遍写了用法（本文件即如此），
 *    那样会把**没实装**的脚本判成实装。故先剥注释行，再要求"接收者 + includes/has"形态。 */
function implementsCheck(p) {
  if (!exists(p)) return false;
  const code = read(p)
    .split('\n')
    .map((l) => l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, ''))   // 剥块注释与行注释
    .join('\n');
  return /(?:process\.)?(?:argv|args|ARGV|ARGS|[A-Za-z_$][\w$]*Args)\s*\.\s*includes\s*\(\s*['"]--check['"]\s*\)/.test(code)
    || /has\s*\(\s*['"]--check['"]\s*\)/.test(code);
}

/** 行尾三列读数（F5）：`git ls-files -z --eol`。
 *  列序 = <i/> <w/> <attr/> [<eol=>] \t <path>；用 -z 防文件名含空白/换行被拆错列。 */
function eolRows() {
  if (!exists('.git')) return null;                     // 非 git 检出（发行包解包）→ 不可判
  let raw = '';
  try {
    raw = execFileSync('git', ['ls-files', '-z', '--eol'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  } catch (e) { return { error: String(e.message).slice(0, 80) }; }
  const rows = [];
  for (const rec of raw.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    if (tab < 0) { rows.push({ file: rec, raw: true }); continue; }
    const f = rec.slice(0, tab).trim().split(/\s+/);
    const strip = (s, p) => (s && s.startsWith(p) ? s.slice(p.length) : s);   // --eol 三列带 i/ w/ attr/ 前缀
    rows.push({
      index: strip(f[0], 'i/') || '?',
      worktree: strip(f[1], 'w/') || '?',
      attr: strip(f[2], 'attr/') || '?',
      eol: f[3] || '',
      file: rec.slice(tab + 1),
    });
  }
  return { rows };
}

/** 字节级往返：字节 --utf8 解码--> 串 --utf8 编码--> 字节 必须相等。
 *  不等 ⇒ 判据读到的"文本"与磁盘不是同一份（编码被换过），行尾断言会静默失效。 */
function roundTripOk(f) {
  const buf = fs.readFileSync(path.join(ROOT, f));
  return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
}

process.env.DSH_ENHANCER_NO_INDEX = '1';          // 与仓库其它 lib 测试同口径：不写进程索引
const indexMod = require(abs('lib/index.cjs'));

// ───────────────────────────── 判据表（1 ADR = 1 行） ─────────────────────────────

const CLAIMS = [
  {
    adr: 'ADR-146', anchor: 'feature:pe-f06', at: '2026-09-12', level: '已兑现',
    promise: 'RPC 入口显式来源边界（同源校验 / 跨站拒 / 无来源头放行 / 1MiB 上限）+ .cmd 值统一 cmdSafeValue 安全化',
    assertions: [
      A('A146-1', '行为', '来源栅栏四态（跨站 / 跨源 / Origin:null 拒；同源 / 无头放行）', '6/6 态正确', () => {
        const R = (h) => ({ headers: h || {} });
        const H = { host: '127.0.0.1:3080' };
        const cases = [
          [indexMod.isTrustedRpcRequest(R(H)), true, '无来源头'],
          [indexMod.isTrustedRpcRequest(R({ ...H, origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' })), true, '同源'],
          [indexMod.isTrustedRpcRequest(R({ ...H, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })), false, '跨站'],
          [indexMod.isTrustedRpcRequest(R({ ...H, origin: 'https://evil.example' })), false, '跨源'],
          [indexMod.isTrustedRpcRequest(R({ ...H, 'sec-fetch-site': 'cross-site' })), false, '仅跨站标记'],
          [indexMod.isTrustedRpcRequest(R({ origin: 'null' })), false, 'Origin:null'],
        ];
        const bad = cases.filter(([got, want]) => got !== want);
        return assert(!bad.length, bad.length ? `错 ${bad.map((c) => c[2]).join(',')}` : '6/6 态正确');
      }),
      A('A146-2', '行为', '1MiB 请求体上限', '超限 → __tooLarge；正常体照常解析', async () => {
        const { EventEmitter } = require('node:events');
        const lim = read('lib/index.cjs').match(/RPC_BODY_LIMIT\s*=\s*(\d+)\s*\*\s*(\d+)/);
        const size = lim ? Number(lim[1]) * Number(lim[2]) : 0;
        const req = new EventEmitter();
        req.destroy = () => {};
        const p = indexMod.readBody(req);
        req.emit('data', Buffer.alloc(1024 * 1024 + 1));
        const over = await p;
        const req2 = new EventEmitter();
        const p2 = indexMod.readBody(req2);
        req2.emit('data', Buffer.from('{"method":"config/get"}'));
        req2.emit('end');
        const normal = await p2;
        return assert(size === 1024 * 1024 && over.__tooLarge === true && normal.method === 'config/get',
          `上限 ${size} B｜超限 ${over.__tooLarge === true ? '__tooLarge' : '未短路'}｜正常体 ${normal.method === 'config/get' ? '解析成功' : '解析失败'}`);
      }),
      A('A146-3', '行为', 'cmdSafeValue：剥双引号 / 折 CRLF / 按需转义 %', '4/4 正确', () => {
        const c = indexMod.cmdSafeValue;
        const cases = [
          [c('a" & calc & "b'), 'a & calc & b', '剥双引号'],
          [c('a\r\nb'), 'a b', '折 CRLF'],
          [c('100%path%'), '100%path%', '默认不转义'],
          [c('100%path%', true), '100%%path%%', 'set 行转义'],
        ];
        const bad = cases.filter(([got, want]) => got !== want);
        return assert(!bad.length, bad.length ? `错 ${bad.map((x) => x[2]).join(',')}` : '4/4 正确');
      }),
      witness('A146-4', 'test/rpc-guard.test.cjs', ['RPCG-01', 'RPCG-02', 'RPCG-03', 'RPCG-04', 'RPCG-05'], '端到端冒烟证据仍在册（403/413/405/栅栏放行）'),
    ],
  },
  {
    adr: 'ADR-194', anchor: 'module:prompt-enhancer', at: '2026-09-12', level: '部分兑现',
    promise: '判定「需要架构重构，分期执行、不推倒重写」：①P0 死层退役 + 协议事实源由注册面派生；②P1 host 半部改原生模块；③P2 规范收敛；④P3 待验证',
    assertions: [
      A('A194-1', '结构', '①P0 死层退役（src/host 收敛）', '7 件 / 33 物理行', () => {
        const files = list('src/host');
        const n = files.reduce((a, f) => a + lines(`src/host/${f}`), 0);
        return assert(files.length === 7 && n === 33, `${files.length} 件 / ${n} 行`);
      }),
      A('A194-2', '结构', '①协议事实源改由注册面派生（废除 protocol.js）', 'src/protocol.js 不存在且 scripts/rpc-manifest.mjs 存在', () => {
        const gone = !exists('src/protocol.js');
        const born = exists('scripts/rpc-manifest.mjs');
        return assert(gone && born, `protocol.js ${gone ? '已废除' : '仍在'} / rpc-manifest.mjs ${born ? '在位' : '缺失'}`);
      }),
      A('A194-3', '结构', '①dead-code-gate 增可达性/一致性规则', '含 R1–R4 四规则', () => {
        const src = read('scripts/dead-code-gate.mjs');
        const rules = ['R1', 'R2', 'R3', 'R4'].filter((r) => src.includes(`'${r}'`) || src.includes(`[${r}]`) || new RegExp(`\\b${r}\\b`).test(src));
        return assert(rules.length === 4, `命中 ${rules.join('/')}`);
      }),
      A('A194-4', '索引', '④索引侧新建 PE-F07「宿主基础层与插件管理面」', `治理日志可读时含 PE-F07 节点（${GOV_EVENTS}）`, () => {
        if (!fs.existsSync(GOV_EVENTS)) return { skip: true, actual: '治理日志不可读（CI/干净 clone 预期）' };
        const hit = fs.readFileSync(GOV_EVENTS, 'utf8').split('\n').filter((l) => l.includes('PE-F07')).length;
        return assert(hit > 0, `日志内 PE-F07 出现 ${hit} 次`);
      }),
      A('A194-5', '目标', '②P1 host 半部改原生 Node 模块（真 require）', 'plugin-host.js 内 require( 计数 > 0', () => {
        const n = occurrences(read('plugin-host.js'), /require\(/g);
        return assert(n > 0, `require( = ${n}（bundle 载体无模块系统）`);
      }),
    ],
    pending: [{ id: 'A194-5', reason: '载体折叠未换：终局轨迹已由 ADR-197 §① 改判、并由 ADR-230 §四-3 坐实「无 require ⇒ 系统面逻辑必然留在 lib/」' }],
  },
  {
    adr: 'ADR-197', anchor: 'module:prompt-enhancer', at: '2026-09-12', level: '在册未达',
    promise: '终局目标架构：lib/index.js ≤120 行只做装配 + 领域逻辑分层 + 自建基础设施换官方缝 + 弃 chunk/marker/new Function 装配',
    assertions: [
      A('A197-1', '目标', '装配薄化：lib/index.cjs ≤ 120 行', '≤120 行', () => {
        const n = lines('lib/index.cjs');
        return assert(n <= 120, `${n} 行`);
      }),
      A('A197-2', '结构', '弃孤儿产物 plugin-client.js', '磁盘无、files 白名单无、构建不产出', () => {
        const disk = !exists('plugin-client.js');
        const whitelist = !JSON.stringify(require(abs('package.json')).files).includes('plugin-client.js');
        const builder = !read('scripts/build-client.mjs').includes("'plugin-client.js'");
        return assert(disk && whitelist && builder, `磁盘${disk ? '无' : '有'} / 白名单${whitelist ? '无' : '有'} / 构建${builder ? '不产出' : '仍产出'}`);
      }),
      A('A197-3', '目标', '弃 chunk/marker/new Function 装配', 'new Function 装配点 = 0', () => {
        const n = occurrences(read('lib/index.cjs'), /new Function\(/g);
        return assert(n === 0, `new Function = ${n} 处`);
      }),
      A('A197-4', '结构', '半部通信保留 HTTP（/rpc 兼容别名）', "RPC_PATH = '/dsh-prompt-enhancer/rpc'", () => {
        const m = read('lib/index.cjs').match(/RPC_PATH\s*=\s*'([^']+)'/);
        return assert(!!m && m[1] === '/dsh-prompt-enhancer/rpc', m ? m[1] : '未找到 RPC_PATH');
      }),
    ],
    pending: [
      { id: 'A197-1', reason: 'ADR-230 修订该轨迹：改为按 9 域分批（首批 D8），且换装载形态是拆分收益的前置项' },
      { id: 'A197-3', reason: '同上：载体折叠未换，chunk/new Function 装配仍在（ADR-230 §四-3）' },
    ],
  },
  {
    adr: 'ADR-201', anchor: 'module:prompt-enhancer', at: '2026-09-12', level: '已兑现',
    promise: '收缩为「提示词增强 + 语音识别」双核心并移除插件内重启：删 update/portRestart、update/makeShortcut，新增 update/install（BREAKING）',
    assertions: [
      A('A201-1', '结构', '线上注册面条数（与 test/rpc-contract.test.cjs 的数字锁交叉核）', '34 条', () => {
        const { native, bundled } = liveMethods();
        const all = new Set([...native, ...bundled]);
        return assert(all.size === 34, `${all.size} 条（原生 ${native.length} + bundle ${bundled.length}）`);
      }),
      A('A201-2', '结构', '删两个 RPC / 新增 update/install', 'portRestart、makeShortcut 缺席；install 在位', () => {
        const { native, bundled } = liveMethods();
        const all = new Set([...native, ...bundled]);
        const gone = !all.has('update/portRestart') && !all.has('update/makeShortcut');
        const born = all.has('update/install');
        return assert(gone && born, `portRestart/makeShortcut ${gone ? '已删' : '仍在'} / update/install ${born ? '在位' : '缺失'}`);
      }),
      A('A201-3', '结构', 'updater-host.cjs 瘦身上限', '≤ 855 行', () => {
        const n = lines('lib/updater-host.cjs');
        return assert(n <= 855, `${n} 行`);
      }),
      A('A201-4', '结构', '客户端重启 UI 已删', 'src/client 下无 portRestart / makeShortcut 引用', () => {
        const walk = (d) => fs.readdirSync(abs(d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
        const hits = walk('src/client').filter((f) => /portRestart|makeShortcut/.test(read(f)));
        return assert(!hits.length, hits.length ? `命中 ${hits.join(',')}` : '零引用');
      }),
      witness('A201-5', 'test/rpc-contract.test.cjs', ['34', 'update/portRestart'], '数字契约锁与「已删方法永不返回」证据在册'),
    ],
  },
  {
    adr: 'ADR-224', anchor: 'feature:pe-f01', at: '2026-09-18', level: '已兑现',
    promise: 'P1a+P1b 收敛：client 载体单一化（lib/client.cjs）+ M2 目标架构层整体退役 + 两条结构门禁 R3/R4 固化',
    assertions: [
      A('A224-1', '结构', 'client 唯一载体', 'exports["./client"] → lib/client.cjs 且文件在位', () => {
        const exp = require(abs('package.json')).exports['./client'];
        return assert(exp === './lib/client.cjs' && exists('lib/client.cjs'), `${exp} / 文件${exists('lib/client.cjs') ? '在位' : '缺失'}`);
      }),
      gate('A224-2', ['scripts/dead-code-gate.mjs'], '结构门禁整体通过（含 R3 产物清单 ↔ files 白名单、R4 src/host 等值集）'),
      A('A224-3', '结构', 'R3/R4 两条规则仍在位（防规则被静默删除而门禁仍 exit 0）', 'R3 + R4 均命中', () => {
        const src = read('scripts/dead-code-gate.mjs');
        const hit = ['R3', 'R4'].filter((r) => src.includes(r));
        return assert(hit.length === 2, `命中 ${hit.join('/')}`);
      }),
    ],
  },
  {
    adr: 'ADR-230', anchor: 'feature:pe-f01', at: '2026-09-18', level: '已兑现',
    promise: 'P3 装配契约：lib/index.cjs 按 9 域划界且 100% 覆盖；拆分按域分批；plugin-host.js 无 require 是结构约束（判据未声明入边 = 0 降级，不虚报）',
    assertions: [
      A('A230-1', '结构', '域边界表覆盖 100%（域表行数和 == 文件物理行数，且域连续无缝）', `域和 == ${lines('lib/index.cjs')} 且首域 1 起 / 末域止于末行`, () => {
        const n = lines('lib/index.cjs');
        const sum = PE_F01_DOMAINS.reduce((a, [, s, e]) => a + (e - s + 1), 0);
        let contig = PE_F01_DOMAINS[0][1] === 1;
        for (let i = 1; i < PE_F01_DOMAINS.length; i += 1) contig = contig && PE_F01_DOMAINS[i][1] === PE_F01_DOMAINS[i - 1][2] + 1;
        const tail = PE_F01_DOMAINS[PE_F01_DOMAINS.length - 1][2];
        return assert(sum === n && contig && tail === n, `域和 ${sum} vs 实测 ${n}｜连续 ${contig}｜末域止 ${tail}`);
      }),
      A('A230-2', '结构', '载体约束事实：plugin-host.js 内无模块系统', 'require( 计数 == 0', () => {
        const n = occurrences(read('plugin-host.js'), /require\(/g);
        return assert(n === 0, `${n}`);
      }),
      A('A230-3', '索引', 'P3 决策档在位且三项拍板已回写', '档存在且含三项拍板行', () => {
        // ⚠ CI 首跑实证（run 35397066749）：`docs/internal` 整目录在干净 clone 里不存在，
        //   先 list() 再判空会 ENOENT 抛错 → 记为冲突（假冲突）。必须先判目录存在。
        if (!exists('docs/internal')) return { skip: true, actual: 'docs/internal 整目录缺位（本地治理档，CI/干净 clone 预期无）' };
        const f = list('docs/internal').find((x) => x.startsWith('P3-装配契约'));
        if (!f) return { skip: true, actual: 'P3 决策档缺位（本地治理档）' };
        const src = read(`docs/internal/${f}`);
        const hit = ['拍板结果', 'D8 诊断面', '不立项'].filter((k) => src.includes(k));
        return assert(hit.length === 3, `${f} 命中 ${hit.length}/3`);
      }),
      gate('A230-4', ['scripts/rpc-manifest.mjs', '--check'], 'RPC 契约面不受本轮影响（派生事实源一致）'),
    ],
  },
  {
    adr: 'ADR-234', anchor: 'module:prompt-enhancer', at: '2026-09-18', level: '已兑现',
    promise: 'P4：结构判据机检化（分母由模型派生、判据表为投影、四档语义含 SKIP/在册未达/在册缺陷）+ 四条结构门禁收敛为 `npm run gate` 并首次进 CI + RC-F 收敛基线（10 个状态面 / 在册缺陷 D-1）',
    assertions: [
      A('B234-1', '结构', '门禁链收敛为一条命令（顺序即依赖序）', '点名集合 ≡ gate 链实际集合（双向）；链序 == 本表声明序；实装 --check 的环在链上必须带 --check（含编排器入口自传旗的形态）', () => {
        const { rings, source, nested, entryScript, diag } = gateChain();
        const named = GATE_RINGS.map((r) => r.script);
        const actual = rings.map((r) => r.script);
        const extra = actual.filter((s) => !named.includes(s));      // 链上新增环未点名 → 红（R4 要堵的那一面）
        const lost = named.filter((s) => !actual.includes(s));       // 点名环从链上消失 → 红（F4 负控）
        const dup = actual.filter((s, i) => actual.indexOf(s) !== i);
        const order = rings
          .map((r) => named.indexOf(r.script))
          .filter((i) => i >= 0);
        const asc = order.every((v, i) => i === 0 || v > order[i - 1]);
        // 旗标腿：直连形态从命令行字面量取证；编排器形态旗由入口脚本自传，改从**入口脚本文本**取证
        //   （条目内需出现 `scripts/<名>.mjs` 与 `--check`，二者相隔不超过 160 字符）。
        //   ⚠ 旧实现 nested 时整条腿短路 —— 复核席实测那是相对基线的判别力净回归（丢 rpc/prompts 的
        //     --check 后判绿）。入口脚本不可读/取不到条目 → 记 fail（fail-closed，不静默放过）。
        const entryText = nested && entryScript && exists(entryScript) ? read(entryScript) : null;
        const flagMiss = [];
        for (const r of rings) {
          if (!implementsCheck(r.script)) continue;
          if (!nested) {
            if (!r.args.includes('--check')) flagMiss.push(r.script);
            continue;
          }
          if (entryText === null) { flagMiss.push(r.script + '(入口脚本不可读，无法取证旗标)'); continue; }
          const k = entryText.indexOf(r.script);
          if (k < 0) { flagMiss.push(r.script); continue; }
          // 取证窗 = 该环自己的条目行，**遇到下一环的 .mjs 字面量即截断**（定宽窗口会串到下一环的旗标上 → 假绿）
          const rest = entryText.slice(k).split('\n');
          let seg = rest[0];
          for (let i = 1; i < Math.min(rest.length, 4) && !/\.mjs['"]/.test(rest[i]); i += 1) seg += '\n' + rest[i];
          if (!/--check/.test(seg)) flagMiss.push(r.script);
        }
        const flags = flagMiss;
        const okAll = !extra.length && !lost.length && !dup.length && asc && !flags.length;
        // ⚠ 归因先行（I4 · 2026-09-27）：零环时**不得**用「点名却缺席 N 件」当结论——读者会去点名面/
        //   package.json 找问题，而真凶在下探面（入口里没有字面量 / 入口不在位 / 入口认不出）。
        //   此行改成只报「零环怎么来的」+ 该查哪个文件；判定不变（照样 okAll=false → 仍判红）。
        //   ⚠ 不只是 actual.length===0：下探失败时 rings 常残留「入口脚本自己」（parseRings 会命中
        //     `node scripts/gate.mjs`），报成「链 1 环｜未点名 gate.mjs」同样是错误归因。故判据是
        //     「下探是否失败」，不是「数出来几个」。
        const diveFailed = diag.state === 'missing' || diag.state === 'zero-literal' || diag.state === 'unparsed';
        if (diveFailed || !actual.length) return no(chainZeroReason(diag));
        return assert(okAll,
          `链 ${actual.length} 环（源 ${source}${nested ? '｜旗标取证面 = 入口脚本文本' : ''}）`
          + `｜未点名 ${extra.length ? extra.join(',') : '无'}`
          + `｜点名却缺席 ${lost.length ? lost.join(',') : '无'}`
          // 部分缺席（有环、但少了某几环）同样要能指向**下探面**：若入口脚本文本里没有该环字面量，
          //   该环很可能是被变量拼接调用（而非被删）——归因必须落在入口脚本上，别让读者去点名面找。
          + (nested && lost.length ? `（下探面：入口脚本 ${entryScript} 字面量里没有它们——请检查该入口是否以变量拼接调用此环）` : '')
          + `｜重复 ${dup.length ? dup.join(',') : '无'}`
          + `｜链序单调 ${asc}`
          + `｜实装 --check 却未带旗 ${flags.length ? flags.join(',') : '无'}`);
      }),
      A('B234-2', '结构', '门禁进 CI 且判据之间不得互相遮蔽（失败仍出读数）', 'Structure gates 跑 npm run gate 且与 Run tests 两步均 if: always()', () => {
        const ci = read('.github/workflows/ci.yml');
        const step = /- name: Structure gates[\s\S]{0,400}?run: npm run gate/.test(ci);
        const gateAlways = /- name: Structure gates[\s\S]{0,300}?if: always\(\)/.test(ci);
        const testsAlways = /- name: Run tests[\s\S]{0,160}?if: always\(\)/.test(ci);
        return assert(step && gateAlways && testsAlways, `步骤 ${step}｜gate always ${gateAlways}｜tests always ${testsAlways}`);
      }),
      A('B234-3', '结构', '判据表是投影（三种模式 + 治理档标记区），治理档缺位不判漂移', '脚本含 --check/--md/--write 与标记对；**语义**守卫：档缺位 ⇒ 判定不是 drift（不锁返回字面量）', () => {
        const src = read('scripts/arch-claims.mjs');
        const modes = ['--check', '--md', '--write'].filter((m) => src.includes(`'${m}'`));
        const marks = src.includes('ARCH-CLAIMS:BEGIN') && src.includes('ARCH-CLAIMS:END');
        // 守卫的**语义**是"缺档 ⇒ 不判漂移"，不是某个具体返回字面量：锁死字面量会把
        //   T2 的归因改造（return {kind:'missing-doc'}）误判成"守卫被删"（2026-09-27 实测踩到）。
        //   改用**行为**判定：拿分类器在缺档/缺标记两个变异体上实跑，看它是否落在"不判漂移"。
        const g1 = classifyDrift(null, 'x', 'sha256:0', 0);
        const g2 = classifyDrift(undefined, 'x', 'sha256:0', 0);
        const skipGuard = g1.kind === 'missing-doc' && g2.kind === 'missing-marker';
        return assert(modes.length === 3 && marks && skipGuard, `模式 ${modes.length}/3｜标记 ${marks}｜缺档守卫（语义）${skipGuard}：缺档→${g1.kind}｜缺标记→${g2.kind}`);
      }),
      A('B234-5', '结构', '投影漂移判定的**归因两分**与**防手抄守卫**在位（T2 · 2026-09-27）', '投影带跨环境同值的判据面指纹；漂移时能分辨"换环境"与"判据过期"；指纹行参与判定且自底向上重算', () => {
        const src = read('scripts/arch-claims.mjs');
        const hasFp = /function claimsFingerprint/.test(src);
        // 指纹的**判据面**必须不含环境派生列：detail 在（判据文本），pass/skip/actual 必须不在。
        const facesLine = (src.match(/const faces = rows\.map\(\(r\) => \[([^\]]*)\]/) || [])[1] || '';
        const facesClean = !/\br\.(pass|skip|actual|expect)\b|\bpassed\b|\bskips\b/.test(facesLine);
        // 跨环境同值的计数腿：计数里只许有 RUN.length / DEFECTS.length（passed/skips 会随环境抖）
        const countsLine = (src.match(/const c = counts \|\| \[([^\]]*)\]/) || [])[1] || '';
        const countsClean = /RUN\.length/.test(countsLine) && !/passed|skips|conflicts/.test(countsLine);
        // 判定例程不得引用投影里的指纹（须自底向上重算），且必须**先剥指纹行**再比对（否则递归）
        const stampStrip = /stampedMd/.test(src) && /stripFp/.test(src);
        const judgeByRecalc = /const localFp = claimsFingerprint\(\)/.test(src);
        // 归因两分：判据面没变 ⇒ 陈旧读数（stale-readings，不判漂移）；变了 ⇒ 真漂移（drift）
        const twoWay = /kind === 'stale-readings'/.test(src) && /判据面\*\*已过期\*\*/.test(src);
        // 指纹行参与判定（否则改档里的指纹无人抓）
        const fpInVerdict = /fpConsistent/.test(src) && /process\.exit\(1\)/.test(src);
        const pass = hasFp && facesClean && countsClean && stampStrip && judgeByRecalc && twoWay && fpInVerdict;
        return assert(pass, `指纹函数 ${hasFp}｜判据面不含环境列 ${facesClean}｜计数跨环境同值 ${countsClean}｜剥指纹行 ${stampStrip}｜自底向上重算 ${judgeByRecalc}｜归因两分 ${twoWay}｜指纹参与判定 ${fpInVerdict}`);
      }),
      A('B234-6', '结构', '投影漂移判定**判别力自证**（内存变异：陈旧读数 与 判据面演化 必须被分成两类，防手抄腿在两种环境下都有效）', '换环境->stale-readings（不判漂移）；同环境读数漂移/指纹变/条数过期/表体缺行->drift 真红；指纹被替换->fpConsistent=false；缺档/缺标记->各 1 且不判漂移', () => {
        // 判别力自证（变异体，仿 S-8/A-4b 的形态）：只"声明"归因两分是不够的——
        //   必须证明这条判定**真能把两类分开放**，否则它可被静默掏空（比如两分腿恒真）。
        //   ⚠ 这是本会 2026-09-27 的**假红**复盘落点：修复前单形态判漂移 ⇒ 另一种形态必假红。
        const FP = 'sha256:' + 'a'.repeat(16);
        const OTHER = 'sha256:' + 'b'.repeat(16);
        // 真实判据面目（用本进程实跑出来的行，不编造文本）
        const ROWS = RUN.slice(0, 3);
        const body = (rows) => rows.map((r) => `| ${r.id} ${r.kind}：${r.detail} |`);
        const mk = (fp, n, rows, env) => ['表头', '|---|---|', ...body(rows),
          '', `> fingerprint（判据面指纹·跨环境同值）：\`${fp}\`（${n} 条断言｜读数快照 env=${env}｜判据面 = id/kind/detail）`,
          '', '> 生成：--md｜通过 1'].join('\n');
        // 另一种环境算出来的同一份表体（剥掉指纹行、读数列不同）
        const computedEnvDiff = mk('', 0, [], 'x').replace(/\n> fingerprint[^\n]*/, '').replace('通过 1', '通过 9');
        const c = [
          ['换环境->陈旧读数', classifyDrift(mk(FP, 3, ROWS, 'gov-readable'), computedEnvDiff, FP, 3, ROWS, 'gov-unreadable').kind === 'stale-readings'],
          ['同环境读数漂移仍判红', classifyDrift(mk(FP, 3, ROWS, 'gov-unreadable'), computedEnvDiff, FP, 3, ROWS, 'gov-unreadable').kind === 'drift'],
          ['指纹变->真漂移', classifyDrift(mk(OTHER, 3, ROWS, 'x'), computedEnvDiff, FP, 3, ROWS, 'x').kind === 'drift'],
          ['条数过期->真漂移', classifyDrift(mk(FP, 2, ROWS, 'x'), computedEnvDiff, FP, 3, ROWS, 'x').kind === 'drift'],
          ['表体缺行->真漂移', classifyDrift(mk(FP, 3, ROWS.slice(0, 2), 'x'), computedEnvDiff, FP, 3, ROWS, 'x').kind === 'drift'],
          ['指纹被替换', (() => { const d = classifyDrift(computedEnvDiff, computedEnvDiff, FP, 3, []); return d.kind === 'none' && d.fpConsistent === false; })()],
          ['逐字相等+行齐', (() => { const x = mk(FP, 3, ROWS, 'x'); const d = classifyDrift(x, x, FP, 3, ROWS, 'x'); return d.kind === 'none' && d.fpConsistent === true && !d.missingRows.length; })()],
          ['缺档', classifyDrift(null, computedEnvDiff, FP, 3, ROWS).kind === 'missing-doc'],
          ['缺标记', classifyDrift(undefined, computedEnvDiff, FP, 3, ROWS).kind === 'missing-marker'],
        ];
        const bad = c.filter((x) => !x[1]).map((x) => x[0]);
        return assert(!bad.length, c.map(([k, v]) => k + ' ' + (v ? '✓' : '✗')).join('｜') + (bad.length ? '｜未命中 ' + bad.join(',') : ''));
      }),
      A('B234-7', '结构', '漂移**归因文本**与事实同向：判据面未变时不得叙述成「已过期」（措辞面假红）', '面变→（已过期+判据面变了）；面未变（同环境读数漂移）→（未变+不是判据演化）且两分类措辞不互借', () => {
        // 依据（2026-09-27 独立复核实测）：同环境读数漂移时，档内指纹 == 本形态指纹、表体齐，
        //   归因却打印「判据面**已过期**」+ 收尾「已归因：判据面变了」——判据面一个字未改。
        //   这是 b2/I3 同族的**措辞与事实相反**：人读会被引向错误的修复方向。只声明两分类不够，
        //   必须证明**文本真的跟着分类走**（纯函数变异体，仿 B234-6 形态）。
        const FP = 'sha256:' + 'a'.repeat(16);
        const OTHER = 'sha256:' + 'b'.repeat(16);
        const ROWS = RUN.slice(0, 3);
        const mk = (fp, n, rows, env) => ['表头', '|---|---|', ...rows.map((r) => `| ${r.id} ${r.kind}：${r.detail} |`),
          '', `> fingerprint（判据面指纹·跨环境同值）：\`${fp}\`（${n} 条断言｜读数快照 env=${env}｜判据面 = id/kind/detail）`,
          '', '> 生成：--md｜通过 1'].join('\n');
        const envDiff = mk('', 0, [], 'x').replace(/\n> fingerprint[^\n]*/, '').replace('通过 1', '通过 9');
        // ① 面未变 + 同环境读数漂移 ⇒ 措辞必须是「未变」，且不得含「已过期」
        const sameEnv = classifyDrift(mk(FP, 3, ROWS, 'gov-readable'), envDiff, FP, 3, ROWS, 'gov-readable');
        const a1 = driftAttribution(sameEnv, FP, 3, 'gov-readable');
        const ok1 = sameEnv.kind === 'drift' && a1.faceChanged === false
          && /判据面\*\*未变\*\*/.test(a1.why) && !/已过期/.test(a1.why)
          && !/判据面变了/.test(a1.tail) && /不是判据演化/.test(a1.tail);
        // ② 面变（指纹变）⇒ 措辞必须是「已过期」，且不得反过来写「未变」
        const faceChg = classifyDrift(mk(OTHER, 3, ROWS, 'x'), envDiff, FP, 3, ROWS, 'x');
        const a2 = driftAttribution(faceChg, FP, 3, 'x');
        const ok2 = faceChg.kind === 'drift' && a2.faceChanged === true
          && /判据面\*\*已过期\*\*/.test(a2.why) && /判据面变了/.test(a2.tail) && !/未变/.test(a2.why);
        // ③ 面变（表体缺行）也必须走「已过期」支
        const rowChg = classifyDrift(mk(FP, 3, ROWS.slice(0, 2), 'x'), envDiff, FP, 3, ROWS, 'x');
        const ok3 = driftAttribution(rowChg, FP, 3, 'x').faceChanged === true;
        // ④ 印刷面：正文两支都真的被调用到（防函数存在却没人调）
        const src = read('scripts/arch-claims.mjs');
        const wired = (src.match(/driftAttribution\(/g) || []).length >= 3;
        const bad = [['面未变→未变措辞', ok1], ['面变→已过期措辞', ok2], ['表体缺行→已过期支', ok3], ['函数已接线(≥3处)', wired]].filter((x) => !x[1]).map((x) => x[0]);
        return assert(!bad.length, `面未变措辞 ${ok1 ? '✓' : '✗'}｜面变措辞 ${ok2 ? '✓' : '✗'}｜缺行支 ${ok3 ? '✓' : '✗'}｜接线 ${wired ? '✓' : '✗'}` + (bad.length ? `｜未命中 ${bad.join(',')}` : ''));
      }),
      A('B234-4', '索引', 'D-1 的处置形态是**判据**而非一次性修复（S-5 在位 + 两副本无已退役件）', '本脚本含 S-5 且两处清单源文件不含 plugin-client.js', () => {
        const src = read('scripts/arch-claims.mjs');
        const clean = ['src/host/pure.js', 'src/client/updater.js'].every((f) => !read(f).includes('plugin-client.js'));
        return assert(src.includes("'S-5'") && clean, `S-5 规则在位 ${src.includes("'S-5'")}｜两副本洁净 ${clean}`);
      }),
    ],
  },
];

// ───────────────────────── 结构性判据（分母与在册性，不属任何单条 ADR） ─────────────────────────

const PE_ADR_SET = CLAIMS.map((c) => c.adr).sort();

/** 在册缺陷台账：机检发现的**非 ADR 面**问题——必须写明处置指向，否则 S-4 记冲突（防"发现了但没人管"）。
 *  当前为空：唯一一条 D-1（`UPDATE_MANIFEST` 含已退役 `plugin-client.js`，使 `update/pull` 在本仓不可能成功）
 *  已于 2026-09-19 按用户拍板方案 A 修复（两处副本 + 注释条数 + U30 断言 + 重建产物），并把「这一类」固化为判据 **S-5**
 *  ——一次性修复会复长，判据才会拦住下一次。 */
const DEFECTS = [];

const STRUCTURAL = [
  A('S-1', '结构', '分母完整性：判据表覆盖的 ADR 集合 == 声明的 PE 决策集（出处 nav_graph mode=adrs）', '7 条且逐条对应', () => {
    // 声明面（出处：`nav_graph mode=adrs`，锚点匹配 /pe-f\d|prompt-enhancer/，采集 2026-09-19）。
    // 新增 PE 决策必须同步加行，否则 S-1（本处）与 S-2（治理日志交叉核对）都会红。
    const declared = ['ADR-146', 'ADR-194', 'ADR-197', 'ADR-201', 'ADR-224', 'ADR-230', 'ADR-234'].sort();
    const same = declared.length === PE_ADR_SET.length && declared.every((x, i) => x === PE_ADR_SET[i]);
    return assert(same, `${PE_ADR_SET.length} 条：${PE_ADR_SET.join(',')}`);
  }),
  A('S-2', '索引', '分母交叉核对：治理日志内 PE 锚点的多重集 == 判据表锚点多重集', `日志可读时 ${CLAIMS.length} 条锚点逐一对应`, () => {
    if (!fs.existsSync(GOV_EVENTS)) return { skip: true, actual: '治理日志不可读（CI/干净 clone 预期）' };
    const anchors = fs.readFileSync(GOV_EVENTS, 'utf8').split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.kind === 'decide' && /pe-f\d|prompt-enhancer/.test(String(e.anchor || '')))
      .map((e) => e.anchor);
    const want = CLAIMS.map((c) => c.anchor).sort();
    const got = anchors.sort();
    return assert(got.length === want.length && got.every((x, i) => x === want[i]), `日志 ${got.length} 条 vs 表 ${want.length} 条`);
  }),
  A('S-3', '结构', '在册性：每条 TARGET（未达）断言必须写明依据', '每条 TARGET 均有 pending 依据', () => {
    const targets = CLAIMS.flatMap((c) => c.assertions.filter((a) => a.kind === '目标').map((a) => ({ adr: c.adr, id: a.id, why: (c.pending || []).find((p) => p.id === a.id) })));
    const bare = targets.filter((t) => !t.why || !t.why.reason);
    return assert(!bare.length, bare.length ? `无依据：${bare.map((t) => t.id).join(',')}` : `${targets.length} 条 TARGET 全部在册`);
  }),
  A('S-4', '结构', '在册缺陷台账：每条缺陷必须写明处置指向与证据（防"发现了但没人管"）', '每条缺陷含 disposition + evidence', () => {
    const bare = DEFECTS.filter((d) => !d.disposition || !(d.evidence || []).length || !d.owner);
    return assert(!bare.length, bare.length ? `条目不全：${bare.map((d) => d.id).join(',')}` : `${DEFECTS.length} 条在册缺陷均有处置指向`);
  }),

  // ── 状态归属判据（RC-F：同一状态多处持有 ⇒ 让副本可机检） ──────────────────────────

  A('S-5', '结构', '发布物清单一致：两处 `UPDATE_MANIFEST` 副本相等、逐项 ⊆ `package.json` files 白名单、注释条数 == 数组长度', '两副本相等 + 无白名单外条目 + 注释与实际同数', () => {
    const wl = require(abs('package.json')).files;
    const legal = (n) => wl.includes(n) || wl.some((w) => n.startsWith(w + '/'));
    const grabArr = (f, name) => {
      const m = read(f).match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
      return m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : null;
    };
    const host = grabArr('src/host/pure.js', 'UPDATE_MANIFEST');
    const client = grabArr('src/client/updater.js', 'UPDATER_MANIFEST');
    if (!host || !client) return no(`清单未解析到（host ${!!host} / client ${!!client}）`);
    const cm = read('src/host/pure.js').match(/全部 (\d+) 个文件/);
    const outside = host.filter((n) => !legal(n));
    const same = host.join() === client.join();
    const cnt = cm ? Number(cm[1]) === host.length : false;
    return assert(same && !outside.length && cnt,
      `host ${host.length} 项 / client ${client.length} 项｜副本相等 ${same}｜白名单外 ${outside.length ? outside.join(',') : '无'}｜注释称 ${cm ? cm[1] : '?'} 实为 ${host.length}`);
  }),
  A('S-6', '结构', '重启探测名单自洽：`RESTART_FILES` 逐项磁盘在位 + ⊆ 发布物白名单 + 含两个装配链入口', '逐项在位且合法，且含 plugin-host.js 与 lib/index.cjs', () => {
    const m = read('lib/index.cjs').match(/const RESTART_FILES = \[([^\]]*)\]/);
    if (!m) return no('未解析到 RESTART_FILES');
    const arr = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    const wl = require(abs('package.json')).files;
    const legal = (n) => wl.includes(n) || wl.some((w) => n.startsWith(w + '/'));
    const missing = arr.filter((f) => !exists(f));
    const outside = arr.filter((f) => !legal(f));
    const entries = arr.includes('plugin-host.js') && arr.includes('lib/index.cjs');
    return assert(!missing.length && !outside.length && entries,
      `${arr.length} 项｜缺文件 ${missing.length ? missing.join(',') : '无'}｜白名单外 ${outside.length ? outside.join(',') : '无'}｜入口齐 ${entries}`);
  }),
  A('S-7', '结构', 'i18n 全局平衡：`ZH` 与 `EN` 顶层键集相等且非空', '两语言键集完全相同（0 差异）', () => {
    const raw = read('src/client/i18n.js');
    const lit = raw.match(/^module\.exports\s*=\s*"([\s\S]*)"\s*;?\s*$/m);
    if (!lit) return no('未解析到 i18n 字符串字面量');
    const src = lit[1].replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const iZ = src.indexOf('const ZH');
    const iE = src.indexOf('const EN');
    if (iZ < 0 || iE <= iZ) return no('未定位到 ZH/EN 两个表');
    const keys = (block) => { const o = []; const re = /^\s{2}([A-Za-z0-9_]+)\s*:/gm; let x; while ((x = re.exec(block)) !== null) o.push(x[1]); return o; };
    const KZ = keys(src.slice(iZ, iE));
    const KE = keys(src.slice(iE));
    const onlyZ = KZ.filter((k) => !KE.includes(k));
    const onlyE = KE.filter((k) => !KZ.includes(k));
    return assert(KZ.length > 0 && !onlyZ.length && !onlyE.length,
      `ZH ${KZ.length} 键 / EN ${KE.length} 键｜仅 ZH ${onlyZ.length ? onlyZ.join(',') : '无'}｜仅 EN ${onlyE.length ? onlyE.join(',') : '无'}`);
  }),
  A('S-8', '结构', '行尾契约执行：受控文本跨机 LF + 二进制不被转换 + 契约在位且被匹配', 'i/ 与 w/ 仅 lf|none；二进制扩展名有显式 binary 声明；.gitattributes 含 * text=auto eol=lf', () => {
    // 依据：.gitattributes「源文件一律 LF」是**契约**，契约无用例即声明（红队 R5）。
    // 只断言跨机稳定的量：索引/工作树行尾、二进制声明面、契约行本身。判定语义（什么算 LF）不可重定义。
    const attrs = exists('.gitattributes') ? read('.gitattributes') : null;
    if (attrs === null) return no('.gitattributes 不在位（行尾契约无载体）—— i/ w/ attr/ 无从断言');
    const contract = /^\s*\*\s+text=auto\s+eol=lf\s*$/m.test(attrs);
    const r = eolRows();
    if (!r || r.error) return no('git ls-files --eol 不可执行：' + (r && r.error ? r.error : '.git 缺位（非 git 检出 / 解包发行物）'));
    const rows = r.rows.filter((x) => !x.raw);
    const malformed = r.rows.filter((x) => x.raw);
    const scan = (rs) => {
      const text = rs.filter((x) => x.attr === 'text' || x.attr === 'text=auto');
      const bins = rs.filter((x) => x.index === '-text');
      return {
        text, bins,
        badText: text.filter((x) => !['lf', 'none'].includes(x.index) || !['lf', 'none'].includes(x.worktree)),
        // 注：不再有 badBin 腿——「i/-text ⇒ attr 含 binary/-text」与 --eol 的列来源同源，恒真（空转）。
        //     二进制面的真判据是下面的 undeclared（**声明面**：扩展名必须在 .gitattributes 有显式规则）。
        badBin: [],
      };
    };
    const j = scan(rows);
    // 判别力自证（变异体）：把第 1 件 w/lf 改成 w/crlf，同一判定路径必须变红；否则本判据可被静默掏空。
    const at = rows.findIndex((y) => y.worktree === 'lf');
    const neg = scan(rows.map((x, i) => (i === at ? { ...x, worktree: 'crlf' } : x)));
    // 二进制**声明面**：真实存在的二进制扩展名必须在 .gitattributes 有显式规则。
    //   ⚠ 不采用「i/-text ⇒ attr 含 -text」的字面写法——--eol 的 attr/ 列本就是 i/-text 的来源，该式恒真（空转）。
    const body = attrs.split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l)).join('\n');
    const binExts = [...new Set(j.bins.map((x) => (path.extname(x.file) || '(无扩展名)').toLowerCase()))].filter((e) => e !== '(无扩展名)');
    const undeclared = binExts.filter((e) => !new RegExp('\\*\\' + e + '\\s+(binary|-text)\\s*$', 'm').test(body));
    const zero = rows.length === 0 || j.text.length === 0 || j.bins.length === 0 || binExts.length === 0;
    const dist = (k) => { const m = {}; for (const x of rows) m[x[k]] = (m[x[k]] || 0) + 1; return Object.entries(m).map(([a, b]) => a + '×' + b).join(' '); };
    const show = (xs) => xs.slice(0, 8).map((x) => x.file + '(' + x.index + ' ' + x.worktree + ' ' + x.attr + ')').join(' ');
    // --deep（可选，不进 gate 链）：逐件字节往返核对，防"判据读到的不是磁盘那份"。默认关，避免每跑一次读全仓。
    if (has('--deep') && !zero) {
      const enc = j.text.filter((x) => !roundTripOk(x.file)).map((x) => x.file);
      if (enc.length) return no('字节往返不等（判据读到的与磁盘非同源）' + enc.length + ' 件：' + enc.slice(0, 5).join(',') + '｜i/ ' + dist('index') + '｜w/ ' + dist('worktree'));
    }
    const pass = contract && !zero && !j.badText.length && !j.badBin.length && !undeclared.length && !malformed.length && neg.badText.length === 1;
    return assert(pass,
      '契约行 ' + contract
      + '｜i/ ' + dist('index') + '｜w/ ' + dist('worktree') + '｜attr/ ' + dist('attr')
      + '｜受控 ' + rows.length + ' 件：文本判 ' + j.text.length + ' 恰越界 ' + j.badText.length + (j.badText.length ? '：' + show(j.badText) : '')
      + '｜二进制 ' + j.bins.length + ' 件（扩展名 ' + binExts.join(',') + '）声明缺 ' + undeclared.length + (undeclared.length ? '：' + undeclared.join(',') : '')
      + '｜畸形 --eol 行 ' + malformed.length
      + '｜负控 命中 ' + neg.badText.length + '/1'
      + (zero ? '｜⚠ 空扫：分母含 0（' + rows.length + '/' + j.text.length + '/' + j.bins.length + '），不判绿' : ''));
  }),
];

// ───────────────────────────────── 执行 ─────────────────────────────────

const RUN = [];
async function run(list_, tier) {
  for (const a of list_) {
    let r;
    try { r = await a.fn(); } catch (e) { r = { pass: false, actual: `抛错 ${String(e.message).slice(0, 70)}` }; }
    RUN.push({ tier, ...a, ...r });
  }
}
for (const c of CLAIMS) await run(c.assertions.map((a) => ({ ...(a.kind === '目标' ? { target: true } : {}), claim: c.adr, ...a })), 'CLAIM');
await run(STRUCTURAL, 'STRUCT');

const conflicts = RUN.filter((r) => !r.skip && r.pass === false && !r.target);
const skips = RUN.filter((r) => r.skip);
const pendingTargets = RUN.filter((r) => r.target && r.pass === false);
const passed = RUN.filter((r) => !r.skip && r.pass === true);

const ICON = (r) => (r.skip ? '⤫' : r.pass ? '✓' : r.target ? '⧗' : '✗');
const fmt = (r) => `  ${ICON(r)} ${r.id} ${r.kind}  ${r.detail}\n      期望 ${r.expect}\n      实测 ${r.actual}${r.skip ? '' : ''}`;

function textReport() {
  const out = [];
  out.push('结构判据机检 · ADR 承诺 ↔ 代码现状（P4 · 口径：物理行 = split(\'\\n\').length）');
  out.push(`分母：PE 架构决策 ${CLAIMS.length} 条（ADR-146 · 194 · 197 · 201 · 224 · 230）`);
  out.push('');
  for (const c of CLAIMS) {
    const rows = RUN.filter((r) => r.claim === c.adr);
    out.push(`${c.adr} @${c.anchor} · ${c.at} · [${c.level}] ${c.promise}`);
    for (const r of rows) out.push(fmt(r));
    const p = (c.pending || []).filter((x) => rows.some((r) => r.id === x.id && !r.pass));
    for (const x of p) out.push(`      ↳ 在册依据 ${x.id}：${x.reason}`);
    out.push('');
  }
  out.push('结构性判据（分母 / 在册性）');
  for (const r of RUN.filter((x) => x.tier === 'STRUCT')) out.push(fmt(r));
  out.push('');
  out.push(`⚠ 在册缺陷 ${DEFECTS.length} 条（非 ADR 面，机检发现；有处置指向但**尚未处置**）`);
  for (const d of DEFECTS) {
    out.push(`  ⚠ ${d.id} @${d.at} · ${d.surface}`);
    out.push(`      发现 ${d.finding}`);
    out.push(`      证据 ${d.evidence.join('｜')}`);
    out.push(`      处置 ${d.disposition}（owner=${d.owner}）`);
  }
  out.push('');
  out.push(`汇总：通过 ${passed.length} · 冲突 ${conflicts.length} · SKIP ${skips.length} · 在册未达 ${pendingTargets.length} · 在册缺陷 ${DEFECTS.length}`);
  if (skips.length) out.push(`  SKIP 明细：${skips.map((s) => s.id).join(', ')}（本地治理档/日志缺位——不记 PASS）`);
  return out.join('\n');
}

function mdTable() {
  const out = [];
  out.push('| ADR | 锚点 | 承诺 | 判据 | 档 | 期望 | 实测 | 判定 |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const r of RUN) {
    const c = CLAIMS.find((x) => x.adr === r.claim);
    out.push(`| ${r.claim || '—'} | \`${c ? c.anchor : '—'}\` | ${c ? c.promise.slice(0, 46) + (c.promise.length > 46 ? '…' : '') : '（结构性）'} | ${r.id} ${r.kind}：${r.detail} | ${r.skip ? 'SKIP' : r.pass ? (r.target ? '在册未达' : 'PASS') : r.target ? '在册未达' : '冲突'} | ${r.expect} | ${r.actual} | ${ICON(r)} |`);
  }
  return out.join('\n');
}

/** 判据面指纹（T2 · 2026-09-27）：**跨环境同值**的判据面摘要。
 *  只吃「非环境派生」列，不吃 期望/实测/判定（那三列随治理日志可不可读而变）。
 *  用法：投影里展示 + `--check` 可归因（漂移时先比指纹）。 */
function claimsFingerprint(rows = RUN, counts = null) {
  // ⚠ 计数里**只许放跨环境同值的量**（本仓实测的坑）：passed/conflicts/skips 随治理日志可不可读
  //   而变（治理根态 33/0/1 vs 工件形态 31/0/3），放进去指纹就会跨形态抖 ⇒ 归因会说反。
  const c = counts || [RUN.length, DEFECTS.length];
  const faces = rows.map((r) => [r.claim || '—', r.id, r.kind, r.detail, r.tier, r.target ? 'T' : '-'].join('\u0001'));
  return 'sha256:' + createHash('sha256').update(faces.join('\u0002') + '\u0003' + c.join(','), 'utf8').digest('hex').slice(0, 16);
}

function mdTail() {
  const out = [];
  // ── 判据面指纹（T2 · 2026-09-27）────────────────────────────────────────────
  // 为什么要有它（本仓实测的假红）：本档**同时**是投影与判定基准，而投影里的「实测/判定」列
  //   **天然随环境变**——实测（--json 逐列比对，同脚本同树）：id/kind/detail/claim/tier/target
  //   两形态全同；actual×2、pass/skip×2、expect×1 仅因「治理日志可不可读」而不同（A194-4/S-2）。
  //   ⇒ 单形态判漂移，另一种形态必然**假红**（实测：治理根态投影留在档里，不带 PE_GOV_ROOT 的
  //     默认形态就报「文档漂移」，而判据表其实一个字都没变）。
  //   故判据面 = 「非环境派生」列（id/kind/detail/claim/tier/target + 计数），跨形态同值。
  //   它点名的是**判据演化**（加/删/改一条断言），不点名读数——正是「投影过期」与「只是换了个
  //   环境跑」的分界。计数进指纹是为了「加一条判据而投影没重生成」可见。
  //   副作用（声明的边界）：断言文案（detail）改动也会让 fingerprint 变，即使判据等价——
  //   工程上是刻意的（本表 detail 即判据文本）；必要时应重生成投影，**不要**判这条为假红。
  out.push(`> fingerprint（判据面指纹·跨环境同值）：\`${claimsFingerprint()}\`（${RUN.length} 条断言｜读数快照 env=${SNAP_ENV}｜判据面 = id/kind/detail/claim/tier/target + 计数，**不含**环境派生的期望/实测/判定列）`);
  out.push('');
  out.push(`> 生成：\`node scripts/arch-claims.mjs --md\`（**投影，勿手抄；判定例程不手抄，见 --check**）｜通过 ${passed.length} · 冲突 ${conflicts.length} · SKIP ${skips.length} · 在册未达 ${pendingTargets.length} · 在册缺陷 ${DEFECTS.length}`);
  out.push('');
  out.push('**在册缺陷（非 ADR 面；有处置指向但尚未处置）**');
  out.push('');
  out.push('| # | 状态面 | 发现 | 证据 | 处置 |');
  out.push('|---|---|---|---|---|');
  for (const d of DEFECTS) out.push(`| ${d.id} | ${d.surface} | ${d.finding} | ${d.evidence.join('<br>')} | ${d.disposition} |`);
  return out.join('\n');
}

function mdReport() { return mdTable() + '\n' + mdTail(); }

if (has('--write')) {
  if (exists(DOC)) {
    const src = read(DOC);
    const i = src.indexOf(MARK_BEGIN);
    const j = src.indexOf(MARK_END);
    if (i >= 0 && j > i) {
      fs.writeFileSync(abs(DOC), src.slice(0, i + MARK_BEGIN.length) + '\n\n' + mdReport() + '\n\n' + src.slice(j), 'utf8');
      console.log(`✓ 判据表已写入 ${DOC} 标记区`);
    } else console.log(`✗ ${DOC} 缺标记 ${MARK_BEGIN} / ${MARK_END}，未写入`);
  } else console.log(`✗ ${DOC} 不存在（跳过写入）`);
} else if (has('--md')) {
  console.log(mdReport());
} else if (has('--json')) {
  console.log(JSON.stringify({
    peAdrSet: PE_ADR_SET,
    summary: { pass: passed.length, conflict: conflicts.length, skip: skips.length, pendingTarget: pendingTargets.length, defects: DEFECTS.length },
    defects: DEFECTS,
    rows: RUN.map(({ fn, ...r }) => r),
  }, null, 1));
} else {
  console.log(textReport());
}

/** 投影漂移**分类器**（纯函数·可内存变异自证，见 B234-6）。
 *  region: string（标记区文本）| null（档不存在）| undefined（档在但缺标记）
 *  envOnly / stale-readings ⇒ 判据面没变，差异只来自环境派生列（期望/实测/判定）。
 *  drift ⇒ 判据面变了（判据演化 / 表体缺行 / 指纹被替换 / 同环境读数漂移）⇒ 投影确实过期。 */
function classifyDrift(region, computedMd, fp, n, rows = [], snapEnv = null, stripFp = null) {
  if (region === null) return { kind: 'missing-doc' };
  if (region === undefined) return { kind: 'missing-marker' };
  // ⚠ 两件事必须分开：①指纹/条数/env 从**原始档区**读（它们是数据）；
  //   ②比对拿**已剥指纹行**的档区（与 compute 侧对称）。曾把两者合成一步 ⇒ 指纹读成（无）、
  //   "环境一致"被误报成指纹不一致（2026-09-27 实测踩到，两种环境都红）。
  const meta = String(region).trim();
  const r = stripFp ? stripFp(meta) : meta;
  const docFp = (meta.match(/fingerprint（[^）]*）：`(sha256:[0-9a-f]+)`/) || [])[1] || null;
  // 指纹行把「读数快照 env=…」插在条数与判据面之间 ⇒ 条数定式只能取到「N 条断言」，
  //   不能沿用上游那版「（N 条断言｜判据面 = 」——旧定式会取不到条数，
  //   把「判据面未过期」误判成过期（2026-09-27 实测踩到）。
  const boundN = (meta.match(/（(\d+) 条断言/) || [])[1] || null;
  const docEnv = (meta.match(/读数快照 env=([a-z-]+)/) || [])[1] || null;
  // 三腿：①档内指纹有值 ②等于本形态实算值 ③条数与本形态一致
  const fpConsistent = docFp === fp && boundN === String(n);
  const verbatim = r === String(computedMd).trim();   // r 已剥指纹行，与 compute 侧对称
  // 表体**行绑定**：每行的 `| id kind：detail |` 必须逐字在位。防"留着指纹行、把表体删空/删几行"，
  //   也防"投影是旧判据面拼出来的新指纹"。（不切单元格：实测 S-8 的期望/实测列内含 ASCII `|`，
  //   切列会误判——这也是读数列不得参与判定的又一条理由。）
  const rowPrefix = (x) => `| ${x.id} ${x.kind}：${x.detail} |`;
  const missingRows = rows.filter((x) => !r.includes(rowPrefix(x)));
  if (verbatim) return { kind: 'none', docFp, boundN, fpConsistent, missingRows };
  // 判据面（指纹 + 表体逐行）一致 ⇒ 差异只能在**读数尾巴**上。还要再分一层，
  //   因为「换环境」与「同环境读数变了」是两件事：
  //   · 档内读数取自**另一种**环境（env 标签不同）⇒ 陈旧读数，刷新即可，**不判漂移**；
  //   · **同一种**环境、读数却变了 ⇒ 环境解释不了（例如代码改了、实测值跟着动）⇒ 仍判红。
  //     ⚠ 少了这一层就是把闸门放宽：同环境也先放过，等于把「读数漂移」整类静默掉——
  //       那正是本仓最忌的「失败不可观测」。
  const thesisOk = fpConsistent && !missingRows.length;
  const envExplains = !!docEnv && docEnv !== snapEnv;
  if (thesisOk && envExplains) return { kind: 'stale-readings', docFp, boundN, docEnv, fpConsistent, missingRows, envOnly: true };
  return { kind: 'drift', docFp, boundN, docEnv, fpConsistent, missingRows, envOnly: false, sameEnvReadings: thesisOk };
}

/** 漂移**归因文本**（纯函数·可内存变异自证，见 B234-7）。
 *  判据面「变没变」决定措辞，**两分类不得互相借用**：
 *   · 面变（指纹/条数/表体任一失效）⇒ 判据面**已过期**，是判据演化；
 *   · 面未变、只剩同环境读数漂移 ⇒ 判据面**未变**，不得写「已过期」（一个字未改却叙述成过期，
 *     即 b2/I3「措辞与事实相反」同族缺陷——2026-09-27 独立复核实测踩到）。
 *  tail 供收尾行复用，避免收尾与上文两处说反。 */
function driftAttribution(drift, localFp, localN, snapEnv) {
  const missing = drift.missingRows || [];
  const legs = [];
  if (drift.docFp !== localFp) legs.push(`指纹不一致（档内 ${drift.docFp || '（无）'} vs 本形态 ${localFp}）`);
  if (drift.boundN !== String(localN)) legs.push(`条数不一致（档内 ${drift.boundN || '（无）'} 条 vs 本形态 ${localN} 条）`);
  if (missing.length) legs.push(`表体缺行 ${missing.length}/${localN}（如 ${missing.slice(0, 3).map((x) => x.id).join(',')}）`);
  if (drift.sameEnvReadings) legs.push(`读数漂移（同为 env=${snapEnv}，实测/判定列却与投影不符）`);
  const faceChanged = drift.docFp !== localFp || drift.boundN !== String(localN) || missing.length > 0;
  const why = faceChanged
    ? `判据面**已过期**（${legs.join('｜') || '表体与指纹之外的内容不一致'}）——投影随判据演化而过期，请在**本形态**跑 --write 重生成`
    : `判据面**未变**，同环境（env=${snapEnv}）读数漂移：${legs.join('｜')}——档内指纹与表体均与本形态一致，不符的是**读数列**（判据面一个字未改），请跑 --write 重生成`;
  const tail = faceChanged
    ? '上面已归因：判据面变了，不是换环境'
    : '上面已归因：判据面未变，是同环境读数漂移（不是判据演化）';
  return { faceChanged, why, tail };
}

if (has('--check')) {
  // 判定例程（**不手抄**）：把指纹行从**两侧**都剥掉，只比其余部分。
  //   ⚠ 两侧必须用**同一个**剥行函数（对称）——--write 写进档里的投影是**含**指纹行的，
  //     只剥实算侧就永远比不齐、还会把"环境一致"误报成"读数快照陈旧"（2026-09-27 实测踩到）。
  //   ⚠ 必须自底向上重算，不得引用投影里那行 fingerprint——否则"改档里的指纹"能绕过门禁。
  const stripFp = (t) => String(t).split('\n').filter((l, i, a) => !/^> fingerprint（/.test(l)
    // 剥行后空行塌缩，按同样规则归一：丢弃"生成："行**之后**的第一个空行
    && !(i > 0 && /^> 生成：/.test(a[i - 1]) && l === '')).join('\n').trim();
  const stampedMd = () => stripFp(mdReport());
  const docText = exists(DOC) ? read(DOC) : null;
  const docRegion = (() => {
    if (docText === null) return null;                    // 本地治理档缺位 → 不判漂移（SKIP）
    const i = docText.indexOf(MARK_BEGIN);
    const j = docText.indexOf(MARK_END);
    return (i < 0 || j < 0) ? undefined : docText.slice(i + MARK_BEGIN.length, j);
  })();

  const localFp = claimsFingerprint();
  const localN = RUN.length;
  // 档区原样传入；classifyDrift 内部分离「读元数据（原始）」与「比对（已剥指纹行）」两侧
  const drift = classifyDrift(docRegion, stampedMd(), localFp, localN, RUN, SNAP_ENV, stripFp);
  // 判据面指纹一致性：档里那行必须**同时**满足 ①有值 ②与本形态实算值相等 ③条数与本形态一致。
  //   三腿缺一即记一票冲突（原来这条只会打印，不参与判定——改档里的指纹或留下旧指纹都无人抓）。
  const fpConsistent = !!drift.fpConsistent;
  // 收尾措辞的**诚实腿**（b2/I3 同源教训）：本环存在 SKIP ⇒ 措辞不得说「一致」而不加限定，
  //   否则"有环未判"会被读成"判过了"。这条在**加指纹前就已存在**（实测：治理根态输出
  //   「✓ 结构判据一致：… SKIP 0」而工件形态输出同样以「✓ 结构判据一致」开头、SKIP 3——
  //   门禁编排器靠**尾行计数**兜住了，但人读会被误导）。声明它，不改任何环的判定语义。
  const partial = skips.length > 0;
  const fpLine = `判据面指纹 ${localFp}（${localN} 条断言）${drift.docFp && drift.docFp !== localFp ? `｜⚠ 投影内指纹不一致：${drift.docFp}` : ''}`;

  if (drift.kind === 'missing-marker') {
    console.log(`⚠ ${DOC} 缺标记区，文档漂移未判（本地档可重建，可跑 --write 重生成）`);
  } else if (drift.kind === 'missing-doc') {
    console.log(`⤫ 文档投影未判：${DOC} 不存在（本地治理档 gitignore，CI/干净 clone 无此件）——不记 PASS｜${fpLine}`);
  } else if (drift.kind === 'stale-readings') {
    // ── 归因两分（其一）：判据面**没变**，只是读数取自另一种环境 ──────────────
    // 这是本会要的「读数可解释」：**不判漂移、不 exit 1**（否则换个环境跑就假红，
    //   而判据表其实一个字都没变）。
    console.log(`⤫ 读数快照陈旧（非判据面漂移）：投影表体与判据面一致，仅环境派生列（期望/实测/判定）取自`
      + ` env=${drift.docEnv || '?'} 而本次是 env=${SNAP_ENV}——跑 --write 可刷新，本条不记 PASS 也不记冲突｜${fpLine}`);
  } else if (drift.kind === 'drift') {
    // 归因另一支：**点名具体是哪条腿失效**——笼统写「指纹 A vs B」会把'指纹相同但表体缺行'
    //   也叙述成指纹不同（实测踩到）。⚠ 措辞由 driftAttribution 统一出，面未变时**不得**说「已过期」。
    const attr = driftAttribution(drift, localFp, localN, SNAP_ENV);
    console.log(`✗ 文档漂移：判据表与投影不一致｜${attr.why}｜${fpLine}`);
  }

  if (conflicts.length) {
    console.log(`✗ 结构判据冲突 ${conflicts.length} 条：${conflicts.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }
  if (drift.kind === 'drift') {
    const attr = driftAttribution(drift, localFp, localN, SNAP_ENV);
    console.log(`✗ ${attr.faceChanged ? '投影已过期' : '投影读数漂移'}：请跑 --write 重生成（${attr.tail}）`);
    process.exit(1);
  }
  // 防手抄腿：档在、标记在、**档区与实算逐字相等**却仍不一致 ⇒ 只能是档内那行指纹被
  //   替换/缺失/条数过期（逐字相等时该腿不会误伤）。⚠ 不受 partial 影响——有 SKIP 也得抓。
  const docPresent = drift.kind !== 'missing-doc' && drift.kind !== 'missing-marker';
  if (docPresent && fpConsistent === false) {
    console.log(`✗ 投影内指纹行与会话实算不符（防手抄失效）：档内 ${drift.docFp || '（无）'} / ${drift.boundN || '（无）'} 条 vs 本形态 ${localFp} / ${localN} 条——请跑 --write 重生成`);
    process.exit(1);
  }
  const tail = partial
    ? `（${passed.length} 条判定通过；另有 SKIP ${skips.length} 条**未判**：${skips.map((s) => s.id).join(', ')}——本条不是"全过"）`
    : '（——有处置指向、尚未处置）';
  console.log(`✓ 结构判据一致${partial ? '（未判全）' : ''}：断言 ${passed.length} 通过 · 冲突 0 · SKIP ${skips.length}（本地档/日志缺位）· 在册未达 ${pendingTargets.length} · 在册缺陷 ${DEFECTS.length}${tail}｜${fpLine}`
    + (drift.kind === 'stale-readings' ? `｜读数快照 env=${drift.docEnv || '?'} ≠ 本次 env=${SNAP_ENV}（表体与判据面一致，仅读数列陈旧；跑 --write 可刷新，不记冲突）` : ''));
  // 收尾措辞的诚实腿：有 SKIP 时不得只留一个 ✓ 让编排器/人读成"全过"。
  if (partial) console.log(`⤫ 未判全：SKIP ${skips.length} 条（${skips.map((s) => s.id).join(', ')}）——不记 PASS`);
}