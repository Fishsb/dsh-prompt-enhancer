'use strict';
// client-enhance-flow —— 增强完成回调行为级测试（2026-08-24「优化完成但草稿未替换」事故防回归）
// 手法：解码 src/client/helpers.js 单行 chunk，注入浏览器桩（localStorage/host/configState）后
// 求值出内部函数，直接驱动 enhance()/cancelEnhance() 断言写回/暂存/丢弃/失败四路；
// 另加接线契约断言（button/bar 源码必须含关键接线标记），专防 f6fa822 式"注释有、代码无"半成品。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const decodeChunk = (rel) => {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const m = raw.match(/module\.exports\s*=\s*"([\s\S]*)";?\s*\n$/);
  if (!m) throw new Error('chunk wrapper mismatch: ' + rel);
  return JSON.parse('"' + m[1] + '"');
};

function loadHelpers() {
  const src = decodeChunk('src/client/helpers.js');
  const lsBacking = new Map();
  const localStorageStub = {
    getItem: (k) => (lsBacking.has(k) ? lsBacking.get(k) : null),
    setItem: (k, v) => lsBacking.set(k, String(v)),
    removeItem: (k) => lsBacking.delete(k),
  };
  const hostStub = {
    calls: [],
    respond: () => ({ ok: true, text: 'OUT' }),
    call(method, args) {
      this.calls.push({ method, args });
      return Promise.resolve(this.respond(method, args));
    },
  };
  const factory = new Function(
    'host', 'configState', 'localStorage', 'MEMORY_ROUNDS_MAX', 'SEEN_KEY_PREFIX',
    src + '\n;return { enhance, undo, cancelEnhance, guardPasses, setActiveSession, getActiveSession, storeFor, isEnhancing };'
  );
  const api = factory(hostStub, { value: { memory: false } }, localStorageStub, 4, 'dsh-enh-seen:');
  return { api, hostStub, lsBacking };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const RK = (sid) => 'dsh-enh-result:' + sid;

// ---------- 行为级：完成回调四路 ----------
test('ENH-FLOW stay: 活动会话内完成 → 草稿写回 + result 态 + 结果持久化', async () => {
  const { api, hostStub, lsBacking } = loadHelpers();
  const sid = 'sess-stay';
  api.setActiveSession(sid); // 关键：登记活动会话（f6fa822 缺失的接线）
  const writes = [];
  const inputActions = { setDraft: (v) => writes.push(v) };
  const draftRef = { current: '原文ABC' };
  hostStub.respond = () => ({ ok: true, text: '优化后XYZ' });
  api.enhance(sid, '原文ABC', inputActions, draftRef);
  await flush();
  assert.equal(writes[writes.length - 1], '优化后XYZ', '草稿必须被写回为结果');
  const s = api.storeFor(sid);
  assert.equal(s.phase, 'result');
  assert.equal(s.backup, '原文ABC');
  assert.ok(lsBacking.has(RK(sid)), 'localStorage 必须持久化结果');
});

test('ENH-FLOW away: 已切走 → 只暂存不写草稿（防串会话）', async () => {
  const { api, hostStub, lsBacking } = loadHelpers();
  const sid = 'sess-away';
  api.setActiveSession(null);
  const writes = [];
  const inputActions = { setDraft: (v) => writes.push(v) };
  const draftRef = { current: '原文' };
  hostStub.respond = () => ({ ok: true, text: '结果Q' });
  api.enhance(sid, '原文', inputActions, draftRef);
  await flush();
  assert.equal(writes.includes('结果Q'), false, '切走后不得写回草稿');
  const s = api.storeFor(sid);
  assert.equal(s.phase, 'result');
  assert.equal(s.enhanced, '结果Q');
  assert.ok(lsBacking.has(RK(sid)), '暂存也必须持久化（回归恢复依赖）');
});

test('ENH-FLOW edited: 留在会话但用户已编辑 → 丢弃且清持久化', async () => {
  const { api, hostStub, lsBacking } = loadHelpers();
  const sid = 'sess-edit';
  api.setActiveSession(sid);
  const writes = [];
  const inputActions = { setDraft: (v) => writes.push(v) };
  const draftRef = { current: '用户改过的内容' };
  hostStub.respond = () => ({ ok: true, text: '迟到结果' });
  api.enhance(sid, '原文', inputActions, draftRef);
  await flush();
  const s = api.storeFor(sid);
  assert.equal(s.phase, 'idle');
  assert.equal(s.enhanced, '');
  assert.equal(writes.includes('迟到结果'), false, '丢弃路径不得写回');
  assert.equal(lsBacking.has(RK(sid)), false, '丢弃必须清理持久化');
});

// ---------- 行为级：失败与取消 ----------
test('ENH-FLOW error: 失败 → 还原 backup + 错误码 + 清持久化', async () => {
  const { api, hostStub, lsBacking } = loadHelpers();
  const sid = 'sess-err';
  api.setActiveSession(sid);
  const writes = [];
  const inputActions = { setDraft: (v) => writes.push(v) };
  const draftRef = { current: '原文E' };
  hostStub.respond = () => ({ ok: false, code: 'TIMEOUT' });
  api.enhance(sid, '原文E', inputActions, draftRef);
  await flush();
  assert.equal(writes.includes('原文E'), true, '失败必须还原 backup');
  const s = api.storeFor(sid);
  assert.equal(s.phase, 'idle');
  assert.equal(s.error, 'TIMEOUT');
  assert.equal(lsBacking.has(RK(sid)), false, '失败必须清理持久化');
});

test('ENH-FLOW cancel: 在途取消 → 还原 backup + 取消 RPC + 清持久化', async () => {
  const { api, hostStub, lsBacking } = loadHelpers();
  const sid = 'sess-cancel';
  api.setActiveSession(sid);
  lsBacking.set(RK(sid), JSON.stringify({ b: '旧', e: '旧结果' })); // 预置陈旧持久化
  const writes = [];
  const inputActions = { setDraft: (v) => writes.push(v) };
  const draftRef = { current: '原文C' };
  hostStub.respond = () => new Promise(() => {}); // 永不完成
  api.enhance(sid, '原文C', inputActions, draftRef);
  await flush();
  assert.equal(api.isEnhancing(sid), true);
  api.cancelEnhance(sid, inputActions);
  assert.equal(writes.includes('原文C'), true, '取消必须还原 backup');
  assert.equal(api.isEnhancing(sid), false);
  assert.equal(lsBacking.has(RK(sid)), false, '取消必须清理陈旧持久化');
  const cancelCall = hostStub.calls.find((c) => c.method === 'cancel');
  assert.ok(cancelCall, '必须发送 cancel RPC');
});

// ---------- 接线契约：专防"注释有、代码无"（f6fa822 事故类） ----------
test('ENH-FLOW wiring: button 必须登记活动会话且声明 actions ref', () => {
  const btn = decodeChunk('src/client/components/enhance-button.js');
  assert.ok(/setActiveSession\(sessionId\)/.test(btn), 'button 缺 setActiveSession 登记（恒 null → 完成回调恒判已切走）');
  assert.ok(btn.includes('inputActionsRef'), 'button 缺 inputActionsRef 声明（恢复效应将 ReferenceError）');
});
test('ENH-FLOW wiring: bar 卸载不得 cancel 在途优化 + 消费效应须豁免暂存态', () => {
  const bar = decodeChunk('src/client/components/enhance-bar.js');
  assert.equal(/host\.call\('cancel'/.test(bar), false, 'bar 卸载残留 cancel——与「后台继续」冲突');
  assert.ok(bar.includes('draft !== s.backup'), 'bar 消费效应缺 backup 豁免（暂存未写回态会被误清）');
});
test('ENH-FLOW wiring: helpers 完成分支三路持久化调用齐备', () => {
  const h = decodeChunk('src/client/helpers.js');
  for (const marker of [
    'saveResultStore(sessionId, s.backup',
    'clearResultStore(sessionId); // v3.3.x 新一轮覆盖旧结果',
    'clearResultStore(sessionId); // v3.3.x-fix：取消',
    'clearResultStore(sessionId); // v3.3.x-fix：丢弃',
  ]) {
    if (!marker) continue;
    assert.ok(h.includes(marker), 'helpers 缺持久化接线标记: ' + marker);
  }
});
