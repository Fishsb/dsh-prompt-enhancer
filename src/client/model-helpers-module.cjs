'use strict';

// 客户端模型候选纯函数（目标模式：普通 CommonJS，构建期由共享运行时内联）。
// 候选顺序 = order 中的显式位置优先，其次内置候选优先于自定义候选。
function buildCandidates(providers, customModels, order) {
  const list = [];
  if (providers) {
    for (const p of providers) {
      for (const m of p.models || []) list.push({ provider: p.provider, model: m.id, name: m.name || m.id, custom: false });
    }
  }
  for (const c of customModels || []) list.push({ provider: c.provider, model: c.model, name: c.name || c.model, custom: true });
  const orderIndex = new Map();
  (order || []).forEach((k, i) => orderIndex.set(k, i));
  list.sort((a, b) => {
    const ia = orderIndex.has(a.provider + '/' + a.model) ? orderIndex.get(a.provider + '/' + a.model) : 1e9;
    const ib = orderIndex.has(b.provider + '/' + b.model) ? orderIndex.get(b.provider + '/' + b.model) : 1e9;
    if (ia !== ib) return ia - ib;
    return (a.custom ? 1 : 0) - (b.custom ? 1 : 0);
  });
  return list;
}

module.exports = { buildCandidates };
