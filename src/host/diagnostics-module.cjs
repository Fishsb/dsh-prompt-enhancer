'use strict';

// 诊断日志环形缓冲（目标模式：普通 CommonJS，构建期由打包器内联）。
//
// 契约（与旧 diagnostics chunk 逐项一致）：
//   · LOG_RING 保存最近 300 行；
//   · 每行统一以 ISO 时间戳前缀开始；
//   · hlog 写 console.log，herr 写 console.error；
//   · 对象参数 JSON.stringify，序列化失败时回退 String。
//
// 运行产物仍需自包含：console 由构建期注入，模块内不读取宿主全局。
const LOG_RING_MAX = 300;

function formatLine(args) {
  return '[' + new Date().toISOString() + '] ' + Array.prototype.map.call(args, (a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
}

function createDiagnostics(consoleLike) {
  const out = consoleLike && typeof consoleLike === 'object' ? consoleLike : {};
  const ring = [];

  function append(line) {
    ring.push(line);
    if (ring.length > LOG_RING_MAX) ring.shift();
  }

  function hlog() {
    const line = formatLine(arguments);
    append(line);
    if (typeof out.log === 'function') out.log(line);
  }

  function herr() {
    const line = formatLine(arguments);
    append(line);
    if (typeof out.error === 'function') out.error(line);
  }

  return { LOG_RING: ring, LOG_RING_MAX, hlog, herr };
}

module.exports = { LOG_RING_MAX, createDiagnostics };
