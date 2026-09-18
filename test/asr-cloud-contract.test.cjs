'use strict';
// 云端 ASR 出网契约断言（2026-09-18 Issue #9 外部反馈修复锚定）
//
// 背景：lib/asr.cjs 的 chat 协议请求体 content part **内层键名误写为 `audio`**（`type` 字段本已正确），
// 与服务端契约不符 → 阿里 DashScope 一律返回 400
// 「Expected 'input_audio' field in input_audio type content part to be a string or dict.」；
// 该 400 又被 `status >= 400` 分支一律映射为 ASR_BAD_RESPONSE，client errKeyFor 落到「音频无效」
// ⇒ 服务端契约错误被伪装成音频质量问题：引擎=云 + 协议=chat 的用户 100% 失败且无从自查。
//
// 缺口成因（本文件要堵的正是它）：仓库此前对 `transcribeChat` / `chat/completions` **零断言**——
// 只有 `node --check` 语法门与正弦波假音频的 voice-verify 冒烟门，「语法门 + 冒烟门都在，唯独契约字段无色」。
//
// 断开口径：**打桩 node:http.request，经导出入口 transcribe() 走生产全路径**
// （transcribe → transcribeChat / transcribeOpenai → httpsRequest → JSON 序列化），
// 断言真实落在网线上的请求体字段，而非源码字符串匹配。
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const asr = require('../lib/asr.cjs');

// 打桩后不会真出网；用 http: 协议使 httpsRequest 走 node:http（避免 TLS 依赖，断言同一序列化路径）
const BASE = 'http://127.0.0.1:9';
const DATA_URL = 'data:audio/wav;base64,' + Buffer.from('fake-pcm-bytes').toString('base64');

/**
 * 打桩 node:http.request：记录真实请求（url / headers / body），按 handler 返回的 {status, body} 应答。
 * handler 在 req.end() 时刻被调用（此时 httpsRequest 已完成 write，请求体完整）。
 */
async function withHttpStub(handler, fn) {
  const original = http.request;
  const calls = [];
  http.request = function (url, opts, cb) {
    const chunks = [];
    const req = new EventEmitter();
    req.write = (c) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; };
    req.destroy = () => {};
    req.end = () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const call = { url: String(url), opts: opts || {}, body };
      const reply = handler(call) || {};
      calls.push({ ...call, reply });
      const res = new EventEmitter();
      res.statusCode = reply.status || 200;
      if (typeof cb === 'function') cb(res);
      setImmediate(() => {
        res.emit('data', Buffer.from(reply.body || ''));
        res.emit('end');
      });
    };
    return req;
  };
  try {
    return await fn(calls);
  } finally {
    http.request = original;
  }
}

/** 云端 chat / openai 双协议配置（refine 关闭 → 全程仅一次出网，断言不被第二次请求干扰） */
function cloudCfg(protocol) {
  return {
    asr: {
      engine: 'cloud',
      cloud: { protocol, baseUrl: BASE, apiKey: 'test-key', model: 'qwen3-asr-flash' },
    },
    refine: { enabled: false },
  };
}

test('AC-01 chat 协议请求体：content part 内层键名必须是 input_audio（Issue #9 回归锚点）', async () => {
  await withHttpStub(
    () => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: '你好，世界' } }] }) }),
    async (calls) => {
      const res = await asr.transcribe(cloudCfg('chat'), DATA_URL);

      assert.equal(calls.length, 1, 'refine 关闭时应只有一次出网（ASR）');
      assert.equal(calls[0].url, BASE + '/chat/completions', 'chat 协议必须打 /chat/completions');
      assert.equal(calls[0].opts.headers.authorization, 'Bearer test-key', '鉴权头按配置注入');

      const body = JSON.parse(calls[0].body);
      assert.equal(body.model, 'qwen3-asr-flash', 'model 取自配置');
      const msg = body.messages[0];
      assert.equal(msg.role, 'user', '单条 user 消息');
      const part = msg.content[0];
      assert.equal(part.type, 'input_audio', 'content part 的 type（原本就写对的那个字段）');
      assert.deepEqual(part.input_audio, { data: DATA_URL, format: 'wav' },
        '内层键名必须是 input_audio —— 服务端契约字段；曾误写为 audio 导致 400 且云 ASR 全灭');
      assert.ok(!('audio' in part), '不得残留旧的错误键名 audio（防回退到 Issue #9 状态）');

      assert.equal(res.ok, true, '识别成功');
      assert.equal(res.text, '你好，世界', '正文经 extractText 取回');
    });
});

test('AC-02 服务端 400 契约错误 → ASR_BAD_RESPONSE（复现「音频无效」的伪装路径）', async () => {
  // 该错误体逐字取自 Issue #9 的外部实测报告（机器直出）
  const serverErr = JSON.stringify({
    error: {
      message: "Invalid content. Expected 'input_audio' field in input_audio type content part to be a string or dict.",
      type: 'internal_server_error',
      code: 'internal_server_error',
    },
  });
  await withHttpStub(
    () => ({ status: 400, body: serverErr }),
    async (calls) => {
      const res = await asr.transcribe(cloudCfg('chat'), DATA_URL);
      assert.equal(calls.length, 1);
      assert.equal(res.ok, false);
      assert.equal(res.code, 'ASR_BAD_RESPONSE',
        '一切 status>=400 都落 ASR_BAD_RESPONSE → client errKeyFor 显示「音频无效」'
        + '（故该类契约错误在 UI 上表现为音频质量问题，用户无从自查）');
      assert.ok(/input_audio/.test(res.message), '服务端原始报错须透传在 message（排查线索不丢）');
    });
});

test('AC-03 openai 协议路由：multipart 走 /audio/transcriptions，不受 chat 修复影响', async () => {
  await withHttpStub(
    () => ({ status: 200, body: JSON.stringify({ text: '你好，世界' }) }),
    async (calls) => {
      const res = await asr.transcribe(cloudCfg('openai'), DATA_URL);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, BASE + '/audio/transcriptions', 'openai 协议必须打 /audio/transcriptions');
      assert.ok(String(calls[0].opts.headers['content-type']).startsWith('multipart/form-data; boundary='),
        'openai 协议走 multipart 而非 JSON');
      assert.ok(calls[0].body.includes('name="file"'), 'multipart 含 file 段');
      assert.ok(calls[0].body.includes('name="model"'), 'multipart 含 model 段');
      assert.ok(!calls[0].body.includes('input_audio'), 'openai 协议不带 input_audio 字段（协议分派正确）');

      assert.equal(res.ok, true);
      assert.equal(res.text, '你好，世界');
    });
});
