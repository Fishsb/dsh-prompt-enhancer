'use strict';
/**
 * Target module: enhance engine / pipeline.
 *
 * M2: this module exposes an EnhanceService built on the shared Pipeline.
 * The monolithic handler was extracted to src/host/enhance-handlers.js
 * (chunk, injected into the generated bundle); M2 深化时把真实 stage handler
 * 迁移到此处注册。
 */
const STAGES = {
  ANALYZE: 'analyze',
  RETRIEVE: 'retrieve',
  ASSEMBLE: 'assemble',
  LLM: 'llm',
};

function createService(services) {
  const pipeline = services && services.get ? services.get('enhance.pipeline') : null;
  if (!pipeline) throw new Error('enhance.pipeline service is required');

  async function run(input, context) {
    let value = input;
    for (const stage of [STAGES.ANALYZE, STAGES.RETRIEVE, STAGES.ASSEMBLE, STAGES.LLM]) {
      value = await pipeline.run(stage, value, context);
    }
    return value;
  }

  return { run, stages: STAGES };
}

function register(ctx, services) {
  const pipeline = services.get('enhance.pipeline');
  // Default no-op handlers so the pipeline is always runnable until real
  // stage implementations are migrated from legacy.
  for (const stage of Object.values(STAGES)) {
    if (!pipeline.has(stage)) {
      pipeline.register(stage, async (value) => value, { priority: 100 });
    }
  }
}

module.exports = { createService, register, STAGES };
