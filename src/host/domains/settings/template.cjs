'use strict';

// 模板默认值 RPC（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 提示词正文仍来自 prompts/enhance 生成区；本模块只负责保持既有
// template/default 返回结构：defaults 指向 T1，catalog 指向 [T1, T2]。

function createTemplateRpc(prompts) {
  const p = prompts && typeof prompts === 'object' ? prompts : {};

  async function templateDefault() {
    return {
      ok: true,
      defaults: {
        base: p.base,
        lite: p.lite,
        standard: p.standard,
        smart: p.smart,
        publish: p.publish,
      },
      catalog: {
        base: [p.base, p.incrementBase],
        lite: [p.lite, p.incrementLite],
        standard: [p.standard, p.incrementStandard],
        smart: [p.smart, p.incrementSmart],
        publish: [p.publish, p.incrementPublish],
      },
    };
  }

  return { templateDefault };
}

module.exports = { createTemplateRpc };
