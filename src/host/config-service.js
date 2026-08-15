'use strict';
/**
 * M2: ConfigService interface.
 *
 * Legacy config validation lives in PURE (src/host/pure.js) and the composed
 * plugin-host.js. This service is the target boundary for M3 schema work.
 */
function createConfigService() {
  function validate(raw) {
    throw new Error('config.validate not wired yet');
  }
  function defaults() {
    throw new Error('config.defaults not wired yet');
  }
  return { validate, defaults };
}

module.exports = { createConfigService };
