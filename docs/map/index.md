# 项目地图 · 总导航（index）

> dsh-prompt-enhancer 的【项目地图】入口。
> **agent 开工前先读本文件**，按需下钻到对应层。

## 地图分层

| 层 | 内容 | 入口 |
|---|---|---|
| **root** | 模块级：每个区域负责什么、改动影响谁 | [`./root.md`](root.md) |
| **tree** | 文件级：每个文件职责/影响/关联 | [`./tree/files.md`](tree/files.md) |
| **flow** | 功能链路：用户动作→代码→接口→影响的完整因果 | [`./flow/`](flow/) |

## 功能链路索引（flow）

| FLOW-ID | 链路 | 文件 |
|---|---|---|
| `PEN-001..004` | 提示词增强核心流程 / 模式体系 / 记忆状态 / 模型链 | [`flow/prompt-enhance.md`](flow/prompt-enhance.md) |
| `VU-001` | 版本检测与一键更新 | [`flow/version-update.md`](flow/version-update.md) |
| `DG-001..002` | 诊断日志 | [`flow/diagnostics.md`](flow/diagnostics.md) |

## 配套文件

| 用途 | 文件 |
|---|---|
| 协同治理入口（agent 开工必读） | [`../AGENTS.md`](../AGENTS.md) |
| 更新日志（Keep a Changelog） | [`../CHANGELOG.md`](../CHANGELOG.md) |

## 地图更新纪律

- **新增 FLOW** → 建 `flow/<name>.md` 并在此登记 FLOW-ID。
- **文件/模块变化** → 更新 `tree/` 与 `root.md`。
- **规则变化** → 更新 `../AGENTS.md`（本封面的治理规则源头）。

> 地图与 CHANGELOG 互为参照：日志条目应标注涉及的 map/flow-id；地图链路应引用变更记录。
