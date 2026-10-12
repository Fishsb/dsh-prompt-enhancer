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
test('RPC-02 派生清单结构锁：15 = 4(lib/index.cjs) + 11(plugin-host.js)，交集 0，schema 6，具名申报 9', () => {
  const r = run(['--json']);
  assert.equal(r.ok, true, 'rpc-manifest --json 失败：\n' + r.out);
  const m = JSON.parse(r.out);
  assert.equal(m.counts.native, 4, 'lib/index.cjs 注册面条数');
  assert.equal(m.counts.bundled, 11, 'plugin-host.js 注册面条数');
  assert.equal(m.counts.live, 15, '线上方法去重总数');
  assert.equal(m.counts.schema, 6, 'schema 覆盖条数');
  assert.equal(m.counts.gap, 9, '具名申报的无校验条数');
  assert.equal(m.noSchema.length, m.counts.gap, 'gap 明细与计数一致');
  assert.ok(!m.live.includes('update/install'), 'P1-c：update/install 已退役（交回官方 plugin manager）');
  assert.ok(!m.live.includes('update/portRestart'), '已退役的重启 RPC 不得回流');
});
