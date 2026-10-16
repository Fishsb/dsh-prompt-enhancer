// Build root plugin-host.js from modular host source.
// The bundle skeleton (src/host/app.js) carries all injection markers; every
// chunk (pure/diagnostics/models/enhance-handlers) is injected
// below, producing the single self-contained artifact required for dynamic
// Cordis install.
// ⚠ P2-0（2026-10-13）注释订正：本清单同步为实际 4 个 chunk（`plugins.js`/`update.js` 已于 P1-c 删除）。
//
// v3.2.1-t（架构调整·版本单一事实源 + 漂移检测）：
//   ① 版本单一事实源 = `package.json`，由**运行时**取得：`lib/harness.cjs` 的
//      `readPluginVersion()` 直读运行环境 `package.json`（读失败返回空串）。
//      ⚠ 口径订正（门禁缺口批 2 · 2026-10-16 · F2，据实读定位）：下文第 56–58 行的
//      `__DASH_PLUGIN_VERSION__` 占位符替换**当前为空转** —— 该占位符在 `src/host/**`
//      与产物 `plugin-host.js` 中命中数均为 **0**（`PLUGIN_VERSION` 在产物内的 3 处
//      全为历史注释），故**产物内不含版本字面量**，构建期**并未**注入版本。
//      ⚠ 不得以「产物内能否 grep 到版本号」作版本判据；`--check` 的成功行**也不构成**
//      「版本已注入」的证据（它只证明「源码 ↔ 产物逐字一致」）。
//      保留该替换语句本身是为守住既有 --check 语义（不属本批权限，见报告 §F2）。
//   ② --check 模式：重建到内存，与磁盘现有产物对比——漂移（源码改了没重建，
//      或产物被手改）即报错退出 1。供 sync-runtime / release / pre-commit 使用。
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function buildHost() {
  // The bundle skeleton (the assembled plugin body with all injection markers)
  // lives in src/host/app.js; every chunk is injected below.
  let body = require('../src/host/app.js');

  // Normalize line endings BEFORE marker matching (see build-client.mjs).
  body = body.replace(/\r\n/g, '\n');
  const pureChunk = require('../src/host/pure.js');
  const diagnosticsChunk = require('../src/host/diagnostics.js');
  const modelsChunk = require('../src/host/models.js');
  const enhanceChunk = require('../src/host/enhance-handlers.js');

  // Inject all chunks, looping until no marker remains (same policy as
  // build-client.mjs — nested markers get expanded on later passes).
  let composed = body;
  const injections = [
    ['// @dsh-diagnostics-inject', diagnosticsChunk],
    ['// @dsh-models-inject', modelsChunk],
    ['// @dsh-pure-inject', pureChunk],
    ['// @dsh-enhance-inject', enhanceChunk],
  ];

  // ── chunk 契约门（2026-10-17 契约面收口批 · 第 ① 件：补齐与 build-client 的**对称**）──
  // 为什么补：事故发生形态是「**契约门只存在于两半部的一半**」——`build-client.mjs:83-97`
  //   在**构建期**就拒绝非字符串 chunk，而本脚本此前**完全没有这道门**。两半部用**同一条**
  //   注入方式（`composed.replace(marker, chunk)`）、写**同一份**契约
  //   （`module.exports = "<JSON 转义源码>"`），却只有一半有门 ⇒ 该不对称本身就是缺陷。
  // 契约：每个 chunk 必须是**字符串**（`module.exports = "…"` 包裹）。裸 JS chunk 经
  //   `require` 返回**空对象** ⇒ 上面 `replace` 会把对象字符串化成 `[object Object]`
  //   写进 `plugin-host.js` ⇒ `lib/index.cjs` 的 `new Function('harness', BODY)` 求值失败
  //   ⇒ 整个 host 半部装载失败。本门在**构建期**即拒绝，并给出违规 chunk 的 marker 与实得类型。
  //
  // ⚠ 覆盖面 = **递归枚举** `src/host/**`（**不写死文件名**）⇒ 将来新增的 chunk 自动入网，
  //   与 `dead-code-gate.mjs` 的 R5/R6/R7 同一派生纪律（同 build-client 门的「取全清单」口径）。
  // ⚠ fail-closed：目录缺位 / 清单为空 / 模块载入抛错（裸 JS 在定义期引用宿主全局即抛）
  //   一律**判红**，不静默回退、不跳过。
  // ⚠ 归属口径：文件 → marker 用**模块身份**映射（同一 `require` 缓存项 ===），避免依赖文件名
  //   与 marker 的命名约定；映射不到（= 该文件未被本脚本装配）时如实标注，**不猜一个 marker**。
  const chunkDir = join(root, 'src', 'host');
  const chunkFiles = [];
  const walkChunks = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      // 与 dead-code-gate R7 同一排除口径（vendor 不属本仓契约面）
      if (ent.isDirectory()) { if (ent.name !== 'vendor') walkChunks(full); continue; }
      if (ent.name.endsWith('.js')) chunkFiles.push(full);
    }
  };
  walkChunks(chunkDir);
  const badChunks = [];
  for (const full of chunkFiles.sort()) {
    const rel = relative(root, full);
    let value;
    try {
      value = require(full);
    } catch (e) {
      // 裸 JS chunk 若在定义期就引用宿主全局会在此抛错 —— 同样属契约违反（不吞）
      badChunks.push({ rel, marker: null, type: '载入抛错 ' + String(e && e.message).slice(0, 80) });
      continue;
    }
    if (typeof value === 'string') continue;
    // marker 归属：按模块身份在既有装配清单里反查（不按文件名约定猜）
    const hit = injections.find(([, chunk]) => chunk === value);
    badChunks.push({ rel, marker: hit ? hit[0].trim() : null, type: typeof value });
  }
  if (chunkFiles.length === 0) {
    throw new Error('chunk 契约门未通过：src/host 未枚举到任何 chunk（无扫描面 ⇒ 不得判绿）');
  }
  if (badChunks.length) {
    console.error('[build-host] chunk 契约违反 —— 以下 chunk 未导出字符串：');
    for (const b of badChunks) {
      console.error('  · ' + (b.marker ? b.marker + '（' + b.rel + '）' : b.rel)
        + (b.marker ? '' : '（⚠ 未被本脚本装配 ⇒ 见门禁 R4）')
        + '  → 实得 ' + b.type);
    }
    console.error('  修复：把 chunk 源码包成 module.exports = "<JSON 转义后的源码>";');
    throw new Error('chunk 契约门未通过（' + badChunks.length + ' 个）');
  }

  let previous;
  do {
    previous = composed;
    for (const [marker, chunk] of injections) {
      if (composed.includes(marker)) {
        composed = composed.replace(marker, chunk);
      }
    }
  } while (composed !== previous);

  // Normalize line endings (see build-client.mjs): source files may carry CRLF
  // after a git checkout with core.autocrlf; committed artifacts are LF.
  composed = composed.replace(/\r\n/g, '\n');

  // ⚠ 版本占位符替换（口径订正 · F2 · 2026-10-16）：本条**当前为空转**——`src/host/**`
  //   无 `__DASH_PLUGIN_VERSION__` 引用点（实测命中 0），故没有任何字面量可替换，
  //   产物内**不含版本**。**版本单一事实源实际由 `lib/harness.cjs` 的 `readPluginVersion()`
  //   运行时直读 `package.json` 达成**（见文件头注①）。此处保留语句是为不改变既有构建
  //   行为与 --check 判定（本批只订正文案，不改逻辑）。
  const pkgVersion = require('../package.json').version;
  composed = composed.split('__DASH_PLUGIN_VERSION__').join("'" + pkgVersion + "'");

  // Keep the legacy header but mark it as a generated artifact.
  // P2-0（2026-10-13）：清单订正为**实际 5 件** —— `plugins.js` / `update.js` 已于 P1-c 删除
  //   （设置第三 tab 退役 + 更新执行器退役）。⚠ 该行会逐字写进 `plugin-host.js` 产物首行，
  //   旧的 7 件清单会让读者以为装配清单有 7 件（并与 R4「等值集」判据互为反证）。
  const header = `// GENERATED by scripts/build-host.mjs — do not edit by hand.\n// Source: src/host/app.js + src/host/{pure,diagnostics,models,enhance-handlers}.js\n`;
  return composed.startsWith('// GENERATED') ? composed : header + composed;
}

const output = buildHost();
const args = process.argv.slice(2);

if (args.includes('--check')) {
  // v3.2.1-t（漂移检测）：对比现有产物，不一致即报错退出 1。
  const target = join(root, 'plugin-host.js');
  let current = null;
  try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
  if (current === output) {
    console.log('plugin-host.js OK（源码 ↔ 产物一致，版本 ' + require('../package.json').version + '）');
    process.exit(0);
  }
  console.error('[build-host --check] 漂移检测失败：plugin-host.js 与源码重建结果不一致！');
  // ⚠ 文案补齐（CHG-126 · 2026-10-16 文案面小批）：本检查的**比较对象**是 src/host（含 app.js 的
  //   提示词生成区）↔ 产物，故「改过 prompts/** 且跑了 sync-prompts、却漏跑 build-host」也会落在
  //   这一支 —— 旧文案只列 src/host 与手改两因，读者拿不到正确归因（会去查一个不存在的 src/host 改动）。
  //   ⚠ 口径边界（本批实测，勿写成更宽的断言）：只改 prompts/** 而**完全没跑** sync-prompts 时，
  //     app.js 生成区与产物**同为旧** ⇒ 本检查仍 exit 0（该形态由 gate 的 prompts 环 / 单测 U40 咬住，
  //     不落此支）。故下面③的措辞严格写成「已跑 sync-prompts 但漏跑 build-host」。
  //   ⚠ 本批**只改这两行文案**：判定逻辑 / 退出码 / 比较对象一字未动。
  console.error('  原因：① 改过 src/host/* 后未重建；② 产物被手工修改；③ 改过 prompts/** 并已跑 sync-prompts、却漏跑 build-host（生成区已在 src/host/app.js 更新，产物仍是旧的）。');
  console.error('  修复：若是 ③ ⇒ node scripts/build-host.mjs（sync-prompts 已跑过，重建产物即可）；若是 ①② ⇒ node scripts/build-host.mjs（重建产物），或还原被手改的产物。'
    + '｜提示：提示词改动生效须**两步都跑**——node scripts/sync-prompts.mjs && node scripts/build-host.mjs（npm run build 不带前者）。');
  process.exit(1);
}

mkdirSync(join(root, 'lib'), { recursive: true });
writeFileSync(join(root, 'plugin-host.js'), output, 'utf8');
// ⚠ 口径订正（③ · 2026-10-16 门禁缺口批）：`output.length` 是 JS 字符串长度（UTF-16 码元数），
//   **不是字节数**——本产物含大量 CJK，两者实测差了 99371（218244 字符 vs 317615 字节）。
//   旧文案把字符数标成 "bytes"，使日志/报告里的体积读数失实（读者以为产物只有 213 KiB）。
//   `writeFileSync(..., 'utf8')` 实际落盘字节数 = Buffer.byteLength(output, 'utf8')，据此标注。
console.log('plugin-host.js written (' + output.length + ' chars / ' + Buffer.byteLength(output, 'utf8') + ' bytes, version ' + require('../package.json').version + ')');
