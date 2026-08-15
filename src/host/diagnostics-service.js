'use strict';
/**
 * M2/M5: DiagnosticsService backed by structured logger.
 */
const { createLogger } = require('./logger.js');

function createDiagnosticsService(options) {
  const logger = createLogger(options && options.logger ? options.logger : {});

  function log(...args) {
    const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    return logger.info('diagnostics.log', { text });
  }

  function error(...args) {
    const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    return logger.error('diagnostics.error', { text });
  }

  function tail(n) {
    return logger.tail(n);
  }

  return { log, error, tail };
}

module.exports = { createDiagnosticsService };
