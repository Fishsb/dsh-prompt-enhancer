---
name: enhance-standard
description: 标准模式——T1 多轮脉络处理；T2 多轮演进增量。检索：多窗口会话关联（近/中/远三档）。
mode: standard
templates:
  t1: system.md
  t2: increment.md
retrieve:
  kind: rounds
  windows: [[1, 2], [3, 5], [6, 10]]
sources: ["session"]
rules: [{"rule": "reference-guide", "when": "参考块/记忆命中"}]
---

# 标准模式（standard）

T1（system.md）：多轮脉络处理（近 2 轮 / 3-5 轮 / 6-10 轮三档窗口，逐档 LLM 判定）。
T2（increment.md）：多轮演进增量（保守补充缺失大逻辑/信息）。
检索：rounds 窗口 [[1,2],[3,5],[6,10]]（由近及远，命中即停）。
