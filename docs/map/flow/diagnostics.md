# 功能链路 · 诊断日志（FLOW-DIAGNOSTICS）

> 记录 host 侧诊断日志与客户端查看的链路。FLOW-ID 前缀 `DG-`。

## DG-001：环形缓冲诊断日志

| 项 | 说明 |
|---|---|
| 缓冲 | `plugin-host.js` `LOG_RING`（最近 300 行环形缓冲） |
| RPC | `logs/last` 读取缓冲，供 client 诊断日志查看器 / 故障排查 |
| 版本来源 | v14 引入 |

## DG-002：日志内容维度

| 项 | 说明 |
|---|---|
| 模式 | `base/lite/standard/smart`（seed 场景标注 `(seed)`） |
| 模型链 | cfg 日志含 `chain=`（逐一尝试链） |
| 记忆 | ctx 日志含 `memory chars=` |
| 推理 | cfg 日志含 `effort=`（reasoningEffort 透传） |

## 变更纪律

新增 / 改动日志维度、缓冲大小、查看 RPC → 标注 `DG-xxx` 并同步日志与 `CHANGELOG.md`。
