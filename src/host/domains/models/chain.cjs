'use strict';

// 目标模式：host 模型域普通 CommonJS 模块（构建期由打包器内联）。
// herr 缺省静默；生产 bundle 内由宿主全局提供（与旧 chunk 同语义）。
// v20：内置兜底链硬编码指向 DeepSeek 官方模型（provider=deepseek-official）。
// 主模型优先取 agentDefaultModel.currentSelection()（当前使用模型），
// 兜底补足固定为 DeepSeek 官方模型链，不再扫描任意 provider（保证确定性）。
const DEEPSEEK_OFFICIAL_CHAIN = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
];
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_OUTPUT_LIMIT = 8000;
// 兜底链 TTL 缓存（避免每次 enhance 都重新解析）
const adaptiveChainCache = { value: null, at: 0 };
const ADAPTIVE_CHAIN_TTL_MS = 60000;
// v21（P1-4）：模型能力解析缓存（resolveModelInfo 结果，TTL 5 分钟，按 provider:model 键）
// 避免 models/resolve 每次调用都重复走适配器能力查询（可能含网络发现，毫秒~秒级开销）
const modelInfoCache = new Map();
const MODEL_INFO_TTL_MS = 300000;

async function resolveModelInfoCached(llmService, provider, model, noCache) {
  const key = provider + '/' + model;
  const hit = modelInfoCache.get(key);
  const now = Date.now();
  if (!noCache && hit && (now - hit.at) < MODEL_INFO_TTL_MS) return hit.value;
  const info = await llmService.resolveModelInfo(provider, model);
  modelInfoCache.set(key, { value: info, at: now });
  // 防无限增长：超过 200 条时清理过期项
  if (modelInfoCache.size > 200) {
    for (const [k, v] of modelInfoCache) {
      if ((now - v.at) >= MODEL_INFO_TTL_MS) modelInfoCache.delete(k);
    }
  }
  return info;
}

async function resolveAdaptiveChain(llmSvc, adm, noCache) {
  const now = Date.now();
  if (!noCache && adaptiveChainCache.value && (now - adaptiveChainCache.at) < ADAPTIVE_CHAIN_TTL_MS) {
    return adaptiveChainCache.value;
  }
  const chain = [];
  try {
    if (adm && typeof adm.currentSelection === 'function') {
      const sel = adm.currentSelection();
      if (sel && typeof sel.provider === 'string' && sel.provider &&
          typeof sel.model === 'string' && sel.model) {
        const lead = { provider: sel.provider, model: sel.model };
        if (typeof sel.reasoningEffort === 'string' && sel.reasoningEffort) lead.reasoningEffort = sel.reasoningEffort;
        chain.push(lead);
      }
    }
  } catch (e) { herr('[enhance] adaptive lead resolve failed', e); }
  // 兜底补足固定为 DeepSeek 官方模型（硬编码，不扫描环境）
  for (const d of DEEPSEEK_OFFICIAL_CHAIN) {
    if (!chain.some((e) => e.provider === d.provider && e.model === d.model)) chain.push({ ...d });
  }
  adaptiveChainCache.value = chain;
  adaptiveChainCache.at = now;
  return chain;
}

module.exports = {
  resolveModelInfoCached,
  resolveAdaptiveChain,
  DEEPSEEK_OFFICIAL_CHAIN,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_OUTPUT_LIMIT,
  adaptiveChainCache,
  ADAPTIVE_CHAIN_TTL_MS,
  modelInfoCache,
  MODEL_INFO_TTL_MS,
};
