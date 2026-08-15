'use strict';
/**
 * M4: ExecutorReloader — external updater executor fallback.
 *
 * Implements the Reloader surface by calling the standalone updater-host RPC
 * (`apply`). This is the fallback path until platform-native hot reload is
 * available.
 */
const http = require('node:http');

function rpcCall(port, method, args) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ method, args: args || {} });
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/rpc',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({ ok: false, code: 'BAD_RESPONSE' }); }
      });
    });
    req.on('error', () => resolve({ ok: false, code: 'EXECUTOR_UNREACHABLE' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'EXECUTOR_TIMEOUT' }); });
    req.end(payload);
  });
}

function createExecutorReloader(options) {
  const port = options && Number.isInteger(options.port) ? options.port : 3081;
  const repo = options && options.repo ? options.repo : 'Fishsb/dsh-prompt-enhancer';

  async function isSupported() {
    const pong = await rpcCall(port, 'ping', {});
    return pong && pong.ok === true;
  }

  async function reload(profile, pkg) {
    return rpcCall(port, 'apply', {
      repo,
      tag: pkg && pkg.tag ? pkg.tag : '',
      profile,
      serviceName: (pkg && pkg.serviceName) || 'dsh-web',
    });
  }

  return { isSupported, reload };
}

module.exports = { createExecutorReloader, rpcCall };
