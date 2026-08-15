'use strict';
// M4: ExecutorReloader tests with a local mock executor.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createExecutorReloader } = require('../src/host/executor-reloader.js');

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

test('EXECR-01 isSupported pings mock executor', async () => {
  const server = await startMockExecutor();
  try {
    const port = server.address().port;
    const r = createExecutorReloader({ port });
    assert.equal(await r.isSupported(), true);
  } finally {
    server.close();
  }
});

test('EXECR-02 reload calls apply with tag/profile', async () => {
  const server = await startMockExecutor();
  try {
    const port = server.address().port;
    const r = createExecutorReloader({ port });
    const out = await r.reload('web', { tag: 'v2.8.3', serviceName: 'dsh-web' });
    assert.equal(out.ok, true);
    assert.equal(out.tag, 'v2.8.3');
    assert.equal(out.profile, 'web');
  } finally {
    server.close();
  }
});

test('EXECR-03 unreachable executor returns error', async () => {
  const r = createExecutorReloader({ port: 1 });
  const out = await r.reload('web', { tag: 'v2.8.3' });
  assert.equal(out.ok, false);
  assert.ok(['EXECUTOR_UNREACHABLE', 'EXECUTOR_TIMEOUT'].includes(out.code));
});
