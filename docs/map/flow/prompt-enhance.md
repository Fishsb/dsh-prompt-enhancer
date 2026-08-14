# 功能链路 · 提示词增强（FLOW-PROMPT-ENHANCE）

> 记录『用户触发 → client 动作 → RPC → host 处理 → 输出』的完整链路。
> 改本链路任一环节，必须评估对上下游的影响。FLOW-ID 前缀 `PEN-`。

---

## 主链路 PEN-001：提示词增强核心流程（engine=v1/v2）

| 环节 | 载体 | 说明 |
|---|---|---|
| 用户触发 | `plugin-client.js` EnhanceButton | 订阅 configState，idle=emoji✨+模式短标签；enhancing=spinner+步骤进度 |
| client 请求 | `plugin-client.js` → `window? no` 注：client 经 `host.call`/RPC | 调 host `enhance` |
| RPC 桥接 | `lib/client.cjs` `host.call` → `/dsh-prompt-enhancer/rpc` | POST {method,args} |
| host 入口 | `lib/index.cjs` → `plugin-host.js` | route method 到 handler |
| 主处理 | `plugin-host.js` `handleEnhance` | engine=v1：主/兜底链逐一尝试；engine=v2：阶段A任务进度→阶段B工作区相关性→阶段C预算组装 |
| 阶段回调 | `plugin-host.js` `onStage` | prepare→history→analyze→files→events→context→llm |
| 进度轮询 | `plugin-host.js` `enhance/progress` | client 500ms 轮询；纯展示，失败静默降级 |
| 模型调用 | `plugin-host.js` `llm.stream` | 透传 reasoningEffort（主模型思考等级） |
| 输出 | 写回 composer（带 undo） | 用户可撤销 |

**关联 FLOW**：`PEN-002`（模式）、`PEN-003`（记忆）。

---

## PEN-002：模式体系

| 项 | 说明 |
|---|---|
| 4 模式 | `base / lite / standard / smart` |
| 载体 | `plugin-host.js` `MODE_TABLE`（表驱动，阶段 A/B/C 分发） |
| 迁移 | 旧 `mode='memory'` → `mode='lite'+memory=true`；`autoMemory` 并入 `memory` |
| client 表现 | 模式切换即时同步；`MODE_OPTIONS.short` + i18n `modeShort*` 键 |

---

## PEN-003：记忆状态

| 项 | 说明 |
|---|---|
| 开关 | `config.memory`（缺省 `false`），所有模式可独立开/关 |
| 注入 | `shouldInjectMemory` 是否注入记忆块；优先占用预算（≤1200 字符） |
| client 表现 | 记忆开关只影响 emoji 饱和度（开=彩色/关=低饱和）；文字饱和度不变 |

---

## PEN-004：模型链 / 尝试链

| 项 | 说明 |
|---|---|
| 链 | `buildTryChain` — 不再区分 main/fallback，按链顺序逐一尝试 |
| 兜底 | v20 起硬编码 DeepSeek 官方模型（deepseek-v4-flash / deepseek-v4-pro） |
| 主模型 | `models/current` → `agentDefaultModel.currentSelection()`（fresh install 兜底链继承） |
| 解析缓存 | `resolveModelInfoCached`（TTL 5min，provider:model 键，200 条上限） |
| 自适应链 | `resolveAdaptiveChain`（60s TTL 缓存）+ `models/autochain`；`models/test` 连通性测试 |

---

## 变更纪律

用户可感知的行为变更、模型链/模式/记忆任何调整 → **必须同步更新 `CHANGELOG.md [Unreleased]` 并标注 `PEN-xxx`**。
