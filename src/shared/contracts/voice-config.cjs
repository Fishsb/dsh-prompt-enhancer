'use strict';

// 语音配置契约：内部键与默认值。
// 用户可见名称不在此处；本模块只冻结内部标识符，避免 client/host 各自手写。
// 目标模式：实现落在发布物内的 lib/voice-config.cjs（npm files 白名单只含 lib/），
// 本文件仅作源码侧转发，保证源码测试与安装包共用同一份事实源。
module.exports = require('../../../lib/voice-config.cjs');

