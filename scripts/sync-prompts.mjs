#!/usr/bin/env node
// ============================================================================
// dsh-prompt-enhancer · prompts 同步脚本
// 把 prompts/*.md（提示词事实源）生成内联到 plugin-host.js 的生成标记区。
//
// 为什么这样做（v2.4.6 设计决策）：
//  - host 半部经 lib/index.cjs 以 new Function('harness', BODY) 执行，动态安装
//    （cordis_define）同样在无 require/fs 的作用域内运行——「运行时读外部文件」
//    在两种安装形态下都不可靠，因此采用「构建时同步」：md 为事实源，脚本生成
//    内联常量，plugin-host.js 保持单文件自包含（动态/静态安装均不受影响）。
//  - 用户可直接编辑 prompts/*.md 后重跑本脚本（node scripts/sync-prompts.mjs），
//    改动随下一次插件发布生效（动插件须重启 GUI）。
//
// 用法: node scripts/sync-prompts.mjs [--check]
//   --check  仅校验生成区与 md 是否一致（不一致退出码 1），不写文件（CI/单测用）
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 状态出口契约（P5）：本环「一致 / 漂移」两态由本环自己声明，gate.mjs 不再从措辞里反推。
import { emitRingState, installCrashGuard } from './lib/ring-state.mjs';

installCrashGuard('prompts');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '..');
// M1 退役后 app.js 为 bundle 骨架源（build-host.mjs 从它生成 plugin-host.js），
// prompts 生成区位于骨架内——同步目标改为 app.js，避免被 build 覆盖。
const HOST = path.join(ROOT, 'src', 'host', 'app.js');
const BEGIN = '// ==PROMPTS-BEGIN==';
const END = '// ==PROMPTS-END==';

// v3.2.23（用户需求·提示词集合化）：事实源从平铺 prompts/ 迁移到提示词包 prompts/enhance/——
// P1-d（2026-10-13 去技能化改名）：根目录 skills/enhance/ ⇒ prompts/enhance/，包级 SKILL.md ⇒ PACKAGE.md（正文零改动）。
// 常量名映射保持兼容（SYSTEM_PROMPT 等不变，供 enhance-handlers/pure 引用不改名）。
const SKILL_ROOT = 'prompts/enhance';
const NAME_MAP = {
  'base/system.md': 'SYSTEM_PROMPT',
  'base/increment.md': 'SYSTEM_INCREMENT_PROMPT',
  'lite/system.md': 'SYSTEM_LITE_PROMPT',
  'lite/increment.md': 'SYSTEM_INCREMENT_LITE_PROMPT',
  'standard/system.md': 'SYSTEM_STANDARD_PROMPT',
  'standard/increment.md': 'SYSTEM_INCREMENT_STANDARD_PROMPT',
  'smart/system.md': 'SYSTEM_SMART_PROMPT',
  'smart/increment.md': 'SYSTEM_INCREMENT_SMART_PROMPT',
  'publish/system.md': 'SYSTEM_PUBLISH_PROMPT',
  'publish/increment.md': 'SYSTEM_INCREMENT_PUBLISH_PROMPT',
  'retrieval/relevance.md': 'RELEVANCE_PROMPT',
  // v3.2.24（规则落点 L2）：参考使用规则独立技能文件——retrieve 命中参考块才条件注入（原在 discipline 内无条件）
  'retrieval/reference-guide.md': 'REFERENCE_GUIDE',
  'retrieval/intent.md': 'DEV_INTENT_PROMPT',
  'retrieval/doc-analysis.md': 'DOC_ANALYSIS_PROMPT',
  'retrieval/websearch.md': 'WEBSEARCH_PLAN_PROMPT',
  'assemble/task-analysis.md': 'TASK_ANALYSIS_PROMPT',
  'assemble/continue.md': 'CONTINUE_PROMPT',
  'assemble/smart.md': 'SMART_TAIL_PROMPT',
  'discipline.md': 'DISCIPLINE_PROMPT',
};

// 自动发现：扫描提示词包内全部 .md（排除包级/模式级 PACKAGE.md），按相对路径查 NAME_MAP 得常量名；
// 缺失映射直接报错（新增技能文件必须登记），保序按 NAME_MAP 声明顺序。
function discoverSources() {
  const found = [];
  const walk = (dir, prefix) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix + ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, rel + '/');
      else if (ent.name.endsWith('.md') && ent.name !== 'PACKAGE.md') {
        if (!NAME_MAP[rel]) throw new Error('提示词文件未在 NAME_MAP 登记: ' + rel);
        found.push(rel);
      }
    }
  };
  walk(path.join(ROOT, SKILL_ROOT), '');
  const byRel = new Map(found.map((rel) => [rel, { md: path.join(SKILL_ROOT, rel), name: NAME_MAP[rel], rel }]));
  return Object.keys(NAME_MAP).map((rel) => byRel.get(rel)).filter(Boolean);
}
const SOURCES = discoverSources();

// —— v3.2.23 元数据：解析 PACKAGE.md frontmatter（YAML 子集：顶层 key / 嵌套对象 / JSON 值）——
function parseFrontmatter(relPath) {
  const raw = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return null;
  const data = {};
  const stack = [data];
  let prevIndent = -1;
  for (const ln of m[1].split(/\r?\n/)) {
    if (ln.trim() === '' || ln.trim().startsWith('#')) continue;
    const indent = (ln.match(/^\s*/)[0] || '').length;
    // 子块缩进更深时入栈；回到同级/父级缩进时弹出（仅当新行缩进 < 前一行缩进）
    while (stack.length > 1 && indent < prevIndent) stack.pop();
    const kv = /^([A-Za-z0-9_]+):(?:\s*(.*))?$/.exec(ln.trim());
    if (!kv) continue;
    const val = kv[2] === undefined ? '' : kv[2].trim();
    const parent = stack[stack.length - 1];
    if (val === '') {
      parent[kv[1]] = {};
      stack.push(parent[kv[1]]);
    } else {
      parent[kv[1]] = tryJson(val);
    }
    prevIndent = indent;
  }
  return data;
}
function tryJson(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^[\[{]/.test(v)) { try { return JSON.parse(v); } catch (e) { return v; } }
  return v;
}

// 生成 SKILL_MANIFEST（templates 直接引用同作用域常量）与 SKILL_RETRIEVE_BUDGETS（包级预算表）
// ⚠ 常量名保留 SKILL_* 前缀（P1-d S2 裁定：改名会波及 enhance-handlers.js 的 5 处**逻辑**引用，
//   而该文件本批仅授权改注释 ⇒ 改名面 > 收益，保留原名）。
function buildSkillManifest() {
  const pkg = parseFrontmatter(SKILL_ROOT + '/PACKAGE.md') || {};
  const modes = Array.isArray(pkg.modes) ? pkg.modes : [];
  const lines = ['// v3.2.23（提示词集合化）：SKILL_MANIFEST 由 ' + SKILL_ROOT + '/*/PACKAGE.md frontmatter 生成',
    'const SKILL_MANIFEST = {'];
  for (const mode of modes) {
    const fm = parseFrontmatter(SKILL_ROOT + '/' + mode + '/PACKAGE.md');
    if (!fm) throw new Error(mode + '/PACKAGE.md 缺 frontmatter');
    const t1 = NAME_MAP[mode + '/system.md'];
    const t2 = NAME_MAP[mode + '/increment.md'];
    lines.push('  ' + JSON.stringify(mode) + ': { name: ' + JSON.stringify(fm.name || 'enhance-' + mode) +
      ', mode: ' + JSON.stringify(mode) +
      ', templates: { t1: ' + t1 + ', t2: ' + t2 + ' }' +
      ', retrieve: ' + JSON.stringify(fm.retrieve || { kind: 'none', windows: [] }) +
      // v3.2.24（规则落点 L2/L3）：可选参考源 + 场景触发规则声明（模型按需引入）
      ', sources: ' + JSON.stringify(fm.sources || []) +
      ', rules: ' + JSON.stringify(fm.rules || []) + ' },');
  }
  lines.push('};');
  const budgets = (pkg.retrieve && Array.isArray(pkg.retrieve.budgets)) ? pkg.retrieve.budgets : [];
  lines.push('const SKILL_RETRIEVE_BUDGETS = ' + JSON.stringify(budgets) + ';');
  return lines.join('\n');
}

// md 行 → JS 字符串数组元素（转义反斜杠与单引号；行尾空行 trim 掉）
function linesToArray(lines) {
  const arr = [];
  for (const ln of lines) {
    const s = ln.replace(/\r$/, '');
    if (s.trim() === '') { arr.push(''); continue; }
    arr.push(s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  }
  return arr;
}

function buildSection() {
  const blocks = [];
  for (const src of SOURCES) {
    const raw = fs.readFileSync(path.join(ROOT, src.md), 'utf8');
    const lines = raw.split('\n');
    // 去掉文件末尾多余空行（保持 join('\n') 语义与手写版一致）
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length === 0) throw new Error(src.md + ' is empty');
    const elems = linesToArray(lines);
    const body = elems.map((e) => '  ' + (e === '' ? "''" : "'" + e + "'")).join(',\n');
    blocks.push('const ' + src.name + ' = [\n' + body + ',\n].join(\'\\n\');');
  }
  blocks.push(buildSkillManifest());
  return blocks.join('\n\n');
}

const header = [
  BEGIN + '  (generated by scripts/sync-prompts.mjs from prompts/*.md — do not edit here; edit prompts/*.md then rerun)',
  '',
].join('\n');
const footer = END;

// app.js 是 JSON 字符串模块（module.exports = "<转义后的整个 body>"）：生成区文本
// 必须按 JSON 字符串转义形式写入，否则真实换行/引号会破坏字符串字面量。
function escapeForJsonString(text) {
  return JSON.stringify(text).slice(1, -1);
}

const hostSrc = fs.readFileSync(HOST, 'utf8');
// 精确定位生成区：BEGIN 标记带 "(generated by scripts/sync-prompts.mjs" 后缀，
// 与骨架头注释里「plugin-host.js 中 ==PROMPTS-BEGIN== / ==PROMPTS-END== 标记区」
// 的字样区分开（indexOf 裸标记会命中头注释导致替换错位）。
const genBegin = '// ==PROMPTS-BEGIN==  (generated by scripts/sync-prompts.mjs';
const endMarker = '// ==PROMPTS-END==';
const segStart = hostSrc.indexOf(genBegin);
const segEndIdx = hostSrc.indexOf(endMarker, segStart === -1 ? 0 : segStart);
if (segStart === -1 || segEndIdx === -1) {
  emitRingState('prompts', 'FAIL', 'src/host/app.js 缺少生成标记区（' + BEGIN + ' / ' + END + '）——无法判定漂移');
  console.error('✗ src/host/app.js 缺少生成标记区（' + BEGIN + ' / ' + END + '），请先手工建立');
  process.exit(2);
}
const segEnd = segEndIdx + endMarker.length;
const generated = header + buildSection() + '\n' + footer;
const updated = hostSrc.slice(0, segStart) + escapeForJsonString(generated) + hostSrc.slice(segEnd);

// ── 产物面判据（② · 2026-10-16 门禁缺口批）─────────────────────────────────────
// 病：本环旧口径只比 «md ↔ src/host/app.js 生成区»。若有人跑了 sync-prompts 但**漏跑 build-host**
//   （或产物被手改/陈旧），本环判绿，而 plugin-host.js —— **真正被装载的产物** —— 里仍是旧提示词：
//   提示词改动从未进产物，门禁却全绿（「会掩盖问题」级）。
// 判据：**--check** 时，产物内**同一生成区**（同 BEGIN 锚 + 同 END 锚）必须与刚算出的 generated 逐字相同。
//   产物缺位 / 找不到标记区 / 区域不一致 ⇒ 判红（fail-closed，不猜「大概没过时」）。
// ⚠ 作用域：本判据只进 `--check`（门禁环）。**写调用**（无旗标）语义不变——它只负责「md → app.js」，
//   产物由 build-host 重生产物；写路径不新增失败面（否则单纯的 sync 会被产物陈旧连带判死，
//   那会把「同步」变成「必须一次跑完两步」，超出本环职责）。写路径也不再假报 PASS（见文末）。
const PRODUCT = path.join(ROOT, 'plugin-host.js');
const IS_CHECK = process.argv.includes('--check');
function productRegion(src) {
  const a = src.indexOf(genBegin);
  if (a === -1) return null;
  const b = src.indexOf(endMarker, a);
  if (b === -1) return null;
  return src.slice(a, b + endMarker.length);
}
let productSrc = null;
try { productSrc = fs.readFileSync(PRODUCT, 'utf8'); } catch { /* 缺位 → 下面按不一致判 */ }
const productRegionText = productSrc === null ? null : productRegion(productSrc);
const inProduct = productRegionText === generated;
/** 产物面不一致的**归因**（三种形态分开说，读者才知道该跑哪一步） */
const productWhy = productSrc === null
  ? '产物 plugin-host.js 缺位（无法取证）'
  : (productRegionText === null
    ? '产物 plugin-host.js 内找不到生成标记区（' + BEGIN + ' / ' + END + '）'
    : '产物 plugin-host.js 内生成区 ≠ 该 md 源应有的生成区（跑了 sync-prompts 但漏跑 build-host，或产物陈旧/被手改）');

if (updated === hostSrc) {
  if (!IS_CHECK) {
    // 写调用 + 无需写：md 与 app.js 生成区已一致。**不记 PASS**（本次是写调用，产物面未判）——
    // 旧文案在此处打印「prompts 与 plugin-host.js 生成区一致」并记 PASS，正是缺陷②的假绿措辞来源。
    console.log('✓ 生成区无需同步（md 与 src/host/app.js 生成区已一致）');
    emitRingState('prompts', 'SKIP', '本次为同步（写）调用且无需写入：md 与生成区已一致，未判产物漂移');
    process.exit(0);
  }
  if (inProduct) {
    console.log('✓ prompts 与 plugin-host.js 生成区一致');
    emitRingState('prompts', 'PASS', '生成区与 ' + SKILL_ROOT + ' 下的 md 源逐字一致（' + SOURCES.length + ' 个常量，零漂移）｜产物面同源逐字一致');
    process.exit(0);
  }
  emitRingState('prompts', 'FAIL', '产物未同步：' + productWhy);
  console.error('✗ 产物未同步：src/host/app.js 生成区与 md 一致，但' + productWhy);
  console.error('  修复：node scripts/build-host.mjs（据 src/host 重生产物）后重跑本检查。');
  process.exit(1);
}
if (IS_CHECK) {
  emitRingState('prompts', 'FAIL', '生成区漂移：' + SKILL_ROOT + ' 下的 md 源与 src/host/app.js 生成区不一致');
  console.error('✗ 生成区漂移：prompts/*.md 与 src/host/app.js 生成区不一致。');
  console.error('  修复：node scripts/sync-prompts.mjs && node scripts/build-host.mjs（两步都要跑——只跑前者不会更新产物）');
  process.exit(1);
}
fs.writeFileSync(HOST, updated, 'utf8');
console.log('✓ src/host/app.js 生成区已同步（' + SOURCES.map((s) => s.name).join('/') + '）');
// ⚠ 措辞订正（② · 2026-10-16）：旧文案说「plugin-host.js 生成区已同步」——**不实**：本脚本只写
//   src/host/app.js，产物要靠 build-host 重建。提示词改动要生效必须**两步都跑**，此处如实说明。
if (inProduct) {
  console.log('  产物 plugin-host.js 的生成区已是同源内容（本次写入未使其过期）。');
} else {
  console.log('  ⚠ 产物 plugin-host.js 的生成区**尚未同步**（本脚本不写产物）——须再跑 node scripts/build-host.mjs。');
}
// 本次是**同步（写）**调用：漂移被修掉了，但「修之前是否一致」这一判定并未作出——不记 PASS。
emitRingState('prompts', 'SKIP', '本次为同步（写）调用：已写入生成区 ' + SOURCES.length + ' 个常量，未判漂移'
  + (inProduct ? '' : '（产物面已同步=false，须补跑 build-host）'));
