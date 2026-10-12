'use strict';
// T3 / N3（2026-09-27）：链级三态退出码**契约锁**（用户裁定 A）。
// 为什么要锁：退出码是 CI 唯一的消费面；此前 ALL_PASS 与 NOT_FULLY_JUDGED **同为 0**，
// 区分只在 \`--json\`（全仓无消费者）⇒「有环没判」与「全判通过」在 CI 眼里同形。
// 本文件的每条断言都对应一个**可证伪的形态**（真值表 + 真跑 gate.mjs），不是"跑过就算"。
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const NL = String.fromCharCode(10);

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'scripts', 'gate.mjs');
/** 真跑 gate（返回退出码 + 解析后的 --json；退出码取自**进程**，不是 --json 里的字段） */
const runGate = (args = ['--json'], env = {}) => {
  const p = spawnSync(process.execPath, [GATE, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024,
  });
  let json = null;
  try { json = JSON.parse(p.stdout); } catch { /* 保留 null，由断言报错 */ }
  return { code: p.status, json, out: String(p.stdout || '') + String(p.stderr || '') };
};

test('GATEEXIT-01 三态码值锁：0 全过 / 1 有 FAIL / 2 未判全（三个数互不相同）', async () => {
  const m = await import(path.join(ROOT, 'scripts', 'lib', 'gate-exit.mjs'));
  assert.equal(m.GATE_EXIT.ALL_PASS, 0, '全过必须仍是 0（不破坏既有"绿=0"约定）');
  assert.equal(m.GATE_EXIT.FAIL, 1, '失败必须仍是 1（不破坏既有"红=1"约定）');
  assert.equal(m.GATE_EXIT.NOT_FULLY_JUDGED, 2, '未判全必须是**独立**码（N3 的全部要点）');
  const vals = Object.values(m.GATE_EXIT);
  assert.equal(new Set(vals).size, vals.length, '三态码值不得重复');
});

test('GATEEXIT-02 verdictOf 真值表：失败优先；非 PASS（含空表）一律未判全，不判绿', async () => {
  const m = await import(path.join(ROOT, 'scripts', 'lib', 'gate-exit.mjs'));
  const V = m.verdictOf;
  assert.equal(V(['PASS', 'PASS']), 'ALL_PASS');
  assert.equal(V(['PASS', 'SKIP']), 'NOT_FULLY_JUDGED', '有 SKIP 即未判全');
  assert.equal(V(['PASS', 'FAIL']), 'FAIL');
  assert.equal(V(['FAIL', 'SKIP']), 'FAIL', '失败优先于未判全（有失败先修失败）');
  assert.equal(V([]), 'NOT_FULLY_JUDGED', '零环 = 什么都没判 ⇒ 不判绿（分母为 0 不许判绿）');
  // 未来新增的任何非 PASS 状态也不得静默判绿
  assert.equal(V(['PASS', 'UNKNOWN']), 'NOT_FULLY_JUDGED');
  assert.equal(m.exitCodeOf('NO_SUCH_VERDICT'), 2, '未知 verdict 一律 fail-closed 落到 2（不落 0）');
});

test('GATEEXIT-03 applyBaseline 真值表：仅"未判非空且 ⊆ 非空基线"才降 0，其余一律 2', async () => {
  const m = await import(path.join(ROOT, 'scripts', 'lib', 'gate-exit.mjs'));
  const A = m.applyBaseline;
  // 恰好覆盖 → 接纳
  assert.equal(A('NOT_FULLY_JUDGED', ['x', 'y'], ['x', 'y']).code, 0);
  assert.equal(A('NOT_FULLY_JUDGED', ['x'], ['x', 'y']).accepted, true, '基线是超集也接纳（id 面，多声明无害）');
  // 有基线外的未判环 → **拒绝**（新增缺位不被静默吞掉）
  const outside = A('NOT_FULLY_JUDGED', ['x', 'z'], ['x']);
  assert.equal(outside.code, 2);
  assert.deepEqual(outside.unexpected, ['z'], '必须报出基线外的那一环');
  // 空基线 / 未声明基线 / 无未判对象 → 均不接纳（fail-closed："没有可判对象"不得冒充"已接纳"）
  assert.equal(A('NOT_FULLY_JUDGED', ['x'], []).code, 2, '空基线不接纳');
  assert.equal(A('NOT_FULLY_JUDGED', ['x'], null).code, 2, '未声明基线不接纳');
  assert.equal(A('NOT_FULLY_JUDGED', [], ['x']).accepted, false, '没有未判对象谈不上接纳');
  // FAIL 永不接纳（哪怕其余未判全落在基线内）
  assert.equal(A('FAIL', ['x'], ['x']).code, 1, 'FAIL 不因基线降级');
  assert.equal(A('ALL_PASS', [], ['x']).code, 0);
});

test('GATEEXIT-04 解析：--accept-unjudged 两种写法等价；未给出为 null；去重去空', async () => {
  const m = await import(path.join(ROOT, 'scripts', 'lib', 'gate-exit.mjs'));
  assert.equal(m.parseAcceptBaseline(['--json']), null, '未给出 ⇒ null（不接纳任何未判）');
  assert.deepEqual(m.parseAcceptBaseline(['--accept-unjudged=a,b']), ['a', 'b']);
  assert.deepEqual(m.parseAcceptBaseline(['--accept-unjudged', 'a,b']), ['a', 'b']);
  assert.deepEqual(m.parseAcceptBaseline(['--accept-unjudged=a, a ,,b']), ['a', 'b'], '去重去空');
});

test('GATEEXIT-05 端到端(真跑)：链级退出码与"未判集合"自洽，且裸跑不静默接纳', () => {
  const r = runGate(['--json']);
  assert.ok(r.json, 'gate --json 必须可 parse：\n' + r.out);
  const s = r.json.summary;
  const expected = s.fail > 0 ? 1 : (s.unjudged.length ? 2 : 0);
  assert.equal(r.code, expected,
    '链级退出码与各环状态不自洽：exit=' + r.code + ' 期望=' + expected + '（fail=' + s.fail + ' unjudged=' + s.unjudged.join(',') + '）');
  assert.equal(s.exit, r.code, '--json 的 summary.exit 必须与进程退出码**同值**（单一出处）');
  assert.equal(s.accepted, false, '裸跑（未声明基线）不得接纳任何未判 ⇒ 有未判就必须是 2');
  assert.deepEqual(s.baseline === null ? [] : s.baseline, [], '未声明基线时 baseline 不得被默认填充');
});

test('GATEEXIT-06 端到端(真跑)：显式基线恰好覆盖 ⇒ 接纳留痕；FAIL 优先不被吸收；覆盖不全 ⇒ 仍 2', () => {
  const base = runGate(['--json']);
  assert.ok(base.json, 'gate --json 必须可 parse：\n' + base.out);
  const u = base.json.summary.unjudged;
  const hasFail = base.json.rings.some((x) => x.status === 'FAIL');
  if (!u.length) {
    // 形态 A（治理面齐全：无未判对象）⇒ 基线形同不生效（同样不得降级/升格）。
    const r = runGate(['--json', '--accept-unjudged=' + 'x']);
    assert.equal(r.code, 0, '全过时传无关基线仍应为 0');
    assert.equal(r.json.summary.accepted, false, '无可接纳对象时不得记 accepted（"没有可判对象"不得冒充"已接纳"）');
    return;
  }

  // ── 2026-10-12 回修（独立复验 §4.3 查实）──────────────────────────────────
  //   旧写法把 `okAll.code === 0` 写死，**只在治理根可解析的机器上成立**：
  //   治理根不可读（干净 clone / CI 的必然形态）⇒ arch-claims=FAIL ⇒ verdict=FAIL（失败优先）
  //   ⇒ applyBaseline **只把 NOT_FULLY_JUDGED 降 0、不降 FAIL** ⇒ 实测 code=1 ⇒ 断言必红。
  //   那是「环境凑巧」而非「环境无关」。现改为**按实际形态**断言，两支各自带负控：
  //     · 有 FAIL ⇒ 失败优先：退 1，基线**不吸收** FAIL（正是 applyBaseline 的核心纪律，
  //       旧写法在这个形态下根本没验到它），且未判集合仍原样报出；
  //     · 无 FAIL ⇒ 恰好覆盖必须降 0 且留痕（原断言，逐字保留）。
  const okAll = runGate(['--json', '--accept-unjudged=' + u.join(',')]);
  assert.ok(okAll.json, 'gate --json 必须可 parse：\n' + okAll.out);
  // 两支共用的事实（接纳不改判定事实）——与形态无关，两种形态都必须成立。
  assert.deepEqual(okAll.json.summary.unjudged, u, '接纳不改判定事实：未判集合仍须原样报出');

  if (hasFail) {
    // 形态 B：FAIL 优先 —— 基线不得把 FAIL 吸收成 0（这是**加强**：旧断言在此形态是崩的，验不到此纪律）
    assert.equal(okAll.code, 1, '有 FAIL 时退出码必须为 1（失败优先，基线不吸收 FAIL）');
    assert.equal(okAll.json.summary.verdict, 'FAIL', '有 FAIL 时 verdict 必须是 FAIL');
    assert.equal(okAll.json.summary.accepted, false, 'FAIL 不得被基线接纳');
    // 未判面须把不可接纳的 FAIL 逐个报出（不静默吞掉）
    assert.ok(okAll.json.summary.unexpected.includes('arch-claims') || okAll.json.summary.blocking.includes('arch-claims'),
      'FAIL 环必须出现在 unexpected/blocking 里（可定位，不被静默吞掉）');
  } else {
    // 形态 A': 无 FAIL、有 SKIP —— 恰好覆盖必须降 0 并留痕（原断言）
    assert.equal(okAll.code, 0, '恰好覆盖的基线应把未判全降为 0（CI 不永久红）');
    assert.equal(okAll.json.summary.accepted, true, '接纳必须留痕（accepted=true）');
  }

  // ── 负控【必须保留】：覆盖不全 ⇒ 不接纳（新缺位不被静默吞掉）──────────────
  //   ⚠ 判据必须按形态分派（与上面同一思路），否则「只在形态 B 才成立」的假断言会重演：
  //     形态 B：FAIL 优先 ⇒ 一律 1，且 FAIL 环不在基线内 ⇒ 必须报进 unexpected；
  //     形态 A'：verdict=NOT_FULLY_JUDGED，给一个不在未判集合里的基线 ⇒ 未判集合 ⊆ 基线**不成立**
  //             ⇒ 仍是 2（这正是原负控在形态 A' 下的精确形态）。
  const partial = runGate(['--json', '--accept-unjudged=' + 'definitely-not-a-ring']);
  assert.ok(partial.json, 'gate --json 必须可 parse：\n' + partial.out);
  if (hasFail) {
    assert.notEqual(partial.code, 0, '有 FAIL 时给无关基线不得降为 0（不得静默吞掉 FAIL）');
    assert.ok(partial.json.summary.unexpected.length > 0, '未覆盖的 FAIL 环须逐个报出');
  } else if (u.length) {
    assert.equal(partial.code, 2, '基线外的未判环必须让退出码保持 2');
    assert.deepEqual(partial.json.summary.unexpected, u, '未覆盖的环须逐个报出');
    assert.equal(partial.json.summary.accepted, false, '覆盖不全不得记 accepted');
  }
});

test('GATEEXIT-06b 夹具形态：**确定**「无 FAIL 且有未判环」⇒ 恰好覆盖必须降 0 且留痕；覆盖不全 ⇒ 仍 2', () => {
  // ── 2026-10-12 回修：把 GATEEXIT-06 的**原断言**从"环境凑巧才执行"变成"处处执行"────────
  //   为什么需要本条：GATEEXIT-06 的原始核心断言是「恰好覆盖的基线应把未判全降为 0」，
  //   但它只在 real repo 出现「无 FAIL 且有未判环」时才走到 —— 而本机形态 A 无未判环（早退）、
  //   形态 B 有 FAIL（走失败优先支）⇒ 该断言在**两种形态下都不执行**，与 §1.3 的覆盖缺口同族。
  //   这里用夹具**确定地**造出该形态（两环：一 PASS 一 SKIP ⇒ 无 FAIL、有未判环），
  //   使其在**任何机器**上都真被执行。夹具不依赖治理根 ⇒ 与形态无关。
  const tmp = buildUnjudgedFixture();
  try {
    const bare = spawnSync(process.execPath, ['scripts/gate.mjs', '--json'], { cwd: tmp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let bj = null; try { bj = JSON.parse(bare.stdout); } catch { bj = null; }
    assert.ok(bj, '夹具 gate 必须可 parse：\n' + String(bare.stdout).slice(0, 300));
    // 夹具前置自检（不满足即夹具问题，不是判据失效）
    assert.equal(bj.summary.verdict, 'NOT_FULLY_JUDGED', '夹具必须落在 NOT_FULLY_JUDGED（无 FAIL 且有未判）');
    assert.equal(bare.status, 2, '夹具裸跑必须是 2（未判全独立码）');
    const u = bj.summary.unjudged;
    assert.ok(u.length > 0, '夹具必须有未判环');

    // ① 【原断言】恰好覆盖 ⇒ 降 0 且留痕
    const okAll = spawnSync(process.execPath, ['scripts/gate.mjs', '--json', '--accept-unjudged=' + u.join(',')],
      { cwd: tmp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let oj = null; try { oj = JSON.parse(okAll.stdout); } catch { oj = null; }
    assert.ok(oj, '夹具接纳态必须可 parse：\n' + String(okAll.stdout).slice(0, 300));
    assert.equal(okAll.status, 0, '恰好覆盖的基线应把未判全降为 0（CI 不永久红）');
    assert.equal(oj.summary.accepted, true, '接纳必须留痕（accepted=true）');
    assert.deepEqual(oj.summary.unjudged, u, '接纳不改判定事实：未判集合仍须原样报出');
    // 措辞纪律同时在此形态被验（与 GATEEXIT-10 的夹具支互为独立证据）
    assert.ok(!/全过/.test(oj.summary.exitText), '接纳态文案不得说「全过」（实测：' + oj.summary.exitText + '）');

    // ② 【原负控】覆盖不全 ⇒ 仍 2
    const partial = spawnSync(process.execPath, ['scripts/gate.mjs', '--json', '--accept-unjudged=definitely-not-a-ring'],
      { cwd: tmp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let pj = null; try { pj = JSON.parse(partial.stdout); } catch { pj = null; }
    assert.ok(pj, '夹具覆盖不全态必须可 parse：\n' + String(partial.stdout).slice(0, 300));
    assert.equal(partial.status, 2, '基线外的未判环必须让退出码保持 2');
    assert.deepEqual(pj.summary.unexpected, u, '未覆盖的环须逐个报出');
    assert.equal(pj.summary.accepted, false, '覆盖不全不得记 accepted');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('GATEEXIT-11 穷举不变量：accepted ⇔（verdict=NOT_FULLY_JUDGED ∧ 未判非空 ∧ 基线非空 ∧ 未判⊆基线）', async () => {
  const m = await import(path.join(ROOT, 'scripts', 'lib', 'gate-exit.mjs'));
  // ⚠ 集合里**必须含重复元素**（独立复核席 D1 实测：全不重复时 Array.from(new Set()) 无事可做，
  //   去重行为零覆盖 ⇒ 删掉实现里的 Set 仍 11/11 绿）。故下列集合刻意混入重复项。
  const unjudgedSets = [[], ['a'], ['b'], ['a', 'b'], ['a', 'x'], ['a', 'a', 'b'], ['a', 'b', 'a', 'b']];
  const baselines = [null, [], ['a'], ['b'], ['a', 'b'], ['a', 'x'], ['a', 'a'], ['b', 'b', 'a']];
  const verdicts = ['ALL_PASS', 'FAIL', 'NOT_FULLY_JUDGED', 'SOME_FUTURE_STATE'];
  let bad = 0; let acceptedShapes = 0; let total = 0;
  for (const v of verdicts) for (const u of unjudgedSets) for (const b of baselines) {
    total += 1;
    const r = m.applyBaseline(v, u, b ?? [], []);   // 显式传 blocking='[]'（缺省 undefined 会污染形状断言）
    const base = b === null ? [] : b;
    const shouldAccept = v === 'NOT_FULLY_JUDGED' && u.length > 0 && base.length > 0 && u.every((x) => base.includes(x));
    const expectCode = shouldAccept ? 0 : (v === 'FAIL' ? 1 : v === 'ALL_PASS' ? 0 : 2);
    if (r.accepted !== shouldAccept) { bad += 1; console.log('  accepted 不符:', v, JSON.stringify(u), JSON.stringify(b), r.accepted); }
    if (r.code !== expectCode) { bad += 1; console.log('  code 不符:', v, JSON.stringify(u), JSON.stringify(b), r.code, expectCode); }
    // unexpected 必须只含**基线外**的 id（否则"基线外"这份信号就掺假了）
    if (!r.unexpected.every((id) => !base.includes(id))) { bad += 1; console.log('  unexpected 含基线内 id:', JSON.stringify(r)); }
    // ⚠ 去重面（独立复核席 D1）：上面这些集合刻意含重复元素——**报出的机读数组不得带重复**。
    //   为什么单独盯形状而不是结果：删掉实现里的 Set 时"判定结果"确实不变（多余元素被 includes 吸收），
    //   但**报给消费者的数组会带重复** ⇒ 下游按 id 计数/比对（如 CI 脚本、后续按 id 派工）会读错。
    //   故此处显式断言三个数组各自无重复，把去重从"实现细节"升为**契约形状**。
    for (const [k, arr] of [['unjudged', r.unjudged], ['baseline', r.baseline], ['blocking', r.blocking], ['unexpected', r.unexpected]]) {
      if (arr.length !== new Set(arr).size) { bad += 1; console.log('  ' + k + ' 带重复项:', JSON.stringify(arr)); }
    }
    // 未判集合的**集合语义**必须保持：输入 ['a','a','b'] 与 ['a','b'] 判定结果逐项相同
    const twin = m.applyBaseline(v, Array.from(new Set(u)), b === null ? null : Array.from(new Set(b)), []);
    if (twin.code !== r.code || twin.accepted !== r.accepted) {
      bad += 1; console.log('  重复元素改变了判定（集合语义被破坏）:', v, JSON.stringify(u), JSON.stringify(b));
    }
    if (r.accepted) acceptedShapes += 1;
  }
  assert.equal(bad, 0, '穷举 ' + total + ' 组合出现 ' + bad + ' 处不符');
  assert.ok(acceptedShapes > 0, '穷举中必须存在可接纳形状（否则断言退化成恒真）');
  assert.ok(acceptedShapes < total, '接纳必须是少数形状，不得恒真');
  // 形状锁：**所有**返回分支的键集合必须逐一相同（漏键比错值更隐蔽：下游读到 undefined 才崩）
  const shapes = new Map();
  for (const v of verdicts) for (const u of unjudgedSets) for (const b of baselines) for (const blk of [[], ['z']]) {
    const keys = Object.keys(m.applyBaseline(v, u, b ?? [], blk)).sort().join(',');
    shapes.set(keys, (shapes.get(keys) || 0) + 1);
  }
  assert.equal(shapes.size, 1, '返回形状不唯一（有分支漏键）：' + Array.from(shapes.keys()).join(' | '));
});

test('GATEEXIT-12 不可接纳面（D2）：非 PASS 且非 SKIP 的环即便 id 在基线内也不得被接纳', async () => {
  const m = await import(path.join(ROOT, 'scripts', 'lib', 'gate-exit.mjs'));
  // 复现独立复核席实测的形态：零输出的静默死环（UNKNOWN）恰好 id 就是基线内的那一环
  const r = m.applyBaseline('NOT_FULLY_JUDGED', ['arch-claims'], ['arch-claims'], ['arch-claims']);
  assert.equal(r.accepted, false, 'UNKNOWN 环不得被基线吸收（否则"换空脚本"即可让链级报 0）');
  assert.equal(r.code, 2, '含不可接纳面时链级必须是 2');
  assert.deepEqual(r.blocking, ['arch-claims'], 'blocking 面须原样报出（机读可见）');
  assert.ok(r.unexpected.includes('arch-claims'), '被拒的环须出现在 unexpected 里（不被静默吞掉）');
  // FAIL 优先仍成立
  assert.equal(m.applyBaseline('FAIL', ['x'], ['x'], ['y']).code, 1, '有 FAIL 时仍是 1（失败优先于未判全）');
  // 端到端：真把环换成 0 字节 no-op，确认加了基线也**不**报 0
  const fs = require('node:fs'); const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-d2-'));
  fs.cpSync(ROOT, tmp, { recursive: true, filter: (s) => !/\.git|node_modules/.test(s) });
  fs.writeFileSync(path.join(tmp, 'scripts', 'arch-claims.mjs'), '', 'utf8');   // 0 字节：静默死环
  const p = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'gate.mjs'), '--quiet', '--accept-unjudged=arch-claims,cards'],
    { cwd: tmp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const out = String(p.stdout || '') + String(p.stderr || '');
  assert.equal(p.status, 2, '静默死环 + 基线 ⇒ 必须仍为 2（实测修复前为 0）：\n' + out.slice(-800));
  assert.ok(/UNKNOWN/.test(out), '摘要须点名 UNKNOWN 环（可定位）：\n' + out.slice(-800));
});

test('GATEEXIT-07 端到端(真跑·故障注入)：环全超时 ⇒ FAIL 腿为 1（不被未判全/接纳混淆）', () => {
  const r = runGate(['--json'], { GATE_RING_TIMEOUT_MS: '1' });
  assert.ok(r.json, 'gate --json 必须可 parse：\n' + r.out);
  assert.equal(r.json.summary.fail, r.json.summary.total, '1ms 环顶应让全部环 FAIL');
  assert.equal(r.code, 1, 'FAIL 腿必须仍是 1（有失败即失败，不退化成 2）');
  assert.equal(r.json.summary.verdict, 'FAIL');
  // 同一次注入里显式给基线也不得把 FAIL 降级
  const r2 = runGate(['--json', '--accept-unjudged=dead-code,rpc,prompts,arch-claims,cards'], { GATE_RING_TIMEOUT_MS: '1' });
  assert.equal(r2.code, 1, 'FAIL 不得被接纳基线降为 0');
});

test('GATEEXIT-08 基线位置纪律：不得写进 package.json 的 gate 脚本（否则本地默认被静默降级）', () => {
  const pkg = require(path.join(ROOT, 'package.json'));
  assert.equal(pkg.scripts.gate, 'node scripts/gate.mjs',
    'gate 脚本不得内联 --accept-unjudged：本地裸跑必须诚实报 2，接纳只能在 CI 侧显式声明');
  assert.ok(!/accept-unjudged/.test(pkg.scripts.gate || ''), 'gate 脚本不得出现接纳基线');
});

test('GATEEXIT-09 CI 与裁定一致：CI 步显式传基线，且失败仍出读数（if: always() 未被吃掉）', () => {
  const fs = require('node:fs');
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const step = ci.slice(ci.indexOf('- name: Structure gates'));
  const body = step.slice(0, step.indexOf('- name: Run tests'));
  assert.ok(/run: npm run gate/.test(body), 'CI 必须仍跑 npm run gate');
  const m = body.match(/--accept-unjudged=([\w.,-]*)/);
  assert.ok(m, 'CI 步须**显式**传 --accept-unjudged=<基线>（本仓两环扫描面在仓外+gitignore，属构造性缺位）');
  assert.deepEqual(m[1].split(',').filter(Boolean).sort(), ['arch-claims', 'cards'],
    'CI 声明的基线须恰为两个构造性缺位环（新增环进基线=静默放行，须有意识地改这里）');
  assert.ok(/if: always\(\)/.test(body), 'CI 步仍须 if: always()（判据之间不得互相遮蔽）');
});

/** 造一个**确定存在未判环**的 gate 夹具（与形态 A/B 无关，故原断言在两种形态下都真执行）。
 *
 *  手法与 `test/ring-state.test.cjs` 的 `buildFixture` 同族（整目录复制 `scripts/`，避免相对 import
 *  在该夹具里 ERR_MODULE_NOT_FOUND 而对"实现方式不同"报红、掩盖真因）。差异：这里把 `gate.mjs` 的
 *  **整个 RINGS 环表**换成两个合成哨兵环 —— 于是该夹具**必然**产出「有 SKIP、无 FAIL」的形态，
 *  无论跑它的机器治理根可不可读，且不会牵动任何真环（真环在仓外扫描面上有环境依赖）。
 *
 *  ⚠ 返回的 tmp 由调用方 `fs.rmSync` 清理（务必 finally）。 */
const buildUnjudgedFixture = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-unjudged-fx-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  // ⚠ 写进哨兵脚本的是 `\n` 这个**两字符转义序列**，不是裸换行（`String.fromCharCode(10)`）。
  //   在生成文件的双引号字符串里塞裸换行 = 语法错误 ⇒ 脚本零输出、exit 1 ⇒ 夹具两环皆走退化位 FAIL
  //   （本回修实测踩到过：夹具自检报「必须含真 SKIP 环」）。`String.fromCharCode(92)` 即反斜杠，
  //   与 `test/ring-state.test.cjs` 生成契约行用的是同一手法。
  const ESC_N = String.fromCharCode(92) + 'n';
  // 哨兵环①：自报 SKIP（契约行状态字段 = SKIP）+ 退出码 0 ⇒ 提供「有未判环」
  fs.writeFileSync(path.join(tmp, 'scripts', '_fx-skip.mjs'),
    'process.stderr.write("RING-STATE fixtureskip SKIP 夹具：本地扫描面缺位（构造性）' + ESC_N + '");' + NL,
    'utf8');
  // 哨兵环②：自报 PASS（对照）⇒ 使「全过」措辞有可比较的另一形态
  fs.writeFileSync(path.join(tmp, 'scripts', '_fx-pass.mjs'),
    'process.stderr.write("RING-STATE fixturepass PASS 夹具：本环判过（构造性）' + ESC_N + '");' + NL,
    'utf8');
  const gatePath = path.join(tmp, 'scripts', 'gate.mjs');
  let g = fs.readFileSync(gatePath, 'utf8');
  const start = g.indexOf('const RINGS = [');
  // ⚠ 必须切到 `];` **含**结束符（`slice(end)` 会把 `];` 本身留在原位——实测那样拼出
  //   `...args: [] },];` 的畸形数组 ⇒ 两环皆 FAIL，夹具自检报「必须含真 SKIP 环」）。
  const end = g.indexOf('];', start);
  assert.ok(start > -1 && end > start, '夹具注入点应存在（gate.mjs 的 RINGS 字面量）');
  const synthetic = [
    'const RINGS = [',
    "  { id: 'fixtureskip', script: 'scripts/_fx-skip.mjs', args: [] },",
    "  { id: 'fixturepass', script: 'scripts/_fx-pass.mjs', args: [] },",
    '];',
  ].join(NL);
  g = g.slice(0, start) + synthetic + g.slice(end + 2);
  fs.writeFileSync(gatePath, g, 'utf8');
  return tmp;
};

test('GATEEXIT-10 措辞纪律（b2·I3 / b3·N4）：有环未判就不得说「全过」——基线接纳态也不例外', () => {
  // ── 2026-10-12 回修（独立复验 §8.2.2 指出覆盖缺口）──────────────────────
  //   上一轮把本断言包进 `if (unjudged.length)`，本机形态 A（治理根可解析 ⇒ 无未判环）下
  //   **原断言根本不执行** ⇒ 「有未判环时不得说全过」在本机不再被验证。
  //   现改为**先造一个必然有未判环的夹具**，在该夹具上验原断言 ⇒ **两种形态下都真执行**。
  //   夹具不依赖治理根 ⇒ 与 §1.2 同源的环境耦合一并消除。
  const tmp = buildUnjudgedFixture();
  let bare; let accepted;
  try {
    bare = spawnSync(process.execPath, ['scripts/gate.mjs', '--json'], { cwd: tmp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    var bareJson = null; try { bareJson = JSON.parse(bare.stdout); } catch { bareJson = null; }
    assert.ok(bareJson, '夹具 gate 必须可 parse（否则是夹具问题，不是判据失效）：\n' + String(bare.stdout).slice(0, 400));
    // 夹具前置：必须真的造出「有未判环」——否则下面断言依旧空转（这是本用例的自检，不是放松）
    assert.ok(bareJson.summary.unjudged.length > 0,
      '夹具必须造出未判环（否则本断言又变成形态依赖）：实测 unjudged=' + JSON.stringify(bareJson.summary.unjudged));
    assert.ok(bareJson.rings.some((x) => x.status === 'SKIP'), '夹具必须含真 SKIP 环');
    assert.ok(!bareJson.rings.some((x) => x.status === 'FAIL'), '夹具不得含 FAIL（否则走失败优先支，验不到措辞纪律）');

    // ① 核心（原断言·在夹具形态下必然执行）：有未判环 ⇒ 文案不得说「全过」
    assert.notEqual(bareJson.summary.exitText, '全过', '有未判环时退出码文案不得说「全过」');
    assert.ok(!/全过/.test(bareJson.summary.exitText), '文案不得**自含**「全过」子串（旧版"本条不是全过"即栽在这）');

    // ② 接纳态：退出码可以是 0，但**文案仍不得说全过**（0 是决策，未判是事实）
    accepted = spawnSync(process.execPath,
      ['scripts/gate.mjs', '--json', '--accept-unjudged=' + bareJson.summary.unjudged.join(',')],
      { cwd: tmp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let accJson = null; try { accJson = JSON.parse(accepted.stdout); } catch { accJson = null; }
    assert.ok(accJson, '夹具接纳态 gate 必须可 parse：\n' + String(accepted.stdout).slice(0, 400));
    // 该夹具是可接纳形态（无 FAIL、未判 ⊆ 基线）⇒ 退出码应被降为 0（接纳生效），但措辞仍不得说全过
    assert.equal(accepted.status, 0, '夹具接纳态退出码应为 0（恰好覆盖 ⇒ 降 0）');
    assert.equal(accJson.summary.accepted, true, '夹具接纳态应记 accepted=true');
    assert.ok(!/全过/.test(accJson.summary.exitText),
      '基线接纳态文案不得含「全过」（实测取到：' + accJson.summary.exitText + '）');
    assert.equal(accJson.summary.verdict, bareJson.summary.verdict, '接纳不得改写 verdict 事实');
    assert.notEqual(accJson.summary.verdict, 'ALL_PASS', '有未判环时 verdict 不得是 ALL_PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ③ 真仓形态下的另一面（保留上一轮新增的反向负控，不丢）：无未判环时「全过」是真话。
  //    该支只在形态 A（治理根可解析）走到——但②的夹具支**已保证处处执行**，故这里不是覆盖缺口。
  const real = runGate(['--json']);
  if (real.json && !real.json.summary.unjudged.length) {
    assert.equal(real.json.summary.verdict, 'ALL_PASS', '真仓无未判环时 verdict 必须是 ALL_PASS');
    assert.equal(real.json.summary.exitText, '全过', '真仓无未判环时文案应为「全过」（实测：' + real.json.summary.exitText + '）');
  }
});
