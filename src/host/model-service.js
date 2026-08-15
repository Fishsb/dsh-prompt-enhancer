'use strict';
/**
 * M2: ModelService interface.
 *
 * The legacy model RPCs and cache live in src/host/legacy/plugin-host.js and
 * the extracted chunk src/host/models.js. This service is the target boundary
 * that those implementations will be wired into during M2/M3.
 */
function createModelService() {
  async function resolve(provider, model) {
    throw new Error('models.resolve not wired yet');
  }
  async function current() {
    throw new Error('models.current not wired yet');
  }
  async function test(provider, model) {
    throw new Error('models.test not wired yet');
  }
  async function autochain() {
    throw new Error('models.autochain not wired yet');
  }
  return { resolve, current, test, autochain };
}

module.exports = { createModelService };
