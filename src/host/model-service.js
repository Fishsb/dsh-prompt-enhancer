'use strict';
/**
 * M2: ModelService interface.
 *
 * The model RPCs and cache live in the generated host bundle (src/host/models.js
 * chunk + app.js). This service is the target boundary those implementations
 * will be wired into during M2 深化.
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
