---
name: enhance-smart
description: 开发向模式——T1 项目事实优先；T2 开发向增量。检索：会话关联 + 开发意向判定 + 工作区三门槛（.md/文档/代码）。
mode: smart
templates:
  t1: system.md
  t2: increment.md
retrieve:
  kind: rounds
  windows: [[1, 1], [2, 3]]
sources: ["session", "workspace"]
rules: [{"rule": "reference-guide", "when": "参考块/记忆命中"}, {"rule": "smart-tail", "when": "smart+开发意向+代码阶段"}]
---

# 开发向模式（smart）

T1（system.md）：项目事实优先（开发意向判定 → 工作区 .md + 相关文档 + 项目地图三门槛）。
T2（increment.md）：开发向增量（保守补充缺失大逻辑/信息）。
检索：rounds 窗口 [[1,1],[2,3]]；进工作区阶段（代码阶段追加 SMART_TAIL）。
