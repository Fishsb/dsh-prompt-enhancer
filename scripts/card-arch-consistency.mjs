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
//   A-1b / A-2b / A-3b  判别力自证：三条判据各自的判定函数必须在**合成正反例**上给出不同结论，
//        否则门禁可被静默掏空（把规则删掉仍然全绿）。三条与 A-1/A-2/A-3 同批运行、同批红绿。
//
// 用法：node scripts/card-arch-consistency.mjs [--check] [--json] [--devref <dir>] [--arch <dir>]
//   --check（= 默认行为，gate 第 5 环显式写它）  有冲突 -> exit 1
//   --devref / --arch  覆盖扫描面（默认 docs/devref 与 <治理根>/.internal/arch），
//                      用于**可复现的反例自证**：指向临时目录即可看它变红。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const CLOSED_MARK = /后续|已全部|已订正|已闭环|已作废|已并入|已摘除|已补登|为准/;
const ARCH_TRIG = /索引待修正|应改锚|待改锚|索引待补/;
const ARCH_EVID = /实测|nav_graph|已作废|二次复核|已闭环/;
const ARCH_GLOB = /^prompt-enhancer-.*\.md$/;

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

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
  for (let i = head + 1; i < lines.length; i++) {
    if (lines[i].indexOf('|') < 0) break;                       // 卡表结束
    const cells = cellsOf(lines[i]);
    if (/^[-:\s|]+$/.test(cells.join('|'))) continue;            // 分隔行
    if (cells.length < columns.length) break;                    // 非本表
    const pick = (name) => (at(name) >= 0 && cells[at(name)] !== undefined ? cells[at(name)] : '');
    const status = clean(pick('状态'));
    if (!status) continue;
    rows.push({ title: clean(pick('卡')), volume: clean(pick('册')), status, source: pick('溯源') });
  }
  return { rows, columns };
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

/** A-1 判定核心（纯函数，真数据与合成样本共用） */
function judgeCardBody(body) {
  const hits = UNCLOSED.filter((w) => body.indexOf(w) >= 0);
  const closed = CLOSED_MARK.test(body);
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
  if (indexText === null) return { present: false, indexFile, rows: [], closed: [], details: [], violations: [], unresolved: [] };
  const { rows, columns } = parseIndexTable(indexText);
  const closed = rows.filter((r) => /^(closed|superseded)\b/i.test(r.status));
  const violations = [];
  const unresolved = [];
  const details = [];
  const seen = new Set();
  // 逐张登记（含**不判**的 accepted 卡）：分母必须整表可见，不能只列被判的那几张
  for (const row of rows) {
    const judged = /^(closed|superseded)\b/i.test(row.status);
    const body = resolveCardBody(devrefDir, row);
    if (!body) { details.push({ title: row.title, status: row.status, judged, file: '(未解析到正文)', via: '-', hits: [], closedMark: false }); if (judged) unresolved.push(row.title); continue; }
    const rel = path.relative(ROOT, body.file);
    const key = path.resolve(body.file);
    if (seen.has(key)) { details.push({ title: row.title, status: row.status, judged, file: rel, via: body.via, dup: true, hits: [], closedMark: true }); continue; }
    seen.add(key);
    const v = judgeCardBody(readIf(body.file) || '');
    details.push({ title: row.title, status: row.status, judged, file: rel, via: body.via, hits: v.hits, closedMark: v.closed });
    if (judged && v.violation) violations.push({ title: row.title, file: rel, hits: v.hits });
  }
  return { present: true, indexFile, rows, columns, closed, details, violations, unresolved };
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
  const detail = '卡表<->卡正文：卡分母 ' + cards.rows.length + ' 张（INDEX 卡表数据行，**非文件数**）｜本判据判 ' + cards.closed.length + ' 张（closed/superseded）｜余 ' + (cards.rows.length - cards.closed.length) + ' 张非闭环卡不判｜命中未闭环措辞 ' + sum + ' 处｜逐卡 ' + cards.details.map((d) => d.title + '[' + d.status + (d.judged ? '·判' : '·不判') + (d.dup ? '·同文件已并计' : '') + '｜' + d.file + '（' + d.via + '）' + (d.judged && !d.dup ? '｜命中 ' + (d.hits.length ? d.hits.join(',') : '0') + '｜闭环标记 ' + (d.closedMark ? '有' : '无') : '') + ']').join(' ') + (cards.unresolved.length ? '｜正文未解析 ' + cards.unresolved.length + '（' + cards.unresolved.join(';') + '）' : '');
  const pass = !cards.violations.length && !cards.unresolved.length;
  const actual = pass
    ? '分母 ' + cards.closed.length + ' 张已闭环卡｜均零命中或已写明闭环事实｜违规 0'
    : '违规 ' + cards.violations.length + ' 张' + (cards.violations.length ? '：' + cards.violations.map((v) => v.title + '（' + v.file + '，命中 ' + v.hits.join(',') + '，全文无闭环标记）').join(' ') : '') + (cards.unresolved.length ? '｜正文未解析（判据无法执行，不得判绿）' + cards.unresolved.length + ' 张：' + cards.unresolved.join(',') : '');
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
  add('A-2', !arch.violations.length,
    '架构档措辞须邻近实测依据（扫 prompt-enhancer-*.md，块级邻域）',
    '命中措辞的块内必含 实测/nav_graph/已作废/二次复核/已闭环',
    '分母 ' + arch.docs.length + ' 份本项目档（同目录他项目档与 _PLAN-* 不在扫描面）｜命中措辞 ' + hitsN + ' 处（' + wit + '）｜无依据 ' + arch.violations.length + (arch.violations.length ? '：' + arch.violations.map((v) => v.doc + ':' + v.line + '（' + v.word + '，块 ' + v.block + '，' + v.blockChars + ' 字符内无依据）').join(' ') : ''));
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
// 这三条证明「判定函数确实能说不」——否则删掉规则也全绿，是假绿。
{
  const bad1 = judgeCardBody('本卡正文仍写：待修正，等待处理。').violation;
  const ok1 = judgeCardBody('待修正（后续：已全部补登）。').violation;
  const ok2 = judgeCardBody('正文与现状一致，无事发生。').violation;
  add('A-1b', bad1 === true && ok1 === false && ok2 === false,
    'A-1 判别力自证（合成正反例）', '命中且无闭环标记 -> 违规；有标记或零命中 -> 不违规',
    '反例(命中无标记) ' + (bad1 ? '判违规 ✓' : '漏判 ✗') + '｜正例(命中+后续) ' + (ok1 ? '误伤 ✗' : '不违规 ✓') + '｜正例(零命中) ' + (ok2 ? '误伤 ✗' : '不违规 ✓'));

  const nBad = judgeArchText('## 索引待修正\n\n建议补登记若干文件。').length;
  const nOk = judgeArchText('## 索引待修正\n\n本次实测 nav_graph 显示落点全部在册。').length;
  add('A-2b', nBad === 1 && nOk === 0,
    'A-2 判别力自证（合成正反例）', '命中且块内无依据 -> 违规；块内有依据 -> 不违规',
    '反例(命中无依据) 违规 ' + nBad + ' 处' + (nBad === 1 ? ' ✓' : ' ✗') + '｜正例(命中+实测) 违规 ' + nOk + ' 处' + (nOk === 0 ? ' ✓' : ' ✗'));

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

const conflicts = ROWS.filter((r) => !r.skip && !r.pass);
const skips = ROWS.filter((r) => r.skip);
const passed = ROWS.filter((r) => !r.skip && r.pass);

if (has('--json')) {
  console.log(JSON.stringify({ devref: DEVREF, arch: ARCH, rows: ROWS, summary: { pass: passed.length, conflict: conflicts.length, skip: skips.length } }, null, 1));
} else {
  console.log('知识卡<->架构档一致性机检（册 A · 判据 A-1 / A-2 / A-3 + 三条判别力自证）');
  console.log('扫描面：卡表 ' + path.relative(ROOT, path.join(DEVREF, 'INDEX.md')) + '｜架构档 ' + ARCH);
  for (const r of ROWS) {
    console.log('  ' + (r.skip ? '[SKIP]' : r.pass ? '✓' : '✗') + ' ' + r.id + '  ' + r.detail);
    console.log('      期望 ' + r.expect);
    console.log('      实测 ' + r.actual);
  }
  console.log('汇总：通过 ' + passed.length + ' · 冲突 ' + conflicts.length + ' · SKIP ' + skips.length);
}

if (has('--check')) {
  if (conflicts.length) {
    console.log('✗ 卡<->档一致性冲突 ' + conflicts.length + ' 条：' + conflicts.map((c) => c.id).join(', '));
    process.exit(1);
  }
  console.log('✓ 卡<->档一致性判据一致：断言 ' + passed.length + ' 通过 · 冲突 0 · SKIP ' + skips.length + (skips.length ? '（扫描面缺位：' + skips.map((s) => s.id).join(',') + '——不记 PASS）' : ''));
}
