#!/usr/bin/env node
// scripts/card-arch-consistency.mjs - 知识卡<->架构档一致性机检（册 A · 2026-09-25）
//
// 为什么要有它（根因，不是个案）：
//   前序抓出的 4 处假断言指向同一根因——「知识卡与架构档互不引用」。
//   docs/devref/shoucang/2026-09-10-...索引锚点待修正.md 早在 2026-09-13 就标 closed，
//   并写明「6 个落点已全部补登、pure.js 已从 PE-F04 摘除」；但三份架构档仍写「索引待修正 /
//   应补登记」，三个子代理又都没读那张卡，重蹈了它 2026-09-10 的误判。
//   => 卡闭了环、档不知道；档写了误判、卡也不知道。人工逐条对账已发三次，故把一致性变成机检
//      （与 ADR-234「结构判据机检化」同源），并落在既有 gate 链里——否则又是一份「存在但没人跑」的文档。
//
// 分母口径（**卡数 ≠ 文件数**，册 C 2026-09-25 实测）：
//   docs/devref 下 .md 共 7 份，但**卡只有 4 张**——cards/how-to.md 与 cards/decision.md 是**空册壳**（0 卡），
//   cards/reference.md 载 2 张，shoucang/ 2 份各 1 张。故本门的卡分母**一律取 INDEX.md 卡表的数据行数**，
//   不取任何文件数（按文件数会得 7 / 5 / 3 的错值）。
//
// 判据（三条 + 三条判别力自证；分母 / 豁免 / 命中全部打印，禁止只给结论）：
//   A-1  卡表<->卡正文：INDEX.md 卡表里状态 closed/superseded 的卡，其正文文件若仍含未闭环措辞
//        （待修正 / 应补登记 / 待拍板 / 未代改）且**全文无任何闭环标记** -> FAIL。
//        口径：正文若已写明闭环事实（后续…已全部补登 等），则残留措辞属表述面（卡标题归册 C 的 C-1），
//        不在此判——本判据抓的是「卡闭了环但正文根本没改」。
//        ⚠ 口径边界（显式声明，勿当全知）：闭环标记按**文件级**判定，故「在某处补一句后续」即可豁免
//          全文命中；这是措辞面判据的固有限度，不是本门能自动证伪的东西。
//   A-2  档<->卡：<治理根>/.internal/arch/prompt-enhancer-*.md 出现「索引待修正 / 应改锚」类措辞时，
//        其**所在文本块**（连续非空行 = 段落或整张表）内必须出现实测依据
//        （实测 / nav_graph / 已作废 / 二次复核 / 已闭环），否则 FAIL。
//        扫描面**只限本项目档**：治理根管多个项目，扫全目录会对别的项目出红（误伤，实测 18 份档中 5 份属他项目）；
//        _PLAN-* 类规划档不是「现行架构档」，亦不在扫描面。
//   A-3  空扫护栏：扫描面**存在**但分母为 0 -> FAIL（吸取本轮「arch-check.mjs l1 子模式 0 对 0 判 ✓」教训），
//        不得判绿。目录 / 文件**不存在**（干净 clone、非本项目机器）-> SKIP：本地治理面缺位，
//        既不是 PASS 也不是 FAIL——否则 gitignore 的 devref 或治理根不在的机器会被误伤。
//   A-1b / A-2b / A-3b  判别力自证：判据可被静默掏空（把规则删掉仍然全绿）——见下方 F3 口径。
//
//   A-1b / A-2b / A-3b  判别力自证（F3·2026-09-26 红队修复升级）：对三条判据的**真实判定路径**做内存变异
//        （UNCLOSED 置空 / ARCH_TRIG 置空 / 判定阈值改掉）后结论必须**翻转**——只证纯函数会同句响应不算证接线，
//        门禁照样能被静默掏空（把规则删掉仍然全绿）。另有**接线断言**：扫描面存在时真判据不得停在 SKIP。
//        变异只在内存发生（不落盘、不改文件、不起子进程）。
//   F7 读侧健康（2026-09-26 红队修复）：编码不可判（非法 UTF-8 / U+FFFD）、表行被静默丢弃、
//        读期间被改写（size+mtimeMs 变化）——命中即 FAIL，真判据**不得判绿**。
//
// 退出码（**保持原契约**：仅 --check 才按冲突数决定；无参调用仍 exit 0——该处越界不改，另立工作项）：
//   有冲突 -> exit 1。
//   F2（2026-09-26 红队修复）：未判全（有 SKIP）或读侧不可判 -> exit 0，但尾行**不得出现「一致」**字样，
//        改打「⏭ …未判全：断言 N · SKIP M（未判：…）」；--json 的 summary 另有 judged（真判条数）。
//   F3（2026-09-26 红队修复 + 裁定收窄）：扫描面**存在却解析不出可判对象（分母 0）** -> A-4 FAIL，
//        堵「表头失配 ⇒ 分母 0 ⇒ 同句 SKIP」那一类静默掏空。
//        口径收窄：present 且**行数 > 0** 而 closed/superseded = 0 是**合法分母 0**，不算接线缺口（不红）。
//        A-1c / A-2c / A-3c 为**真数据对账腿**：判据裁决必须与扫描面读数独立重推的期望一致，
//        用于堵「只改调用点 add(id, true, …)」这类掏空；A-3c 的期望由读数独立重推，不复用 A-3 的中间量。
//
// ⚠ --json 兼容性：本版**结构可能与旧版不同** —— summary 增 judged/unjudged/readHealth 三键，
//   新增顶层 tail（尾行文本），且尾行不再以纯文本追加在 JSON 之后（旧版 stdout 因此不是合法 JSON）。
//   消费方请按键取值，勿按行号/行数解析。
//
// 用法：node scripts/card-arch-consistency.mjs [--check] [--json] [--devref <dir>] [--arch <dir>]
//   --devref / --arch  覆盖扫描面（默认 docs/devref 与 <治理根>/.internal/arch），
//                      用于**可复现的反例自证**：指向临时目录即可看它变红。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 状态出口契约（P5）：本环原有尾行三态保留为**给人看的面**；下面在**同一批裁决量**上再产出机读契约行。
import { emitRingState, installCrashGuard, installStdoutHygiene } from './lib/ring-state.mjs';

installCrashGuard('cards');
// 本环 --json 的 stdout 是机读数据面（必须可 JSON.parse）⇒ 装 stdout 纯净性守卫（无开关）。
installStdoutHygiene();
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const opt = (name, dflt) => {
  const i = ARGS.indexOf(name);
  if (i >= 0 && ARGS[i + 1] && ARGS[i + 1].indexOf('--') !== 0) return ARGS[i + 1];
  return dflt;
};
const GOV_ROOT = process.env.PE_GOV_ROOT || 'D:\\FF';
const DEVREF = path.resolve(opt('--devref', path.join(ROOT, 'docs', 'devref')));
const ARCH = path.resolve(opt('--arch', path.join(GOV_ROOT, '.internal', 'arch')));

// ── 词表（唯一归属地；改口径改这里，并同步头注）─────────────────────────
const UNCLOSED = ['待修正', '应补登记', '待拍板', '未代改'];
let CLOSED_MARK = /后续|已全部|已订正|已闭环|已作废|已并入|已摘除|已补登|为准/; // let：F3 变异用
// 用 let：F3 判别力自证要对**真实判定路径**做内存变异（掏空即须翻转），const 正则无法就地置换
let ARCH_TRIG = /索引待修正|应改锚|待改锚|索引待补/;
let ARCH_EVID = /实测|nav_graph|已作废|二次复核|已闭环/;
const ARCH_GLOB = /^prompt-enhancer-.*\.md$/;

const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

// ── F7 读侧健康（2026-09-26 红队修复）──────────────────────────────────
// 一次读入同时记录三类「读得不干净」的事实。口径：命中即「本判据不可判」——**不得判绿**，
// 而不是让分母静默缩小后同句 SKIP（那正是「让失败不可观测」）。
const HEALTH = { issues: [] };
function readText(p) {
  const st0 = fs.statSync(p);
  const buf = fs.readFileSync(p);
  let st1 = null;
  try { st1 = fs.statSync(p); } catch { st1 = null; }
  const text = buf.toString('utf8');
  const issues = [];
  if (text.indexOf('\uFFFD') >= 0) issues.push('编码不可判（含 U+FFFD 替换符：非合法 UTF-8 字节序列）');
  // ⚠ 防御性保留 · 实测**当前不可达**（2026-09-26 第三轮，复核席提出死码质疑，实测确认）：
  //   V8 的 UTF-8 解码器对**每一类**畸形序列都产出 U+FFFD，故上一分支必然先命中。
  //   取证：15 类非法字节样本（lone 0x80 / lone 0xC0 / overlong 2·3·4 字节 / 截断 0xE2 0x82 / 截断 0xF0 0x9F /
  //   代理对 0xED 0xA0 0x80 / GB18030 0xD0 0xD1 0xD2 / 0xFF 0xFE / 0xFE 0xFF / latin1 0xE9 / 5 字节 / 混合 0x41 0xFF 0x42）
  //   全部在第一分支命中；「分支二独中」= 0 例（唯一能到这一行的是**明文含真 U+FFFD 字符**的文件，但那也先命中分支一）。
  //   保留理由：它是「解码再编码不等」这条不变式的兜底，若将来换解码器（或用 Buffer 转码路径）行为变化，这一行是唯一防线。
  //   它不冒充「已验证可达」——就本行注释为准，任何读者可据此判为死径。
  else if (Buffer.from(text, 'utf8').compare(buf) !== 0) issues.push('编码不可判（解码再编码与原始字节不等｜当前不可达，防御性保留）');
  if (!st1 || st1.size !== st0.size || st1.mtimeMs !== st0.mtimeMs) issues.push('读期间被改写（size/mtimeMs 在读前后变化）');
  if (issues.length) HEALTH.issues.push({ file: p, issues });
  return text;
}
const readIf = (p) => (fs.existsSync(p) ? readText(p) : null);

/** 文本块切分：连续非空行 = 一个块（markdown 段落 / 整张表）；返回 行数组 + 每行所属块的起始行 */
function blocksOf(text) {
  const lines = text.split(/\r?\n/);
  const owner = new Array(lines.length).fill(-1);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') { start = -1; continue; }
    if (start === -1) start = i;
    owner[i] = start;
  }
  return { lines, owner };
}

/** 块内命中：返回 [{ word, line, blockStart, blockEnd, blockChars, text }] */
function hitsInBlocks(text, re) {
  const { lines, owner } = blocksOf(text);
  const isHead = lines.map((l) => /^\s{0,3}#{1,6}\s/.test(l));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(re.source, 'g'));
    if (!m) continue;
    const bs = owner[i];
    let be = i;
    while (be + 1 < lines.length && owner[be + 1] === bs) be++;
    // 标题行是**标签**不是断言：把标题并入其下首个正文块，避免「## 索引待修正 + 空行 + 有据正文」被误判无依据
    if (bs === i && isHead[bs]) {
      let k = be + 1;
      while (k < lines.length && lines[k].trim() === '') k++;
      if (k < lines.length && !isHead[k]) { let e2 = k; while (e2 + 1 < lines.length && owner[e2 + 1] === owner[k]) e2++; be = e2; }
    }
    const blockText = lines.slice(bs, be + 1).join('\n');
    for (const w of m) out.push({ word: w, line: i + 1, blockStart: bs + 1, blockEnd: be + 1, blockChars: blockText.length, text: blockText });
  }
  return out;
}

/** 解析 INDEX.md 卡表：**表头驱动**（册 C 2026-09-25 重排过列序——按列位切会静默读错字段）*/
function parseIndexTable(text) {
  const lines = text.split(/\r?\n/);
  const cellsOf = (raw) => {
    const t = raw.trim();
    return (t.charAt(0) === '|' ? t.replace(/^\|/, '').replace(/\|\s*$/, '') : t).split('|').map((c) => c.trim());
  };
  let head = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('|') < 0) continue;
    const cells = cellsOf(lines[i]).map(clean);
    if (cells.indexOf('卡') >= 0 && cells.indexOf('状态') >= 0) { head = i; break; }
  }
  if (head < 0) return { rows: [], columns: [] };
  const columns = cellsOf(lines[head]).map(clean);
  // 列名模糊匹配：册 C 会把表头写全（如「溯源（源文件）」），按精确名找不到会**静默读空**
  const at = (name) => columns.findIndex((c) => c.indexOf(name) >= 0);
  const rows = [];
  const dropped = [];                                          // F7b：被丢弃的表行（分母静默缩小 → 必须可见）
  for (let i = head + 1; i < lines.length; i++) {
    if (lines[i].indexOf('|') < 0) break;                       // 卡表结束
    const cells = cellsOf(lines[i]);
    if (/^[-:\s|]+$/.test(cells.join('|'))) continue;            // 分隔行
    if (cells.length < columns.length) { dropped.push({ line: i + 1, cells: cells.length, cols: columns.length }); break; } // 非本表
    const pick = (name) => (at(name) >= 0 && cells[at(name)] !== undefined ? cells[at(name)] : '');
    const status = clean(pick('状态'));
    if (!status) continue;
    rows.push({ title: clean(pick('卡')), volume: clean(pick('册')), status, source: pick('溯源') });
  }
  return { rows, columns, dropped, headLine: head + 1 };
}

/** 卡 -> 正文文件：① 溯源列里的 .md 路径（权威：册 C 改题后标题已与文件名不同名）② 按册回退 */
function resolveCardBody(devrefDir, row) {
  for (const tok of (row.source.match(/`[^`]*\.md`/g) || [])) {
    const cand = path.join(devrefDir, tok.replace(/`/g, '').trim());
    if (fs.existsSync(cand)) return { file: cand, via: '溯源列' };
  }
  if (row.volume === 'shoucang') {
    const dir = path.join(devrefDir, 'shoucang');
    if (!fs.existsSync(dir)) return null;
    const hit = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f.indexOf(row.title) >= 0);
    return hit.length === 1 ? { file: path.join(dir, hit[0]), via: '题名匹配' } : null;
  }
  const f = path.join(devrefDir, 'cards', row.volume + '.md');
  return fs.existsSync(f) ? { file: f, via: '册壳文件' } : null;
}

/** A-1 判定核心（真数据与合成样本共用）。F7a：读入面不可判（编码）时一律判违规，不得判绿 */
function judgeCardBody(body) {
  const hits = UNCLOSED.filter((w) => body.indexOf(w) >= 0);
  const closed = CLOSED_MARK.test(body);
  if (body.indexOf('\uFFFD') >= 0) return { hits, closed, violation: true, unreadable: true };
  return { hits, closed, violation: hits.length > 0 && !closed };
}

/** A-2 判定核心（纯函数）：返回无依据的违规命中 */
function judgeArchText(text) {
  return hitsInBlocks(text, ARCH_TRIG).filter((h) => !ARCH_EVID.test(h.text));
}

// ── 扫描面 1：卡表 <-> 卡正文 ─────────────────────────────────────────
function scanCards(devrefDir) {
  const indexFile = path.join(devrefDir, 'INDEX.md');
  const indexText = readIf(indexFile);
  if (indexText === null) return { present: false, indexFile, rows: [], closed: [], details: [], violations: [], unresolved: [], dropped: [], srcFiles: [] };
  const { rows, columns, dropped } = parseIndexTable(indexText);
  const closed = rows.filter((r) => /^(closed|superseded)\b/i.test(r.status));
  const violations = [];
  const unresolved = [];
  const details = [];
  const seen = new Set();
  const srcFiles = [indexFile];   // F7a：本判据读过的全部文件（含 INDEX 本身）
  // 逐张登记（含**不判**的 accepted 卡）：分母必须整表可见，不能只列被判的那几张
  for (const row of rows) {
    const judged = /^(closed|superseded)\b/i.test(row.status);
    const body = resolveCardBody(devrefDir, row);
    if (!body) { details.push({ title: row.title, status: row.status, judged, file: '(未解析到正文)', via: '-', hits: [], closedMark: false }); if (judged) unresolved.push(row.title); continue; }
    const rel = path.relative(ROOT, body.file);
    const key = path.resolve(body.file);
    if (seen.has(key)) { details.push({ title: row.title, status: row.status, judged, file: rel, via: body.via, dup: true, hits: [], closedMark: true }); continue; }
    seen.add(key);
    srcFiles.push(body.file);
    const v = judgeCardBody(readIf(body.file) || '');
    details.push({ title: row.title, status: row.status, judged, file: rel, via: body.via, hits: v.hits, closedMark: v.closed });
    if (judged && v.violation) violations.push({ title: row.title, file: rel, hits: v.hits });
  }
  return { present: true, indexFile, rows, columns, closed, details, violations, unresolved, dropped, srcFiles };
}

// ── 扫描面 2：架构档 ─────────────────────────────────────────────────
function scanArch(archDir) {
  if (!fs.existsSync(archDir)) return { present: false, dir: archDir, docs: [], witnessed: [], violations: [] };
  const docs = fs.readdirSync(archDir).filter((f) => ARCH_GLOB.test(f));
  const violations = [];
  const witnessed = [];
  for (const f of docs) {
    const text = readIf(path.join(archDir, f)) || '';
    const all = hitsInBlocks(text, ARCH_TRIG);
    const bad = judgeArchText(text);
    if (all.length) witnessed.push({ doc: f, hits: all.length, ok: all.length - bad.length, bad: bad.length });
    for (const b of bad) violations.push({ doc: f, word: b.word, line: b.line, block: b.blockStart + '-' + b.blockEnd, blockChars: b.blockChars });
  }
  return { present: true, dir: archDir, docs, witnessed, violations };
}

/** F7：给定一批文件路径，返回其中「读侧不可判」的诊断串（编码/被改写） */
function unreadableIn(files) {
  const out = [];
  for (const h of HEALTH.issues) {
    if (!files.some((f) => path.resolve(f) === path.resolve(h.file))) continue;
    const rel = path.relative(ROOT, h.file);
    out.push((rel.startsWith('..') ? h.file : rel) + '（' + h.issues.join('；') + '）');
  }
  return out;
}

// ── 执行 ─────────────────────────────────────────────────────────────
const ROWS = [];
const add = (id, pass, detail, expect, actual, skip) => ROWS.push({ id, pass, skip: !!skip, detail, expect, actual });

const cards = scanCards(DEVREF);
const arch = scanArch(ARCH);

// A-1
if (!cards.present) {
  add('A-1', true, '卡表<->卡正文：未闭环措辞检测', '扫描面缺位 -> SKIP', 'SKIP：' + path.relative(ROOT, cards.indexFile) + ' 不存在（本地治理面，干净 clone 无此文件）', true);
} else if (!cards.closed.length) {
  add('A-1', true, '卡表<->卡正文：未闭环措辞检测', '已闭环卡正文不含未闭环措辞', '分母 0：卡表 ' + cards.rows.length + ' 张卡，其中 closed/superseded 0 张——本判据无可判对象', true);
} else {
  const sum = cards.details.filter((d) => d.judged).reduce((a, d) => a + d.hits.length, 0);
  const cardDropped = cards.dropped || [];
  const detail = '卡表<->卡正文：卡分母 ' + cards.rows.length + ' 张（INDEX 卡表数据行，**非文件数**）｜本判据判 ' + cards.closed.length + ' 张（closed/superseded）｜余 ' + (cards.rows.length - cards.closed.length) + ' 张非闭环卡不判｜命中未闭环措辞 ' + sum + ' 处｜逐卡 ' + cards.details.map((d) => d.title + '[' + d.status + (d.judged ? '·判' : '·不判') + (d.dup ? '·同文件已并计' : '') + '｜' + d.file + '（' + d.via + '）' + (d.judged && !d.dup ? '｜命中 ' + (d.hits.length ? d.hits.join(',') : '0') + '｜闭环标记 ' + (d.closedMark ? '有' : '无') : '') + ']').join(' ') + (cards.unresolved.length ? '｜正文未解析 ' + cards.unresolved.length + '（' + cards.unresolved.join(';') + '）' : '');
  const cardUnreadable = unreadableIn(cards.srcFiles || []);
  const pass = !cards.violations.length && !cards.unresolved.length && !cardDropped.length && !cardUnreadable.length;
  const actual = pass
    ? '分母 ' + cards.closed.length + ' 张已闭环卡｜均零命中或已写明闭环事实｜违规 0'
    : '违规 ' + cards.violations.length + ' 张' + (cards.violations.length ? '：' + cards.violations.map((v) => v.title + '（' + v.file + '，命中 ' + v.hits.join(',') + '，全文无闭环标记）').join(' ') : '') + (cards.unresolved.length ? '｜正文未解析（判据无法执行，不得判绿）' + cards.unresolved.length + ' 张：' + cards.unresolved.join(',') : '') + (cardDropped.length ? '｜F7b 表行被丢弃（分母静默缩小，不得判绿）' + cardDropped.length + ' 行：' + cardDropped.map((d) => 'INDEX:' + d.line + '（' + d.cells + '/' + d.cols + ' 列）').join(' ') : '') + (cardUnreadable.length ? '｜F7 读侧不可判（不得判绿）' + cardUnreadable.length + ' 处：' + cardUnreadable.join(' / ') : '');
  add('A-1', pass, detail, '已闭环卡的正文不含未闭环措辞（或已写明闭环事实）', actual);
}

// A-2
if (!arch.present) {
  add('A-2', true, '架构档措辞须邻近实测依据', '扫描面缺位 -> SKIP', 'SKIP：' + ARCH + ' 不存在（本地治理根面，非本项目机器无此目录）', true);
} else if (!arch.docs.length) {
  add('A-2', true, '架构档措辞须邻近实测依据', 'prompt-enhancer-*.md 存在且措辞有依据', '分母 0：' + ARCH + ' 下 prompt-enhancer-*.md 0 份——本判据无可判对象', true);
} else {
  const hitsN = arch.witnessed.reduce((a, w) => a + w.hits, 0);
  const wit = arch.witnessed.length ? arch.witnessed.map((w) => w.doc + '(命中 ' + w.hits + '/有据 ' + w.ok + '/无据 ' + w.bad + ')').join(' ') : '无命中';
  const archUnreadable = unreadableIn(arch.docs.map((f) => path.join(ARCH, f)));
  add('A-2', !arch.violations.length && !archUnreadable.length,
    '架构档措辞须邻近实测依据（扫 prompt-enhancer-*.md，块级邻域）',
    '命中措辞的块内必含 实测/nav_graph/已作废/二次复核/已闭环；读入面须可判',
    '分母 ' + arch.docs.length + ' 份本项目档（同目录他项目档与 _PLAN-* 不在扫描面）｜命中措辞 ' + hitsN + ' 处（' + wit + '）｜无依据 ' + arch.violations.length + (arch.violations.length ? '：' + arch.violations.map((v) => v.doc + ':' + v.line + '（' + v.word + '，块 ' + v.block + '，' + v.blockChars + ' 字符内无依据）').join(' ') : '') + (archUnreadable.length ? '｜F7 读侧不可判（不得判绿）' + archUnreadable.length + ' 份：' + archUnreadable.join(' / ') : ''));
}

// A-3 空扫护栏：扫描面存在但分母 0 -> FAIL（不判绿）
{
  const emptyCards = cards.present ? cards.rows.length : null;
  const emptyArch = arch.present ? arch.docs.length : null;
  const zero = [];
  if (emptyCards === 0) zero.push('INDEX 卡表 0 张卡');
  if (emptyArch === 0) zero.push('本项目架构档 0 份');
  const skip = !cards.present && !arch.present;
  add('A-3', zero.length === 0, '空扫护栏（扫描面存在则分母不得为 0）', '分母 > 0；为 0 即 FAIL，不判绿',
    skip ? 'SKIP：两个扫描面均不存在'
      : (zero.length ? 'FAIL：空扫——' + zero.join(' / ') + '（扫描面存在却 0 命中，判据不可判，不得判绿）'
        : '卡表 ' + (cards.present ? cards.rows.length + ' 张卡' : '缺位') + '（口径=INDEX 卡表数据行，非文件数）｜本项目架构档 ' + (arch.present ? arch.docs.length + ' 份' : '缺位') + '，分母均 > 0'),
    skip);
}

// ── 判别力自证（A-1b / A-2b / A-3b）：门禁不得被静默掏空 ─────────────────
// F3（2026-09-26 红队修复）：自证必须沿**真实判定路径**做内存变异后断言结论**翻转**——
// 只把合成样本喂给纯函数，证的是「函数会同句响应」，证不到「规则真的接在扫描面上」（掏空照样全绿）。
// 变异只在内存做：不落盘、不改文件、不起子进程；每处变异用完立刻还原。
/** 内存变异：setup() 就地改状态并返回还原函数；probe() 在变异态下取读数。不落盘、不改文件、不起子进程 */
function withMutation(setup, probe) {
  const restore = setup();
  try { return probe(); } finally { restore(); }
}
{
  // ── A-1b：掏空词表 / 掏空闭环标记（改判定阈值），两条路径结论都必须翻转 ──
  const sample = '本卡正文仍写：待修正，等待处理。';
  const baseViolation = judgeCardBody(sample).violation;                          // 基线：应判违规
  const wipedViolation = withMutation(
    () => { const bak = UNCLOSED.splice(0, UNCLOSED.length); return () => UNCLOSED.push(...bak); },
    () => judgeCardBody(sample).violation);                                       // 掏空词表 -> 应不再违规
  const closedAlwaysViolation = withMutation(
    () => { const bak = CLOSED_MARK; CLOSED_MARK = /[\s\S]*/; return () => { CLOSED_MARK = bak; }; },
    () => judgeCardBody(sample).violation);                                       // 阈值改「永远视作已闭环」-> 应不再违规
  const ok1 = judgeCardBody('待修正（后续：已全部补登）。').violation;              // 真数据正例：不违规
  const ok2 = judgeCardBody('正文与现状一致，无事发生。').violation;                 // 真数据正例：不违规
  const a1bOk = baseViolation === true && wipedViolation === false && closedAlwaysViolation === false && ok1 === false && ok2 === false;
  add('A-1b', a1bOk,
    'A-1 判别力自证（真实判定路径的内存变异：掏空词表 / 改阈值）',
    '基线判违规；掏空 UNCLOSED 或把闭环标记改恒真后结论必须翻转；真数据正例不得误伤',
    '基线(命中无标记) ' + (baseViolation ? '判违规 ✓' : '漏判 ✗')
    + '｜掏空词表 ' + (wipedViolation === false ? '翻转 ✓' : '未翻转 ✗')
    + '｜闭环标记恒真 ' + (closedAlwaysViolation === false ? '翻转 ✓' : '未翻转 ✗')
    + '｜正例(命中+后续) ' + (ok1 ? '误伤 ✗' : '不违规 ✓')
    + '｜正例(零命中) ' + (ok2 ? '误伤 ✗' : '不违规 ✓'));

  // ── A-2b：掏空触发词表 / 掏空依据词表，结论都必须翻转 ──
  const badText = '## 索引待修正\n\n建议补登记若干文件。';
  const okText = '## 索引待修正\n\n本次实测 nav_graph 显示落点全部在册。';
  const nBaseBad = judgeArchText(badText).length;
  const nWiped = withMutation(
    // 注意：掏空须用**永不匹配**的正则；/$^/ 之类可空匹配的源会被 hitsInBlocks 的 new RegExp(...,'g') 逐行判真（假命中）
    () => { const bak = ARCH_TRIG; ARCH_TRIG = /$a^/; return () => { ARCH_TRIG = bak; }; },
    () => judgeArchText(badText).length);                                         // 掏空触发词表 -> 应为 0
  const nWipedEvid = withMutation(
    () => { const bak = ARCH_EVID; ARCH_EVID = /[\s\S]*/; return () => { ARCH_EVID = bak; }; },
    () => judgeArchText(badText).length);                                         // 掏空依据词表 -> 应为 0
  const nOk = judgeArchText(okText).length;
  const a2bOk = nBaseBad === 1 && nWiped === 0 && nWipedEvid === 0 && nOk === 0;
  add('A-2b', a2bOk,
    'A-2 判别力自证（真实判定路径的内存变异：掏空触发词 / 掏空依据词）',
    '基线违规 1 处；掏空 ARCH_TRIG 或 ARCH_EVID 后必须归零；真数据正例不得误伤',
    '基线(命中无依据) 违规 ' + nBaseBad + ' 处' + (nBaseBad === 1 ? ' ✓' : ' ✗')
    + '｜掏空触发词 违规 ' + nWiped + ' 处' + (nWiped === 0 ? ' ✓' : ' ✗')
    + '｜掏空依据词 违规 ' + nWipedEvid + ' 处' + (nWipedEvid === 0 ? ' ✓' : ' ✗')
    + '｜正例(命中+实测) 违规 ' + nOk + ' 处' + (nOk === 0 ? ' ✓' : ' ✗'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-arch-empty-'));
  // 空扫反例须**与真实形状同构**：INDEX.md 在位（扫描面存在）但卡表 0 行——否则 present=false 会走 SKIP 而非 FAIL
  fs.writeFileSync(path.join(tmp, 'INDEX.md'), '# cards INDEX\n\n| 卡 | 册 | 创建 | 状态 | 溯源 |\n|---|---|---|---|---|\n', 'utf8');
  const eCards = scanCards(tmp);
  const eArch = scanArch(tmp);
  const eCardsZero = eCards.present && eCards.rows.length === 0;
  const eArchZero = eArch.present && eArch.docs.length === 0;
  fs.rmSync(tmp, { recursive: true, force: true });
  add('A-3b', eCardsZero && eArchZero,
    'A-3 判别力自证（指向空目录）', '存在的空扫描面 -> 分母 0（可被 A-3 判 FAIL）',
    '空卡表 ' + (eCardsZero ? 'present 且 0 张 ✓' : '未复现 ✗') + '｜空架构目录 ' + (eArchZero ? 'present 且 0 份 ✓' : '未复现 ✗'));
}

// ── F3 接线断言 A-4：扫描面存在却**解析不出任何可判对象** -> FAIL ────────────────
// 口径收窄（2026-09-26 主持人裁定 1）：A-1 停在 SKIP 有两种形状，**理由可判别**：
//   [合法零 closed] 卡表合法、行数 > 0、closed/superseded = 0 ⇒ 合法分母 0，不红（红它会培育「习惯性放行」）
//   [表头失配]      表头不被识别 / 解析失败，行数 = 0          ⇒ 接线（解析）缺口，红
// 故「停在 SKIP」本身不是缺口；**分母为 0 才是**。判定核心抽为纯函数，A-4 自身也能被变异自证（A-4b）。
// 注：这是 A-4 自身口径的收窄，不触碰「什么算未闭环」的判定语义。
function wiringGaps(rows, presentOf, denomOf) {
  return ['A-1', 'A-2'].filter((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r || !r.skip) return false;          // 真判过 -> 不是缺口
    if (!presentOf(id)) return false;         // 扫描面缺位 -> 合法 SKIP
    return denomOf(id) === 0;                 // 面在、行数为 0 -> 接线/解析缺口
  });
}
{
  const real = ['A-1', 'A-2'];
  const presentOf = (id) => (id === 'A-1' ? cards.present : arch.present);
  const denomOf = (id) => (id === 'A-1' ? (cards.present ? cards.rows.length : null) : (arch.present ? arch.docs.length : null));
  const stuck = wiringGaps(ROWS, presentOf, denomOf);
  const legalZero = ['A-1', 'A-2'].filter((id) => {
    const r = ROWS.find((x) => x.id === id);
    return r && r.skip && presentOf(id) && denomOf(id) > 0;
  });
  add('A-4', stuck.length === 0, 'F3 接线断言：扫描面存在却解析不出可判对象（分母 0）',
    'present 且分母 0 的真判据 -> FAIL；present 且分母 > 0 的 SKIP 属合法分母 0，不算接线缺口',
    stuck.length
      ? 'FAIL：扫描面 present 却分母为 0 的真判据 ' + stuck.length + ' 条：' + stuck.join(', ') + '（解析/接线缺口，判据不可判，不得判绿）'
      : 'A-1 ' + (cards.present ? 'present(' + cards.rows.length + ' 张卡)' : '缺位') + ' · A-2 ' + (arch.present ? 'present(' + arch.docs.length + ' 份档)' : '缺位')
        + (legalZero.length ? '｜合法分母 0 不记缺口：' + legalZero.join(', ') : ''));
}

// ── F3 补强：A-1 真数据对账（判据裁决必须与扫描面**实际读数**一致）───────────────
// 变异只改调用点（add('A-1', true, …)）时，判定核心的自证照样全绿 —— 本条按读数重算一遍期望裁决。
// 第三轮修正（C-3 / 主持人裁定 2）：**适用条件不再只看分母**。原实现「A-1 SKIP ⇒ 本条也 SKIP」，
//   于是「状态列换个判据不认得的词 ⇒ closed 数 0 ⇒ A-1 SKIP ⇒ 对账腿跟着 SKIP」——证据（正文里明写
//   「待修正」）与裁决（SKIP）矛盾时全链无护栏，真数据即可触发、零变异。
//   新口径：A-1 停在 SKIP 时，若扫描面 present 且**任何已解析卡正文确有未闭环命中** ⇒ 本条判「分母口径与
//   正文证据不一致」→ FAIL（不得静默判绿）。判据不重定义「什么算未闭环」——用的是同一条 judgeCardBody。
{
  const a1 = ROWS.find((x) => x.id === 'A-1');
  const blocking = (cards.violations || []).length + (cards.unresolved || []).length + ((cards.dropped || []).length)
    + unreadableIn(cards.srcFiles || []).length;
  // 与裁决无关的**原始证据**：已解析卡正文里的未闭环命中（含判据判不到的那批卡）
  const evidenceHits = (cards.details || []).filter((d) => (d.hits || []).length > 0);
  const skipOk = !a1 || a1.skip === true;
  if (skipOk && cards.present && evidenceHits.length > 0) {
    add('A-1c', false, 'A-1 真数据对账（裁决须与扫描面读数一致）',
      'A-1 停在 SKIP 时，若扫描面 present 且已解析卡正文有未闭环命中 ⇒ 证据与裁决矛盾，不得判绿',
      'FAIL：分母口径与正文证据不一致 —— 已解析卡正文命中未闭环措辞 ' + evidenceHits.length + ' 张'
      + '：' + evidenceHits.map((d) => d.title + '（' + d.file + '，命中 ' + d.hits.join(',') + '）').join(' ')
      + '｜但 A-1 因 closed/superseded 分母为 0 走了 SKIP（状态列用词不在判据词表内即触发此形状）');
  } else if (skipOk) {
    add('A-1c', true, 'A-1 真数据对账（裁决须与扫描面读数一致）', '无可判对象 -> 本对账不适用', '扫描面缺位或分母 0 且正文无未闭环命中：本条不适用（A-1 自身已按 SKIP 口径记录）', true);
  } else {
    const expectPass = blocking === 0;
    add('A-1c', a1.pass === expectPass, 'A-1 真数据对账（裁决须与扫描面读数一致）',
      '扫描面读数有阻断项 ⇒ A-1 必须 !pass；阻断项 0 ⇒ A-1 必须 pass',
      '读数阻断项 ' + blocking + ' 项（违规 ' + (cards.violations || []).length + ' · 未解析 ' + (cards.unresolved || []).length
      + ' · 丢弃行 ' + ((cards.dropped || []).length) + ' · 读侧不可判 ' + unreadableIn(cards.srcFiles || []).length + '）'
      + '｜期望 pass=' + expectPass + ' · 实际 pass=' + a1.pass + (a1.pass === expectPass ? ' ✓' : ' ✗ 裁决与读数不一致'));
  }
}

// ── F3 补强：A-2 真数据对账（与 A-1c 同形：裁决必须与扫描面读数一致）────────────
{
  const a2 = ROWS.find((x) => x.id === 'A-2');
  const blocking2 = (arch.violations || []).length + unreadableIn(arch.docs.map((f) => path.join(ARCH, f))).length;
  if (!a2 || a2.skip) {
    add('A-2c', true, 'A-2 真数据对账（裁决须与扫描面读数一致）', '无可判对象 -> 本对账不适用', '扫描面缺位或分母 0：本条不适用（A-2 自身已按 SKIP 口径记录）', true);
  } else {
    const expectPass2 = blocking2 === 0;
    add('A-2c', a2.pass === expectPass2, 'A-2 真数据对账（裁决须与扫描面读数一致）',
      '扫描面读数有阻断项 ⇒ A-2 必须 !pass；阻断项 0 ⇒ A-2 必须 pass',
      '读数阻断项 ' + blocking2 + ' 项（无依据 ' + (arch.violations || []).length + ' · 读侧不可判 ' + unreadableIn(arch.docs.map((f) => path.join(ARCH, f))).length + '）'
      + '｜期望 pass=' + expectPass2 + ' · 实际 pass=' + a2.pass + (a2.pass === expectPass2 ? ' ✓' : ' ✗ 裁决与读数不一致'));
  }
}

// ── F3 补强（裁定 2·2026-09-26）：A-3 真数据对账 ────────────────────────────
// 缺口实录：A-3 与 A-4 单掏空任一都红，**同时掏空则全绿** —— 两个护栏互相兜底，兜不住彼此一起失效。
// 本腿不复用 A-3 内的 zero 变量，直接由扫描面读数**独立重推**期望裁决：裁决与重推不一致即红。
{
  const a3 = ROWS.find((x) => x.id === 'A-3');
  const zeroAgain = [];
  if (cards.present && cards.rows.length === 0) zeroAgain.push('INDEX 卡表 0 张卡');
  if (arch.present && arch.docs.length === 0) zeroAgain.push('本项目架构档 0 份');
  const skipAgain = !cards.present && !arch.present;
  if (!a3 || skipAgain) {
    add('A-3c', true, 'A-3 真数据对账（裁决须与扫描面读数一致）', '无可判对象 -> 本对账不适用',
      '两扫描面均缺位：本条不适用（A-3 自身已按 SKIP 口径记录）', true);
  } else {
    const expectPass3 = zeroAgain.length === 0;
    add('A-3c', a3.pass === expectPass3, 'A-3 真数据对账（裁决须与扫描面读数一致）',
      '独立重推：面 present 且分母 0 ⇒ A-3 必须 !pass；否则 A-3 必须 pass',
      '独立重推 分母为 0 的扫描面 ' + zeroAgain.length + ' 项' + (zeroAgain.length ? '（' + zeroAgain.join(' / ') + '）' : '')
      + '｜期望 pass=' + expectPass3 + ' · 实际 pass=' + a3.pass + (a3.pass === expectPass3 ? ' ✓' : ' ✗ 裁决与读数不一致（护栏被掏空或口径分叉）'));
  }
}

// ── A-5：卡表以外未被引用的卡正文（第二轮补·缺陷 A）────────────────────────────
// 病人：A-4 收窄到「分母为 0」后漏了这一类 —— 卡表解析正常、行数 > 0、零 closed 行，
//   但**磁盘上还有卡表根本没引用的卡正文**（含未闭环措辞）。全链无护栏（收窄前 67f535fd 靠 A-4 误打误撞红）。
// 判据形状（**一律用描述性名称，不用单字代号**：代号在跨席沟通里已被读反过一次）：
//   [表头失配]        = 表头不被识别、解析出 0 行                    -> A-4 红
//   [磁盘有未引用卡]  = 行数 > 0、零 closed 行、存在未被卡表引用的卡正文 -> A-5 红
//   [合法零 closed]   = 行数 > 0、零 closed 行、无未引用卡正文        -> 绿（合法分母 0）
//   [状态词不被识别]  = 状态列用词不在 closed/superseded 词表内、正文却有措辞 -> A-1c 红
//   [仿冒册壳]        = 首行写成册壳样式但正文段里有未闭环措辞         -> A-5 红（第四轮补）
// 判据口径：磁盘卡正文 ⊆ 卡表已解析集合 ⟺ 「未被引用」与「有 case 差异」同时为空。
//   注：按字面「差集非空」，真实 INDEX.md 里的 `cards/reference.md` 同时也是**册壳**（首行 # 且含「知识卡册」），
//   在大小写敏感的 WSL 上会被误报——故对**真册壳**豁免；豁免是唯一让文件整体脱离全部判据的出口，
//   故**必须具名可见**：A-5 的「实测」串里打印被豁免的件数与文件名清单（:494 这条承诺与实现对账）。
function cardBodyFiles(devrefDir) {
  const out = [];
  for (const sub of ['cards', 'shoucang']) {
    const d = path.join(devrefDir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.md')) out.push({ abs: path.join(d, f), rel: sub + '/' + f, sub });
  }
  return out;
}
// 册壳判定（第四轮·仿冒册壳夹具）：**不可只靠首行仿冒** —— 首行正则形如「# 知识卡册 · reference」
// 再补一句未闭环措辞即可免检（实测 /tmp/ghost → EXIT=0 静默豁免）。
// 改为**结构化**判定，四条件全中才算册壳（任一条不满足即非册壳，落回未引用卡判定）：
//   ① 首行是 H1 且含「知识卡册」——既有格式面，仅作必要条件，不单独构成豁免；
//   ② 整份文件**没有任何卡条目小节**（无 `## ` 开头行）——有卡条目就不可能是空册；
//   ③ 整份文件**没有任何卡字段行**（无 `- 状态：`/`- 溯源：`/`- 指向架构档：`）——有字段就有卡；
//   ④ 未闭环措辞**只出现在 markdown 块引用里**（行首 `>` 或引用块内续行）——见下方 ④ 的实现注释；
//      措辞落在普通正文段 => 那是断言不是告誡 => 不是册壳。
// 取证：真实册壳 how-to.md / decision.md 的「待修正」都落在第 5 行的块引用告诫句（行首 `>`，grep -n 实测）；
//       仿冒夹具的措辞落在普通正文段，条件 ④ 即判非册壳。
function isShellBody(abs) {
  const raw = readIf(abs);
  if (raw === null) return false;
  const lines = raw.split(/\r?\n/);
  const first = lines[0] || '';
  if (!first.startsWith('#') || first.indexOf('知识卡册') < 0) return false;                 // ①
  if (lines.some((l) => /^\s{0,3}#{2,6}\s/.test(l))) return false;                          // ②
  if (lines.some((l) => /^\s*-\s*(状态|溯源|指向架构档)\s*[:：]/.test(l))) return false;      // ③
  // ④ 未闭环措辞只允许出现在**块引用**（markdown 引用 = 引述/告诫）里。
  //    ⚠ 这里**不能**用关键词白名单：第一版我写了「本册|须知|必须|注意|⚠」等词，而仿冒夹具正文正是
  //    「本册待修正，尚未核对。」——关键词本身就是可仿冒面，等于没堵（实测 ghost 仍 EXIT=0）。
  //    结构判据是**块引用**（行首 `>` 或引用块内续行），不是关键词、也不是「同一块里另有闭环词」：
  //    ——「同块须含 CLOSED_MARK 词」这条我试过又撤了：真实两个册壳的告诫句里**不含**任何闭环词
  //      （实测 grep 后续|已全部|已订正|已闭环|已作废|… 均 0 命中），加上它会把真实册壳判成非册壳、
  //      在真实面把它们当「未引用卡」报红——直接违反「真实面必须绿」的硬条件。
  //    ⚠ 已登记残余：仿冒者若把措辞**写进块引用**、且文件里没有其它正文段，形状与真册壳**无法区分**
  //      （这不只是本判据的弱点，是「空册声明」这一形态本身的弱断言性）。此残余见交付说明，不冒充已堵。
  const inQuote = new Array(lines.length).fill(false);
  let inQ = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*>/.test(lines[i])) inQ = true;
    else if (lines[i].trim() === '') inQ = false;   // 空行结束引用块
    inQuote[i] = inQ;
  }
  const hitIdx = lines.map((l, i) => ({ l, i })).filter((x) => UNCLOSED.some((w) => x.l.indexOf(w) >= 0));
  if (hitIdx.some((x) => !inQuote[x.i])) return false;                                       // ④
  return true;
}
function unreferencedCards(devrefDir, rows, resolveFn) {
  if (!fs.existsSync(path.join(devrefDir, 'INDEX.md'))) return { present: false, files: [] };
  const onDisk = cardBodyFiles(devrefDir);
  const declared = new Set();
  for (const row of rows) {
    const b = resolveFn(devrefDir, row);
    if (b) declared.add(path.resolve(b.file));
  }
  const exempt = onDisk.filter((f) => isShellBody(f.abs));
  const files = onDisk
    .filter((f) => !isShellBody(f.abs))
    .map((f) => ({ ...f, declared: declared.has(path.resolve(f.abs)) }))
    .filter((f) => !f.declared);
  return { present: true, files, diskTotal: onDisk.length, declaredTotal: declared.size, exempt };
}
const unreferenced = unreferencedCards(DEVREF, cards.rows || [], resolveCardBody);
{
  if (!unreferenced.present) {
    add('A-5', true, '卡表以外未被引用的卡正文（未纳入卡表者）', '扫描面缺位 -> SKIP', 'SKIP：' + path.relative(ROOT, path.join(DEVREF, 'INDEX.md')) + ' 不存在', true);
  } else {
    const refs = unreferenced.files;
    add('A-5', refs.length === 0,
      '卡表以外未被引用的卡正文（未纳入卡表者）',
      '磁盘卡正文 ⊆ 卡表已解析集合（cards/**、shoucang/**，册壳样式除外）；未被引用的卡正文 > 0 即 FAIL',
      '磁盘卡正文 ' + (unreferenced.diskTotal || 0) + ' 件｜卡表已解析 ' + (unreferenced.declaredTotal || 0) + ' 件｜未被引用 ' + refs.length + ' 件'
      + (refs.length ? '：' + refs.map((f) => f.rel).join(' / ') + '（这些文件的未闭环措辞不在任何判据的扫描面内，不得判绿）' : '')
      // 豁免是**唯一**让文件整体脱离全部判据的出口，必须具名可见（头注口径：分母/豁免/命中全部打印）
      + '｜册壳豁免 ' + (unreferenced.exempt || []).length + ' 件'
      + ((unreferenced.exempt || []).length ? '：' + unreferenced.exempt.map((f) => f.rel).join(' / ') + '（命中首行+无小节+无卡字段+措辞仅在块引用 四条件，故不判）' : ''));
  }
}

// A-4b：护栏自身的内存变异自证——present 恒真/恒假、分母恒 0/恒大、未引用集恒空/恒非空，结论必须随之翻转
{
  const fakeRows = [{ id: 'A-1', skip: true }, { id: 'A-2', skip: false }];
  const allPresent = wiringGaps(fakeRows, () => true, () => 0).length;      // 面在 + 分母 0 -> 应检出 1 处缺口
  const nonePresent = wiringGaps(fakeRows, () => false, () => 0).length;    // 面缺位 -> 应为 0
  const legalZero = wiringGaps(fakeRows, () => true, () => 3).length;       // 面在 + 分母 >0 -> 合法分母 0，应为 0
  const honest = wiringGaps([{ id: 'A-1', skip: false }, { id: 'A-2', skip: false }], () => true, () => 0).length; // 无 SKIP -> 0
  // A-5b：指向临时目录构造「未引用卡 + 卡表只引用其一」的形状，判别函数必须非空检出
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'card-arch-unref-'));
  fs.mkdirSync(path.join(t2, 'cards'), { recursive: true });
  fs.mkdirSync(path.join(t2, 'shoucang'), { recursive: true });
  fs.writeFileSync(path.join(t2, 'INDEX.md'), '# INDEX\n\n| 卡 | 册 | 创建 | 状态 | 溯源 |\n|---|---|---|---|---|\n| 甲卡 | reference | 2026-01-01 | accepted | `cards/reference.md` |\n', 'utf8');
  fs.writeFileSync(path.join(t2, 'cards', 'reference.md'), '# 甲卡\n\n正文正常。\n', 'utf8');
  fs.writeFileSync(path.join(t2, 'shoucang', '未引用卡.md'), '# 乙卡\n\n仍写：索引待修正。\n', 'utf8');
  const uCards = scanCards(t2);
  const u = unreferencedCards(t2, uCards.rows, resolveCardBody);
  // 反向：把未引用卡也登记进卡表 -> 未引用集必须归空
  fs.writeFileSync(path.join(t2, 'INDEX.md'), '# INDEX\n\n| 卡 | 册 | 创建 | 状态 | 溯源 |\n|---|---|---|---|---|\n| 甲卡 | reference | 2026-01-01 | accepted | `cards/reference.md` |\n| 乙卡 | shoucang | 2026-01-01 | accepted | `shoucang/未引用卡.md` |\n', 'utf8');
  const uCards2 = scanCards(t2);
  const u2 = unreferencedCards(t2, uCards2.rows, resolveCardBody);
  fs.rmSync(t2, { recursive: true, force: true });
  const a5bOk = u.files.length === 1 && u2.files.length === 0;
  add('A-4b', allPresent === 1 && nonePresent === 0 && legalZero === 0 && honest === 0 && a5bOk,
    'A-4/A-5 判别力自证（内存变异 + 指向临时目录构造：present/分母/未引用集三面）',
    'present 且分母 0 -> 缺口 1；present 缺位 -> 0；present 且分母 >0 -> 0；无 SKIP -> 0；未引用卡 1 件 -> 检出 1，登记后 -> 0',
    'present+分母0 检出 ' + allPresent + ' 处' + (allPresent === 1 ? ' ✓' : ' ✗')
    + '｜present 缺位 检出 ' + nonePresent + ' 处' + (nonePresent === 0 ? ' ✓' : ' ✗')
    + '｜present+分母>0 检出 ' + legalZero + ' 处' + (legalZero === 0 ? ' ✓' : ' ✗')
    + '｜无 SKIP 检出 ' + honest + ' 处' + (honest === 0 ? ' ✓' : ' ✗')
    + '｜未引用卡 检出 ' + u.files.length + ' 件' + (u.files.length === 1 ? ' ✓' : ' ✗')
    + '｜登记后 检出 ' + u2.files.length + ' 件' + (u2.files.length === 0 ? ' ✓' : ' ✗'));
}

// ── 机读面三态自证 A-6 ────────────────────────────────────────────────
// 必须在 passed/conflicts 之前入表：否则 A-6 自身不在 ROWS 的派生计数里，
// 「rows.filter(pass===true).length === summary.pass」这条自证会把它自己漏掉（实测 11 vs 10）。
// 三态：true = 判过且通过 / false = 判过且不通过 / null = 停在 SKIP（没判上）。退出码仍只由 conflicts 决定。
// 三态映射只此一处：A-6 直接**读它产出的结果**（不是另算一遍），否则「把置 null 那行删掉」可逃逸。
const toTriState = (rows) => rows.map((r) => (r.skip ? { ...r, pass: null } : { ...r, pass: r.pass }));
const rawSkipTrue = ROWS.filter((r) => r.skip && r.pass === true).length;
const emittedRows = toTriState(ROWS);
const triTrueCount = emittedRows.filter((r) => r.pass === true).length;
const triSkipTrueCount = emittedRows.filter((r) => r.skip && r.pass === true).length;
const triExpectPass = ROWS.filter((r) => !r.skip && r.pass).length;
add('A-6', triTrueCount === triExpectPass && triSkipTrueCount === 0,
  '机读面三态自证（SKIP 行不得报 pass=true）',
  'rows.filter(pass===true).length === summary.pass，且不存在 skip 且 pass===true 的行',
  '置 null 前 skip 行原始 pass=true 的 ' + rawSkipTrue + ' 条（原始病态值）'
  + '｜置 null 后 pass=true 计数 ' + triTrueCount + '｜应等于的通过数 ' + triExpectPass + (triTrueCount === triExpectPass ? ' ✓' : ' ✗ 机读面与汇总不一致')
  + '｜置 null 后 skip 却 pass===true 的行 ' + triSkipTrueCount + ' 条' + (triSkipTrueCount === 0 ? ' ✓' : ' ✗ SKIP 在机读面仍报通过'));

const conflicts = ROWS.filter((r) => !r.skip && !r.pass);
const skips = ROWS.filter((r) => r.skip);
const passed = ROWS.filter((r) => !r.skip && r.pass);
// F2：真判条数（judged）——「判过了且通过」与「压根没判上」必须在机器可读面上分开。
// 显式白名单（只算 A-1/A-2/A-3 三条真判据）：自证（A-*b）、接线（A-4）、对账（A-1c）不得充数。
const judged = ROWS.filter((r) => /^A-[123]$/.test(r.id) && !r.skip);
const unjudged = skips.filter((s) => /^A-[123]$/.test(s.id)).map((s) => s.id);
const judgedTotal = judged.length + unjudged.length;
const health = HEALTH.issues.map((h) => (path.relative(ROOT, h.file).startsWith('..') ? h.file : path.relative(ROOT, h.file)) + '（' + h.issues.join('；') + '）');

// F2 + F3：尾行只有在「冲突 0 · 无 SKIP · 读侧干净」时才允许报「判据一致」这类全判通过结论。
// 冲突 -> exit 1；未判全 / 读侧不可判 -> exit 0 但**不得**报全判通过（换了输入就换结论 ⇒ 不可当全判通过读）。
const partial = skips.length > 0 || health.length > 0;
const tailLine = conflicts.length
  ? '✗ 卡<->档冲突 ' + conflicts.length + ' 条：' + conflicts.map((c) => c.id).join(', ')
  : (partial
    ? '⏭ 卡<->档未判全：断言 ' + passed.length + ' · 冲突 0 · SKIP ' + skips.length + ' · 真判 ' + judged.length + '/' + judgedTotal
      + (skips.length ? '（未判：' + unjudged.join(',') + '）' : '')
      + (health.length ? '（读侧不可判 ' + health.length + ' 处）' : '')
      + '——不记 PASS（本条不是全判通过）'
    : '✓ 卡<->档判据全过（无 SKIP、读侧干净）：断言 ' + passed.length + ' 通过 · 冲突 0 · SKIP 0 · 真判 ' + judged.length + '/' + judged.length);

// ── 机读面三态产出 ─────────────────────────────────────────────────
// 病人：add() 的 SKIP 分支统一传 pass=true ⇒ 停在 SKIP 的行在 --json 里报「通过」。修法：置 null。
// rows[].pass 三态：true / false / null（null = 停在 SKIP，没判上）。退出码不受影响。
const jsonRows = toTriState(ROWS);

if (has('--json')) {
  // 机读面：stdout 只有**一行** JSON（stdout 必须可 parse）
  // rows[].pass 三态：true / false / null（null = 停在 SKIP，没判上）
  console.log(JSON.stringify({
    devref: DEVREF, arch: ARCH, rows: jsonRows,
    summary: { pass: passed.length, conflict: conflicts.length, skip: skips.length, judged: judged.length, unjudged, readHealth: health },
    tail: tailLine,
  }, null, 1));
} else {
  console.log('知识卡-架构档（卡<->档）机检（册 A · 判据 A-1 / A-2 / A-3 + 判别力自证 A-1b/A-2b/A-3b + 接线 A-4）');
  console.log('扫描面：卡表 ' + path.relative(ROOT, path.join(DEVREF, 'INDEX.md')) + '｜架构档 ' + ARCH);
  for (const r of ROWS) {
    console.log('  ' + (r.skip ? '[SKIP]' : r.pass ? '✓' : '✗') + ' ' + r.id + '  ' + r.detail);
    console.log('      期望 ' + r.expect);
    console.log('      实测 ' + r.actual);
  }
  console.log('汇总：通过 ' + passed.length + ' · 冲突 ' + conflicts.length + ' · SKIP ' + skips.length + ' · 真判 ' + judged.length + '/' + judgedTotal);
  if (health.length) console.log('读侧健康：✗ ' + health.length + ' 处不可判 —— ' + health.join(' / '));
  console.log(tailLine);
}

// 状态出口（P5）：三态与尾行 tailLine、退出码**同源**（读 conflicts/skips/passed/health 同一批量）。
//   FAIL = 有冲突；SKIP = 未判全（有 SKIP 或读侧不可判）/ 未带 --check（退出码不反映判定）；PASS = 冲突 0 且判全。
const ringState = conflicts.length
  ? ['FAIL', `卡<->档冲突 ${conflicts.length} 条：${conflicts.map((c) => c.id).join(', ')}`]
  : !has('--check')
    ? ['SKIP', '未带 --check（退出码不反映判定）——' + tailLine.replace(/\s+/g, ' ')]
    : partial
      ? ['SKIP', `未判全：断言 ${passed.length} · SKIP ${skips.length}${skips.length ? '（未判：' + unjudged.join(',') + '）' : ''}${health.length ? '（读侧不可判 ' + health.length + ' 处）' : ''}——不记 PASS`]
      : ['PASS', `判据全过（无 SKIP、读侧干净）：断言 ${passed.length} 通过 · 冲突 0 · 真判 ${judged.length}/${judged.length}`];
emitRingState('cards', ringState[0], ringState[1]);

// 退出码：**按原契约不动**（本项只改措辞与信号）——只有显式 --check 才按冲突数与源。
// 无参调用仍 exit 0：这一处是既有行为，改动它属越界；「无参也按门禁退出」另立工作项处理。
if (has('--check') && conflicts.length) process.exit(1);
