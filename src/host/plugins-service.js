'use strict';
/**
 * M2: PluginsService interface.
 *
 * Legacy plugin management RPCs live in src/host/legacy/plugin-host.js and the
 * extracted chunk src/host/plugins.js. This service is the target boundary.
 */
function createPluginsService() {
  async function inventory() {
    throw new Error('plugins.inventory not wired yet');
  }
  async function run() {
    throw new Error('plugins.run not wired yet');
  }
  async function stop() {
    throw new Error('plugins.stop not wired yet');
  }
  async function undefine() {
    throw new Error('plugins.undefine not wired yet');
  }
  return { inventory, run, stop, undefine };
}

module.exports = { createPluginsService };
