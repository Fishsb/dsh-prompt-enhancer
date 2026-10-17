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
  const inp = s.match(/style: \{ flex: '1 1 0', minWidth: '120px'([^}]*) \},/);
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
  const mutated = s.replace("style: { flex: '1 1 0', minWidth: '120px', boxSizing: 'border-box' }", "style: { flex: '1 1 0', minWidth: '120px' }");
  assert.notEqual(mutated, s, '前置：变异锚点须命中');
  const inp = mutated.match(/style: \{ flex: '1 1 0', minWidth: '120px'([^}]*) \},/);
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
