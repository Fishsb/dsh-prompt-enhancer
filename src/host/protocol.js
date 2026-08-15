'use strict';
/**
 * M3: RPC protocol version and method registry.
 *
 * Establishes an explicit protocol boundary between client, host, and executor.
 */
const PROTOCOL_VERSION = 1;

const RPC_METHODS = [
  // enhance
  'enhance',
  'enhance/progress',
  'cancel',
  // models
  'models/list',
  'models/current',
  'models/resolve',
  'models/test',
  'models/autochain',
  // config/template
  'template/default',
  // update
  'update/check',
  'update/pull',
  'update/envcheck',
  'update/executorEnsure',
  'update/restartNeeded',
  // diagnostics
  'logs/last',
  // plugins
  'plugins/inventory',
  'plugins/run',
  'plugins/stop',
  'plugins/undefine',
];

function isKnownMethod(method) {
  return typeof method === 'string' && RPC_METHODS.includes(method);
}

module.exports = { PROTOCOL_VERSION, RPC_METHODS, isKnownMethod };
