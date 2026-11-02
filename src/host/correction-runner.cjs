'use strict';

// 语音纠错执行域（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 边界：
//   · 只负责 voice/correct 的一次执行（开关守卫、历史参考、模型链、结果清洗）；
//   · 宿主能力（llm / timer / sessionQuery / readVoiceConfig）全部经 deps 注入；
//   · 不注册 RPC、不读全局变量、不直接操作 pending/progress。
//
// 兼容性：返回值与既有 RPC 逐项一致，包括 skipped/skippedBy/switchFrom/code、
// changed、historyChars、fallbackUsed 与失败 code/message。
const { resolveCorrectionSwitch, CORRECTION_DISABLED_CODE, CORRECTION_ENABLED_REASON } = require('./correction-switch.cjs');

const CORRECTION_WINDOW = [1, 1];
const CORRECTION_TIMEOUT_MS = 30000;
const CORRECTION_MAX_TOKENS = 4000;
const CORRECTION_OUTPUT_LIMIT = 16000;

function createCorrectionRunner(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const ctx = d.ctx;
  const harness = d.harness;
  const llm = d.llm;
  const hlog = typeof d.hlog === 'function' ? d.hlog : () => {};
  const startWaitAbort = d.startWaitAbort;
  const validateConfig = d.validateConfig;
  const buildTryChain = d.buildTryChain;
  const collectStream = d.collectStream;
  const cleanCorrectionOutput = d.cleanCorrectionOutput;
  const friendlyMessage = d.friendlyMessage;
  const extractHistoryConclusions = d.extractHistoryConclusions;
  const splitHistoryRounds = d.splitHistoryRounds;
  const correctionPrompt = d.correctionPrompt;
  const historyTimeoutMs = d.historyTimeoutMs;

  async function fetchCorrectionHistory(sessionId) {
    const sq = ctx && typeof ctx.get === 'function' ? ctx.get('sessionQuery') : null;
    if (!sq || typeof sq.readSurface !== 'function') {
      hlog('[correction] history skipped no-readSurface');
      return '';
    }
    const waitAbort = startWaitAbort(ctx.timer, historyTimeoutMs);
    try {
      const surface = await waitAbort.race(sq.readSurface(sessionId));
      if (waitAbort.timedOut()) { hlog('[correction] history timeout'); return ''; }
      const events = extractHistoryConclusions(surface && surface.events);
      const lines = splitHistoryRounds(events, CORRECTION_WINDOW[0], CORRECTION_WINDOW[1]);
      const text = lines.join('\n');
      hlog('[correction] history rounds=' + CORRECTION_WINDOW[0] + '-' + CORRECTION_WINDOW[1] + ' events=' + events.length + ' chars=' + text.length);
      return text;
    } catch (e) {
      hlog('[correction] history failed', e && e.message ? e.message : e);
      return '';
    } finally {
      waitAbort.dispose();
    }
  }

  async function runCorrection(args) {
    const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : 'unknown';
    const text = args && typeof args.text === 'string' ? args.text : '';
    if (text.trim() === '') return { ok: false, code: 'GUARD', message: friendlyMessage({ code: 'GUARD' }) };

    if (llm === undefined) return { ok: false, code: 'NO_LLM', message: friendlyMessage({ code: 'NO_LLM' }) };
    const cfg = validateConfig(args && args.config);
    // 宿主 harness 缺 readVoiceConfig（旧夹具/非 bundle 载体）时，按既有语义回退请求配置；
    // 产品链路始终由 harness.readVoiceConfig() 提供归一化面。
    const corrSwitch = resolveCorrectionSwitch(args && args.config, harness && typeof harness.readVoiceConfig === 'function' ? harness : null);
    if (corrSwitch.on !== true) {
      hlog('[correction] skipped session=' + sessionId + ' from=' + corrSwitch.from);
      return {
        ok: true,
        skipped: true,
        skippedBy: CORRECTION_ENABLED_REASON,
        switchFrom: corrSwitch.from,
        code: CORRECTION_DISABLED_CODE,
        text,
        message: friendlyMessage({ code: CORRECTION_DISABLED_CODE }),
      };
    }
    const chain = buildTryChain(cfg.fallback);
    if (chain.length === 0) return { ok: false, code: 'NO_MODEL', message: friendlyMessage({ code: 'NO_MODEL' }) };
    const historyText = await fetchCorrectionHistory(sessionId);
    const system = correctionPrompt.replace('{history}', historyText);
    let lastFailure = null;
    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      let timedOut = false;
      let abortIterator = null;
      let settleTimeout = null;
      const gate = new Promise((resolve) => { settleTimeout = resolve; });
      const fireAbort = () => {
        timedOut = true;
        if (abortIterator && typeof abortIterator.return === 'function') {
          try { abortIterator.return(); } catch (e) { /* 忽略 */ }
        }
        try { settleTimeout({ kind: 'aborted', aborted: true }); } catch (e) { /* 忽略 */ }
      };
      const timer = ctx.timer.timeout(fireAbort, CORRECTION_TIMEOUT_MS);
      try {
        hlog('[correction] try session=' + sessionId + ' provider=' + entry.provider + ' model=' + entry.model);
        const stream = llm.stream({
          provider: entry.provider,
          model: entry.model,
          maxTokens: CORRECTION_MAX_TOKENS,
          temperature: 0.3,
          system,
          messages: [{
            id: 'correction-' + sessionId,
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          }],
        });
        const iterator = stream[Symbol.asyncIterator]();
        abortIterator = iterator;
        const collectP = collectStream(iterator, CORRECTION_OUTPUT_LIMIT);
        collectP.catch(() => { /* 落败方 */ });
        const result = await Promise.race([collectP, gate]);
        if (!timedOut && result.kind === 'ok') {
          const out = cleanCorrectionOutput(result.text, text);
          if (typeof out === 'string' && out.trim() !== '') {
            hlog('[correction] ok session=' + sessionId + ' chars=' + out.length + ' history=' + historyText.length);
            const changedFlag = out !== text;
            return { ok: true, text: out, provider: entry.provider, model: entry.model, historyChars: historyText.length, changed: changedFlag, fallbackUsed: i > 0 };
          }
          lastFailure = { code: 'EMPTY_RESPONSE' };
        } else {
          lastFailure = timedOut ? { code: 'TIMEOUT' }
            : (result.kind === 'maxtokens' ? { code: 'OUTPUT_TRUNCATED' }
            : (result.failure || { code: 'EMPTY_RESPONSE' }));
        }
      } catch (e) {
        lastFailure = { code: e && e.code ? String(e.code) : 'STREAM_THROW', message: String(e && e.message ? e.message : e) };
        hlog('[correction] stream failed code=' + lastFailure.code);
      } finally {
        try { timer(); } catch (e) { /* 忽略 */ }
        if (abortIterator && typeof abortIterator.return === 'function') {
          try { abortIterator.return(); } catch (e) { /* 忽略 */ }
        }
      }
      const code = lastFailure ? lastFailure.code : 'UNKNOWN';
      if (code === 'TIMEOUT' || code === 'ABORTED' || code === 'OUTPUT_TRUNCATED') break;
    }
    const code = lastFailure && lastFailure.code ? lastFailure.code : 'LLM_FAILED';
    hlog('[correction] failed session=' + sessionId + ' code=' + code);
    return { ok: false, code, message: friendlyMessage({ code }) };
  }

  return { runCorrection, fetchCorrectionHistory };
}

module.exports = {
  CORRECTION_WINDOW,
  CORRECTION_TIMEOUT_MS,
  CORRECTION_MAX_TOKENS,
  CORRECTION_OUTPUT_LIMIT,
  createCorrectionRunner,
};
