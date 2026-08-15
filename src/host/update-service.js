'use strict';
/**
 * M2/M4: UpdateService interface + platform-backed apply.
 *
 * Legacy update RPCs (check/pull/envcheck) still live in the composed
 * plugin-host.js; this service adds the M4 `apply` path through UpdatePlatform.
 */
const { createUpdatePlatform } = require('./update-platform.js');
const { createExecutorReloader } = require('./executor-reloader.js');

function createUpdateService(options) {
  const opts = options || {};
  const platform = opts.platform || createUpdatePlatform({
    reloader: opts.reloader,
    executor: opts.executor || createExecutorReloader({ port: opts.executorPort || 3081 }),
  });

  async function check() {
    throw new Error('update.check not wired yet');
  }
  async function pull() {
    throw new Error('update.pull not wired yet');
  }
  async function envcheck() {
    throw new Error('update.envcheck not wired yet');
  }
  async function apply(tag, profile, serviceName) {
    return platform.apply(tag, profile, serviceName);
  }
  async function canHotReload() {
    return platform.canHotReload();
  }

  return { check, pull, envcheck, apply, canHotReload };
}

module.exports = { createUpdateService };
