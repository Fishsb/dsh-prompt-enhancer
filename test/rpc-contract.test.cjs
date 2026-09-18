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
test('RPC-02 派生清单结构锁：34 = 16(lib/index.cjs) + 18(plugin-host.js)，交集 0，schema 17，具名申报 17', () => {
  const r = run(['--json']);
  assert.equal(r.ok, true, 'rpc-manifest --json 失败：\n' + r.out);
  const m = JSON.parse(r.out);
  assert.equal(m.counts.native, 16, 'lib/index.cjs 注册面条数');
  assert.equal(m.counts.bundled, 18, 'plugin-host.js 注册面条数');
  assert.equal(m.counts.live, 34, '线上方法去重总数');
  assert.equal(m.counts.schema, 17, 'schema 覆盖条数');
  assert.equal(m.counts.gap, 17, '具名申报的无校验条数');
  assert.equal(m.noSchema.length, m.counts.gap, 'gap 明细与计数一致');
  assert.ok(m.live.includes('update/install'), 'update/install 在位');
  assert.ok(!m.live.includes('update/portRestart'), '已退役的重启 RPC 不得回流');
});
