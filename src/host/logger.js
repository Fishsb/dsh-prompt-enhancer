'use strict';
/**
 * M5: structured JSON logger.
 *
 * Emits one JSON object per line to stdout/stderr. Keeps a small ring for
 * in-memory tailing (can be wired into diagnostics service later).
 */
const LEVELS = ['debug', 'info', 'warn', 'error'];

function createLogger(options) {
  const ring = [];
  const max = options && Number.isInteger(options.ringSize) ? options.ringSize : 300;
  const writer = options && options.writer ? options.writer : ((line) => console.log(line));

  function write(level, event, fields) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...(fields || {}),
    };
    const line = JSON.stringify(entry);
    ring.push(line);
    if (ring.length > max) ring.shift();
    if (level === 'error') console.error(line);
    else writer(line);
    return entry;
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    tail: (n) => ring.slice(-(n || ring.length)),
  };
}

module.exports = { createLogger, LEVELS };
