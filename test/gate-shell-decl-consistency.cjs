'use strict';
// T7 册壳声明集探针 —— 豁免上界的**可见性**落点（scripts/card-arch-consistency.mjs 的配套件）。
//
// 病（本卡）：册壳豁免是**文件级全有全无** —— 被豁免的文件脱离**全部**判据。旧口径靠「形态四条件」，
//   凡能复刻形状者同享豁免（实测仿冒件 EXIT=0，静默免检）。新口径改用显式声明行
//   `SHELL-DECL <本文件相对路径>`：豁免**只认**这条语句，形状不再构成豁免。
// 残余（判据内**不可解**，见判据器头注「残余①」）：**任何文件都能写下点名自己的那条声明** ⇒ 豁免集
//   **无唯一性上界**。实测：把真册壳那一行复制进另一份同形文件、只把文件名改成自己，即同样被豁免，
//   **无需碰真册壳那个文件**。"谁有权声明"是外部意图，判据里没有任何可读通道能证明某一行声明由谁写的。
// ⇒ 本探针**不假装**拦得住它。它只做一件判据内做得到的事：让「仓内带了哪几条声明」**进版本控制、可 diff**。
//   docs/devref/ 被 .gitignore:19 忽略（声明行本身不可见），故用 .gate-shell-decls.json 台账作为落点：
//   声明集多一条或少一条，都必须先改台账 = 一次显式、可审、可回滚的提交。
//
// 断言（三条独立取数，各带证据；夹具在临时目录，**真实面零写入**）：
//   ① 台账 ⟷ 真实面：台账每条声明的文件存在、且文件里那一行与台账**逐字**一致；每个带声明的文件**恰好一条**
//      （判据器口径：两条及以上 = 声明有歧义 ⇒ 不豁免，故台账必须能反映这一点）。
//   ② 不改动探测：仓内声明集（扫描面全量枚举）⟷ 台账**键集**双向相等 —— 多一条即「有人加了声明」，
//      少一条即「声明消失」；且台账**不得**含扫描面外的路径（否则可用台账给别处洗白）。
//   ③ 抄件判红（端到端，真跑判据器）：临时目录构造「首行仿册壳 + 块引用未闭环措辞 + 原样拷贝的他人声明」
//      → 必须 A-5 红 / EXIT=1；对照「抄件改名点自己」→ 被豁免（**已知残余的实证**，如实断言并标注）。
//      另跑真实面：两册壳必须仍在豁免集里且带声明依据（真实面绿的机读证据），冲突 0。
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, 'scripts', 'card-arch-consistency.mjs');
const LEDGER = path.join(ROOT, '.gate-shell-decls.json');
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'shell-decl');
const SCAN_DIRS = ['docs/devref/cards', 'docs/devref/shoucang'];   // 与判据器 cardBodyFiles() 同口径
const DECL_RE = /^SHELL-DECL ([A-Za-z0-9._\/-]+)$/;               // 与判据器 SHELL_DECL_RE 同口径（行首锚定 + 整行）

const readText = (p) => fs.readFileSync(p, 'utf8');
const linesOf = (t) => t.split(/\r?\n/);
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

/** 扫描面枚举：返回 {present, files:[{rel, decls:[string]}]}；目录不存在 = 扫描面缺位（不是「干净」）。 */
function scanFace(root) {
  const present = SCAN_DIRS.some((d) => fs.existsSync(path.join(root, d)));
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(root, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.md'))) {
      const decls = linesOf(readText(path.join(abs, f))).map((l) => l.trim())
        .map((l) => DECL_RE.exec(l)).filter(Boolean).map((m) => m[0]);
      files.push({ rel: d + '/' + f, decls });
    }
  }
  return { present, files };
}

/** 真跑判据器：返回 { code, summary, tail }；夹具目录以 --devref 传入（真实面只读）。 */
function runGate(devrefDir) {
  const args = [GATE, '--check', '--json'];
  if (devrefDir) args.push('--devref', devrefDir);
  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    stdout = String(e.stdout || '');
    code = typeof e.status === 'number' ? e.status : -1;
  }
  const a = stdout.indexOf('{');
  const b = stdout.lastIndexOf('}');
  assert.ok(a >= 0 && b > a, '判据器 --json 未输出可解析 JSON：' + JSON.stringify(stdout.slice(0, 400)));
  return { code, summary: JSON.parse(stdout.slice(a, b + 1)).summary, json: JSON.parse(stdout.slice(a, b + 1)) };
}

test('T7 册壳声明集探针：台账 ⟷ 真实面 + 抄件判红 + 残余①实证', (t) => {
  const ledger = JSON.parse(readText(LEDGER));
  const face = scanFace(ROOT);
  // 扫描面缺位（gitignore 的 docs/devref 不在本机 / CI checkout）⇒ 本探针**不可判**：
  // 不判绿（那是「没判上冒充通过」），也不判红（CI 上会让门禁永久非零 —— T3 已裁定不取该口径）。
  if (!face.present) {
    t.skip('扫描面缺位（docs/devref 不在本机）⇒ 声明集不可判：不判绿也不判红');
    return;
  }

// ── ① 台账 ⟷ 真实面 ────────────────────────────────────────────────────
{
  assert.ok(Array.isArray(ledger.entries) && ledger.entries.length > 0, '台账 entries 不得为空');
  const byRel = new Map(face.files.map((f) => [f.rel, f]));
  for (const e of ledger.entries) {
    const hit = byRel.get(e.file);
    assert.ok(hit, '台账登记的 ' + e.file + ' 在扫描面不存在（台账与真实面漂移）');
    assert.equal(hit.decls.length, 1,
      e.file + ' 的声明行应为**恰好 1 条**（判据器口径：≥2 条 = 声明有歧义 ⇒ 不豁免）；实际 ' + hit.decls.length + ' 条：' + JSON.stringify(hit.decls));
    assert.equal(hit.decls[0], e.decl,
      e.file + ' 文件里的声明行与台账**逐字**不一致：文件=' + JSON.stringify(hit.decls[0]) + ' 台账=' + JSON.stringify(e.decl));
  }
  // 真实册壳必须**带声明**（否则豁免失效 ⇒ 它们会掉进未引用集，真实面判红）
  const shells = ['docs/devref/cards/how-to.md', 'docs/devref/cards/decision.md'];
  for (const s of shells) {
    const hit = byRel.get(s);
    assert.ok(hit && hit.decls.length === 1, '真实册壳 ' + s + ' 必须带恰好 1 条声明行（豁免的唯一入口）');
  }
  console.log('✓ ① 台账 ⟷ 真实面：' + ledger.entries.length + ' 条登记逐字一致；两册壳各带 1 条自身声明');
}

// ── ② 不改动探测：仓内声明集 ⟷ 台账键集（双向）──────────────────────────
{
  const inFace = face.files.filter((f) => f.decls.length > 0).map((f) => f.rel).sort();
  const inLedger = ledger.entries.map((e) => e.file).sort();
  assert.deepEqual(inFace, inLedger,
    '仓内声明集与台账不一致 —— 声明集**任何变化**都必须先显式更新 ' + path.basename(LEDGER)
    + '（这是 docs/devref 被 gitignore 后，声明唯一能留下的可见痕迹）\n  仓内：' + JSON.stringify(inFace) + '\n  台账：' + JSON.stringify(inLedger));
  for (const e of ledger.entries) {
    assert.ok(SCAN_DIRS.some((d) => e.file.startsWith(d + '/')),
      '台账不得登记扫描面以外的路径（否则可借台账给别处洗白）：' + e.file);
  }
  assert.ok(!ledger.entries.some((e) => e.file.startsWith('test/fixtures/')),
    'test/fixtures 下的**判断器夹具**不得进台账（夹具是证据，不是被豁免的治理面）');
  console.log('✓ ② 不改动探测：仓内声明集 = 台账键集 = ' + inFace.length + ' 件（' + inFace.join(' / ') + '）');
}

// ── ③ 抄件判红（端到端）+ 真实面绿的机读证据 ──────────────────────────────
{
  // 真实面：两册壳在豁免集里（带声明依据），冲突 0，EXIT 0
  const real = runGate(null);
  const exempt = real.summary.exempt || [];
  const rels = exempt.map((x) => x.rel).sort();
  assert.deepEqual(rels, ['cards/decision.md', 'cards/how-to.md'],
    '真实面豁免集必须恰好是两册壳；实际 ' + JSON.stringify(rels));
  for (const x of exempt) {
    assert.ok(x.decl && /SHELL-DECL/.test(x.decl), '豁免必须带**依据**（声明行原串）进机读面；实际 ' + JSON.stringify(x));
  }
  assert.equal(real.summary.conflict, 0, '真实面冲突必须为 0');
  assert.equal(real.code, 0, '真实面 EXIT 必须为 0');

  // 夹具目录：INDEX 只引用 reference.md；ghost.md 与真册壳**逐字同形**（块引用措辞），只差声明行
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-decl-probe-'));
  fs.mkdirSync(path.join(tmp, 'cards'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'shoucang'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'INDEX.md'),
    ['# INDEX', '', '| 卡 | 册 | 创建 | 状态 | 溯源 |', '|---|---|---|---|---|',
      '| 甲卡 | reference | 2026-01-01 | accepted | `cards/reference.md` |', ''].join('\n'), 'utf8');
  fs.writeFileSync(path.join(tmp, 'cards', 'reference.md'), ['# 甲卡', '', '正文正常。', ''].join('\n'), 'utf8');
  const realShellBody = readText(path.join(FIXTURES, 'real-how-to.md'));
  const withDecl = (declLine) => realShellBody.replace('SHELL-DECL cards/how-to.md', declLine);
  const ghost = path.join(tmp, 'cards', 'ghost.md');

  // (a) 原样抄：声明行**逐字拷贝**（点名的是真册壳那个文件）—— 抄件自己没声明 ⇒ 必须判红
  fs.writeFileSync(ghost, withDecl('SHELL-DECL cards/how-to.md'), 'utf8');
  const a = runGate(tmp);
  assert.equal(a.summary.conflict > 0, true, '原样抄件必须被判红（A-5）；实际 conflict=' + a.summary.conflict);
  assert.equal(a.code, 1, '原样抄件必须 EXIT=1；实际 ' + a.code);
  assert.deepEqual((a.summary.exempt || []).map((x) => x.rel), [], '原样抄件不得进豁免集');
  assert.deepEqual(a.summary.unreferenced, ['cards/ghost.md'], '原样抄件必须落在未引用集里');

  // (b) 完全无声明（旧四条件下会被豁免的形状）—— 必须判红（换口径的净收益，实测 0→1）
  fs.writeFileSync(ghost, linesOf(realShellBody).filter((l) => !DECL_RE.test(l.trim())).join('\n'), 'utf8');
  const b = runGate(tmp);
  assert.equal(b.code, 1, '无声明同形件必须 EXIT=1（旧口径下这里 EXIT=0 = 静默豁免）；实际 ' + b.code);
  assert.deepEqual((b.summary.exempt || []).map((x) => x.rel), [], '无声明同形件不得进豁免集');

  // (c) 【已知残余的实证】抄件把声明改成**点名自己** —— 判据内拦不住（豁免集无唯一性上界）
  fs.writeFileSync(ghost, withDecl('SHELL-DECL cards/ghost.md'), 'utf8');
  const c = runGate(tmp);
  assert.deepEqual((c.summary.exempt || []).map((x) => x.rel), ['cards/ghost.md'],
    '残余①预期：自称声明即可豁免（本断言是把**上界**钉成可见事实，不是断言它正确）——若将来引入唯一性约束，此处应改为判红');
  assert.equal(c.code, 0, '残余①预期：自称声明者 EXIT=0（判据内不可解；可见性由本探针的台账侧提供）');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('✓ ③ 抄件判红：原样抄 EXIT=' + a.code + '（未引用 ' + JSON.stringify(a.summary.unreferenced) + '）'
    + '｜无声明 EXIT=' + b.code + '｜改名点自己 EXIT=' + c.code + '（残余①实证，豁免 ' + JSON.stringify(c.summary.exempt.map((x) => x.rel)) + '）');
  console.log('   真实面：豁免 ' + JSON.stringify(exempt.map((x) => x.rel)) + ' 带依据 · 冲突 ' + real.summary.conflict + ' · EXIT ' + real.code);
}

// ── ④ 夹具是**逐字副本**（真实面回归的证据面）：md5 相等 ⇒ 同样的字节在判据下拿到豁免 ──
{
  for (const [fx, real] of [['real-how-to.md', 'docs/devref/cards/how-to.md'], ['real-decision.md', 'docs/devref/cards/decision.md']]) {
    const fxAbs = path.join(FIXTURES, fx);
    const realAbs = path.join(ROOT, real);
    assert.ok(fs.existsSync(fxAbs), '缺少夹具（真实面逐字副本）：' + fxAbs);
    assert.equal(md5(fxAbs), md5(realAbs),
      fx + ' 必须是 ' + real + ' 的**逐字副本**（md5 相等）——真实面回归靠这条保持证据性；若真实册壳改了内容（如改声明行），请同步更新夹具');
  }
  console.log('✓ ④ 夹具 = 真实面逐字副本（md5 相等）：real-how-to.md / real-decision.md');
}
});
