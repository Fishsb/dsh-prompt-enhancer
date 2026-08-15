'use strict';
/**
 * Host modular entry (target architecture).
 *
 * Current build stage: `scripts/build-host.mjs` still emits the legacy
 * `src/host/legacy/plugin-host.js` unchanged. This module is the target
 * composition point once legacy code is extracted into feature modules.
 */
const { createServiceRegistry } = require('./services');
const { Pipeline } = require('./pipeline');
const enhance = require('./enhance');
const { createModelService } = require('./model-service');
const { createUpdateService } = require('./update-service');
const { createDiagnosticsService } = require('./diagnostics-service');
const { createPluginsService } = require('./plugins-service');
const { createConfigService } = require('./config-service');

function register(ctx, options) {
  const opts = options || {};
  const services = createServiceRegistry(ctx);
  const pipeline = new Pipeline();

  services.provide('enhance.pipeline', pipeline);
  services.provide('enhance.service', enhance.createService(services));
  services.provide('models.service', createModelService());
  services.provide('update.service', createUpdateService(opts.update || {}));
  services.provide('diagnostics.service', createDiagnosticsService());
  services.provide('plugins.service', createPluginsService());
  services.provide('config.service', createConfigService());

  enhance.register(ctx, services);

  return services;
}

module.exports = { register };
