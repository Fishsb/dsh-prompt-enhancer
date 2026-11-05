'use strict';

// 增强 assemble 阶段（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 职责：把检索结果、记忆轮次与原文组装成 llm.stream 的消息数组，并写一条
// 配置日志。不调用模型、不读取服务、不写回草稿；纯函数与提示词由调用方注入。

function createAssembleStage(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const setProgress = typeof d.setProgress === 'function' ? d.setProgress : () => {};
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};
  const wrapUserText = d.wrapUserText;
  const wrapPublishText = d.wrapPublishText;
  const buildMemoryDeltaHint = d.buildMemoryDeltaHint;
  const buildChatMessages = d.buildChatMessages;
  const stageContext = d.stageContext;
  const continuePrompt = d.continuePrompt || '';

  async function enhanceStageAssemble(state) {
    const args = state.args;
    const sessionId = state.sessionId;
    const seq = state.seq;
    const text = state.text;
    // 2026-08-18（用户需求·每模式步骤补充）：assemble 阶段开始即上报进度「组装上下文」
    if (state.rec) setProgress(state.rec, stageContext);
    const cfg = state.cfg;
    const chain = state.chain;
    const system = state.system;
    const memRounds = state.memRounds;
    const memoryActive = state.memoryActive;
    const memDelta = state.memDelta;
    const v2Block = state.v2Block;
    const v2Log = state.v2Log;
    const isContinuation = state.isContinuation === true;
    const timeoutMs = state.timeoutMs;
    const maxTokens = state.maxTokens;
    const outputLimit = state.outputLimit;
    // v2.6.1：消息组装——记忆链经 buildChatMessages 成为真多轮 user/assistant 消息，
    // 最终 user 消息 = 本轮修改摘要 + 模式块 + 原文包裹；无记忆 → 单 user 消息（旧行为）。
    let memoryLog = '';
    // v2.8.0（一键发布 · 实测修正）：publish 用中性用户包装（wrapPublishText），
    // 其余模式沿用「请优化以下提示词」包装（行为不变）
    const wrappedText = state.isPublish ? wrapPublishText(text) : wrapUserText(text);
    let finalText = v2Block !== '' ? v2Block + '\n\n' + wrappedText : wrappedText;
    if (isContinuation) {
      state.system = system + '\n\n' + continuePrompt;
      const hint = buildMemoryDeltaHint(memDelta);
      finalText = '【本轮修改】（主要优化方向）\n' + (hint !== '' ? hint : '请基于当前草稿继续完善。') + '\n\n【当前提示词】\n"""\n' + text + '\n"""\n\n请基于以上修改继续完善，输出完整更新后的提示词。';
    }
    let messages;
    if (memoryActive) {
      const hint = buildMemoryDeltaHint(memDelta);
      if (hint !== '' && !isContinuation) finalText = hint + '\n\n' + finalText;
      const built = buildChatMessages(memRounds, finalText, 'enhance-' + sessionId + '-' + seq, cfg.context.budgetChars);
      messages = built.messages;
      memoryLog = 'memory rounds=' + memRounds.length + ' chars=' + built.memChars + ' delta=' + (hint !== '' ? 'yes' : 'none');
    } else {
      messages = [{ id: 'enhance-' + sessionId + '-' + seq, role: 'user', content: [{ type: 'text', text: finalText }], source: { kind: 'user' } }];
    }
    const modeTag = args && args.seed === true ? cfg.mode + '(seed)' : cfg.mode;
    const ctxLog = [v2Log === 'none' ? '' : v2Log, memoryLog].filter((s) => s !== '').join('+') || 'none';
    hlog('[enhance] cfg session=' + sessionId + ' mode=' + modeTag + ' ctx=' + ctxLog + ' chain=' + (chain.length > 0 ? chain.map((f) => f.provider + '/' + f.model).join(',') : '-') + ' timeout=' + timeoutMs + ' maxTokens=' + maxTokens + ' outputLimit=' + outputLimit + ' template=' + (cfg.templatePick && typeof cfg.templatePick === 'object' && cfg.templatePick[cfg.mode] ? cfg.templatePick[cfg.mode] : (cfg.templateMode === 'custom' ? 'custom' : 'builtin')));
    state.messages = messages;
    return state;
  }

  return { enhanceStageAssemble };
}

module.exports = { createAssembleStage };
