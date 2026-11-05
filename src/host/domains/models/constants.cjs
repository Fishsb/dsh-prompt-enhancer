'use strict';

// 模型/增强的默认参数常量（原位于 models chunk，供 PURE 的 validateConfig 使用）。
// 目标模式：普通 CommonJS 模块，由打包器内联；不再由构建脚本切片注入。
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_OUTPUT_LIMIT = 8000;

module.exports = { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOKENS, DEFAULT_OUTPUT_LIMIT };
