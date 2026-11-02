'use strict';

// 客户端共享运行时入口（普通 CommonJS；构建期由打包器内联）。
// 这里的模块必须无浏览器/宿主环境依赖：纯契约、纯规则。
const filler = require('./voice/filler-module.cjs');

module.exports = {
  FILLER_CHARS: filler.FILLER_CHARS,
  FILLER_CHARS_GUARDED: filler.FILLER_CHARS_GUARDED,
  FILLER_PHRASES_HARD: filler.FILLER_PHRASES_HARD,
  FILLER_PHRASES: filler.FILLER_PHRASES,
  FILLER_PROTECTED: filler.FILLER_PROTECTED,
  FILLER_REDUP_SAFE: filler.FILLER_REDUP_SAFE,
  stripFillers: filler.stripFillers,
  runFiller: filler.runFiller,
  fillerSnapshot: filler.fillerSnapshot,
  subscribeFiller: filler.subscribeFiller,
  notifyFiller: filler.notifyFiller,
};
