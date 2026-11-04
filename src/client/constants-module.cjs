'use strict';

// 客户端常量与配置默认值（目标模式：普通 CommonJS，构建期由共享运行时内联）。

const contractData = require('../shared/contracts/contract-data.cjs');

const CONFIG_KEY = 'dsh.enhance.config.v2';
const CONFIG_KEY_V1 = 'dsh.enhance.config.v1';
const CONFIG_DEFAULTS = JSON.parse(JSON.stringify(contractData.CONFIG_DEFAULTS));
// v20 曾内置兜底链硬编码 DeepSeek 官方（fresh install 补足与「恢复默认」）；
// 2026-08-18（用户需求·删内置兜底链）：已删除——完全按模型配置顺序，空配置报无模型
// v3.2（用户需求）：恢复默认 / 首次安装的默认模型链 = 官方两个模型（1 Flash、2 Pro）。
// 注意：非运行时兜底——增强时模型链为空仍报 NO_MODEL（不自动使用）；模型可删除可改。
const DEFAULT_MODEL_CHAIN = JSON.parse(JSON.stringify(contractData.DEFAULT_MODEL_CHAIN));
// v2.2（§4.3/§6.6）：模式选项单点（4 模式，记忆模式已删除——记忆为独立开关）
// v2.3（§7.2）：short = 模式短标签（idle 按钮内显示；i18n modeShort* 键优先，此字段为回退）
const MODE_OPTIONS = [
  { value: 'base', label: '基础模式', short: '基础', hint: '直发优化，不读取任何上下文，全体系最快最省' },
  { value: 'lite', label: '轻量模式', short: '轻量', hint: '仅参考最近 1 轮会话（LLM 判定关联，有关联才作为参考）；零工作区检索' },
  { value: 'standard', label: '标准模式', short: '标准', hint: '会话递进参考（前 2 轮 → 第 3-5 轮 → 第 6-10 轮），LLM 判定关联、命中即止' },
  { value: 'smart', label: '专家模式', short: '专家', hint: '会话关联递进 + 工作区 .md 文档与开发环境判断 + 代码文档检索；以软件工程专业词汇优化并输出调整方案' },
  // v2.7.0（一键发布）：项目/游戏开发规格生成——网络检索 + 工作区检索 + 九章规格
  { value: 'publish', label: '一键发布', short: '发布', hint: '输入粗略想法（如"想开发一个纸牌游戏"）→ 自动规划 2~3 个检索主题 + 多步网络检索 + 工作区参考，一键生成完善、边界明确的生成提示词规格（九章：目标与角色/范围边界/技术架构/核心要求/场景内容/交互/扩展/交付限制/验收清单）；检索要点跨轮记忆，多轮补充逐步细化（记忆强制开启；上下文预算需 > 0 才启用检索）' },
];
const MODE_VALUES = MODE_OPTIONS.map((m) => m.value);
if (MODE_VALUES.length !== contractData.MODE_KEYS.length || MODE_VALUES.some((k, i) => k !== contractData.MODE_KEYS[i])) {
  throw new Error('client constants: MODE_OPTIONS 与契约模式键不一致');
}
// v3.1.8（用户需求·预算真正生效 + 每模式独立档位）：每模式上下文预算可用档位（与 host pure.js
// MODE_BUDGET_OPTIONS 一致）——client 下拉按此渲染、切换模式时校正 budgetChars；base 无上下文检索仅 0。
const MODE_BUDGET_OPTIONS = JSON.parse(JSON.stringify(contractData.MODE_BUDGET_OPTIONS));
// v3.1.8（实测驱动·用户指令 2026-08-18）：超时/Token/字符每模式档位——基于 4 模式 × 3 次真实增强实测
// （默认模板 T1、不带思考）：base avg 2.6s / lite 5.7s / standard 2.2s / smart 6.7s（最大 9.8s）；
// 输出 156–336 字符（≈40–85 token）。档位 = 0（无限制）/ 标准档（默认，实测×余量+模板语义保真上限）
// / 思考档（开启思考预留）/ 复杂档（复杂模板预留）。smart 管道含检索/判定/工作区调用 → 更高标准档。
const MODE_TIMEOUT_OPTIONS = JSON.parse(JSON.stringify(contractData.MODE_TIMEOUT_OPTIONS));
const MODE_MAXTOKENS_OPTIONS = JSON.parse(JSON.stringify(contractData.MODE_MAXTOKENS_OPTIONS));
const MODE_OUTPUTLIMIT_OPTIONS = JSON.parse(JSON.stringify(contractData.MODE_OUTPUTLIMIT_OPTIONS));
// v3.1.8（切换模式重置默认）：每模式默认档位（标准档）——与 host pure.js MODE_PARAMS_DEFAULT /
// MODE_BUDGET_DEFAULT 一致；切换模式时 client 将 params + budgetChars 重置到该模式默认。
const MODE_PARAMS_DEFAULT = JSON.parse(JSON.stringify(contractData.MODE_PARAMS_DEFAULT));
const MODE_BUDGET_DEFAULT = JSON.parse(JSON.stringify(contractData.MODE_BUDGET_DEFAULT));
// v2.3（§7.2）：模式短标签解析——i18n 键（modeShort+Cap）优先（EN 正确），MODE_OPTIONS.short 回退
function modeShortLabel(t, mode) {
  const key = 'modeShort' + (mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : '');
  const localized = t(key);
  if (localized !== key) return localized;
  const row = MODE_OPTIONS.find((m) => m.value === mode);
  return row && row.short ? row.short : '';
}
// v3.1.7（用户反馈·设置页模式下拉不跟随语言）：模式全称解析——i18n 键（modeLabel+Cap）优先，
// MODE_OPTIONS.label 回退（label 字段保留中文兜底，i18n 缺失时仍可显示）
function modeLabel(t, mode) {
  const key = 'modeLabel' + (mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : '');
  const localized = t(key);
  if (localized !== key) return localized;
  const row = MODE_OPTIONS.find((m) => m.value === mode);
  return row && row.label ? row.label : '';
}
// 已优化标记键（§2.4）：localStorage 按会话布尔标记（区分首次与 reload；仅记忆开启期打标）
const SEEN_KEY_PREFIX = 'dsh.enhance.seen.';
// v2.6.1（记忆链）：发送前迭代记忆最多保留轮数（与 host MEMORY_ROUNDS_MAX 一致）
const MEMORY_ROUNDS_MAX = contractData.MEMORY_ROUNDS_MAX;
// 模板体系扩展（2026-08-18 修订）：内置模板键（T1=default 默认模板·只清晰化重述不扩展 /
// T2=increment 增量模板·保守补充未说的大逻辑/信息，每模式方向不同）+ 自定义模板容量/长度上限（与 host PURE 常量一致）
const TEMPLATE_BUILTIN_KEYS = contractData.TEMPLATE_BUILTIN_KEYS.slice();
const TEMPLATE_CUSTOM_MAX = contractData.TEMPLATE_CUSTOM_MAX;
const TEMPLATE_TEXT_MAX = contractData.TEMPLATE_TEXT_MAX;
const TEMPLATE_NAME_MAX = contractData.TEMPLATE_NAME_MAX;
// 选中键中自定义模板的索引（pick 形如 custom:<index>）→ -1 表示非自定义
function customPickIndex(pick) {
  if (typeof pick !== 'string' || pick.indexOf('custom:') !== 0) return -1;
  const idx = parseInt(pick.slice(7), 10);
  return Number.isInteger(idx) && idx >= 0 ? idx : -1;
}

module.exports = {
  CONFIG_KEY,
  CONFIG_KEY_V1,
  CONFIG_DEFAULTS,
  DEFAULT_MODEL_CHAIN,
  MODE_OPTIONS,
  MODE_VALUES,
  MODE_BUDGET_OPTIONS,
  MODE_TIMEOUT_OPTIONS,
  MODE_MAXTOKENS_OPTIONS,
  MODE_OUTPUTLIMIT_OPTIONS,
  MODE_PARAMS_DEFAULT,
  MODE_BUDGET_DEFAULT,
  modeShortLabel,
  modeLabel,
  SEEN_KEY_PREFIX,
  MEMORY_ROUNDS_MAX,
  TEMPLATE_BUILTIN_KEYS,
  TEMPLATE_CUSTOM_MAX,
  TEMPLATE_TEXT_MAX,
  TEMPLATE_NAME_MAX,
  customPickIndex,
};
