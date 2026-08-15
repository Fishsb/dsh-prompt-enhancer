'use strict';
/**
 * M2: UpdateService interface.
 *
 * Legacy update RPCs live in src/host/legacy/plugin-host.js and the extracted
 * chunk src/host/update.js. This service is the target boundary.
 */
function createUpdateService() {
  async function check() {
    throw new Error('update.check not wired yet');
  }
  async function pull() {
    throw new Error('update.pull not wired yet');
  }
  async function envcheck() {
    throw new Error('update.envcheck not wired yet');
  }
  return { check, pull, envcheck };
}

module.exports = { createUpdateService };
