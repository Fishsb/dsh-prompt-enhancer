'use strict';
// P2（2026-09-19）：RPC 契约**单一事实源**门禁入单测。
// 事实源由 scripts/rpc-manifest.mjs 从注册面派生（不人工清点）；本测试把它拉进 npm test，
// 使「线上方法集 / schema 覆盖 / 文档面 / 具名申报 / 孤儿」五者在本地默认路径上被检查。
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const run = (args) => {
  try {
    return { ok: true, out: execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'rpc-manifest.mjs'), ...args], { encoding: 'utf8', cwd: ROOT }) };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
  }
};

test('RPC-01 事实源一致性 --check 通过（注册面 / 文档面 / 申报集 / 孤儿 四不变量）', () => {
  const r = run(['--check']);
  assert.equal(r.ok, true, 'rpc-manifest --check 未通过：\n' + r.out);
});

// 契约锁：下述数字是**已发布对外契约**的快照。任何变更都必须是有意识的编辑（并评估 BREAKING），
// 而不是被静默漂移带走——这正是 P2 要关掉的 RC-A「无单一事实源」。
// P1-a（2026-10-13 缩批）：数字锁 34 → **26**（native 16 → 8）。⚠ 这不是「改浅断言」——
//   本条锁的是「注册面事实」，34 是 P1-a 前的实测值；P1-a 删掉 8 条 voice/*（model*/deploy*）
//   ⇒ 事实变为 26 = 8(lib/index.cjs) + 18(plugin-host.js)。**判据强度不变**：仍是逐项严格等号
//   （native/bundled/live/schema/gap 五处全等，未改成区间、未删断言、未 skip）。
// P1-c（2026-10-13）：数字锁 26 → **15**（native 8 → 4）。⚠ 事实同步，非改浅：
//   仍是逐项严格等号。P1-c 删掉 4 条 plugins/* + 7 条 update/*（设置第三 tab 与更新执行器退役）。
// CHG-117（2026-10-16 · 规整改造批）：数字锁 15 → **14**（native 4 → 3；schema 6 → 5）。
//   ⚠ 事实同步，非改浅：删掉的是 **`voice/transcribe`**（自「自建采集链退役」后**已无调用方**，
//     `CHG-115` `I-1`；且其调官方 `transcribe()` 漏传 `AbortSignal` 必失败 `I-3`）⇒ 整条死链。
//   `bundled 11` / `gap 9` **不变**：前者是 plugin-host.js 注册面（本就不含该 RPC），
//   后者 = live \ schemas（该 RPC **有** schema ⇒ 本就不在 gap）。
test('RPC-02 派生清单结构锁：14 = 3(lib/index.cjs) + 11(plugin-host.js)，交集 0，schema 5，具名申报 9', () => {
  const r = run(['--json']);
  assert.equal(r.ok, true, 'rpc-manifest --json 失败：\n' + r.out);
  const m = JSON.parse(r.out);
  assert.equal(m.counts.native, 3, 'lib/index.cjs 注册面条数');
  assert.equal(m.counts.bundled, 11, 'plugin-host.js 注册面条数');
  assert.equal(m.counts.live, 14, '线上方法去重总数');
  assert.equal(m.counts.schema, 5, 'schema 覆盖条数');
  assert.equal(m.counts.gap, 9, '具名申报的无校验条数');
  assert.equal(m.noSchema.length, m.counts.gap, 'gap 明细与计数一致');
  assert.ok(!m.live.includes('update/install'), 'P1-c：update/install 已退役（交回官方 plugin manager）');
  assert.ok(!m.live.includes('update/portRestart'), '已退役的重启 RPC 不得回流');
  // ⚠ CHG-117：`voice/transcribe` 已删 —— 与既有的「退役方法不得回流」同款锁（**新增锁，不是改浅**）
  assert.ok(!m.live.includes('voice/transcribe'), 'CHG-117：voice/transcribe 已退役，不得回流');
  // ⚠ 键名以 `rpc-manifest --json` 实际导出为准：有校验集合叫 `schemaCovered`（不是 `schemas`）。
  assert.ok(!m.schemaCovered.includes('voice/transcribe'), 'CHG-117：voice/transcribe 的 schema 已删，不得回流');
});
