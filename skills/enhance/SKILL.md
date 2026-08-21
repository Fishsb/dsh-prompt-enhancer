---
name: enhance
description: 提示词增强技能包——5 模式 × (T1 重述梳理 / T2 保守增量) + 全局纪律层 + 检索判定子技能。代码只做加载编排，行为知识全部声明于此。
modes: ["base", "lite", "standard", "smart", "publish"]
retrieve:
  budgets: [{"budget":0,"roundsChars":0,"smartDocs":0,"smartDepth":0,"smartChars":0,"smartCodeChars":0},{"budget":2000,"roundsChars":1200,"smartDocs":2,"smartDepth":2,"smartChars":1500,"smartCodeChars":1200},{"budget":4000,"roundsChars":2400,"smartDocs":3,"smartDepth":2,"smartChars":3000,"smartCodeChars":2400},{"budget":8000,"roundsChars":4800,"smartDocs":5,"smartDepth":3,"smartChars":5000,"smartCodeChars":4800},{"budget":16000,"roundsChars":9600,"smartDocs":8,"smartDepth":4,"smartChars":8000,"smartCodeChars":8000},{"budget":32000,"roundsChars":16000,"smartDocs":12,"smartDepth":5,"smartChars":12000,"smartCodeChars":12000}]
---

# 提示词增强技能包

本包以「技能集合」方式组织提示词增强的所有行为知识：

- **模式技能**（base/lite/standard/smart/publish）：每个目录一个技能，含 T1（重述梳理）与 T2（保守增量）双模板 + 检索策略声明
- **全局纪律层** `discipline.md`：无条件随每次优化加载（输出纪律 + 稳定性 + 参考使用规则）
- **检索判定子技能** `retrieval/`：relevance（会话关联判定）/ intent（开发意向）/ doc-analysis（文档分析）/ websearch（搜索规划）
- **组装规则** `assemble/`：task-analysis（任务分析）/ continue（续写）/ smart（smart 尾段）

新增模式 = 新增目录（SKILL.md + system.md + increment.md），零代码改动。
