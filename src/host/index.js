'use strict';
/**
 * Host modular entry (target architecture).
 *
 * Current build stage: `scripts/build-host.mjs` still emits the legacy
 * `src/host/legacy/plugin-host.js` unchanged. This module is the target
 * composition point once legacy code is extracted into feature modules.
 */
const enhance = require('./enhance');
const models = require('./models');
const update = require('./update');
const diagnostics = require('./diagnostics');
const plugins = require('./plugins');
const config = require('./config');

function register(ctx) {
  config.register(ctx);
  diagnostics.register(ctx);
  models.register(ctx);
  enhance.register(ctx);
  update.register(ctx);
  plugins.register(ctx);
}

module.exports = { register };
