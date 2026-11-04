'use strict';

// 增强阶段注册器与执行器（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 职责边界：
//   · 只负责「按契约顺序执行已注册的阶段处理器」；
//   · 不读取配置、不调用模型、不写回草稿；
//   · 阶段顺序唯一事实源 = src/shared/contracts/enhance-stages.cjs。
//
// 兼容性：内部阶段为 analyze / retrieve / assemble / llm / commit；
// 线上 enhance/progress 的既有 stage 名仍保持 llm，现有 UI 文案映射不需要改动。
const { ENHANCE_STAGE_ORDER } = require('../shared/contracts/enhance-stages.cjs');

function createEnhancePipeline(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const order = Array.isArray(opts.order) && opts.order.length > 0 ? opts.order.slice() : ENHANCE_STAGE_ORDER.slice();
  const handlers = new Map();

  function assertStage(name) {
    if (typeof name !== 'string' || order.indexOf(name) === -1) {
      throw new Error('enhance-pipeline: unknown stage ' + String(name));
    }
  }

  function register(name, handler, registerOptions) {
    assertStage(name);
    if (typeof handler !== 'function') {
      throw new Error('enhance-pipeline: handler must be a function');
    }
    const priority = registerOptions && Number.isInteger(registerOptions.priority) ? registerOptions.priority : 0;
    const list = handlers.get(name) || [];
    list.push({ handler, priority });
    list.sort((a, b) => a.priority - b.priority);
    handlers.set(name, list);
  }

  async function run(name, value) {
    assertStage(name);
    const list = handlers.get(name) || [];
    let current = value;
    for (const entry of list) current = await entry.handler(current);
    return current;
  }

  async function runAll(value) {
    let current = value;
    for (const name of order) current = await run(name, current);
    return current;
  }

  function stages() {
    return order.slice();
  }

  function handlersFor(name) {
    assertStage(name);
    return (handlers.get(name) || []).map((entry) => entry.handler);
  }

  return { register, run, runAll, stages, handlersFor };
}

module.exports = { createEnhancePipeline };
