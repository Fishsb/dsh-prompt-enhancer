'use strict';
/**
 * M2/M3: ConfigService backed by config-schema.
 */
const { cloneDefaults, validateConfig, migrateLegacyConfig } = require('./config-schema.js');

function createConfigService() {
  function validate(raw) {
    return validateConfig(raw);
  }
  function defaults() {
    return cloneDefaults();
  }
  function migrate(raw) {
    return migrateLegacyConfig(raw);
  }
  return { validate, defaults, migrate };
}

module.exports = { createConfigService };
