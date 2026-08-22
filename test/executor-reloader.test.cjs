'use strict';
// M4: ExecutorReloader tests with a local mock executor.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExecutorReloader, readPortFilePort } = require('../src/host/executor-reloader.js');

function startMockExecutor() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const { method, args } = JSON.parse(body || '{}');
        if (method === 'ping') {
          res.end(JSON.stringify({ ok: true, version: '0.1.6', pid: 1 }));
        } else if (method === 'apply') {
          res.end(JSON.stringify({ ok: true, accepted: true, tag: args.tag, profile: args.profile }));
        } else {
          res.end(JSON.stringify({ ok: false, code: 'UNKNOWN' }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// A1 测试隔离：显式注入不存在的 port 文件，防止用例命中本机真实 executor.port（3081 活体）
const NO_PORT_FILE = path.join(os.tmpdir(), 'execr-no-such-port-file-' + process.pid + '.json');

test('EXECR-01 isSupported pings mock executor', async () => {
  const server = await startMockExecutor();
  try {
    const port = server.address().port;
    const r = createExecutorReloader({ port, portFile: NO_PORT_FILE });
    assert.equal(await r.isSupported(), true);
  } finally {
    server.close();
  }
});

test('EXECR-02 reload calls apply with tag/profile', async () => {
  const server = await startMockExecutor();
  try {
    const port = server.address().port;
    const r = createExecutorReloader({ port, portFile: NO_PORT_FILE });
    const out = await r.reload('web', { tag: 'v2.8.3', serviceName: 'dsh-web' });
    assert.equal(out.ok, true);
    assert.equal(out.tag, 'v2.8.3');
    assert.equal(out.profile, 'web');
  } finally {
    server.close();
  }
});

test('EXECR-03 unreachable executor returns error', async () => {
  const r = createExecutorReloader({ port: 1, portFile: NO_PORT_FILE });
  const out = await r.reload('web', { tag: 'v2.8.3' });
  assert.equal(out.ok, false);
  assert.ok(['EXECUTOR_UNREACHABLE', 'EXECUTOR_TIMEOUT'].includes(out.code));
});

// ---- v3.3.x（A1·端口发现）----

test('EXECR-04 discovers dynamic port via executor.port when fixed candidates dead', async () => {
  const server = await startMockExecutor(); // 充当「漂移后的动态口」执行器
  try {
    const dynPort = server.address().port;
    const portFile = path.join(os.tmpdir(), 'execr-dyn-' + process.pid + '.json');
    fs.writeFileSync(portFile, JSON.stringify({ port: dynPort, pid: 1, ts: Date.now() }));
    // 不传固定端口：3081 候选必死（无监听），唯一活口在 portFile
    const r = createExecutorReloader({ portFile });
    try {
      assert.equal(await r.isSupported(), true);
      const out = await r.reload('web', { tag: 'vX' });
      assert.equal(out.ok, true);
      assert.equal(out.tag, 'vX');
    } finally { fs.rmSync(portFile, { force: true }); }
  } finally {
    server.close();
  }
});

test('EXECR-05 all candidates dead → unsupported + explicit error', async () => {
  const portFile = path.join(os.tmpdir(), 'execr-dead-' + process.pid + '.json');
  fs.writeFileSync(portFile, JSON.stringify({ port: 59999, pid: 1, ts: Date.now() })); // 无监听端口
  try {
    const r = createExecutorReloader({ port: 1, portFile });
    assert.equal(await r.isSupported(), false);
    const out = await r.reload('web', { tag: 'vX' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'EXECUTOR_UNREACHABLE');
  } finally { fs.rmSync(portFile, { force: true }); }
});

test('EXECR-06 cache invalidation: fresh re-probe after holder disappears', async () => {
  const server = await startMockExecutor();
  let closed = false;
  try {
    const port = server.address().port;
    const portFile = path.join(os.tmpdir(), 'execr-cache-' + process.pid + '.json');
    fs.writeFileSync(portFile, JSON.stringify({ port, pid: 1, ts: Date.now() }));
    try {
      const r = createExecutorReloader({ port: 1, portFile }); // 只能靠 portFile 命中
      assert.equal(await r.resolvePort(), port);   // 缓存建立
      await new Promise((res) => { closed = true; server.close(res); }); // 执行器消失
      assert.equal(await r.resolvePortFresh(), 0); // 失效重探 → 0
    } finally { fs.rmSync(portFile, { force: true }); }
  } finally {
    if (!closed) { try { server.close(); } catch { /* 已关闭 */ } }
  }
});

test('EXECR-07 readPortFilePort validation', () => {
  const p = path.join(os.tmpdir(), 'execr-unit-' + process.pid + '.json');
  fs.writeFileSync(p, JSON.stringify({ port: 40001, pid: 2, ts: 3 }));
  assert.equal(readPortFilePort(p), 40001);
  fs.writeFileSync(p, '{ broken');
  assert.equal(readPortFilePort(p), 0);
  fs.writeFileSync(p, JSON.stringify({ port: 80 })); // 越界（<1024）
  assert.equal(readPortFilePort(p), 0);
  fs.rmSync(p, { force: true });
  assert.equal(readPortFilePort(p), 0); // 缺失
});
