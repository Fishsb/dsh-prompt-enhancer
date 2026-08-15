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
const models = require('./models');
const update = require('./update');
const diagnostics = require('./diagnostics');
const plugins = require('./plugins');
const config = require('./config');

function register(ctx) {
  const services = createServiceRegistry(ctx);
  const pipeline = new Pipeline();

  services.provide('enhance.pipeline', pipeline);
  services.provide('enhance.service', enhance.createService ? enhance.createService(services) : {});
  services.provide('models.service', models.createService ? models.createService(services) : {});
  services.provide('update.service', update.createService ? update.createService(services) : {});
  services.provide('diagnostics.service', diagnostics.createService ? diagnostics.createService(services) : {});
  services.provide('plugins.service', plugins.createService ? plugins.createService(services) : {});
  services.provide('config.service', config.createService ? config.createService(services) : {});

  config.register(ctx, services);
  diagnostics.register(ctx, services);
  models.register(ctx, services);
  enhance.register(ctx, services);
  update.register(ctx, services);
  plugins.register(ctx, services);

  return services;
}

module.exports = { register };
