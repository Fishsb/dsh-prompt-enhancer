'use strict';
/**
 * M2: DiagnosticsService interface.
 *
 * The legacy ring buffer lives in src/host/legacy/plugin-host.js and the
 * extracted chunk src/host/diagnostics.js. This service is the target boundary.
 */
function createDiagnosticsService() {
  const ring = [];
  const max = 300;

  function push(line) {
    ring.push(line);
    if (ring.length > max) ring.shift();
  }

  function log(...args) {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    push(line);
    console.log(line);
    return line;
  }

  function error(...args) {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    push(line);
    console.error(line);
    return line;
  }

  function tail(n) {
    return ring.slice(-(n || ring.length));
  }

  return { log, error, tail };
}

module.exports = { createDiagnosticsService };
