'use strict';
/**
 * Host modular entry (M2 服务注册组合点).
 *
 * Build stage: `scripts/build-host.mjs` assembles the generated root
 * plugin-host.js from src/host/app.js (bundle skeleton) + chunk modules.
 * This module is the service-registration composition point for the target
 * architecture (M2 深化时接入生成的 bundle)。
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
