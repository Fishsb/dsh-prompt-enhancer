'use strict';
/**
 * M4: update platform coordinator.
 *
 * Chooses between platform-native hot reload and the external executor
 * fallback. This is the target entry point for one-click update once the
 * legacy updater-host flow is migrated.
 */
const { UnsupportedReloader } = require('./reloader.js');

function createUpdatePlatform(options) {
  const reloader = options && options.reloader ? options.reloader : new UnsupportedReloader();
  const executor = options && options.executor ? options.executor : null;

  async function canHotReload() {
    return reloader.isSupported();
  }

  async function apply(tag, profile, serviceName) {
    if (await reloader.isSupported()) {
      return reloader.reload(profile, { tag });
    }
    if (executor && typeof executor.apply === 'function') {
      return executor.apply(tag, profile, serviceName);
    }
    return { ok: false, code: 'NO_RELOADER', message: 'no reloader or executor available' };
  }

  return { canHotReload, apply };
}

module.exports = { createUpdatePlatform };
