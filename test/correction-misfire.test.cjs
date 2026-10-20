// ============================================================================
// 纠错误改治理批（2026-10-20 · `CHG-291`）· 判据锁
//
// 病历（`CHG-290` 实测 190 次真调，判「部分有效」）：
//   该改的 51/51 全动手（「几乎不改」被证伪），但**不该改的 139 次里误改 40 次（28.8%）**。
//   本轮治的就是那 40 次，判词不能靠"看起来好了" ⇒ 本文件把 M1–M5 **各锁一条断言**。
//
// 五条判据（对应 TASK.md 的 M1…M5，逐条可判）：
//   M1  `cleanOutput` 不得整体套在纠错路径上 —— **只能剥掉输入里不存在的包装**；
//       凡剥掉的字符在用户原文里存在 ⇒ 不许剥（`CHG-290` D 类 4 条 100% 必现的那个缺陷）。
//   M2  `的 / 地 / 得` 互换一律不纠（判据① + 兜底；不是新判据）。
//   M3  `在` + 动词 这类两可 ⇒ 不纠（判据① + 兜底）。
//   M4  会话参考只能"阻止改动"，⛔ 不能"促成改动"（提示词纪律；见 P4 的文本锁）。
//   M5  `changed` = 最终输出与输入**是否逐字相同**；相同 ⇒ 必为 false。
//
// ⚠ 判据面（三层，缺一层就是假绿）：
//   1. 纯函数层：真求值 `plugin-host.js` 的 PURE 区段（单测即被测代码的同一份实现）
//   2. 接线层：纠错路径**确实**调 `cleanCorrectionOutput`、**不再**调裸 `cleanOutput`
//   3. 提示词层：三条「明令不纠」在 `prompts/enhance/correction.md` 与产物生成区**逐字在位**
// ============================================================================
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HOST = fs.readFileSync(path.join(ROOT, 'plugin-host.js'), 'utf8');

/** 真求值 PURE 区段（与 test/lib.test.cjs 同一机制；不复制实现）。 */
function loadPure() {
  const begin = HOST.indexOf('// ==PURE-BEGIN==');
  const end = HOST.indexOf('// ==PURE-END==');
  assert.ok(begin !== -1 && end > begin, 'PURE 标记必须存在');
  const pureText = HOST.slice(begin, end);
  const grab = (name) => {
    const m = HOST.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, 'const ' + name + ' 必须存在');
    return name + ' = ' + m[1] + ';';
  };
  const defs = ['DEFAULT_TIMEOUT_MS', 'DEFAULT_MAX_TOKENS', 'DEFAULT_OUTPUT_LIMIT'].map(grab).join('\n');
  return new Function(defs + '\n' + pureText + `
    ;return { cleanOutput, cleanCorrectionOutput, correctionStripAllowed, correctionStripFragments };
  `)();
}

const P = loadPure();

// ════════════════════════════════════════════════════════════════════════════
// M1 · ⭐ 本批第一位：「模型原样回显」必须逐字不变（`CHG-290` D 类的正面）
//
// ⚠ 这是「吃用户的字」的直接反例集：改前这 4 条**全部被剥**（模型一个字没改也照被剥）。
// ════════════════════════════════════════════════════════════════════════════
const VERBATIM_ECHO_CASES = [
  ['D1 · 原文自带引号（pairs 里的「」）', '「请把这段代码格式化一下。」'],
  ['D2 · 原文自带中文括号（对照组：改前也没被剥）', '（一）先确认需求（二）再动手实现'],
  ['D3 · 原文自带代码块围栏（pairs 里的 ```）', '```\nconst a = 1;\n```'],
  ['D4 · 原文含尾部提示串（TAIL_NOTES 里的「以上是优化结果」）', '他说：以上是优化结果'],
  ['D5 · 原文含首部前缀（LEAD_OUTPUT_PREFIX 里的「以下是优化后的提示词：」）', '以下是优化后的提示词：把日志导出来'],
  ['D6 · 对照组：本就正确的文本', '请在座的各位看一下'],
];

test('CHG291-M1a ⭐「模型原样回显」⇒ 输出**逐字等于**输入（一个字都不许动）', () => {
  for (const [label, text] of VERBATIM_ECHO_CASES) {
    const out = P.cleanCorrectionOutput(text, text);
    assert.equal(out, text, 'M1 违反：原样回显被剥了 ⇒ ' + label);
  }
});

test('CHG291-M1b ⭐ M5 联动：原样回显 ⇒ `changed` 必为 false（不得虚报改动）', () => {
  for (const [label, text] of VERBATIM_ECHO_CASES) {
    const out = P.cleanCorrectionOutput(text, text);
    assert.equal(out !== text, false, 'M5 违反：逐字相同却报 changed=true ⇒ ' + label);
  }
});

test('CHG291-M1c 负控：真包装（原文里**没有**）仍必须被剥 —— ⛔ 不是"干脆不剥了"', () => {
  // 模型真的加了包装（提示词禁止但可能发生）⇒ 纠错路径仍要把它剥掉，否则用户草稿里会留前缀。
  assert.equal(
    P.cleanCorrectionOutput('请优化以下提示词：\n"""\n原始内容。\n"""\n修复建议正文', '原始内容。'),
    '修复建议正文',
    '真包装必须仍能剥（否则等于用"少吃几个引号"换"让用户手动删前缀"）'
  );
  assert.equal(
    P.cleanCorrectionOutput('以下是优化后的提示词：\n订正后的正文', '用户原文'),
    '订正后的正文',
    '首部前缀（原文里不存在）必须仍能剥'
  );
  assert.equal(
    P.cleanCorrectionOutput('订正后的正文\n\n以上是优化结果', '用户原文'),
    '订正后的正文',
    '尾部提示（原文里不存在）必须仍能剥'
  );
});

test('CHG291-M1d 判据直锁：`correctionStripAllowed` 只在「剥掉的片段不在原文里」时放行', () => {
  // 放行：剥掉的是原文里没有的包装
  assert.equal(P.correctionStripAllowed('订正后的正文\n\n以上是优化结果', '订正后的正文', '用户原文'), true);
  // 否决：剥掉的片段出现在原文里（哪怕只是首尾空格）
  assert.equal(P.correctionStripAllowed('「正文」', '正文', '「正文」'), false, '「」在原文里 ⇒ 必须否决');
  assert.equal(P.correctionStripAllowed('  abc  ', 'abc', '  abc  '), false, '首尾空格属于用户的字 ⇒ 必须否决');
  // 片段对不上 ⇒ 保守否决（不认这次剥离）
  assert.equal(P.correctionStripAllowed('abc', 'xyz', 'abc'), false, 'cleaned 不是 raw 的子串 ⇒ 否决');
  // 无原文可比 ⇒ 沿用旧行为（不新增限制）
  assert.equal(P.correctionStripAllowed('「正文」', '正文', ''), true, '无原文时不得凭空收紧');
});

test('CHG291-M1e 边界：不得因 trim 把用户的首尾空格算成改动', () => {
  for (const t of ['  abc  ', 'abc ', ' abc', '\tabc\n']) {
    assert.equal(P.cleanCorrectionOutput(t, t), t, '用户原文的首尾空白必须逐字保留：' + JSON.stringify(t));
  }
});

test('CHG291-M1f 真纠错不受影响：只换一个字的订正必须原样返回', () => {
  assert.equal(
    P.cleanCorrectionOutput('请在座的各位先看一下这份文档。', '请在坐的各位先看一下这份文档。'),
    '请在座的各位先看一下这份文档。',
    'M6 的地基：治误改不得把真纠错一起治好'
  );
});

// ════════════════════════════════════════════════════════════════════════════
// 接线层：纠错路径**确实**用 cleanCorrectionOutput，且**不再**用裸 cleanOutput
// ════════════════════════════════════════════════════════════════════════════
test('CHG291-W1 接线：`runCorrection` 内不得再出现裸 `cleanOutput(` 调用', () => {
  const start = HOST.indexOf('async function runCorrection(args)');
  assert.ok(start > 0, 'runCorrection 必须存在');
  const end = HOST.indexOf("harness.handle('voice/correct'", start);
  assert.ok(end > start, 'runCorrection 的边界必须可定位');
  const body = HOST.slice(start, end);
  assert.equal(/[^a-zA-Z]cleanOutput\s*\(/.test(body), false,
    'M1 违反：runCorrection 内仍有裸 cleanOutput(...) 调用（纠错路径没有包装，不许整体套用）');
  assert.equal(/cleanCorrectionOutput\s*\(/.test(body), true,
    'M1 未接线：runCorrection 必须改为调 cleanCorrectionOutput');
});

test('CHG291-W2 增强管线**未**被本批改动：仍用 cleanOutput（两处、逐字）', () => {
  // 治的是纠错路径，⛔ 不是把增强管线的清洗一起改掉
  assert.equal(HOST.includes('const cleaned = isPublish ? stripScenarioEcho(cleanOutput(result.text, state.text)) : cleanOutput(result.text, state.text);'), true,
    '增强主路径的 cleanOutput 调用必须逐字保留');
});

test('CHG291-W3 M5 接线：`changed` 由「输出 vs 输入逐字比较」得出（有具名中间量）', () => {
  assert.equal(HOST.includes('const changedFlag = out !== text;'), true,
    'M5：changed 必须是 out !== text 的具名结果（不得由剥/补过程推导）');
  assert.equal(HOST.includes('changed: changedFlag'), true, 'M5：返回值必须用该具名量');
});

// ════════════════════════════════════════════════════════════════════════════
// M2 / M3 / M4 · 提示词层（三条「明令不纠」必须逐字在位）
//
// ⚠ 为什么锁**文本**而不是锁行为：「的/地/得 不动」「在+动词 不动」是**模型遵从不遵从**的问题，
//   不是本仓可离线判定的行为 —— 离线唯一能锁的是「禁令真的写进去了」。
//   行为面由 `CHG-291` 的复测读数承担（报告 §④），⛔ 不在单测里假造模型。
// ════════════════════════════════════════════════════════════════════════════
const PROMPT_MD = fs.readFileSync(path.join(ROOT, 'prompts', 'enhance', 'correction.md'), 'utf8');

test('CHG291-P1 M2：「的 / 地 / 得 互换 ⇒ 不动」在提示词里逐字在位，且标注了对应判据', () => {
  assert.equal(PROMPT_MD.includes('`的 / 地 / 得` 互换 ⇒ 不动'), true,
    'M2 未落地：提示词缺少「的/地/得 互换 ⇒ 不动」的明令');
  assert.equal(/的 \/ 地 \/ 得` 互换 ⇒ 不动\*\*（对应\*\*判据①\*\*）/.test(PROMPT_MD), true,
    'M2 纪律：必须写清「对应哪条已批准原则」（①），不得凭空新增判据');
});

test('CHG291-P2 M3（**已按 CHG-296 收窄**）：「在 + 单音节动词 两可 ⇒ 不动」在提示词里逐字在位，且标注了对应判据', () => {
  // ⚠ `CHG-296`（S1）把 M3 从「`在` + 动词」一刀切收窄为「`在` + **单音节**动词」——
  //   旧措辞「在 + 动词 这类口语/书面两可」**已按授权移除**（它连带挡住了 `在已`/`下周在讨论`/`等下在说`）。
  //   本断言同步改为锁**收窄后**的措辞 ⇒ 是**收紧**（旧写法出现即判红，见 CHG296-M3a），⛔ 不是改浅。
  assert.equal(PROMPT_MD.includes('`在` + 单音节动词'), true,
    'M3 未落地：提示词缺少收窄后的「在 + 单音节动词 两可 ⇒ 不动」明令');
  assert.equal(/在` \+ 单音节动词[^\n]*（对应\*\*判据① \+ 兜底\*\*）/.test(PROMPT_MD), true,
    'M3 纪律：必须写清「对应哪条原则」（① + 兜底）');
});

test('CHG291-P3 M4：「参考只能阻止改动、不能促成改动」在提示词里在位', () => {
  assert.equal(PROMPT_MD.includes('参考只能「阻止改动」，⛔ 不能「促成改动」'), true,
    'M4 未落地：参考在专名场景是诱因（CHG-290 交叉证据）⇒ 必须显式禁掉"参考促成改动"');
  assert.equal(/参考里有 ⇒ 说明这可能是既有命名 ⇒ 更该不动/.test(PROMPT_MD), true,
    'M4 纪律：必须给出**唯一判法**（参考里有 ⇒ 更该不动），⛔ 不是"参考里的写法可以照改"');
});

test('CHG291-P4 提示词结构未被改动：判据 ①–④ 与「四条」数量原样（⛔ 未新增判据/未放宽）', () => {
  // 判据数量与编号顺序未变（本轮只加「显式反例」，不许改判据面）
  for (const k of ['① **唯一读法**', '② **只换单位**', '③ **非事实面**', '④ **非专名非数值**']) {
    assert.equal(PROMPT_MD.includes(k), true, '判据原文必须逐字保留：' + k);
  }
  // ⚠ 措辞以 md 原文为准（`**同时**满足下列四条`）——本断言锁的是**数量词"四条"**，不是排版
  assert.equal(PROMPT_MD.includes('满足下列四条时才适用本例外'), true, '「四条」这个数量词必须未变（不许悄悄加判据）');
  // 兜底原文未变
  assert.equal(PROMPT_MD.includes('宁可漏改，绝不错改'), true, '兜底纪律必须逐字在位');
});

test('CHG291-P5 提示词已进产物生成区（改了 md 却漏跑 sync-prompts 的哨兵）', () => {
  assert.equal(HOST.includes('的 / 地 / 得'), true,
    '产物里没有 M2 的禁令 ⇒ 跑了 prompts/*.md 却漏 sync-prompts + build-host');
  assert.equal(HOST.includes('参考只能「阻止改动」'), true,
    '产物里没有 M4 的禁令 ⇒ 提示词未进生成区');
});

// ════════════════════════════════════════════════════════════════════════════
// M6 · 治误改不得把真纠错一起治好（TASK.md M6：A 类改对数不得下降）
//
// ⚠ 本文件只锁**离线可判**的那一半：清洗层不得把「模型已给出的正确纠错」打回原文。
//   另一半（模型在提示词收紧后还改不改 A 类）是**模型遵从度**，只能在报告 §④ 的复测读数里看；
//   ⛔ 单测里不假造模型（那是"用桩子证明模型行"）。
// ════════════════════════════════════════════════════════════════════════════
const CORRECT_FIXES = [
  ['A9 · 在已→已经', '这个问题的根本原因在已找到了，是配置写错了。', '这个问题的根本原因已经找到了，是配置写错了。'],
  ['A12 · 只有→有（删字，判据②边界）', '这个接口的返回只有点问题，需要修一下。', '这个接口的返回有点问题，需要修一下。'],
  ['B8 · 在→再（真误写）', '我们下周在讨论这个问题，先不着急。', '我们下周再讨论这个问题，先不着急。'],
  ['B13 · 在说→再说（真误写）', '这个问题等下在说，先把当前这版发出去。', '这个问题等下再说，先把当前这版发出去。'],
  ['A8 · 到→导', '麻烦你把日志到出来看看，我这边看不到。', '麻烦你把日志导出来看看，我这边看不到。'],
  ['A3 · 在坐→在座', '请在坐的各位先看一下这份文档。', '请在座的各位先看一下这份文档。'],
];

test('CHG291-M6 清洗层**不得**把「模型已给出的正确纠错」打回原文', () => {
  for (const [label, orig, modelOut] of CORRECT_FIXES) {
    assert.equal(P.cleanCorrectionOutput(modelOut, orig), modelOut,
      'M6 违反：清洗层把正确纠错改掉了 ⇒ ' + label);
  }
});

test('CHG291-M6b 负控：A 类**真改动**必须与「原样回显」可判（前者 changed=true、后者 false）', () => {
  for (const [label, orig, modelOut] of CORRECT_FIXES) {
    const out = P.cleanCorrectionOutput(modelOut, orig);
    assert.equal(out !== orig, true, '真纠错必须体现为 changed：' + label);
    const echo = P.cleanCorrectionOutput(orig, orig);
    assert.equal(echo !== orig, false, '原样回显必须体现为 changed=false：' + label);
  }
});

test('CHG291-M1g ⭐ 关键穿透：模型**改了别的字**但**保留了用户自带的「」** ⇒ 引号不许被剥', () => {
  // ⚠ 这条是本批**唯一能穿透「逐字回显早返回」的断言**（变异自证发现：
  //   若只删条件剥离、留早返回，前面 M1a 全绿 —— 因为 raw === orig 时根本不进清洗）。
  //   形态：用户原文带「」且其中**确有错字**，模型订正了错字但原样保留引号。
  const orig = '「请在坐的各位看一下。」';
  const modelOut = '「请在座的各位看一下。」';
  assert.equal(P.cleanCorrectionOutput(modelOut, orig), modelOut,
    'M1 违反：模型保留了用户自带的「」，却被剥离（这是"吃用户的字"的另一形态）');
  // 同族：代码块围栏 + 内部错字
  const orig2 = '```\n这个函数的逻缉有点问题\n```';
  const modelOut2 = '```\n这个函数的逻辑有点问题\n```';
  assert.equal(P.cleanCorrectionOutput(modelOut2, orig2), modelOut2,
    'M1 违反：模型保留了用户自带的代码块围栏，却被剥离');
});

test('CHG291-M1h 早返回不是唯一防线：条件剥离本身必须也守得住（去掉早返回仍须正确）', () => {
  // 直接打 correctionStripAllowed（绕过 cleanCorrectionOutput 的早返回）
  assert.equal(P.correctionStripAllowed('「请在座的各位看一下。」', '请在座的各位看一下。', '「请在坐的各位看一下。」'), false,
    '条件剥离层必须自己否决：剥掉的「」出现在用户原文里');
  assert.equal(P.correctionStripAllowed('```\n逻辑\n```', '逻辑', '```\n逻缉\n```'), false,
    '条件剥离层必须自己否决：剥掉的 ``` 出现在用户原文里');
});

// ════════════════════════════════════════════════════════════════════════════
// M3 收窄锁（二轮 · `CHG-296` · S1）
//
// 病历：上一轮（`CHG-295`）的 M3 把「`在` + 动词」**一刀切**成「一律不动」，
//   连带挡住了本该改对的 `在已`（=「已经」同音误写）· `下周在讨论` · `等下在说`
//   ⇒ A 类真改对 51 → 32。本轮把它收窄为「只挡**单音节**动词的真两可形态」。
//
// ⚠ 这不是放宽判据①–④：M3 是**上一轮写的禁止项**，不是已批准判据（判据面已由 P4 锁住）。
// ════════════════════════════════════════════════════════════════════════════
test('CHG296-M3a 提示词已收窄为「单音节」限定（不再是「在 + 动词」一刀切）', () => {
  assert.equal(PROMPT_MD.includes('`在` + 单音节动词'), true,
    'M3 未收窄：仍是一刀切的「在 + 动词」写法');
  assert.equal(PROMPT_MD.includes('`在` + 动词 这类口语/书面两可'), false,
    'M3 未收窄：旧的一刀切写法仍在');
});

test('CHG296-M3b 收窄后的三条具体判据逐字在位（在已 / 下周在讨论 / 等下在说）', () => {
  assert.equal(PROMPT_MD.includes('在已` 本身不成词'), true,
    '缺「在已」的判定依据（不成词 ⇒ 只能是「已经」）');
  assert.equal(PROMPT_MD.includes('「下周」「等下」指**尚未发生**'), true,
    '缺「未来时间标记 ⇒ 只能是再」的判定依据');
  assert.equal(PROMPT_MD.includes('句中若有指向未来/已完成的时间或结果标记'), true,
    '缺唯一判法（时间/结果标记 ⇒ 不是「正在进行」）');
});

test('CHG296-M3c 判据 ①–④ 与 M2 / M4 **逐字未动**（收窄 M3 不得连带改别的）', () => {
  for (const k of ['① **唯一读法**', '② **只换单位**', '③ **非事实面**', '④ **非专名非数值**']) {
    assert.equal(PROMPT_MD.includes(k), true, '判据原文必须逐字保留：' + k);
  }
  assert.equal(PROMPT_MD.includes('`的 / 地 / 得` 互换 ⇒ 不动'), true, 'M2 不得被动');
  assert.equal(PROMPT_MD.includes('参考只能「阻止改动」'), true, 'M4 不得被动');
  assert.equal(PROMPT_MD.includes('满足下列四条时才适用本例外'), true, '判据数量词「四条」不得变');
});

test('CHG296-M3d 产物已同步（改了 md 漏跑 sync-prompts + build-host 的哨兵）', () => {
  assert.equal(HOST.includes('`在` + 单音节动词'), true,
    '产物里没有收窄后的 M3 ⇒ 改了 prompts/*.md 却漏跑 sync-prompts + build-host');
});
