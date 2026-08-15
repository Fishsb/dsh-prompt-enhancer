'use strict';
/**
 * M4: Reloader interface for platform-native hot update.
 *
 * Primary goal: one-click update without dropping the 3080 port. The platform
 * adapter will implement `isSupported()` and `reload()` using Cordis
 * `entry.update()` / full reload when available; otherwise the external
 * executor fallback is used.
 */
class Reloader {
  async isSupported() {
    throw new Error('not implemented');
  }

  async reload(_profile, _pkg) {
    throw new Error('not implemented');
  }
}

class UnsupportedReloader extends Reloader {
  async isSupported() {
    return false;
  }

  async reload() {
    return { ok: false, code: 'UNSUPPORTED', message: 'platform hot reload is not available' };
  }
}

module.exports = { Reloader, UnsupportedReloader };
