'use strict';
/**
 * Target module: enhance engine / pipeline.
 *
 * M2 深化（2026-08-16）：真实增强流程已在生成 bundle 内管道化——
 * src/host/enhance-handlers.js chunk 内置同契约 Pipeline（registerEnhanceStage/
 * runEnhanceStages），analyze/retrieve/assemble/llm 四 stage 注册式执行。
 * 本模块（src 侧）保持 M2 服务骨架：createService 供目标架构组合，
 * register 注册 no-op 兜底（bundle 运行时不受本模块影响，产物自包含）。
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
