// CHG-117（2026-10-16 · 规整改造批）：**清口水词**（本地纯规则）契约测试。
// 覆盖：① 三类清理（语气词 / 即时重复 / 拉长音）行为
//       ② ⭐ **误删防护四项**（位置保护 / 白名单 / 可关 / 可见性）
//       ③ 边界：不改写、不新增、不改语义（**只做减法**）
//       ④ 可见性读数（清理几次 / 是否跳过 / 旧键清理态）
//       ⑤ 变异自证（退回防护 ⇒ 必红）+ 负控（正常句 / 儿化音 / 已关闭）
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = join(__dirname, '..');
const decodeChunk = (rel) => {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  const m = raw.match(/module\.exports\s*=\s*"([\s\S]*)";?\s*$/);
  return JSON.parse('"' + m[1] + '"');
};

function loadFiller(src) {
  const code = src || decodeChunk('src/client/voice/filler.js');
  const api = new Function(code + '\n;return { stripFillers, runFiller, fillerSnapshot, subscribeFiller, FILLER_CHARS, FILLER_CHARS_GUARDED, FILLER_PHRASES, FILLER_PHRASES_HARD, FILLER_PROTECTED, FILLER_REDUP_SAFE };')();
  return api;
}
const F = loadFiller();
const strip = (s) => F.stripFillers(s).text;

// ─────────── ① 三类清理 ───────────
test('FILLER-01 语气词（孤立）被删：嗯 / 呃 / 哦 / 啊', () => {
  assert.equal(strip('嗯我们明天开会'), '我们明天开会');
  assert.equal(strip('呃我觉得可以'), '我觉得可以');
  assert.equal(strip('这样就行了吧？哦'), '这样就行了吧？');
  assert.equal(strip('啊，那就这样'), '那就这样');
});

test('FILLER-02 无歧义话语标记被删（就是说 / 那个啥 / 怎么说呢 / 你知道）', () => {
  assert.equal(strip('就是说我们需要导出功能'), '我们需要导出功能');
  assert.equal(strip('那个啥，你先等一下'), '，你先等一下'.replace(/^[，]+/, '') || '你先等一下');
  assert.equal(strip('怎么说呢，感觉还行'), '感觉还行');
});

test('FILLER-03 即时重复词折叠为 1（多字 + 单字）', () => {
  assert.equal(strip('就是就是那个意思'), '就是那个意思');
  assert.equal(strip('我我我想想这个事'), '我想想这个事');
  assert.equal(strip('我们我们走吧'), '我们走吧');
});

test('FILLER-04 拉长音：语气词 + 拉长音一并清理（不出残留符号）', () => {
  assert.equal(strip('嗯——那我们开始'), '那我们开始');
  assert.equal(strip('那个～～我说一下'), '我说一下');
  assert.equal(strip('嗯……好吧'), '好吧');
});

// ─────────── ② ⭐ 误删防护 ───────────
test('FILLER-10 ⭐位置保护·儿化音：儿不是语气词，词中/词尾均不动', () => {
  for (const s of ['那个儿化音要注意', '我去那边儿看看', '花儿开了', '我们玩一会儿', '门儿都没有', '这哪儿有文件', '小孩儿在玩']) {
    assert.equal(strip(s), s, '不得改坏：' + s);
  }
});

test('FILLER-11 ⭐白名单·易误删词：阿姨 / 女儿 / 哎呀 / 叠词 全保留', () => {
  for (const s of ['阿姨你好', '女儿和儿子都来了', '哎呀，这个真好看', '看看这个文档', '谢谢你的帮助', '爸爸妈妈都在', '哥哥和姐姐', '我们慢慢来']) {
    assert.equal(strip(s), s, '不得改坏：' + s);
  }
});

test('FILLER-12 ⭐歧义短语·只在严格孤立/重复时删：然后 / 那个 作真实连接词时不删', () => {
  assert.equal(strip('然后我们按顺序执行'), '然后我们按顺序执行', '「然后」接内容词 ⇒ 保留（删了会改语义）');
  assert.equal(strip('那个文件在哪'), '那个文件在哪', '「那个」作指代 ⇒ 保留');
  assert.equal(strip('那个，我说一下'), '我说一下', '「那个」孤立 ⇒ 可删');
});

test('FILLER-13 ⭐正常句不得改坏（负控·整句原样）', () => {
  for (const s of ['请把导出的数据按时间排序', '我们需要在明天之前完成这个功能', '目标是提升系统稳定性',
    '把一些文件整理一下，按时间排好', '更新执行器是独立进程，使用独立端口']) {
    assert.equal(strip(s), s, '正常句必须原样：' + s);
  }
});

test('FILLER-14 ⭐只做减法：输出必须是输入的子序列（不改写/不新增/不换词）', () => {
  const cases = ['嗯那个我们明天开会吧', '我我我想想这个事', '就是说需要导出', '嗯——那我们开始',
    '阿姨你好', '然后我们按顺序执行', '那个儿化音要注意'];
  const isSubseq = (a, b) => { let i = 0; for (const ch of b) if (ch === a[i]) i++; return i === a.length; };
  for (const c of cases) {
    const out = strip(c);
    assert.ok(out.length <= c.length, '输出不得变长：' + c);
    assert.ok(isSubseq(out, c), '输出必须是输入的子序列（不得改写/新增）：' + c + ' ⇒ ' + out);
  }
});

test('FILLER-15 ⭐可关闭：enabled=false ⇒ 原样返回并记一次 skipped（可见）', () => {
  const before = F.fillerSnapshot().skipped;
  const r = F.runFiller('嗯那个我们明天开会吧', false);
  assert.equal(r.text, '嗯那个我们明天开会吧', '关闭 ⇒ 不得改动');
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'disabled');
  assert.equal(F.fillerSnapshot().skipped, before + 1, '跳过次数须可见（不得静默）');
});

// ─────────── ③ 可见性 ───────────
test('FILLER-20 ⭐可见性：清理次数/删除处数/最近删除明细均可读（不得静默失效）', () => {
  const s0 = F.fillerSnapshot();
  const r = F.runFiller('嗯那个我们明天开会吧', true);
  assert.equal(r.changed, true);
  const s1 = F.fillerSnapshot();
  assert.ok(s1.runs > s0.runs, '执行次数须递增');
  assert.ok(s1.cleaned > s0.cleaned, '清理发生次数须递增');
  assert.ok(s1.removedTotal > s0.removedTotal, '累计删除处数须递增');
  assert.ok(Array.isArray(s1.lastRemoved) && s1.lastRemoved.length > 0, '最近删除明细须可读');
  assert.equal(typeof s1.legacyChecked, 'boolean', '旧键清理态须可读');
});

test('FILLER-21 订阅可见：subscribeFiller 能在清理后收到通知', () => {
  let fired = 0;
  const off = F.subscribeFiller(() => { fired += 1; });
  F.runFiller('嗯在吗', true);
  off();
  const after = fired;
  F.runFiller('嗯在吗', true);
  assert.ok(after > 0, '订阅者须被通知');
  assert.equal(fired, after, '退订后不得再通知');
});

// ─────────── ④ 边界 ───────────
test('FILLER-30 边界：空串 / 非字符串 / 纯标点 安全', () => {
  assert.equal(F.stripFillers('').text, '');
  assert.equal(F.stripFillers(null).text, null);
  assert.equal(F.stripFillers(undefined).changed, false);
  assert.equal(typeof strip('。。。'), 'string');
});

test('FILLER-31 产物含清理器且设置页有可见性组件（构建注入防漂移）', () => {
  const client = readFileSync(join(ROOT, 'lib', 'client.cjs'), 'utf8');
  assert.ok(client.includes('function stripFillers'), '产物缺清口水词清理器');
  assert.ok(client.includes('function FillerDiag'), '产物缺可见性组件（不得静默）');
  assert.ok(client.includes('cleanupLegacyRefine'), '产物缺旧配置一次性清理');
  assert.ok(client.includes("t('voiceRefineShort')"), '产物缺「清口水词」开关文案引用');
});

test('FILLER-32 已退役面不得回流（旧规整 LLM 链 / 旧子键 / 旧 i18n 键）', () => {
  const client = readFileSync(join(ROOT, 'lib', 'client.cjs'), 'utf8');
  for (const bad of ['voiceRefineChain', 'voiceRefineCustom', 'voiceRefineApiKey', 'voiceRefineBaseUrl', 'voiceRefineModel', 'voiceRefineOff']) {
    assert.equal(client.includes(bad), false, 'CHG-117：旧 i18n 键不得回流 ' + bad);
  }
  // ⚠ 只判「**声明/常量定义**」形态，不判注释里的**提及**（CHG-117 的说明性注释里会点名旧物，
  //   那是允许的 —— 与既有的"看调用形态不看裸串"同款口径）。
  const asr = readFileSync(join(ROOT, 'lib', 'asr.cjs'), 'utf8');
  for (const pat of [/function\s+refineText/, /async\s+function\s+transcribe/, /const\s+REFINE_PROMPT\s*=/,
    /const\s+REFINE_TIMEOUT_MS\s*=/, /function\s+setLlm/, /function\s+httpsRequest/, /function\s+extractText/]) {
    assert.equal(pat.test(asr), false, 'CHG-117：旧规整 LLM 链不得回流 ' + pat);
  }
  assert.equal(/transcribe:\s*asr\.transcribe/.test(readFileSync(join(ROOT, 'lib', 'rpc-voice.cjs'), 'utf8')), false,
    'CHG-117：rpc-voice 不得再调 asr.transcribe');
});

// ─────────── ④-bis CHG-121 收尾批：儿化音白名单**加固**回归锁 ───────────
// 定性（先量后补）：现行**无**风险 —— 「儿」不在任一语气词表内，位置保护也挡住词中「儿」。
//   本块是**加固**（防将来词表扩张），故判据形态 = ① 加固条目逐条在位 ② 现行不得被改坏
//   ③ **变异自证**：摘掉加固块 ⇒ 同一「词表扩张」变异下必被改坏（证明本锁不是恒真摆设）。
const ERHUA_HARDENED = ['一会儿', '这会儿', '那会儿', '多会儿', '等会儿',
  '有点儿', '一点儿', '差点儿', '玩儿', '门儿', '事儿', '味儿', '劲儿', '空儿',
  '头儿', '苗儿', '伴儿'];
// 模拟「将来词表扩张」：把「儿」列进受保护字表（**单因子**——位置保护保留）。
//   ⚠ 与下方 FILLER-V01 的双因子变异不同：V01 证「位置保护承重」；本条证「白名单加固承重」。
const addErToGuarded = (src) => {
  const anchor = "var FILLER_CHARS_GUARDED = [";
  assert.ok(src.includes(anchor), '变异锚点须存在（受保护字表）');
  return src.replace(anchor, anchor + "'儿', ");
};

test('FILLER-40 ⭐CHG-121 加固：儿化音白名单逐条在位 + 现行不得改坏', () => {
  for (const w of ERHUA_HARDENED) {
    assert.ok(F.FILLER_PROTECTED.indexOf(w) !== -1, 'CHG-121：加固条目须入白名单 —— ' + w);
    assert.equal(strip(w), w, 'CHG-121：现行不得改坏 —— ' + w);
    assert.equal(strip('我想' + w), '我想' + w, 'CHG-121：句中周边不得改坏 —— ' + w);
  }
});

test('FILLER-40V ⭐变异自证·加固有牙：摘掉加固块 ⇒ 词表扩张变异下必被改坏', () => {
  const base = decodeChunk('src/client/voice/filler.js');
  // ① 正例：有加固块 ⇒ 同一变异下**全部不得**被改坏
  const withFix = loadFiller(addErToGuarded(base));
  const broke = ERHUA_HARDENED.filter((w) => withFix.stripFillers(w).text !== w);
  assert.deepEqual(broke, [], '有加固时「儿」入表也不得改坏，实测被改坏：' + JSON.stringify(broke));
  // ② 摘掉加固块 == 退回「补白名单之前」⇒ 若本锁没牙（恒真）此处会静默通过
  assert.ok(base.includes("'一会儿'"), 'CHG-121 加固块须存在（否则本变异无对象）');
  const reverted = base.replace(/'一会儿', '这会儿', '那会儿', '多会儿', '等会儿',\n[\s\S]*?'头儿', '苗儿', '伴儿',\n/g, '');
  assert.ok(!reverted.includes("'一会儿'"), '变异须真的摘掉了加固块');
  const noFix = loadFiller(addErToGuarded(reverted));
  const brokeReverted = ERHUA_HARDENED.filter((w) => noFix.stripFillers(w).text !== w);
  assert.ok(brokeReverted.length > 0,
    '摘掉加固后必须被改坏（否则本判据为恒真摆设）；实测被改坏 0 条');
});

// ─────────── ⑤ 变异自证 + 负控 ───────────
// 变异：让「位置保护」失效（`notInsideWord` 恒真 ⇒ 完全不看位置）。
//   ⚠ 单变「位置保护」**不会**伤到儿化音 —— 因为「儿」**根本不在语气词词表里**
//     （它靠"词表不含"这一事实保护）。故本变异**双因子**：把「儿」临时列进词表 + 关掉位置保护，
//     才能证明**位置保护这条判据真的在承重**（而不是摆设）。
const POS_ANCHOR = "    if (!notInsideWord(out, i, j)) { i++; continue; }";
function mutateDropPositionGuard(src) {
  assert.ok(src.includes(POS_ANCHOR), '变异锚点须存在（位置保护）');
  return src.replace(POS_ANCHOR, '');
}
const addErToList = (src) => {
  const anchor = "var FILLER_CHARS_GUARDED = [";
  assert.ok(src.includes(anchor), '变异锚点须存在（受保护字表）');
  return src.replace(anchor, anchor + "'儿', ");
};
test('FILLER-V01 ⭐变异自证·位置保护承重（双因子：列「儿」入表 + 关位置保护）', () => {
  const base = decodeChunk('src/client/voice/filler.js');
  const SAMPLE = '那个儿化音要注意';
  // ① 只把「儿」列进表、**保留**位置保护 ⇒ 仍安全（位置保护挡住了）
  const withGuard = loadFiller(addErToList(base));
  assert.equal(withGuard.stripFillers(SAMPLE).text, SAMPLE,
    '列「儿」入表后，位置保护应当仍然挡住（词中不删）');
  // ② 再把位置保护关掉 ⇒ **必被改坏** ⇒ 证明该判据真的在承重
  const noGuard = loadFiller(mutateDropPositionGuard(addErToList(base)));
  assert.notEqual(noGuard.stripFillers(SAMPLE).text, SAMPLE,
    '若此处仍相等，说明「位置保护」这条判据没有判别力（摆设）');
});

test('FILLER-V02 变异自证·白名单仍有牙：清空白名单 ⇒ 阿姨/哎呀 必被改坏', () => {
  const src = decodeChunk('src/client/voice/filler.js')
    .replace(/var FILLER_PROTECTED = \[[\s\S]*?\];/, 'var FILLER_PROTECTED = [];');
  const M = loadFiller(src);
  const hurt = ['阿姨你好', '哎呀，这个真好看'].filter((s) => M.stripFillers(s).text !== s);
  assert.ok(hurt.length > 0, '若此处为空，说明 FILLER-11 对"白名单"没有判别力');
});

test('FILLER-V03 负控·正常句在两种变异下仍不得被改坏', () => {
  for (const kind of ['pos', 'white']) {
    const src = decodeChunk('src/client/voice/filler.js');
    const code = kind === 'pos' ? mutateDropPositionGuard(addErToList(src))
      : src.replace(/var FILLER_PROTECTED = \[[\s\S]*?\];/, 'var FILLER_PROTECTED = [];');
    const M = loadFiller(code);
    for (const s of ['请把导出的数据按时间排序', '我们需要在明天之前完成这个功能']) {
      assert.equal(M.stripFillers(s).text, s, '负控(' + kind + ')：正常句不得被改坏');
    }
  }
});
