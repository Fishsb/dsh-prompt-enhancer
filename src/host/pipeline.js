'use strict';
/**
 * M2: enhance pipeline registry target.
 *
 * Replaces the current stage-callback flow with a registerable pipeline:
 * new modes / retrieval sources register handlers instead of modifying the
 * main enhance function.
 */
class Pipeline {
  constructor() {
    this._handlers = new Map();
  }

  register(name, handler, options) {
    if (typeof name !== 'string' || name === '') throw new Error('pipeline handler name required');
    if (typeof handler !== 'function') throw new Error('pipeline handler must be a function');
    const priority = options && Number.isInteger(options.priority) ? options.priority : 0;
    const list = this._handlers.get(name) || [];
    list.push({ handler, priority });
    list.sort((a, b) => a.priority - b.priority);
    this._handlers.set(name, list);
    return () => this.unregister(name, handler);
  }

  unregister(name, handler) {
    const list = this._handlers.get(name) || [];
    const next = list.filter((entry) => entry.handler !== handler);
    if (next.length === 0) this._handlers.delete(name);
    else this._handlers.set(name, next);
  }

  async run(name, input, context) {
    const list = this._handlers.get(name) || [];
    let value = input;
    for (const { handler } of list) {
      try {
        value = await handler(value, context);
      } catch (error) {
        if (context && typeof context.onError === 'function') {
          context.onError(name, error);
          continue;
        }
        throw error;
      }
    }
    return value;
  }

  has(name) {
    return this._handlers.has(name);
  }
}

module.exports = { Pipeline };
