# Changelog

本项目所有重要变更记录于此文件。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。完整发布说明见 [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)。

> 🗺️ 本日志与项目地图[`docs/map/`](docs/map/index.md)交叉引用：新条目标注涉及 map/flow-id（PEN/VU/DG）；agent 开工前先读 [`AGENTS.md`](AGENTS.md)。

## [2.4.7] - 2026-08-15

### Changed
- **自定义模板每模式独立**：`config.template.texts`（base/lite/standard/smart 各一份，各 ≤4000）替代全局单份 `text`；旧 v2 `text` / v1 `templateText` 自动迁移到全部 4 模式（"全局一份"语义不丢内容）— [PEN-002]
- **自定义模板默认预填**：切换「自定义模板」且当前模式无内容时，自动预填该模式默认提示词（非空白），可在此基础上修改；模式切换时内容跟随当前模式、编辑互不干扰 — [PEN-002]
- **修复 v2 结构自定义模板不生效**：host 此前只读 v1 平铺 `templateMode/templateText`，v2 结构 `template.mode/text` 下自定义模板实际从未生效；现双兼容 — [PEN-001]
- **新增 RPC `template/default`**：返回 4 模式默认提示词（当前同值 = SYSTEM_PROMPT），供 client 预填；未来内置按模式拆分时自动跟随 — [PEN-001]

### Added
- 单测 U41：texts 解析/非法键/超长/旧值迁移/v2 结构/新结构优先 7 组断言；全量 43/43 通过 — [PEN-001]

## [2.4.6] - 2026-08-15

### Changed
- **提示词外置**：`SYSTEM_PROMPT` / `TASK_ANALYSIS_PROMPT` / `CONTEXT_GUARD` 三个静态提示词移出 `plugin-host.js`，以 `prompts/*.md`（`system.md` / `task-analysis.md` / `context-guard.md`）为事实源；`plugin-host.js` 的 `==PROMPTS-BEGIN==`/`==PROMPTS-END==` 生成区由 `scripts/sync-prompts.mjs` 内联同步（`--check` 校验漂移）。设计决策：host 半部以 `new Function` 执行、动态安装无 require/fs 作用域，运行时读外部文件不可靠，故构建时同步、保持单文件自包含；lite 规则强化与 V2 上下文块为运行时动态拼接（代码逻辑），不入 prompts — [PEN-001]
- **设置页布局**：「优化模式」与「模板」下拉合并为同一行双字段（`.dsh-plg-row-duo` + `.dsh-plg-field`，各占一半、窄屏自动换行）；自定义模板内容区仍独占一行 — [PEN-002]

### Added
- 单测 U40：生成区 = `prompts/*.md` 逐行求值一致性断言（防「改 md 忘同步 / 手改生成区」双向漂移）；全量 42/42 通过 — [PEN-001]

## [2.4.5] - 2026-08-15

### Changed
- **SYSTEM_PROMPT 语义保真重写**（用户反馈：优化结果对提示词理解不够、语义理解错误）——新增【理解原文（第一优先）】阶段：先逐条列出原文已明确信息（动作对象/动作/约束/范围/术语/数字/语气），区分「原文明确需求」与「推测」，推测只用于措辞不写入结果；语义等价为底线（不得替换/扩大/缩小/颠倒）；明确化仅限「模糊但可推断」的表述，无法推出不得添加；「怎么做」细节完整保留；删除旧版「只写做什么不解释怎么做」（与示例自相矛盾，诱导删细节）与「补充缺失的必要上下文」（诱导臆造）；长度改「服从语义保真」（简单 ≤800、复杂可超出但禁冗余）；语言改「主体语言」（混合输入保留术语）；示例扩至 4 条（新增语义保真/模糊明确化示范）— [PEN-001]
- **lite 规则引擎保守化**：`analyzeInputRules` 建议措辞全部改为「仅当可合理推断且不偏离原意时才明确化，否则保持原文」——修复旧文案（"请在优化结果中补充合理约束（如长度上限…）"）诱导模型添加原文未提及的新要求、造成语义漂移；lite 强化段拼接措辞同步改「优化时请遵循以下原则」；client 模式 hint（ZH/EN）文案对齐 — [PEN-002]
- **lite 规则引擎落地（补发 v2.4.4 缺失功能）**：新增 `analyzeInputRules` 纯函数（目标/约束/输出格式/示例四要素缺失检测，PURE 区段可单测）；lite 模式缺失项强化指令附加 system（零 LLM 成本、零外部上下文）——v2.4.4 tag 曾因发布流程遗漏不含此代码，本版为完整实现 — [PEN-002]

### Added
- 单测 U39：SYSTEM_PROMPT 语义保真契约断言（理解原文/语义等价/禁臆造/删除旧矛盾约束）+ lite 规则保守化断言；全量 41/41 通过 — [PEN-001]

## [2.4.4] - 2026-08-15

### Fixed
- `sidebar.footer.action` 占位注册 id 由 `cordis-panel` 改为插件唯一值 `cordis-panel-enh`，回避与基座 `dsh-client-ui-cordis` 的 `CordisPanel`（同槽位同 id）冲突，修复 update/重挂时的 single-occupant duplicate 与 "Failed to load plugins"（历史 v2.4.1-fix2 同源问题）— [PEN-001]

## [Unreleased]

### Added
- 协同治理落地：新增 `AGENTS.md`（agent 开工入口：改前影响分析 + 改后同步地图/日志）与项目地图 `docs/map/index.md`（root 模块级 / tree 文件级 / flow 功能链路，FLOW-ID: PEN / VU / DG）— [MAP-001]
- README 安装章节改为实测通过的傻瓜式一条命令：`dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v2.4.4`（版本锁定 + pnpm 前提 + allowBuilds 兜底说明），降低新用户安装门槛 — [VU-001]
- Release 资产附 `dsh-prompt-enhancer-<版本>.tgz` 安装包，README 新增「下载安装包离线安装」方式（`dsh plugin add ./xxx.tgz`，含预构建 lib/，无需联网与构建授权）— [VU-001]

## [2.4.3] - 2026-08-15

### Added
- 模型配置栏默认展开——设置页打开即见完整模型链— [PEN-002]
- 插件管理版本选择与「当前 → 目标」确认切换（选中非当前版本显示核对行，确认后执行 update）— [VU-001]
- 残缺包防误切：缺 host/client 半部的历史包在版本下拉中禁用并标注「（不完整）」— [VU-001]

### Changed
- 优化按钮统一样式对齐模型选择器：等线字体（DengXian）、字重 600、24px 胶囊、label-secondary 灰字、hover 深色椭圆背景、左右留白 4/8px— [PEN-001]
- 清理 plugin-host.js 中 `defaultDirFor` 重复定义— [VU-001]

## [2.4.2] - 2026-08-15

### Fixed
- 动态 client 沙箱 `fetch` 限制：「版本检测与一键更新」改用 `window.fetch` 直连 GitHub API— [VU-001]
- locale 注册容错：update 场景页面残留实例不再抛 `locale namespace "enhance" already has locale "zh"`— [VU-001]

## [2.4.1] - 2026-08-15

### Changed
- host 不再出网：版本检测/拉取的数据获取改由浏览器直连 GitHub API（CORS），host 只做解析/校验/写入— [VU-001]
- 写入基于会话策略，修复无会话时 `FS_SANDBOX_DENIED`— [VU-001]

## [2.4.0] - 2026-08-15

### Added
- 版本检测与一键更新（update/check + update/pull，contents API 下载）— [VU-001]
- 插件管理页版本检测卡片；按钮三态字体锚点对齐模型选择器（13px/500/20px）— [VU-001]

[2.4.7]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.7
[2.4.6]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.6
[2.4.5]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.5
[2.4.4]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.4
[2.4.3]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.3
[2.4.2]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.2
[2.4.1]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.1
[2.4.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.0
