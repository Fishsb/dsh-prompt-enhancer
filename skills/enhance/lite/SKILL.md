---
name: enhance-lite
description: 轻量模式——T1 上轮参考处理；T2 上轮延续增量。检索：前 1 轮会话关联参考。
mode: lite
templates:
  t1: system.md
  t2: increment.md
retrieve:
  kind: rounds
  windows: [[1, 1]]
---

# 轻量模式（lite）

T1（system.md）：上轮参考处理（前 1 轮会话关联，仅吸收明确需求）。
T2（increment.md）：上轮延续增量（保守补充缺失大逻辑/信息）。
检索：rounds 窗口 [[1,1]]（最近 1 轮，LLM 判定关联命中即注入参考）。
