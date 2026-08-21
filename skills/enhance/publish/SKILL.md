---
name: enhance-publish
description: 一键发布模式——T1 九章需求规格（IEEE 29148/GDD）；T2 九章规格增量。检索：多步网络检索（主题规划→逐主题搜索→跨轮记忆回注）。
mode: publish
templates:
  t1: system.md
  t2: increment.md
retrieve:
  kind: v2
  windows: []
---

# 一键发布模式（publish）

T1（system.md）：九章需求规格生成（IEEE 29148 / GDD 方法论，输出结构严格九章 + 方案自评）。
T2（increment.md）：九章规格增量（保守补充缺失大逻辑/信息）。
检索：v2 多步网络检索（LLM 规划主题 → 逐主题搜索 → 跨轮记忆回注，预算 > 0 才启用）。
