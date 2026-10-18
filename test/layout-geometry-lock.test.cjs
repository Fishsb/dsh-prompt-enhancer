'use strict';
// layout-geometry-lock.test —— ⭐ 本批（2026-10-18 最小改动批）的**长期产出**：
//   把「全量几何快照对比（除目标外逐项差 0.0）」固化成**回归锁**，
//   使它今后能自动抓到本仓反复出现的「修一处坏一处」（CHG-179 两次 · CHG-185 · CHG-189）。
//
// ⚠ 为什么用**纯源码/结构判据**而不是量测：
//   · 本仓的量测装置（scripts/settings-layout-audit.mjs）需要 Chrome headless，
//     **在 CI / 干净 clone 上不保证可用** ⇒ 若把回归锁写成"必须跑浏览器"，
//     它会在 CI 上长期 SKIP，等于没有锁（本仓已有此类教训：判据面没有触发点 = 甲类）。
//   · 因此这里锁**布局的成因结构**（谁是不是 flex 容器 / 谁带 flexWrap / 谁的宽度由内容决定），
//     它们**不需要浏览器**，且正是"修一边坏一边"发生的地方。
//   · 几何量测仍由 scripts/settings-layout-audit.mjs 承担（人工/部署前预检），两者互补：
//     本文件 = 结构锁（机载、每次 npm test 跑）；audit = 像素锁（装置跑）。
//
// ⭐ 本锁的**核心形态**：把「首行容器的布局契约」与「四个 chip 的宽度契约」逐条钉死。
//   ⚠ 它允许的改动面 = **零**（除非作者同时更新本锁并证明"其余读数不变"）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { decodeChunk } = require('../scripts/lib/chunk-decode.mjs');

function voiceSrc() {
  return decodeChunk('src/client/voice/voice-section.js');
}
function styleSrc() {
  return decodeChunk('src/client/styles.js');
}

// 取某段源码（用起止锚点切），供"只在开关块内判"这类**范围限定**判据使用。
//   ⚠ 范围限定是必须的：本仓已实测"全文 grep 会命中别的选择器"给出假阳性 1。
function sliceBetween(src, startAnchor, endAnchor) {
  const i = src.indexOf(startAnchor);
  assert.ok(i >= 0, '前置：须能定位 ' + startAnchor);
  const j = src.indexOf(endAnchor, i);
  assert.ok(j > i, '前置：须能定位 ' + endAnchor);
  return src.slice(i, j);
}

test('GEOLOCK-01 首行容器 = flex + wrap + center（不得回 grid —— grid 会撑出方块）', () => {
  const s = voiceSrc();
  // 首行：装 >=2 个 ToggleChip 的容器。其 style 必须逐字为这三件。
  const m = s.match(/React\.createElement\('div', \{ style: \{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' \} \},/);
  assert.ok(m, '首行容器须是 display:flex + flexWrap:wrap + alignItems:center + gap:12px（⛔ 回 grid 会把开关撑成方块）');
  // 负控：源码里**不得**再出现 grid 列定义（注释除外）
  const codeOnly = s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.equal(/gridTemplateColumns/.test(codeOnly), false, '⛔ 代码层不得再出现 gridTemplateColumns（回退标志）');
});

test('GEOLOCK-02 四个 chip 的宽度契约 = width:auto + min-width 兜底 + nowrap（不得回到固定 width:<px>）', () => {
  const s = voiceSrc();
  const chip = sliceBetween(s, 'const ToggleChip = (p) =>', '}, p.onText);');
  // ① 必须 width:auto（宽度由「文字 + 内边距」决定）
  assert.ok(/style: \{[^}]*width: 'auto'/.test(chip), '开关须 width:auto ⇒ 宽度由内容决定');
  // ② ⛔ 不得是固定像素宽（本仓已两次栽在这里：固定宽 + stretch = 方块）
  assert.equal(/style: \{[^}]*width: '\d+px'/.test(chip), false, '⛔ 开关宽度不得写成固定像素');
  // ③ min-width 兜底下限必须在（防 EN 最长态被裁）
  const mw = chip.match(/minWidth: '(\d+)px'/);
  assert.ok(mw, '开关须有 min-width 兜底');
  assert.ok(Number(mw[1]) >= 96, 'min-width 须 >= 96px（EN 最长现实取值 102.13px 的兜底）；实得 ' + mw[1]);
  // ④ nowrap（换行会让高度不可控）
  assert.ok(/whiteSpace: 'nowrap'/.test(chip), '开关须 white-space:nowrap');
});

test('GEOLOCK-03 热键子行 = flex 项 + flexWrap wrap（内层可折行，但不得靠改外层 flexWrap 解决）', () => {
  const s = voiceSrc();
  const m = s.match(/className: 'dsh-plg-row', style: \{ flex: '[^']+', minWidth: '[^']+', flexWrap: 'wrap' \} \},/);
  assert.ok(m, '热键子行须是带 flex/minWidth/flexWrap:wrap 的 flex 项');
  // ⚠ 外层首行必须**保留** flexWrap:wrap —— 窄视口要允许整块折行（去掉它=禁止折行，会溢出）
  assert.ok(/display: 'flex', flexWrap: 'wrap', alignItems: 'center'/.test(s), '⛔ 外层首行须保留 flexWrap:wrap（否则窄视口溢出）');
});

test('GEOLOCK-04 热键输入框 = border-box（⭐ 本批修复点：这 2px 决定它折不折行）', () => {
  const s = voiceSrc();
  const inp = s.match(/style: \{ flex: '1 1 0', minWidth: '96px'([^}]*) \},/);
  assert.ok(inp, '前置：须能定位热键输入框 style');
  // ⭐ 本批根因：输入框 min-width:120px 是**内容宽**（content-box）⇒ 实际最小占位 120+2*padding。
  //   子行最小内容宽 = 72(label) + (120+padding) + 92(清除) + 2*8(gap) > 列宽 322 ⇒ 折行 2px。
  //   加 box-sizing:border-box 让 min-width 变成**含内边距**的占位 ⇒ 最小内容宽降到 314 ⇒ 不折行。
  assert.ok(/boxSizing: 'border-box'/.test(inp[1]), '⛔ 热键输入框须 box-sizing:border-box（本批耗时 2px 的修复点，删掉即回退换行）');
});

test('GEOLOCK-05 静音行 = nowrap + 滑块 flex:1 1 auto + 读数 em 槽（CHG-189 三项成果不得回退）', () => {
  const s = voiceSrc();
  // ① 静音行三件必须同一行
  assert.ok(/className: 'dsh-plg-row dsh-vi-silence-row', style: \{ flexWrap: 'nowrap' \} \},/.test(s),
    '静音行须 flexWrap:nowrap（折行会把读数甩到滑块下面）');
  // ② 滑块必须在**规则内**判，不得全文 grep（本仓已实测假阳性）
  const st = styleSrc();
  const rule = st.match(/'\.dsh-vi-slider\{([^}]*)\}'/);
  assert.ok(rule, 'styles.js 须有 .dsh-vi-slider 规则');
  assert.ok(/flex:1 1 auto/.test(rule[1]), '滑块须 flex:1 1 auto');
  assert.equal(/flex:1 1 0\b/.test(rule[1]), false, '⛔ 滑块不得回到 flex:1 1 0');
  // ③ 读数槽（关/开两态等宽的载体）
  const rd = st.match(/'\.dsh-vi-silence-row > \.dsh-plg-muted\{([^}]*)\}'/);
  assert.ok(rd, 'styles.js 须有读数槽规则');
  assert.ok(/min-width:\s*[\d.]+em/.test(rd[1]), '读数槽须用 em 计最小占位');
});

test('GEOLOCK-06 两块卡片 = 同款边界（并列层级不得回退成"从属"）', () => {
  const st = styleSrc();
  const sec = st.match(/'\.dsh-cfg-sec\{([^}]*)\}'/);
  assert.ok(sec, 'styles.js 须有 .dsh-cfg-sec 规则');
  assert.ok(/border:1px solid/.test(sec[1]), '两块须各有一圈边框（视觉并列的载体）');
  assert.ok(/border-radius/.test(sec[1]), '两块须有圆角');
});

test('GEOLOCK-07 变异自证：把输入框的 box-sizing 去掉 ⇒ GEOLOCK-04 必红（本锁有牙）', () => {
  const s = voiceSrc();
  const mutated = s.replace("style: { flex: '1 1 0', minWidth: '96px', boxSizing: 'border-box' }", "style: { flex: '1 1 0', minWidth: '96px' }");
  assert.notEqual(mutated, s, '前置：变异锚点须命中');
  const inp = mutated.match(/style: \{ flex: '1 1 0', minWidth: '96px'([^}]*) \},/);
  assert.ok(inp, '前置：变异后仍须能定位');
  assert.equal(/boxSizing: 'border-box'/.test(inp[1]), false, '变异后应无 box-sizing ⇒ GEOLOCK-04 的断言必红');
});

test('GEOLOCK-08 负控：不动任何文件 ⇒ 本锁全绿（防"恒红"）', () => {
  const s = voiceSrc();
  assert.ok(s.length > 1000, '源码可读');
  assert.ok(/const ToggleChip = \(p\) =>/.test(s), 'ToggleChip 在位');
  const st = styleSrc();
  assert.ok(st.length > 1000, 'styles 可读');
});

// ───────── 2026-10-18（R2 · 热键列收窄批）新增回归锁 ─────────
// 背景：用户裁定 A 方案（P1 收窄热键列内容）⇒ 本批只改两处：
//   ① 清除按钮⇒图标按钮（必须保留 title + aria-label）；
//   ② 热键 label⇒极短标记（必须保留 title + aria-label）。
// 这四条锁就是那两处不得回退的机载判据（GEOLOCK-09..12）+ 变异自证与负控。
//   ⚠ 为何锁“可发现性”：图标化最大风险不是宽度，而是用户看不懂那个图标是什么——
//     = 图标化后必须仍能通过悬停/读屏器得知语义。


test('GEOLOCK-09 清除按钮 = 图标按钮且 title/aria-label 保留（R2 第 1 处）', () => {
  const s = voiceSrc();
  const m = s.match(/className: 'dsh-plg-btn dsh-plg-btn-icononly', title: t\('voiceHotkeyClear'\), 'aria-label': t\('voiceHotkeyClear'\), onClick: clearHotkey \}/);
  assert.ok(m, '清除按钮须是图标按钮（dsh-plg-btn-icononly）且同时带 title + aria-label（不得变成不可发现）');
  assert.equal(/style: \{ width: '92px', whiteSpace: 'nowrap' \}/.test(s), false, '⛔ 不得回到 92px 文本按钮（那会把本列内容下限抬回 300+）');
});

test('GEOLOCK-10 热键 label = 极短标记且 title/aria-label 保留（R2 第 2 处）', () => {
  const s = voiceSrc();
  const m = s.match(/React\.createElement\('label', \{ className: 'dsh-plg-label', style: \{ width: 'auto', minWidth: '0' \}, title: t\('voiceHotkeyCombo'\), 'aria-label': t\('voiceHotkeyCombo'\) \}/);
  assert.ok(m, 'label 须确为极短标记且带 title + aria-label（原文案不丢）');
  assert.equal(/style: \{ width: '72px', minWidth: '72px' \} \}, t\('voiceHotkeyCombo'\)/.test(s), false, '⛔ 不得回到 72px 文字 label');
  // 负控范围声明：本条只判热键列内那一个 label，不判全仓其余 label
  assert.equal(s.split("className: 'dsh-plg-label'").length - 1 >= 1, true, '其余处的 dsh-plg-label 不受本条约束（判据范围 = 热键列）');
});

test('GEOLOCK-11 热键列内容下限与输入框下限（R2 算术必然）', () => {
  const s = voiceSrc();
  assert.ok(/className: 'dsh-plg-row', style: \{ flex: '1 1 160px', minWidth: '160px', flexWrap: 'wrap' \} \},/.test(s),
    '热键列 min-width 须随两处改动下移到 160px（旧 320px 会让本列必然整块折行）');
  const inp = s.match(/style: \{ flex: '1 1 0', minWidth: '(\d+)px', boxSizing: 'border-box' \},/);
  assert.ok(inp, '前置：须能定位热键输入框 style');
  assert.equal(inp[1], '96', '输入框 min-width 须为 96px（含内边距的占位：96-24-2=70px 内容宽），实得 ' + inp[1]);
  assert.ok(/boxSizing: 'border-box'/.test(inp[0]), '⛔ 不得丢掉 box-sizing:border-box（GEOLOCK-04 的成果）');
});

test('GEOLOCK-12 变异自证 + 负控（R2 锁有牙）', () => {
  const s = voiceSrc();
  // 变异①：清除按钮退回 92px 文本形态 ⇒ GEOLOCK-09 必红
  const m1 = s.replace(
    "className: 'dsh-plg-btn dsh-plg-btn-icononly', title: t('voiceHotkeyClear'), 'aria-label': t('voiceHotkeyClear'), onClick: clearHotkey }",
    "className: 'dsh-plg-btn', style: { width: '92px', whiteSpace: 'nowrap' }, onClick: clearHotkey }");
  assert.notEqual(m1, s, '前置：变异①锚点须命中');
  assert.equal(/className: 'dsh-plg-btn dsh-plg-btn-icononly', title: t\('voiceHotkeyClear'\)/.test(m1), false,
    '变异①后 GEOLOCK-09 的断言必红');
  // 变异②：热键列 min-width 回到 320 ⇒ GEOLOCK-11 必红
  const m2 = s.replace("style: { flex: '1 1 160px', minWidth: '160px', flexWrap: 'wrap' }",
    "style: { flex: '1 1 320px', minWidth: '320px', flexWrap: 'wrap' }");
  assert.notEqual(m2, s, '前置：变异②锚点须命中');
  assert.equal(/flex: '1 1 160px', minWidth: '160px'/.test(m2), false, '变异②后 GEOLOCK-11 的断言必红');
  // 负控：不动任何文件 ⇒ 上述两条假设均成立（防“恒红”）
  assert.ok(/className: 'dsh-plg-btn dsh-plg-btn-icononly', title: t\('voiceHotkeyClear'\)/.test(s), '负控：图标按钮在位');
  assert.ok(/flex: '1 1 160px', minWidth: '160px'/.test(s), '负控：热键列下限在位');
});
// ══════════════════════════════════════════════════════════════════════════════
// 2026-10-18（结构回归锁批）新增：**两条机载锁**（GEOLOCK-A* / GEOLOCK-B*）
//
// 由来（上一批自己提、本席采纳）：上一批把「语音必须在 tab 层」与「模型行固定宽合计 ≤ 534」
//   只写成了 /tmp 里的临时判据（check-a / check-c），**未入库** ⇒ 谁把语音移回「模型配置」
//   正文的卡片、谁把 provider 下限调回 104，npm test 都抓不到（= F-5 那条装置缺口）。
//   本批把这两条的**结构腿**并进本文件（本文件已在 scripts.test 清单内 ⇒ 真机载）。
//
// ⚠ 仍**不依赖浏览器**（硬约束）：两条锁只读「源码结构」与「CSS 声明值」（成因面），
//   ⛔ 不跑 headless Chrome。理由同文件头：CI / 干净 clone 上不保证有 Chrome ⇒ 写成
//   「必须跑浏览器」的锁会长期 SKIP = 等于没有锁。像素量测仍归
//   scripts/settings-layout-audit.mjs（人工/部署前预检），两者互补。
//
// ⚠ 判据范围（否定性断言的**范围**必须写明）：
//   · A 组只判 src/client/components/** 与 src/client/voice/** 这 24 个 client chunk 的
//     **代码面**（已剥注释）—— ⛔ 不判 lib/client.cjs 产物字节、⛔ 不判运行期 DOM 层级、
//     ⛔ 不判样式"看起来是否平级"（后者是像素锁的面）。
//   · B 组只判 .dsh-plg-row（模型链条目行）内**本仓自己声明**的宽度；⛔ 不判宿主侧容器
//     实际给了多少宽（那是真机量测的面，见 MODEL_ROW_AVAILABLE_PX 的来源注释）。
// ══════════════════════════════════════════════════════════════════════════════

/** 读某 client chunk 的**代码面**（已剥注释）。 */
async function codeOf(rel) {
  const { codeOnly } = await import('../scripts/lib/code-only.mjs');
  return codeOnly(decodeChunk(rel));
}

// ───────── 锁 A：语音设置必须在 tab 层（与「模型配置」「优化参数」同层）─────────

/** 页内 tab 表的解析结果：{ block, entries:[{key,labelKey}] }；解析不出返回 null（fail-closed）。 */
function parseTabTable(pluginsCode) {
  const head = 'const tabs = [';
  const i = pluginsCode.indexOf(head);
  if (i < 0) return null;
  const j = pluginsCode.indexOf('];', i);
  if (j < 0) return null;
  const block = pluginsCode.slice(i, j + 2);
  const entries = [];
  const re = /\[\s*'([a-z-]+)'\s*,\s*t\('([A-Za-z0-9_]+)'\)\s*\]/g;
  let m;
  while ((m = re.exec(block)) !== null) entries.push({ key: m[1], labelKey: m[2] });
  return { block: block, entries: entries };
}

/** tab 正文分派：voice / models / params 三支各自渲染哪个组件（解析不出为 null）。 */
function parseTabBodyDispatch(pluginsCode) {
  const pick = (re) => { const m = pluginsCode.match(re); return m ? m[1] : null; };
  return {
    voice: pick(/tab === 'voice'\s*\?\s*React\.createElement\((VoiceSection)\b/),
    models: pick(/tab === 'models'\s*\?\s*React\.createElement\((ModelConfigTab)\b/),
    params: pick(/:\s*React\.createElement\((ParamsTab)\b/),
  };
}

test('GEOLOCK-A1 「语音输入」必须是**页内 tab 表**里的一项（与模型配置/优化参数同一处定义）', async () => {
  const plugins = await codeOf('src/client/components/model-plugins-section.js');
  const tabTable = parseTabTable(plugins);
  assert.ok(tabTable, '前置：须能定位页内 tab 表 const tabs = [...]');
  const keys = tabTable.entries.map((e) => e.key);
  // ① 三项**同一处定义**且都在：语音不是另起一行 tab，也不是别处的第二套 tab 条
  assert.deepEqual(keys, ['models', 'voice', 'params'],
    '页内 tab 表须逐项为 models / voice / params（语音与另两个同层）；实得 ' + JSON.stringify(keys));
  // ② 语音项的标签键必须是 tabVoice
  const voice = tabTable.entries.find((e) => e.key === 'voice');
  assert.equal(voice.labelKey, 'tabVoice', '语音 tab 的标签键须是 tabVoice；实得 ' + voice.labelKey);
  // ③ 表里不得出现第四项（出现即意味着又加了 tab，需本锁同步评估）
  assert.equal(tabTable.entries.length, 3, '页内 tab 表须恰为 3 项；实得 ' + tabTable.entries.length);
});

test('GEOLOCK-A2 tab 正文分派：voice 分支必须渲染 VoiceSection（且另两支各就位）', async () => {
  const plugins = await codeOf('src/client/components/model-plugins-section.js');
  const dispatch = parseTabBodyDispatch(plugins);
  assert.equal(dispatch.voice, 'VoiceSection', "⛔ tab === 'voice' 分支须渲染 VoiceSection（语音 tab 的正文）");
  assert.equal(dispatch.models, 'ModelConfigTab', 'models 分支须渲染 ModelConfigTab');
  assert.equal(dispatch.params, 'ParamsTab', 'params 分支须渲染 ParamsTab');
  // ⚠ 分派必须由**同一个 tab 状态**驱动（三支是同一个三元链）—— 防「另起一套条件渲染」的假平级
  assert.ok(/const body = tab === 'voice'\s*\?\s*React\.createElement\(VoiceSection, props\)\s*:\s*tab === 'models'/.test(plugins),
    '三支须是同一条 const body = tab === … 三元链（同一处 tab 状态）');
});

test('GEOLOCK-A3 ⛔ 语音**不得**是「模型配置」tab 正文里的卡片（历史回退形态）', async () => {
  const cfgTab = await codeOf('src/client/components/model-config-tab.js');
  // ⚠ 必须判**剥注释后的代码**：该文件注释里仍写着「VoiceSection 已从本 tab 移出」的病史，
  //   裸 grep 会被那段注释命中 ⇒ 假红（本仓已实测过"全文 grep 命中注释"这类假阳性）。
  assert.equal(/VoiceSection/.test(cfgTab), false,
    '⛔ ModelConfigTab 的**代码**里不得出现 VoiceSection —— 它就是本批之前的历史形态'
    + '（语音是「模型配置」正文第 2 张卡片 ⇒ 切到「优化参数」时整块消失，且被 tab 名罩住 = 从属）');
  // 正面钉住正文里那张卡片是谁
  assert.ok(/React\.createElement\(ModelMainSection,/.test(cfgTab), '前置：ModelConfigTab 正文须仍含 ModelMainSection');
});

test('GEOLOCK-A4 VoiceSection 全 client chunk 只挂载**一处**，且该处就是 tab 分派', async () => {
  const { listChunkFiles } = require('../scripts/lib/chunk-decode.mjs');
  const { codeOnly } = await import('../scripts/lib/code-only.mjs');
  const clients = listChunkFiles(ROOT).filter((f) => f.indexOf('src/client/') === 0);
  assert.ok(clients.length > 20, '前置：client chunk 枚举须非空（实得 ' + clients.length + '）');
  const sites = [];
  for (const rel of clients) {
    const code = codeOnly(decodeChunk(rel));
    const n = (code.match(/React\.createElement\(VoiceSection\b/g) || []).length;
    if (n > 0) sites.push(rel + ' x' + n);
  }
  // 唯一挂载点 = tab 分派 ⇒ 换个地方塞一张卡片会立刻变红（不只是"模型配置"那一处）
  assert.deepEqual(sites, ['src/client/components/model-plugins-section.js x1'],
    'VoiceSection 须**只在** tab 分派处挂载一次；实得 ' + JSON.stringify(sites));
});

test('GEOLOCK-A5 三个 tab 标签都在 i18n 两侧，且「语音输入」是语音 tab 的中文标签', () => {
  const i18n = decodeChunk('src/client/i18n.js');
  const dict = new Function(i18n + '\n;return { ZH: ZH, EN: EN };')();
  assert.equal(typeof dict.ZH, 'object', '前置：ZH 字典须可求值');
  assert.equal(typeof dict.EN, 'object', '前置：EN 字典须可求值');
  // ① 三个 tab 的标签键在两侧都存在（缺一个 ⇒ 该 tab 渲染成 undefined）
  for (const k of ['tabModels', 'tabVoice', 'tabParams']) {
    assert.equal(typeof dict.ZH[k], 'string', 'ZH 缺 tab 标签键 ' + k);
    assert.equal(typeof dict.EN[k], 'string', 'EN 缺 tab 标签键 ' + k);
  }
  // ②「语音输入」这四个字就是标签本身（用户原话 CHG-188 / CHG-202 的落点）
  assert.equal(dict.ZH.tabVoice, '语音输入', 'ZH 的 tabVoice 须逐字为「语音输入」；实得 ' + dict.ZH.tabVoice);
  // ③ 三个标签互不相同（都叫一个名 = 用户仍分不出层次）
  const zh = ['tabModels', 'tabVoice', 'tabParams'].map((k) => dict.ZH[k]);
  assert.equal(new Set(zh).size, 3, '三个 tab 中文标签须互不相同；实得 ' + JSON.stringify(zh));
});

test('GEOLOCK-A-V 变异自证：语音退回「模型配置」正文卡片 ⇒ A3/A4 必红（锁 A 有牙）+ 负控', async () => {
  const plugins = await codeOf('src/client/components/model-plugins-section.js');
  const cfgTab = await codeOf('src/client/components/model-config-tab.js');

  // ⭐ 变异①（= 本批之前的**历史形态**：语音作为「模型配置」正文的第 2 张卡片）：
  //   在 ModelMainSection 之后（正文渲染块内）再挂一个 VoiceSection。
  const mutatedCfg = cfgTab.replace(
    /saveFallback: saveFallback \}\)/,
    'saveFallback: saveFallback }),\n    React.createElement(VoiceSection, { t: t })');
  assert.notEqual(mutatedCfg, cfgTab, '前置：变异①锚点须命中（正文渲染块的 ModelMainSection 调用）');
  assert.equal(/VoiceSection/.test(mutatedCfg), true, '前置：变异①后代码里应重新出现 VoiceSection');
  // ⇒ A3 的断言（代码面零 VoiceSection）必红
  assert.equal(!/VoiceSection/.test(mutatedCfg), false, '变异①后 GEOLOCK-A3 必红（语音又成了 tab 正文里的卡片）');
  // ⇒ A4 的断言（全 client 只一处挂载）也必红：把它算进「挂载点集合」里
  const sitesOf = (code) => (code.match(/React\.createElement\(VoiceSection\b/g) || []).length;
  const mutatedSites = [['model-plugins-section', sitesOf(plugins)], ['model-config-tab', sitesOf(mutatedCfg)]]
    .filter((x) => x[1] > 0).map((x) => x[0]);
  assert.deepEqual(mutatedSites, ['model-plugins-section', 'model-config-tab'],
    '变异①后挂载点变成 2 处 ⇒ GEOLOCK-A4 必红');

  // ⭐ 变异②：把 voice 从 tab 表里摘掉 ⇒ A1 必红
  const mutatedTab = plugins.replace("['voice', t('tabVoice')],", '');
  assert.notEqual(mutatedTab, plugins, '前置：变异②锚点须命中（tab 表里的语音项）');
  const t2 = parseTabTable(mutatedTab);
  assert.ok(t2, '前置：变异②后仍须能定位 tab 表');
  assert.deepEqual(t2.entries.map((e) => e.key), ['models', 'params'], '变异②后 A1 必红（语音不再是一个 tab）');

  // 负控：不动任何文件 ⇒ 上述假设在**原文件**上均成立（防"恒红"）
  assert.equal(/VoiceSection/.test(cfgTab), false, '负控：原文件代码面确无 VoiceSection');
  assert.deepEqual(parseTabTable(plugins).entries.map((e) => e.key), ['models', 'voice', 'params'], '负控：tab 表三项在位');
});

// ───────── 锁 B：模型行固定宽合计 ≤ 真机可用宽 ─────────

// ⭐⭐ 本锁的**唯一魔数**：真机可用宽（= 模型链条目行的 row1 宽）。**具名 + 注明来源**，
//   ⛔ 不许在别处再出现一次字面量（GEOLOCK-B5 会自检这一点）。
//
//   来源（三条独立读数，均为只读实读，不是本轮估算）：
//   ① CHG-196 实测：宿主设置面板 .VOzbGW_panel 是**定值 800px** ⇒ 内容盒 564；
//      .dsh-vi-section / 模型行 row1 = 534。⚠ 窗口从 602 扫到 2382，panel 恒 800
//      ⇒ **真机上不存在"700px 内容区"**（那是更上一轮从截图估的数，已作废，不得当依据）。
//   ② 本仓量测装置同一事实的**代码注释**（scripts/lib/settings-layout-driver.mjs:191）：
//      「row1 = root - 30（真机实测恒定偏移：宿主 padding 链 root 564 → row1 534）」
//      —— 装置的 30 偏移与 534 是同一条实测链（B5 会拿这两个数互算校验）。
//   ③ 溢出读数也以它为分母：改前实测 scrollWidth 586 vs clientWidth 534（**溢出 52px**），
//      改后 0px（2026-10-18 ia-parity 批报告 §⑥）。
//   ⚠ 因此 534 **不是**可以挑的数（不是断点、不是设计稿值），是宿主给的硬边界。
const MODEL_ROW_AVAILABLE_PX = 534;

// 行内**固定宽项**（不可被压缩的项）：逐项声明 + 从 CSS 实读下限。
//   ⚠ 每项都写明"为什么它是固定宽项"，与 ia-parity 批 §⑤ 的因果表一一对应。
const MODEL_ROW_FIXED_ITEMS = [
  { id: 'num', selector: '.dsh-plg-num', why: '序号列（width:18px + flex:none ⇒ 不可压缩）' },
  { id: 'provider', selector: '.dsh-plg-select-provider', why: '厂家选择器（min-width 下限；仅挤压时让到下限）' },
  { id: 'thinking', selector: '.dsh-plg-select-thinking', why: '思考开关（flex:0 0 auto + 固定 width）' },
  { id: 'level', selector: '.dsh-plg-select-level', why: '思考等级（flex:0 0 auto + 固定 width）' },
];
// 图标组（⛓ ↑ ↓ ✕）：个数来自源码结构（GEOLOCK-B4 核），宽度来自 CSS（.dsh-plg-btn-icononly 的 min-width）。
const MODEL_ROW_ICON_SELECTOR = '.dsh-plg-btn-icononly';
const MODEL_ROW_ICON_COUNT = 4;
// ⚠ 行内**唯一一处非 CSS 实读值**：失效行的 ⚠ 徽标（.dsh-plg-badge-invalid）在 styles.js 里
//   **没有任何规则**（本轮 grep 实得 0 条）⇒ 它的宽由内容定（源码里内容就是单个 ⚠ 字形）。
//   本锁按「13px 字号下的单个字形 + 安全余量」取 20px 上界，并在报告 §⑨ 登记为**未验证**——
//   ⛔ 不把它当 0（那会让最坏态漏算），也不假装它是 CSS 读出来的。
const MODEL_ROW_BADGE_BOUND_PX = 20;

/** 从 styles.js 里取某条**简单选择器**规则的声明体；取不到返回 null（fail-closed）。 */
function cssRule(stylesSrc, selector) {
  const key = "'" + selector + '{';
  const i = stylesSrc.indexOf(key);
  if (i < 0) return null;
  const j = stylesSrc.indexOf('}', i);
  if (j < i) return null;
  return stylesSrc.slice(i + key.length, j);
}
/** 取某条规则里某个声明的原始值（未解析）；无此声明返回 null。 */
function cssDecl(rule, prop) {
  const m = new RegExp('(?:^|;)' + prop + ':([^;}]+)').exec(rule || '');
  return m ? m[1].trim() : null;
}
/** 取 px 值；非 px（em/%/auto）⇒ null（调用方须 fail-closed，⛔ 不得按 0 处理）。 */
function cssPx(rule, prop) {
  const v = cssDecl(rule, prop);
  if (v === null) return null;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
  return m ? Number(m[1]) : null;
}
/** 解析 flex 简写为 {grow,shrink,basis}（缺省按 CSS 规范：0 1 auto）。 */
function cssFlex(rule) {
  const v = cssDecl(rule, 'flex');
  if (v === null) return { grow: 0, shrink: 1, basis: 'auto', raw: null };
  if (v === 'none') return { grow: 0, shrink: 0, basis: 'auto', raw: v };
  if (v === 'auto') return { grow: 1, shrink: 1, basis: 'auto', raw: v };
  const p = v.split(/\s+/);
  // `flex:1 1 0` 的 basis 是裸 `0`（= 0px）——归一化，否则"是否 0 基"的判断会因写法不同而飘
  const rawBasis = p[2] === undefined ? '0px' : p[2];
  const basis = /^0(px)?$/.test(rawBasis) ? '0px' : rawBasis;
  return {
    grow: Number(p[0]),
    shrink: p[1] === undefined ? 1 : Number(p[1]),
    basis: basis,
    raw: v,
  };
}

/**
 * 计算模型行的宽度预算（**纯函数**：喂 CSS 文本即可，便于内存变异自证）。
 * @param {string} stylesSrc 已解码的 src/client/styles.js 源码
 */
function modelRowBudget(stylesSrc) {
  const rowRule = cssRule(stylesSrc, '.dsh-plg-row');
  if (rowRule === null) return { ok: false, reason: '缺 .dsh-plg-row 规则' };
  if (/flex-wrap\s*:/.test(rowRule)) {
    return { ok: false, reason: '.dsh-plg-row 出现了 flex-wrap ⇒ 本预算的"单行"前提不成立' };
  }
  const gap = cssPx(rowRule, 'gap');
  if (gap === null) return { ok: false, reason: '.dsh-plg-row 的 gap 不是 px（无法算间隙预算）' };
  const baseSelect = cssRule(stylesSrc, '.dsh-plg-select');
  const baseMin = cssPx(baseSelect, 'min-width');
  const items = [];
  for (const spec of MODEL_ROW_FIXED_ITEMS) {
    const rule = cssRule(stylesSrc, spec.selector);
    if (rule === null) return { ok: false, reason: '缺规则 ' + spec.selector };
    const flex = cssFlex(rule);
    const ownMin = cssPx(rule, 'min-width');
    // 专属规则未写 min-width 时会**继承**基规则 .dsh-plg-select 的 min-width（CSS 级联事实）
    const minW = ownMin !== null ? ownMin : (spec.selector.indexOf('.dsh-plg-select-') === 0 ? baseMin : null);
    const width = cssPx(rule, 'width');
    // 不可压缩（shrink:0）时宽度的**实际下限** = max(min-width, width)
    const widthFloor = flex.shrink === 0 && width !== null ? width : null;
    const candidates = [minW, widthFloor].filter((x) => x !== null && x !== undefined);
    if (candidates.length === 0) return { ok: false, reason: spec.selector + ' 既无 min-width 也无可继承的基规则下限' };
    items.push({
      id: spec.id, selector: spec.selector, floor: Math.max.apply(null, candidates),
      minW: minW, width: width, flex: flex, why: spec.why,
    });
  }
  const iconRule = cssRule(stylesSrc, MODEL_ROW_ICON_SELECTOR);
  if (iconRule === null) return { ok: false, reason: '缺规则 ' + MODEL_ROW_ICON_SELECTOR };
  const iconRowBtn = cssRule(stylesSrc, '.dsh-plg-row > .dsh-plg-btn');
  const iconMin = cssPx(iconRule, 'min-width');
  const iconFlex = cssFlex(iconRowBtn);
  if (iconMin === null) return { ok: false, reason: '图标按钮无 px min-width（宽度不可算）' };
  if (iconFlex.shrink !== 0) return { ok: false, reason: '行内按钮须 flex:none（可压缩 ⇒ 图标会被裁）' };
  const icons = { count: MODEL_ROW_ICON_COUNT, each: iconMin, floor: MODEL_ROW_ICON_COUNT * iconMin, flex: iconFlex };
  // 弹性项 = 模型名选择器
  const modelRule = cssRule(stylesSrc, '.dsh-plg-select-model');
  if (modelRule === null) return { ok: false, reason: '缺规则 .dsh-plg-select-model' };
  const modelFlex = cssFlex(modelRule);
  const modelOwnMin = cssPx(modelRule, 'min-width');
  const modelFloor = modelOwnMin !== null ? modelOwnMin : baseMin;
  if (modelFloor === null) return { ok: false, reason: '模型名选择器无下限' };
  // 子项数（**最坏态**：失效徽标在位 + 思考开关/等级在位）
  const childMax = items.length + 1 /* 模型名选择器 */ + icons.count + 1 /* 失效徽标（条件渲染） */;
  const fixedSum = items.reduce((a, x) => a + x.floor, 0) + icons.floor
    + gap * (childMax - 1) + MODEL_ROW_BADGE_BOUND_PX;
  return {
    ok: true, items: items, icons: icons, gap: gap, childMax: childMax,
    fixedSum: fixedSum, modelFloor: modelFloor, modelFlex: modelFlex,
    elastic: MODEL_ROW_AVAILABLE_PX - fixedSum,
  };
}

test('GEOLOCK-B1 模型行 = 单行 flex + gap 可算（"合计 ≤ 可用宽"的前提）', () => {
  const styles = decodeChunk('src/client/styles.js');
  const rowRule = cssRule(styles, '.dsh-plg-row');
  assert.ok(rowRule !== null, '前置：styles.js 须有 .dsh-plg-row 规则');
  assert.ok(/display:\s*flex/.test(rowRule), '模型行须是 flex 容器');
  assert.equal(/flex-wrap\s*:/.test(rowRule), false,
    '⛔ .dsh-plg-row 不得出现 flex-wrap —— 一旦换行，"固定宽合计 ≤ 可用宽"就不再是单行约束'
    + '（换行会把横向溢出变成"看不出来的第二行"，而历史形态正是横向溢出裁切）');
  const gap = cssPx(rowRule, 'gap');
  assert.ok(gap !== null && gap > 0, '间隙须是 px 且 > 0（否则预算少算 N 段间隙）；实得 ' + cssDecl(rowRule, 'gap'));
});

test('GEOLOCK-B2 固定宽项逐项列出，且「固定合计 + 模型名下限」≤ 真机可用宽', () => {
  const styles = decodeChunk('src/client/styles.js');
  const b = modelRowBudget(styles);
  assert.ok(b.ok, '预算须可算：' + b.reason);
  const listing = b.items.map((x) => x.id + '=' + x.floor).join(' · ');
  assert.equal(b.items.length, 4, '固定宽项须恰为 4 项（thinking / level / provider / num）；实得 ' + b.items.length);
  for (const need of ['thinking', 'level', 'provider', 'num']) {
    assert.ok(b.items.some((x) => x.id === need), '固定宽项清单缺 ' + need);
  }
  assert.ok(b.icons.floor > 0, '图标组固定宽须 > 0');
  // ① 固定合计（含图标组、间隙、失效徽标上界）本身不得越过可用宽
  assert.ok(b.fixedSum <= MODEL_ROW_AVAILABLE_PX,
    '固定宽合计 ' + b.fixedSum + 'px 已超真机可用宽 ' + MODEL_ROW_AVAILABLE_PX + 'px（' + listing
    + ' + 图标组 ' + b.icons.count + 'x' + b.icons.each + '=' + b.icons.floor
    + ' + 间隙 ' + b.gap + 'x' + (b.childMax - 1) + ' + 失效徽标上界 ' + MODEL_ROW_BADGE_BOUND_PX + '）');
  // ② 更要紧的一条：把**弹性项自己的下限**也算进去后仍不得越界（否则最压缩态照样溢出）
  assert.ok(b.fixedSum + b.modelFloor <= MODEL_ROW_AVAILABLE_PX,
    '固定合计 ' + b.fixedSum + ' + 模型名下限 ' + b.modelFloor + ' = ' + (b.fixedSum + b.modelFloor)
    + 'px > ' + MODEL_ROW_AVAILABLE_PX + 'px（最压缩态仍溢出）');
});

test('GEOLOCK-B3 模型名选择器是行内**唯一弹性项**（它吃掉全部剩余空间）', () => {
  const styles = decodeChunk('src/client/styles.js');
  const b = modelRowBudget(styles);
  assert.ok(b.ok, '预算须可算：' + b.reason);
  // ① 弹性项 = flex-grow ≥ 1 且 basis 为 0（剩余空间全给它，不是按内容宽参与分配）
  assert.ok(b.modelFlex.grow >= 1, '模型名选择器须 flex-grow ≥ 1（唯一弹性项）；实得 flex:' + b.modelFlex.raw);
  assert.equal(b.modelFlex.basis, '0px', '模型名选择器须 flex-basis 0（吃掉全部剩余空间）；实得 flex:' + b.modelFlex.raw);
  // ② 其余行内项一律不得 grow（多一个弹性项 ⇒ 剩余空间被分走，模型名不再吃满）
  const growers = b.items.filter((x) => x.flex.grow > 0).map((x) => x.id);
  assert.deepEqual(growers, [], '除模型名选择器外，行内不得有其它 grow 项；实得 ' + JSON.stringify(growers));
  assert.equal(b.icons.flex.grow, 0, '图标组不得 grow（须 flex:none）');
  // ③ 因果落点：留给弹性项的空间必须**不小于它的可读下限**
  assert.ok(b.elastic >= b.modelFloor,
    '留给模型名选择器的剩余空间 ' + b.elastic + 'px < 其下限 ' + b.modelFloor + 'px'
    + '（= 上一批修复的因果反向：弹性项被压到下限以下 ⇒ 名称被裁）');
});

test('GEOLOCK-B4 行内子项清单 = 本预算的分母（多出/少一项都会让预算失真）', async () => {
  const row = await codeOf('src/client/components/fallback-row.js');
  // 图标组：4 个（⛓ ↑ ↓ ✕）
  const icons = (row.match(/dsh-plg-btn dsh-plg-btn-icononly/g) || []).length;
  assert.equal(icons, MODEL_ROW_ICON_COUNT,
    '行内图标按钮个数须为 ' + MODEL_ROW_ICON_COUNT + '（预算按此算图标组宽）；实得 ' + icons);
  // 四个选择器各一个（品种在，且没多塞第二个同类控件）
  for (const cls of ['dsh-plg-select-provider', 'dsh-plg-select-model', 'dsh-plg-select-thinking', 'dsh-plg-select-level']) {
    const n = (row.match(new RegExp(cls, 'g')) || []).length;
    assert.equal(n, 1, '行内 ' + cls + ' 须恰 1 处；实得 ' + n);
  }
  // ⚠ 行内选择器**不得**再带 ms-fill / ms-content（这两类会覆盖 flex 简写，
  //   把上面对 flex 的读取变成假读数 ⇒ 预算数字不再代表真实占位）
  assert.equal(/dsh-plg-ms-(fill|content)/.test(row), false,
    '⛔ 行内选择器不得带 dsh-plg-ms-fill / dsh-plg-ms-content（会覆盖 flex ⇒ 预算失真）');
  // 失效徽标（预算里那 20px 上界的对象）必须在位——它若被删，B2 的上界就该同步下调。
  //   ⚠ 2026-10-19（清债批 D-2）：该节点原先挂的 `dsh-plg-badge-invalid` 是**孤儿类**
  //     （styles.js 解码全文零规则）⇒ 类名已换成既有 `.dsh-plg-upd-outdated`（告警色），
  //     **节点本身与 `⚠` 字形、title 一字未动**。本断言据此改判**节点在不在**（沿用"失效徽标在位"
  //     这一语义），⛔ 不再绑定那个已退役的类名——否则锁会把"删孤儿类"判成"删了徽标"（假红）。
  assert.equal((row.match(/className: 'dsh-plg-upd-outdated', title: t\('cfgRowInvalid'\)/g) || []).length, 1,
    '前置：失效徽标节点须仍在位（预算为它留了 20px 上界）');
});

test('GEOLOCK-B5 真机可用宽只以**具名常量**出现一次（⛔ 不许散落魔数）+ 来源与装置互算', async () => {
  const fs = require('node:fs');
  const self = fs.readFileSync(__filename, 'utf8');
  // ① 剥注释后统计该**数字字面量**的出现次数（注释里引用来源不算"散落"）。
  //   ⚠ 正则用常量**动态拼**，不在本文件里再写一遍数字 —— 否则这条自检会把自己的判据算成散落点。
  const { codeOnly } = await import('../scripts/lib/code-only.mjs');
  const codeText = codeOnly(self);
  const literalRe = new RegExp('(?<![0-9.])' + MODEL_ROW_AVAILABLE_PX + '(?![0-9.])', 'g');
  const hits = (codeText.match(literalRe) || []).length;
  assert.equal(hits, 1,
    '该数字在**代码面**须恰出现 1 次（= MODEL_ROW_AVAILABLE_PX 的定义处）；实得 ' + hits);
  // ② 产品源码里**一次都不许有**（它是宿主给的边界，不是插件可以自行断言的像素值）
  const { listChunkFiles } = require('../scripts/lib/chunk-decode.mjs');
  const productHits = [];
  for (const rel of listChunkFiles(ROOT)) {
    if ((codeOnly(decodeChunk(rel)).match(literalRe) || []).length > 0) productHits.push(rel);
  }
  assert.deepEqual(productHits, [],
    '⛔ 产品源码的**代码面**不得出现该数字（散落魔数）；命中 ' + JSON.stringify(productHits)
    + '｜判据范围 = src/client/** + src/host/** 全部 chunk 的剥注释代码面（不含注释文本）');
  // ② 与量测装置**互算**（不是把 534 再抄一遍）：装置的注释写明 row1 = root - 30、root 564 → row1 534
  const driver = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'settings-layout-driver.mjs'), 'utf8');
  const chain = /row1 = root - (\d+)/.exec(driver);
  assert.ok(chain, '装置须仍写明 row1 = root - N 的偏移链');
  const pair = /root (\d+) → row1 (\d+)/.exec(driver);
  assert.ok(pair, '装置注释须仍写明 root → row1 的实测值对');
  assert.equal(Number(pair[1]) - Number(chain[1]), Number(pair[2]), '装置的 root - 偏移须等于其 row1 读数');
  assert.equal(MODEL_ROW_AVAILABLE_PX, Number(pair[2]),
    '具名常量须等于装置注释里那条实测链的 row1 读数；实得 ' + MODEL_ROW_AVAILABLE_PX + ' vs ' + pair[2]);
  // ③ 来源注释必须写明三条实测依据（缺一条就等于"来源不明"）。
  //   ⚠ 锚串里那段数字由常量拼入（避免本文件把该数字再写第二遍 ⇒ 上面的"只出现一次"自检才有意义）
  const head = self.slice(0, self.indexOf('const MODEL_ROW_AVAILABLE_PX'));
  const N = String(MODEL_ROW_AVAILABLE_PX);
  for (const anchor of ['CHG-196', 'settings-layout-driver.mjs:191', '586 vs clientWidth ' + N]) {
    assert.ok(head.indexOf(anchor) >= 0, '来源注释缺依据锚：' + anchor);
  }
});

test('GEOLOCK-B-V 变异自证：provider 下限回 104 ⇒ B2/B3 必红（锁 B 有牙）+ 历史形态复算 + 负控', () => {
  const styles = decodeChunk('src/client/styles.js');
  const current = modelRowBudget(styles);
  assert.ok(current.ok, '前置：当前树预算须可算：' + current.reason);
  const provider = current.items.find((x) => x.id === 'provider');
  assert.equal(provider.floor, 80, '前置：当前 provider 下限须为 80px（上一批让出的值）；实得 ' + provider.floor);

  // ⭐ 变异②（作业书判据 A 的第二条）：provider 的 min-width 由 80 调回**上一次的溢出配置** 104
  //   —— 逐字来自 ed96df2^ 的 .dsh-plg-select-provider{…min-width:104px…}。
  const mutated = styles.replace(
    "'.dsh-plg-select-provider{flex:0 1 136px;min-width:80px;max-width:176px}'",
    "'.dsh-plg-select-provider{flex:0 1 136px;min-width:104px;max-width:176px}'");
  assert.notEqual(mutated, styles, '前置：变异②锚点须命中（provider 的 min-width 声明）');
  const after = modelRowBudget(mutated);
  assert.ok(after.ok, '前置：变异后预算仍须可算');
  assert.equal(after.items.find((x) => x.id === 'provider').floor, 104, '前置：变异后 provider 下限应为 104');
  // ⇒ B2 第二段（含弹性项下限的那条）必红。
  //   ⚠ 如实声明**哪一段**会红：仅把 provider 下限调回 104（+24px）时，**第一段**
  //   （"固定宽合计本身" 396→420 ≤ 534）仍为真 ⇒ 本变异打红的是 B2 的**第二段**与 B3。
  //   ⛔ 不写成"两段都红"，那是把判据读数说错（本仓方法学：读数与事实必须同向）。
  assert.equal(after.fixedSum <= MODEL_ROW_AVAILABLE_PX, true,
    '变异②后固定合计 ' + after.fixedSum + ' 仍未越界（如实记录：本变异打红的是含弹性项下限的那一段）');
  assert.equal(after.fixedSum + after.modelFloor <= MODEL_ROW_AVAILABLE_PX, false,
    '变异②后 GEOLOCK-B2 第二段必红：' + (after.fixedSum + after.modelFloor) + ' > ' + MODEL_ROW_AVAILABLE_PX);
  // ⇒ B3 的因果断言也必红（弹性项被压到下限以下）
  assert.equal(after.elastic >= after.modelFloor, false,
    '变异②后 GEOLOCK-B3 第三段必红：剩余 ' + after.elastic + ' < 下限 ' + after.modelFloor);

  // ⭐ 历史形态复算（ed96df2^ 的四条 CSS，逐字）：thinking 59（无 min-width ⇒ 继承基规则 96）
  //   + provider 104 + model 120 + level 72（无 min-width ⇒ 继承 96）⇒ 合计应显著越过可用宽
  const hist = styles
    .replace("'.dsh-plg-select-provider{flex:0 1 136px;min-width:80px;max-width:176px}'",
      "'.dsh-plg-select-provider{flex:0 1 136px;min-width:104px;max-width:176px}'")
    .replace("'.dsh-plg-select-thinking{flex:0 0 auto;width:56px;min-width:56px}'",
      "'.dsh-plg-select-thinking{flex:0 0 auto;width:59px}'")
    .replace("'.dsh-plg-select-level{flex:0 0 auto;width:62px;min-width:62px}'",
      "'.dsh-plg-select-level{flex:0 0 auto;width:72px}'")
    .replace("'.dsh-plg-select-model{flex:1 1 0;min-width:135px}'",
      "'.dsh-plg-select-model{flex:1 1 0;min-width:120px}'");
  const h = modelRowBudget(hist);
  assert.ok(h.ok, '前置：历史形态须仍可算：' + h.reason);
  assert.ok(h.fixedSum + h.modelFloor > MODEL_ROW_AVAILABLE_PX,
    '历史形态（上一批修复前）应越过可用宽；实得 ' + (h.fixedSum + h.modelFloor));

  // ⭐⭐ **标定**（本锁最关键的一条自证）：历史形态下"全部子项下限之和 + 8 段间隙"
  //   必须**逐数等于**当年真机实测的 scrollWidth 586 —— 这证明本模型的算术与
  //   像素面是同一回事，而不是一套"看起来合理"的数字。
  //   ⚠ 为何是 8 段间隙：该形态下失效徽标不在位（正常数据）⇒ 子项 = 序号 + 4 选择器 +
  //     4 图标 = 9 个 ⇒ 间隙 8 段。带徽标的最坏态另算（见 B2 的 20px 上界）。
  const rawSum = (b) => b.items.reduce((a, x) => a + x.floor, 0) + b.modelFloor
    + b.icons.floor + b.gap * 8;
  assert.equal(rawSum(h), 586,
    '历史形态的子项下限之和须等于实测 scrollWidth 586（模型标定）；实得 ' + rawSum(h));
  // 同一算式在**当前树**上必须收敛到可用宽以内（= 溢出真的没了，不是被统计口径藏起来）
  assert.ok(rawSum(current) <= MODEL_ROW_AVAILABLE_PX,
    '当前树的同一算式须 ≤ 可用宽；实得 ' + rawSum(current));

  // 负控：不动任何文件 ⇒ 当前读数干净（防"恒红"）
  assert.ok(current.fixedSum + current.modelFloor <= MODEL_ROW_AVAILABLE_PX,
    '负控：当前树 ' + (current.fixedSum + current.modelFloor) + ' <= ' + MODEL_ROW_AVAILABLE_PX);
});
