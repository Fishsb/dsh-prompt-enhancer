'use strict';
// M5: observability and integrity tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// P1b（2026-09-19）：M5 骨架 src/host/logger.js 已退役 → 其守卫 OBS-01 随骨架一并退役
//（该测试守的是从不接线的骨架，意图已由 ADR-194/197 承载）。
// integrity 的活副本是 lib/integrity.cjs（原 src/host/integrity.js 为死层，已删）→ 守卫改挂活副本。
const { sha256File, verifySha256 } = require('../lib/integrity.cjs');
// 目标模式（CHG-320）：诊断日志已迁为普通模块，测试直接加载真实模块并注入假 console。
const { createDiagnostics, LOG_RING_MAX } = require('../src/host/domains/diagnostics/log.cjs');

test('OBS-02 sha256File and verifySha256', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-obs-'));
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'hello');
  const hash = await sha256File(file);
  assert.match(hash, /^[a-f0-9]{64}$/);
  const ok = await verifySha256(file, hash);
  assert.equal(ok.ok, true);
  const bad = await verifySha256(file, '0'.repeat(64));
  assert.equal(bad.ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('OBS-03 批次D hlog/herr 行带 ISO 时间戳前缀且保留原文案（普通模块 + 假 console）', () => {
  const captured = [];
  const fakeConsole = {
    log: (...a) => captured.push(['log', a.join(' ')]),
    error: (...a) => captured.push(['error', a.join(' ')]),
  };
  const api = createDiagnostics(fakeConsole);
  assert.equal(typeof api.hlog, 'function');
  assert.equal(typeof api.herr, 'function');

  api.hlog('[enhance] update/envcheck ok svc=dsh-web', { items: 4 });
  api.herr('[enhance] update/envcheck failed', 42);

  assert.equal(captured.length, 2);
  assert.equal(captured[0][0], 'log', 'hlog 走 console.log');
  assert.equal(captured[1][0], 'error', 'herr 走 console.error');
  const TS = '^\\[20\\d{2}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\] ';
  assert.match(captured[0][1], new RegExp(TS + '\\[enhance\\] update/envcheck ok svc=dsh-web \\{"items":4\\}$'),
    'hlog 输出行以 [20…Z] 开头且原文案/参数原样保留');
  assert.match(captured[1][1], new RegExp(TS + '\\[enhance\\] update/envcheck failed 42$'),
    'herr 输出行同样带 ISO 前缀');

  assert.equal(api.LOG_RING.length, 2, '环形缓冲仍收录两行');
  assert.match(api.LOG_RING[0], /^\[20\d{2}-/, 'LOG_RING 内容含时间戳前缀（logs/last 消费方可见）');
  assert.ok(api.LOG_RING[0].includes('[enhance] update/envcheck ok'), '关键 token 原样保留（grep 兼容，D-1）');
  assert.equal(LOG_RING_MAX, 300, '环形缓冲上限保持 300 行');
});
