'use strict';
/**
 * M2: Cordis-style service registry target.
 *
 * This module defines the service boundary used by the refactored host:
 * modules expose capabilities through `ctx.provide`, and consumers declare
 * dependencies through `inject`. It is source scaffolding for M2; the legacy
 * single-file host still runs until extraction is complete.
 */
function createServiceRegistry(ctx) {
  const services = new Map();

  function provide(name, service) {
    if (services.has(name)) throw new Error('service already provided: ' + name);
    services.set(name, service);
    if (ctx && typeof ctx.provide === 'function') {
      ctx.provide(name, service);
    }
    return service;
  }

  function get(name) {
    return services.get(name);
  }

  function has(name) {
    return services.has(name);
  }

  return { provide, get, has };
}

module.exports = { createServiceRegistry };
