# Changelog

本项目所有重要变更记录于此文件。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。完整发布说明见 [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)。

> 🗺️ 本日志与项目地图[`docs/map/`](docs/map/index.md)交叉引用：新条目标注涉及 map/flow-id（PEN/VU/DG）；agent 开工前先读 [`AGENTS.md`](AGENTS.md)。

## [Unreleased]

### Changed
- **细粒度进度反馈（v3.0r，用户需求）**：标准/智能/一键发布等检索重模式执行期间，按钮进度提示全程动态变化，消除"卡顿"误判——① `enhance/progress` RPC 返回扩展字段（`detailKey`/`detailArgs`/`step`/`total`/`elapsedMs`，`stage` 兼容保留）；② host 新增子步骤注入点：会话窗口判定（i/n）、开发意向判定、文档分析、代码检索、检索主题规划、逐主题搜索（「正在搜索 2/3：体素引擎」）、链节重试（i/n）、工作区扫描；`rec` 增加 `startedAt` 计时；③ client 进度文案优先级 detailKey 模板（i18n 中英新键 8 个，`{current}/{total}/{query}` 占位）> stage 文案 > 默认；末尾追加**已用秒数**（如「正在搜索 2/3：体素引擎 · 8s」）；新增 SMK-17（publish 期间轮询断言 detailKey 序列与字段），测试 111 → 112 — 架构治理
- **工作区文档清理（用户指令）**：① 删除 5 个历史版本快照目录（`dsh-prompt-enhancer-v2.4.5/2.4.8/2.5.1/2.7.0/2.8.3`，本地归档备份，git tag 已有完整备份）与旧工作副本目录（`prompt-enhancer-release - 提示词增强脚本`）；② 删除旧版本发布说明 `release-notes/v2.4.0–v2.8.3`（22 个，保留 3.0.0；完整说明见 GitHub Releases 页）；③ 删除已完成使命的开发方案文档 `docs/internal/architecture-refactor-plan.md`（M0-M6 已全部落地）与 `docs/internal/方案-publish路由与自评.md`（已被 v3.0p 取代）；保留 `.internal/` 排障经验沉淀、`CONTRIBUTING.md`、模块结构说明、项目地图与 devref；`prompt-enhancer-plugin`（早期开发记录唯一副本）按用户指示删除不备份 — 架构治理

## [3.0.0] - 2026-08-16

### Changed
- **一键更新执行器外挂 + staging 预拉取流程**：执行器不再从 `node_modules/dsh-prompt-enhancer/lib` 启动，改为复制到外部版本化目录（`%LOCALAPPDATA%\dsh-prompt-enhancer\executor\<version>`）并以外部目录为 WorkingDirectory；修复 Windows 下执行器自锁导致 pnpm 替换插件目录 EPERM 的根因。`apply` 流程改为：先在线下载 tarball 到 staging 并校验 → envcheck → 停止服务 → 本地安装 staging tarball → 启动 + 健康检查；重启失败自动回滚旧版本；安装失败恢复原服务；EXECUTOR_VERSION 0.1.5→0.1.6 — [VU-001]
- **更新状态文案补充**：client 轮询新增 `staging/envcheck/preparing/rollback/rolledback` 状态展示，避免新阶段被误显示为“重启中”；失败时直接展示执行器返回的具体错误 — [VU-001]
- **新增架构重构方案文档**：`docs/internal/architecture-refactor-plan.md`，记录从单文件 monolith 到 Cordis 子插件 / 服务化 / 契约化 / 平台热更新的完整调整方案 — 架构治理
- **M0 基线固化**：
  - 新增 `docs/compatibility-matrix.md`：RPC / 配置 / 形态 / 版本兼容矩阵
  - 新增 `test/sys.test.cjs`、`test/updater-host.test.cjs`，测试数 61 → 70
  - `lib/updater-host.cjs` 增加 `require.main === module` 守卫与导出，支持不启动 server 的单元测试
  - 新增 GitHub Actions CI（语法检查 / 单测 / client 构建 / 生成物一致性）
  - `package.json` 增加 `npm test`
  - 修正 `docs/map/flow/prompt-enhance.md` 模式数量 4 → 5 — 架构治理
- **M1 源码模块化脚手架**：
  - 建立 `src/host/` 与 `src/client/` 目标模块目录，放置 legacy 源与模块骨架
  - 新增 `scripts/build-host.mjs`，根 `plugin-host.js` 改为生成物
  - `scripts/build-client.mjs` 改为读取 `src/client/legacy/plugin-client.js`，并同时生成根 `plugin-client.js` 与 `lib/client.cjs`
  - `package.json` 增加 `build:host` / `build:client`，`build` 同时构建 host/client
  - CI 增加对 `plugin-client.js` / `plugin-host.js` 生成物一致性校验 — 架构治理
  - **PURE 纯函数区段提取**：从 `src/host/legacy/plugin-host.js` 抽出到 `src/host/pure.js`（单一事实源），`build-host.mjs` 构建时注入回根 `plugin-host.js`；新增 `scripts/extract-pure.mjs` 维护工具 — 架构治理
  - **diagnostics 日志块提取**：从 `src/host/legacy/plugin-host.js` 抽出到 `src/host/diagnostics.js`，`build-host.mjs` 构建时注入回根 `plugin-host.js`；新增 `scripts/extract-diagnostics.mjs` 维护工具 — 架构治理
  - **models/config 缓存块提取**：从 `src/host/legacy/plugin-host.js` 抽出到 `src/host/models.js`（DeepSeek 兜底链、默认参数、模型能力缓存、自适应链），`build-host.mjs` 构建时注入回根 `plugin-host.js`；新增 `scripts/extract-models.mjs` 维护工具 — 架构治理
  - **plugins 管理 RPC 块提取**：从 `src/host/legacy/plugin-host.js` 抽出到 `src/host/plugins.js`（inventory/run/stop/undefine 四个 handler），`build-host.mjs` 构建时注入回根 `plugin-host.js`；新增 `scripts/extract-plugins.mjs` 维护工具 — 架构治理
  - **update RPC 块提取**：从 `src/host/legacy/plugin-host.js` 抽出到 `src/host/update.js`（check/pull/envcheck 三个 handler），`build-host.mjs` 构建时注入回根 `plugin-host.js`；新增 `scripts/extract-update.mjs` 维护工具 — 架构治理
  - **client i18n 字典提取**：从 `src/client/legacy/plugin-client.js` 抽出到 `src/client/i18n.js`（ZH/EN 字典），`build-client.mjs` 构建时注入回 client 源与 `lib/client.cjs`；新增 `scripts/extract-client-i18n.mjs` 维护工具 — 架构治理
  - **fix(M1)：修正 client i18n 提取范围**——此前只提取了 ZH，EN 仍残留在 legacy；修正为完整提取 ZH+EN 到 `src/client/i18n.js`，生成物内容不变 — 架构治理
  - **client 常量/配置默认值提取**：从 `src/client/legacy/plugin-client.js` 抽出到 `src/client/constants.js`（CONFIG_DEFAULTS / BUILTIN_CHAIN / MODE_OPTIONS / modeShortLabel 等），`build-client.mjs` 构建时注入回 client 源与 `lib/client.cjs`；新增 `scripts/extract-client-constants.mjs` 维护工具 — 架构治理
  - **client updater/env 元数据提取**：从 `src/client/legacy/plugin-client.js` 抽出到 `src/client/updater.js`（UPDATER_DEFAULT_REPO / UPDATER_MANIFEST / URL 构造 / ENV_ITEMS / ENV_DETAIL_TEXT / updaterRepoOf），`build-client.mjs` 构建时注入回 client 源与 `lib/client.cjs`；新增 `scripts/extract-client-updater.mjs` 维护工具 — 架构治理
  - **client 配置/状态逻辑提取**：从 `src/client/legacy/plugin-client.js` 抽出到 `src/client/state.js`（configState / cloneDefaults / sanitize / load/save/subscribe / saveStatus 等），`build-client.mjs` 构建时注入回 client 源与 `lib/client.cjs`；新增 `scripts/extract-client-state.mjs` 维护工具 — 架构治理
  - **client helper/会话逻辑提取**：从 `src/client/legacy/plugin-client.js` 抽出到 `src/client/helpers.js`（errorKey / makeT / sessionStores / enhance / undo / guardPasses 等），`build-client.mjs` 构建时注入回 client 源与 `lib/client.cjs`；新增 `scripts/extract-client-helpers.mjs` 维护工具 — 架构治理
  - **client 模型 helper 提取**：从 `src/client/legacy/plugin-client.js` 抽出 `buildCandidates` 到 `src/client/model-helpers.js`，`build-client.mjs` 构建时注入回 client 源与 `lib/client.cjs`；新增 `scripts/extract-client-model-helpers.mjs` 维护工具 — 架构治理
- **M2 服务化/事件化脚手架**：
  - 新增 `src/host/services.js`：Cordis-style 服务注册表（`ctx.provide` 目标）
  - 新增 `src/host/pipeline.js`：增强管道注册/执行/错误隔离
  - `src/host/index.js` 接入 services/pipeline 并提供 `enhance.pipeline` 等服务
  - 新增 `test/pipeline.test.cjs`（73 tests）— 架构治理
  - **enhance 服务接入 Pipeline**：`src/host/enhance.js` 新增 `createService`（analyze/retrieve/assemble/llm 四阶段）与默认 no-op handler；新增 `test/enhance-pipeline.test.cjs`（75 tests）— 架构治理
  - **models/update/diagnostics/plugins/config 服务接口**：新增 `src/host/{model,update,diagnostics,plugins,config}-service.js`，`src/host/index.js` 统一通过 service registry 提供；新增 `test/services.test.cjs`（77 tests）— 架构治理
- **M3 RPC 契约化脚手架**：
  - 新增 `src/host/protocol.js`：`PROTOCOL_VERSION` / RPC 方法注册表
  - 新增 `src/host/rpc-schema.js`：轻量参数校验
  - 新增 `test/protocol.test.cjs`（79 tests）— 架构治理
  - **配置 Schema/迁移器**：新增 `src/host/config-schema.js`（默认值/校验/v1→v2 迁移），`config-service.js` 接入；新增 `test/config-schema.test.cjs`（83 tests）— 架构治理
  - **RPC 边界接入参数校验**：新增 `lib/rpc-schema.cjs`（bundle-safe CommonJS），`lib/index.cjs` RPC 路由在分发前统一执行 `validateRpcArgs`，非法参数返回 400 — 架构治理
- **M4 更新链路平台化脚手架**：
  - 新增 `src/host/reloader.js`：Reloader 接口 + UnsupportedReloader
  - 新增 `src/host/update-platform.js`：`createUpdatePlatform`（热更新优先，executor fallback）
  - 新增 `test/update-platform.test.cjs`（85 tests）— 架构治理
  - **ExecutorReloader fallback**：新增 `src/host/executor-reloader.js`，通过外部执行器 RPC `apply` 实现 Reloader；新增 `test/executor-reloader.test.cjs`（88 tests）— 架构治理
  - **update 服务接入 UpdatePlatform**：`src/host/update-service.js` 新增 `apply`/`canHotReload`，`src/host/index.js` 支持 `options.update`；新增 `test/services.test.cjs` SVC-03（89 tests）— 架构治理
- **M5 可观测性与安全加固**：
  - 新增 `src/host/logger.js`：结构化 JSON 日志 + 环形 tail
  - 新增 `src/host/integrity.js`：SHA-256 文件校验
  - 新增 `test/observability.test.cjs`（91 tests）— 架构治理
- **M6 工程化收尾**：
  - 新增 `docs/internal/CONTRIBUTING.md`：开发环境 / 命令 / 修改流程 / 发布边界
  - CI 已覆盖语法检查、测试、构建、生成物一致性
  - 测试数 91，文档与地图同步 — 架构治理
- **M5 运行时接入（目标架构）**：`diagnostics-service.js` 接入结构化 logger，日志/tail 统一走 JSON 格式 — 架构治理
- **架构方案执行状态登记**：`docs/internal/architecture-refactor-plan.md` 增加当前执行状态表，明确 M0-M6 完成度与剩余项 — 架构治理
- **M5 完整性校验接入实际 staging**：新增 `lib/integrity.cjs`（bundle-safe），`updater-host.verifyTarball` 返回 SHA-256，外部执行器目录同步复制 `integrity.cjs` — 架构治理
- **M1 尾项：enhance RPC 三 handler 提取**：从 `src/host/legacy/plugin-host.js` 抽出 `enhance/progress`、`enhance`、`cancel` 到 `src/host/enhance-handlers.js`（JSON 文本 chunk，构建注入回根文件，产物逐字节不变）；新增 `scripts/extract-enhance.mjs` 维护工具 — 架构治理
- **M1 尾项：client React 组件拆分**：从 `src/client/legacy/plugin-client.js` 抽出 10 个 React UI 组件（EnhanceButton/EnhanceBar/UpdaterCard/PluginsSection/CollapsibleSection/ModelMainSection/FallbackRow/ModelConfigTab/ParamsTab/ModelPluginsSection+CordisBadgePlaceholder）到 `src/client/components/*.js`；`build-client.mjs` 注入改为**循环注入**（组件 chunk 内嵌其他注入标记时多轮展开，产物逐字节不变）；新增 `scripts/extract-client-components.mjs` 维护工具 — 架构治理
- **M1 尾项完成：legacy 双侧退役**：`src/host/legacy/` 与 `src/client/legacy/` 全部迁出——host 剩余外壳 → `src/host/app.js`（bundle 骨架，含全部注入标记）；client 剩余（CSS 数组 / 顶层插件对象 / 头注释+标记）→ `src/client/{styles,app,skeleton}.js`；`build-host.mjs`/`build-client.mjs` 改为直读 src 骨架 + 循环注入 + 换行规范化（产物与 HEAD 仅构建头 Source 注释不同，正文逐字节等价）；删除全部 extract-*.mjs（legacy 退役后不可再运行）；91 tests 通过 — 架构治理
- **M2 深化：enhance 流程管道化**：`enhance-handlers.js` chunk 内置 bundle 内 Pipeline（契约同 `src/host/pipeline.js`），enhance 主流程拆为 analyze/retrieve/assemble/llm 四 stage 注册式执行——新增增强模式/检索源 = 注册 stage handler 而非修改主流程；逐段搬运行为等价（快路径/超时计时/错误边界/进度轮询不变，产物 diff 仅限 enhance 区段）；新增 `test/bundle-smoke.test.cjs`（首个生成 bundle 直接测试：RPC 注册冒烟 + GUARD/NO_LLM/NO_RECORD 快路径），测试 91 → 95 — 架构治理
- **fix(M3)：enhance RPC 校验契约修正**（实测暴露）：`lib/rpc-schema.cjs` 与 `src/host/rpc-schema.js` 的 enhance schema 误用不存在的 `draft` 字段（client 实际传 `text`，host handler 读 `args.text`）→ 全部 enhance 请求被校验层 400 拦截；改为 `required: ['sessionId', 'text']` 并对齐 client payload；新增 SMK-05 校验层契约测试 + PROTO-02 同步，测试 95 → 96 — 架构治理
- **fix：reasoning 链节 maxTokens 自动放宽**（实测确证）：opencode-go 通道在 `reasoningEffort`（思考等级）下，思考过程消耗输出预算——配置的 maxTokens=2000 在长输入 + effort=max 时耗尽 → 空流（EMPTY_RESPONSE，600 字草稿 19s 空 / 同请求 maxTokens=8000 25s 成功）；llm stage 对带 effort 的链节自动放宽到 ≥8000（publish 不设限同策略的保守版，无 effort 行为不变）；新增 SMK-06/07（mock llm 走通完整管道验证放宽/保持），测试 96 → 98 — 架构治理
- **模式体系重构 S1（基础设施）**：新增 `prompts/relevance.md`（会话关联性判定提示词事实源 → `RELEVANCE_PROMPT`，占位符 `{history}/{current}` 运行时替换）；`sync-prompts.mjs` 同步目标改 `src/host/app.js`（M1 退役后骨架为生成区源，避免被 build 覆盖）并修复生成区精确定位 + JSON 字符串转义写入；PURE 新增 `splitHistoryRounds`（会话轮次窗口切分，user 消息为轮锚点）与 `parseRelevance`（关联判定 JSON 容错解析）；单测 U61/U62，测试 98 → 100 — 架构治理
- **模式体系重构 S2（lite/standard/smart 会话窗口检索）**：新增 `RETRIEVE_TABLE` 检索策略表（base=none / lite=前1轮 / standard=1-2轮→3-5轮→6-10轮递进 / smart=1轮→2-3轮 / publish=v2 旧管道保留）；retrieve stage 重构为策略分发——rounds 模式逐窗口 **LLM 关联判定**（`judgeRelevance`，RELEVANCE_PROMPT 占位替换，10s 超时/失败降级不相关），命中即停并注入【相关会话参考】（≤2400 字符，防回显护栏沿用），全不中无参考；lite 本地规则检查（analyzeInputRules）移除；新增 `fetchSessionHistory`（listEvents/filterEvents → extractHistory）；集成测试 SMK-08/09（mock llm + sessionQuery 走通窗口命中/全 miss）+ U63 策略表契约；产物 diff 仅 host 检索区段 — 架构治理
- **模式体系重构 S3（smart 工作区阶段）**：smart 在会话窗口检索后进入工作区阶段——① 工作区扫描 `.md` 文档（`searchWorkspaceFiles`，扩展名过滤 + 名称/内容命中排序 + 中文组合词分段匹配兜底，2s 超时降级）；② 有 .md → 依据会话参考与关键词提取相关文档，**LLM 开发环境判定**（`judgeDevEnv`，DEV_ENV_PROMPT 占位替换，10s 超时降级非开发环境）——**须同时「有 .md」且「判定开发环境」才进入代码阶段**，否则仅注入文档参考；③ 代码文档检索注入【相关代码参考】（英文代码 vs 中文关键词语义鸿沟 → 内容兜底 + 最终全取前 N 兜底）；④ smart system 追加 `SMART_TAIL_PROMPT`（prompts/smart.md：可优化点分析 + 软件工程专业词汇替换 + 调整建议，输出【调整方案】块）；新增 `parseDevEnv`（PURE）+ SMK-10 集成测试（mock fs/llm/sessionQuery 走通 md→dev-env→code 全链路）— 架构治理
- **smart 流程修订（v3.0v2，用户确认方案）**：① **开发意向判定前置**——会话窗口检索完成后先 LLM 判定提示词是否为「项目开发意向」（`judgeDevIntent`，prompts/intent.md → `DEV_INTENT_PROMPT`，10s 超时降级非意向）——非开发意向**直接停**，不进入工作区；② **B+C 合并**——工作区阶段的一次 LLM 调用（`analyzeDocsRelevance`，prompts/doc-analysis.md → `DOC_ANALYSIS_PROMPT`）同时完成「按提示词检索相关 .md 参考信息（输出 relatedDocs 要点）」与「分析项目地图/文档索引结构（hasProjectMap + codePaths）」；③ 进入第三步门槛 = **有 .md + 相关文档命中 + 项目地图结构**（开发意向已前置通过）；④ **代码阶段按项目地图指向路径优先**（codePaths 前缀命中排前，不足补全量），无指向按关键词扫描兜底；⑤ **SMART_TAIL 仅进入第三步时追加**（调整方案随代码阶段，未进入则不输出）；删除 dev-env 判定（judgeDevEnv/DEV_ENV_PROMPT/prompts/dev-env.md，parseDevEnv 保留待清理）；新增 `parseIntent`/`parseDocsAnalysis`（PURE）+ SMK-10 重写 + SMK-11（非开发意向停），测试 104 → 107 — 架构治理
- **架构审查三项落地**：① **文档同步**——`AGENTS.md` 模块索引与 `docs/map/tree/files.md` 登记全部 8 个提示词事实源（新增 publish/relevance/intent/doc-analysis/smart），并修正 `sync-prompts.mjs` 目标描述（同步进 `src/host/app.js` 生成区，非根 bundle）；② **死代码清理**——移除 `shouldInjectV2`/`analyzeInputRules`/`parseDevEnv`（v3.0v2 修订后遗留，含 U12/U38 单测引用），测试 107 → 106；③ **publish 冒烟**——新增 SMK-12（publish 模式走通 v2 旧管道 + 无 smart tail），全量 106/106 通过 — 架构治理
- **publish 多步检索 + 产物形态调整（v3.0p，用户确认方案）**：
  - **产物形态**：九章规格重写为「**完善、有明确边界的生成提示词**」形态（参考 WebGL Demo 需求书样例）——① 目标概述+**场景化角色设定**（game→游戏开发专家/TA；software→软件架构师；generic→顶级技术专家）；② 需求范围与明确边界（绝对/必须/不得级硬边界）；③ 技术约束与架构（**架构层写实到方案名**，数值给量级）；④ 核心功能要求（**每条附设计意图**，如 SSAO 消除塑料感）；⑤ 场景与内容设计（含代码生成策略）；⑥ 交互与界面；⑦ 扩展方向（**强制沿用既有体系/尺度，不破坏闭合**）；⑧ 交付与限制（**禁止 TODO/占位/要求用户补齐**）；⑨ 验收清单；新增【网络信息运用】指令段（每轮必须参考网络参考、只补缺口、标注来源、**不得虚构来源**）
  - **多步网络检索**：① **LLM 检索主题规划**——新 `prompts/websearch.md` → `WEBSEARCH_PLAN_PROMPT`，规划 2~3 个差异化主题（避开已检索主题），10s 超时/失败 → 降级 `buildWebQuery` 单 query（行为不变）；② **会话级检索记忆 `publishWebMemo`**——主题去重（≤12）+ 要点摘要累积（≤600 字符）；③ **跨轮要点回注**——历史要点以【已获取网络参考】注入当轮（预算内、防回显护栏），后续轮只补新缺口；④ **一轮多主题检索**——逐主题 `web.search`（各 10s 超时，单个失败仅跳过该主题），结果按「### 检索主题」合并注入，`WEB_REF_MAX` 800→1600；PURE 新增 `parseSearchPlan`（U66）；集成测试 SMK-13（多主题逐次搜索+注入）/ SMK-14（跨轮 memo 回注），SMK-12 更新为含 web-plan 的降级路径，测试 107 → 109 — 架构治理
- **文档架构与发布边界规则（用户规则 2026-08-16）**：① 项目功能文档（README 中/英、docs/screenshots/、docs/compatibility-matrix.md、release-notes/、CHANGELOG）与开发治理文档（AGENTS.md、docs/map/、docs/devref/、docs/internal/）**分开存放**——新增 `docs/internal/` 开发治理区（gitignore，本地不推 GitHub），移入 `architecture-refactor-plan.md`、`CONTRIBUTING.md`、`方案-publish路由与自评.md`；`docs/map/`、`docs/devref/` 保持治理工具契约路径（已 gitignore）；② 对外发布仅含项目功能文档 + GitHub 需求说明（README）——`package.json` files 白名单核对（lib/plugin-host.js/plugin-client.js/cordis.patch.yml/README*/LICENSE，不含 docs/、AGENTS.md、src/test/prompts/scripts）；③ 发布 SOP 新增第 6 步 `npm pack --dry-run` 白名单核对；AGENTS.md 新增「文档架构与发布边界」章节与分类表 — 架构治理
- **v3.0p 审查修复（五处）**：① **memo 截断方向**——`slice(0, 600)` 保旧丢新改为 `slice(-600)` 保留最新要点；② **失败主题不污染已检索列表**——仅 `hits > 0` 的检索主题并入会话记忆（搜索失败/超时不占位，后续轮仍可重试）；③ **规划主题硬去重**——`planWebSearch` 返回的主题与已检索主题过滤后再搜索（LLM 未遵从提示词时的兜底），过滤后为空 → 降级单 query；④ **预算门前置**——上下文预算 = 0 时跳过 `planWebSearch`（省 1 次 LLM 调用，与「预算 > 0 才启用检索」联动语义一致）；⑤ **用户可见文案同步**——client publish hint 更新为新九章形态 + 多步检索描述，README（中/英）publish 描述同步，`docs/map/flow/prompt-enhance.md` 登记 publish 检索链路；新增 SMK-15（失败主题不入 memo + 已检索主题去重），测试 109 → 110 — 架构治理
- **超时/耗时匹配审查（真实 LLM 实测驱动）**：opencode-go/deepseek-v4-flash 实测——judge 形状（effort=max / 无 effort，含 2400 字长窗口）耗时 1.8~2.3s（10s 超时余量 5 倍，匹配良好）；**主调用形状（1500 字草稿 + effort=max + 8000 tokens）实测 42s > 非 publish 默认超时 30s → 正常情况必 TIMEOUT**（实锤实例）。修复三项：① **非 publish 主调用超时自动放宽**——链含 effort 时 `timeoutMs` 至少 120s（无 effort 行为不变）；② **judge 类小调用剥离 reasoningEffort**——relevance/intent/doc-analysis/web-plan/阶段 A 任务分析共 5 处（判定/规划任务无需深度思考；消除「effort 思考消耗 400 token 小预算 → 空流」边界风险，实测剥离后耗时相当）；主调用保留 effort（含 maxTokens ≥8000 放宽）；③ **会话历史/事件提取补超时保护**——`fetchSessionHistory` 与 `v2SearchEvents` 加 10s 超时（超时/失败 → [] 不阻断）；新增 SMK-16（judge 剥离 effort + 主调用保留），测试 110 → 111；工作区扫描 2s 经实测（155 条目 4ms）确认余量充足，保持不变 — 架构治理

## [2.8.3] - 2026-08-16

### Fixed
- **一键更新 install timed out 修复**：Windows 下运行中的 dsh-web 会占用 `node_modules/dsh-prompt-enhancer` 文件，导致 pnpm 替换插件目录时 `EPERM` 或长时间卡住；`apply` 流程改为先停止服务再执行安装，安装失败会自动尝试恢复启动服务；EXECUTOR_VERSION 0.1.4→0.1.5 — [VU-001]

## [2.8.2] - 2026-08-16

### Changed
- **一键发布模式记忆强制开启且不可关闭**：切换到 `publish` 模式时自动将记忆置为开启，设置页记忆开关在发布模式下禁用并显示说明；host 侧 `validateConfig` 与 `enhance` 入口双重兜底，即使客户端配置被改为关闭也强制生效 — [PEN-003]
- **自定义模板编辑区增大**：设置页自定义模板 `textarea` 行数由 6 增至 12，并增加 `min-height: 180px`，改善长模板/长规格的编辑体验 — [PEN-002]

## [2.8.1] - 2026-08-16

### Fixed
- **更新模块重启链路修复（执行器改由 Task Scheduler 拉起）**：执行器不再作为 dsh-web 服务的直接 detached 子进程启动，而是通过一次性计划任务（`schtasks /Create + /Run`）以 SYSTEM 身份独立拉起；修复实测中 `sc stop dsh-web` 把旧执行器连带杀死、导致 `restart start` 后无后续日志、一键更新重启“走不通”的问题。执行器启动后自删计划任务（删除任务不会终止已运行实例）；EXECUTOR_VERSION 0.1.3→0.1.4 触发旧执行器版本对齐重建 — [VU-001]

## [2.8.0] - 2026-08-16

### Changed
- **设置联动性修复（配置审查驱动）**：自定义模板 texts 白名单动态化——client 三处硬编码 `['base','lite','standard','smart']` 改为 `MODE_VALUES`（含 publish）+ 默认 texts 补 publish 键：修复「publish 模式自定义模板被 sanitize 丢弃」（与 v2.5.3 同类问题的 publish 复发——host 侧 MODE_KEYS 动态本已兼容）；publish 提示补「上下文预算需 > 0 才启用检索」联动说明 — [PEN-002]
- **重启循环修复（每轮 stop+start 组合）**：执行器重启循环由「stop 一次 + 循环 start」改为「每轮 = 完整 stop→start」——失败轮先重新 stop 幂等清理（等 STOPPED/端口释放）再 start，消除「进程残留/端口未释放时裸 start 无效」的拉起失败风险（手动需 stop+start 两次才成功的根因）；正常首轮成功路径与旧行为等价；EXECUTOR_VERSION 0.1.2→0.1.3 触发执行器版本对齐重建 — [VU-001]

### Added
- **「一键发布」模式（publish，v2.7.0）**：项目/游戏开发规格生成——输入粗略想法（如「想开发一个纸牌游戏」）→ 一键生成完整可实施开发规格。核心：① 专用九章规格 system（`prompts/publish.md` 事实源 → `SYSTEM_PUBLISH_PROMPT`）：目标概述/核心玩法循环/数值与经济/数据结构/核心机制与算法/交互与界面/技术实现建议/分阶段实施路线/交付验收清单；设计红线（不反问、未明确处给默认并标注、顺序与公式绝对精确、乘算倍增非加算、**严禁回显输入原文**）；多轮扩充规则（**每一轮都必须输出完整九章规格**、保持已确认设计、融入补充并细化，配合记忆链）；② **网络检索**（经 DSH `ctx.web.search`，host 侧可用）：检索词 = 草稿主题词 ∪ 记忆链 delta 增删实词（**每次改动方向代入检索条件**，`buildWebQuery` 纯函数）；结果注入「【网络参考】」段（≤800 字符，10s 超时、失败/无服务独立降级不阻断）；③ 完整检索管线复用（阶段 A 任务理解 + 阶段 B 工作区/会话）；④ custom 模板仍可覆盖；建议开启记忆（多轮扩充场景）— [PEN-001]
- **publish 实测驱动修正（真实 LLM 端到端复测）**：① 多轮规则强化「每轮完整九章、不得精简」（修复实测发现第二轮仅输出 432 字符摘要的问题——复测 7746 字符完整九章）；② 红线补「严禁回显输入原文」（修复实测首轮回显输入的问题——复测未回显）；真实 LLM（opencode-go/deepseek-v4-flash）验证：首轮九章 9/9、第二轮完整九章 + 新需求纳入（肉鸽/商店/小丑）— [PEN-001]
- **publish 不设输出限制**（塔防实测驱动）：规格长文生成解除截断——maxTokens 省略（provider 默认上限）、`outputLimit=0`（collectStream 不再 toolong）、超时放宽至 ≥120s；实测：塔防规格 4571 字符时曾因 4000 token 上限截断于「五、核心机制」，修复后 12000 字符流可完整通过（新增 collectStream 单测）— [PEN-001]
- **publish 场景自动路由 + 方案自评判定**（协商/审查三轮驱动）：① **场景路由**（`detectScenario` 纯函数，PURE 区段）：输入模糊想法 → 词表分级加权自动判定 `game/software/generic`（强特征 ×2 / 泛词 ×1 / 英文强 ×1，平局/双零 → generic）；**会话级缓存固定**——首轮判定写入、后续轮读取不重判（场景决定九章骨架，防增量文本导致场景翻转）；进程重启后续作经记忆链最早轮输入兜底判定；system 注入「【场景判定】」行（文案事实源 `prompts/publish.md`「场景适配」段，软件场景第三/五章按性能指标与业务规则展开）；检索词场景化（game → 游戏实现 / software → 软件架构）；scenario 独立日志；② **方案自评判定**（优化侧模型自执行）：九章规格输出后追加【方案自评】块——一致性/完整性/可实施性三项核对 + 【保留】/【调整】判定，锚点规则（任一明确需求未覆盖或缺章 → 必须判【调整】）防自嗨，自评段豁免「严禁回显」红线（允许概括引用需求点、禁逐字回显）；多轮闭环：调整建议供下一轮补充；③ 单测 U53（7 用例 + keywords 缺省等价断言）— [PEN-001]
- **publish 复测修正（真实 LLM 二轮实测）**：① **中性用户包装**（`wrapPublishText`）——publish 不再沿用「请优化以下提示词」措辞（该措辞被模型误读为提示词优化任务，导致自评误判【调整】）；② **判定行回显确定性剥离**（`stripScenarioEcho`）——模型常复述 system 注入的【场景判定】行（完整/截断两形态），指令式「请勿复述」实测无效，改输出后处理剥离；③ **超时 120s → 240s**——带记忆链 rounds 的多轮规格生成（round-2 完整九章 + 融入补充 + 自评）实测 120s 超时，240s 覆盖 4 轮链最坏情况；④ **publish 补充式轮次 delta removed 清零**（`filterDeltaForPublish`）——行级 diff 的 removed 侧 = 上一轮完整规格（用户未复述即全算删除），实测曾把「-删除：一、目标概述」喂给模型导致幻觉「用户要求删除目标概述章」；publish 改动方向由 added 侧（用户本轮文本）承载，removed 清零（检索词与 hint 同步受益，非 publish 行为不变）；新增 U54/U55/U56 单测 — [PEN-001]
- **设置界面两项实测修复（用户反馈驱动）**：① **`template/default` 补 publish 键**——此前只返回 4 模式默认提示词，发布模式切「自定义模板」时预填拿到 undefined → 内容完全为空（发布模式内置九章提示词实际存在但未暴露）；补 `publish: SYSTEM_PUBLISH_PROMPT` 后预填正常；② **发布模式输出限制三项置灰 + 说明**——「不设输出限制」为 host 硬覆盖（超时 ≥240s、maxTokens 省略、outputLimit=0），但设置界面「超时时间/输出 Token 上限/输出字符上限」此前可编辑且实际无效（实测：UI/localStorage 正常更新但发布行为不变）→ 三项在发布模式置灰（disabled）+ 新增说明文案（中/英）；上下文预算仍生效（>0 启用检索）；重建 lib/client.cjs — [PEN-002]

### Changed
- **envcheck 通用适用性修复（多场景实测驱动）**：① **工具不可达统一降级**——`where sc.exe` 预检失败（PATH 失效/系统异常）时全部 6 项降级 `warn tool-unreachable`（此前 sc/reg ENOENT 被误报为「服务不存在/被禁用」block、svc-bin 误通过假绿）；② **svc-bin 依赖 service 状态**——服务不存在时报 `no-service`（warn）而非误报 ok；③ **恢复 net 网络预检**（GitHub 可达性，curl 实测 api.github.com，warn 级）——安装依赖 GitHub，大陆/受限网络前置提示（v2.5.2 曾按用户决策删除，本次实测暴露缺口后恢复）；④ handler 支持 item 级 level 覆盖 — [VU-001]
- **V2 检索质量修复（四模式实测驱动）**：① 新增 `splitCnSegments` 中文分词——连续中文按连接/虚词切分（的/与/并/输出/一份…），替换旧的 8 字窗口截断（「项目的构建与发布」式碎片是中文文件名/内容零命中的根因）；② 停用词表扩展（分析/检查/输出/包含等动作虚词 + **用户/助手**——extractHistory 的 `[用户]/[助手]` 前缀不再成为检索噪音）；③ **文件检索内容兜底**——`rankFiles` 名称 0 命中时降级扫描前 N（5）个文本文件按内容关键词命中（md/txt 文档优先），救活「文件内容相关但文件名无关」场景；实测：提示词「分析 DSH 项目的构建与发布流程…」关键词从碎片噪音变为全实词（构建/发布流程/结构化/模块清单），中文 README 内容命中有效；英文代码工作区中文 token 命中率仍受语义鸿沟限制（无向量检索）— [PEN-001]

## [2.7.1] - 2026-08-15

### Changed
- **继续优化遗留修正（发送/清空复位）**：点击发送（composer 清空）或手动清空输入框 → 按钮恢复初始「优化」形态（`optimized` 重置，不再显示「继续优化」）；**后台记忆链不清除**——用户删除内容可能表示方向调整或反馈方向不正确（持续记忆）— [PEN-001]/[PEN-003]
- **记忆机制明确化**：记忆链 = **固定窗口最近 4 轮** `{input, output}`（FIFO 滚动，注入时按 ≤2400 字符预算等分截断、输入 1/3 输出 2/3）；发送/清空不清除（持续记忆），撤回只弹出最后一轮；关闭开关后完全不读取/写入 — [PEN-003]
- **设置「已保存」判定优化**：改动后 1s（防抖，连续改动只校验最后一次）执行真实检查（localStorage 读回逐字对比），检查伴随转圈动效（保底 0.5s）——已落实 → 「✓ 已保存」（3s 后消失）/ 未落实 → 「✗ 保存失败，请重试」；无 timer 服务降级为旧常驻提示 — [PEN-002]

## [2.7.0] - 2026-08-15

### Added
- **更新未重启提醒**：`dsh plugin add/update` 安装新版本后若服务未重启，插件管理页自动检测（host 对比模块加载时刻与关键文件 mtime）并显示横幅提醒 + 重启命令（`net stop <svc> && net start <svc>`，服务名随 `updater.serviceName` 配置）— [VU-001]

### Changed
- **执行器三处修复（v2.6.0 一键更新链路闭环）**：① `DSH_DSH_BIN` 注入（spawnExecutor 从 `process.argv[1]` 注入 dsh CLI 路径——此前从未注入，apply 安装必然 BAD_ARGS 失败）；② **健康检查端口自解析**（updater-host 改由 `readServicePort` 读服务配置端口，兜底 3080——旧版误用执行器端口 3081 导致健康检查恒通过、服务未恢复也报「重启成功」、5 次重试形同虚设）；③ 执行器版本 bump `0.1.0 → 0.1.2` 触发 executorEnsure 版本对齐重建（否则修复代码不上线）— [VU-001]
- **执行器 CORS 头修复**：响应补 `access-control-allow-methods: POST, OPTIONS` 与 `access-control-allow-headers: content-type`（旧版仅 allow-origin，浏览器预检失败 → fetch reject →「更新执行器不可用」；浏览器模拟预检实测通过）— [VU-001]
- **环境检测收敛为执行器重启阶段真实依赖**：保留 service / svc-type / svc-bin / exec-port（更新端口独立，承接 no-port 语义）；**svc-bin 升级为降级链**（nssm `Parameters\Application` → 未装 nssm 的原生服务读 SCM `ImagePath` 首段 → 均无则跳过，覆盖两种安装形态）；**新增 tools 重启工具检查**（sc/netstat/reg 存在于 SystemRoot\System32，block——重启命令缺失必失败）；删除 port 占用检查（标准场景不可达）、account、restart；检查项显示名统一「更新端口」用户口径 — [VU-001]
- **按钮「继续优化」状态**：成功应用过至少一轮优化后，用户继续修改草稿时按钮由「✨ + 模式短标签」变为**纯文字「继续优化」**（无 ✨ 图标，hover 提示同步区分）；撤回 = 回到起点，按钮恢复「首次优化」形态；优化中 / 完成撤回 / 空输入记忆开关 / 守卫禁用等其余状态不变 — [PEN-001]
- **记忆升级为发送前多轮迭代链**：记忆由「上一轮优化对」升级为 rounds 链（client 内存保留最近 4 轮输入/输出）——发送前「优化→修改→再优化」的每轮改动都会累积，再优化时以**真多轮 user/assistant 消息**代入全部轮次，并通过行级 diff 感知本轮相对上一轮结果的修改方向（+新增/-删除摘要，≤300 字符）；预算规则：链 ≤2400 字符按轮等分（输入 1/3、输出 2/3），记忆注入同样触发防回显护栏；撤回改为只弹出最后一轮（更早轮次仍有效）— [PEN-003]
- **记忆开关文案同步**：设置页提示与 README（中/英）说明多轮累积语义与隐私边界（记忆链仅存页面内存，随优化请求发送给所选模型厂商）— [PEN-003]
- **AGENTS.md 发布 SOP 修订**（发布实战教训固化）：发布前新增「先跑项目地图 sync」（release-notes 新文件会触发 pre-commit 漂移拦截，未 sync 即 commit 曾致 tag 错位断链）；新增「tag 错位修复」流程与打 tag 前 HEAD 核对约定 — 治理规则

## [2.6.0] - 2026-08-15

### Changed
- **更新执行迁至独立执行器**（方案「独立更新执行器方案.md」）：新增 `lib/updater-host.cjs`（常驻独立进程，默认 127.0.0.1:3081，`updater.executorPort` 可配置）与 `lib/sys.cjs`（共享系统原语）；host 新增 RPC `update/executorEnsure`（拉起/版本对齐/重拉）；**删除 host 内 `update/apply`、`update/restart`**（依赖 dsh-web 进程的重启/重试在服务停止瞬间必然失效——v2.5.5 out.log 无 update/restart 日志为证）— [VU-001]
- **重启循环修复**：`timeout` 命令在非交互环境（stdio ignore）立即返回（实测 169ms），v2.5.3/2.5.4 的缓冲从未生效——执行器改用 **node `setTimeout` 可靠等待（stop 后 3s 缓冲）+ 端口健康检查 + 最多 5 次启动重试**（`buildRestartChain` → `buildRestartPlan` 参数对象）— [VU-001]
- **client 更新流程改走执行器**：确认 → envcheck（host）→ executorEnsure → 执行器 apply（安装 + 后台重启）→ 轮询执行器 status（倒计时「第 N 次 · 剩余 S 秒」+ 每轮反馈「第 N 次未恢复，执行器自动重试中」）→ healthy「✓ 重启成功」/ failed「5 次均未恢复，请手动 net start」— [VU-001]

### Added
- 前置实验验证：detached 进程在 dsh-web 服务重启中存活（标记进程全程写入）；执行器 3099/3097 测试端口链路走通（restart 一次 healthy / 白名单拒绝非法 tag/repo）— [VU-001]

## [2.5.5] - 2026-08-15

### Changed
- **重启自检 30s → 10s + 自动重试**（实测：安装后首次启动偶发 DSH 加载崩溃，第二次重启必正常）：自检 10s 未恢复 → 自动调用新 RPC `update/restart`（仅重启链，无安装）重试第二轮 → 仍未恢复才提示手动 `net start` — [VU-001]
- **重启状态倒计时与轮次反馈**：restarting 态显示「正在重启服务…（剩余 N 秒）」，第 2 轮显示「（第 2 次）」；每轮倒计时结束反馈结果——第 1 轮未恢复提示「正在自动重试…」，第 2 轮未恢复提示「请手动 net start」；恢复成功显示「✓ 重启成功，请刷新页面」— [VU-001]

## [2.5.4] - 2026-08-15

### Fixed
- **一键更新重启偶发停服务**（实测定位：v2.5.3 一键更新后新进程读到安装命令触发的 DSH 配置/包落盘中间态 → session-query-sqlite 崩溃 → AppExit 即停，需手动拉起）：重启链缓冲 2s → **5s**（`buildRestartChain`，U43 同步）— [VU-001]
- **重启结果自检**：`update/apply` 成功后 client 轮询首页（最长 30s）确认服务恢复——恢复 → 成功提示 + 刷新按钮；超时 → 明确提示「服务未自动恢复，请手动执行 net start dsh-web」（新增 `restarting` 阶段文案）— [VU-001]

## [2.5.3] - 2026-08-15

### Fixed
- **自定义模板每模式功能在 client 端失效**（v2.4.7 起，深入检查定位）：ParamsTab 用 `cfg.template.mode`（模板模式 custom/builtin）索引 `texts`/`defaults`——而键是优化模式名（base/lite/standard/smart）→ 预填取默认恒 undefined（切自定义窗口空）、显示恒空、输入写入 `texts['custom']`（host 读不到且刷新被白名单丢弃）、模式标签显示空。修复：4 处索引改用 `cfg.mode` + 标签 `modeShortLabel(cfg.mode)`；依赖数组补 `cfg.mode`/`prefillBusy`（快速切模式自动补预填，修竞态）— [PEN-002]
- **清理 v2.5.1/2.5.2 临时诊断代码**：probeEnv 的 debug/raw 字段与 host 透传移除（根因已定位并修复，发布物不再携带 TEMP-DEBUG）— [VU-001]

## [2.5.2] - 2026-08-15

### Fixed
- **服务进程 PATH 缺 system32 导致探测/重启链失败**（v2.5.1 诊断实证）：`mergedEnv` 不再依赖 `process.env.PATH`，改为注册表读取系统 PATH（HKLM）+ 用户 PATH（HKCU）合并，并**兜底追加 `SystemRoot\System32`**——修复环境检测 service/account/pnpmInfo/net 误报，以及重启链 `cmd.exe` 不可达（RESTART_SPAWN_FAILED）— [VU-001]
- **pnpmInfo 文案错位**：探测 detail `missing` 与 service 共用文案键，pnpm 缺失时显示「服务不存在」；改用独立键 `pnpm-missing`（「未找到 pnpm——请安装 pnpm」）— [VU-001]
- **重启链依赖补齐并收敛**（用户决策：只查重启链，其他不查）：新增 `svc-type`（START_TYPE 非 DISABLED，block）/ `svc-bin`（nssm Application 可执行文件存在，block）；`port` 修复盲区（端口解析失败不再静默判 ✓）；**移除安装链/形态类检查**（net / mode / pnpmInfo）——最终检查集 = 重启链纯依赖 6 项（service/account/svc-type/svc-bin/restart/port）— [VU-001]

## [2.5.1] - 2026-08-15

### Fixed
- **环境检测 net 项探测失败**：`lib/index.cjs` `runProbe` 参数白名单正则漏了 `%{}` 字符，`curl -w %{http_code}` 被拒 → 网络连通性探测恒失败（误报 proxy-unreachable）；已放行 `%{}` — [VU-001]

## [2.5.0] - 2026-08-15

### Added
- **一键更新并重启**：「版本检测与更新」卡片在发现新版本后提供 ⚡ 一键更新按钮——二次确认后 host 自动执行官方安装命令（`dsh plugin add github:...#<tag>`，120s 超时）→ 安装成功才执行分离重启链（`net stop <svc> & timeout 2 & net start <svc>`，脱离进程树）→ 页面提供刷新按钮；失败绝不重启（安装失败/环境错误均不触碰服务）— [VU-001]
- **环境检测按钮**：卡片行 1 新增「环境检测」（样式同检查版本）——只读探测 7 项：网络连通性（curl 实测 codeload）/ 服务名存在 / 服务账号 LocalSystem / 服务可重启（nssm KillProcessTree）/ 端口占用 / 安装形态 / pnpm 注入机制；每项 ✓/⚠/✗ + 指引；一键更新前自动前置校验（block 级缺失阻止并列出）— [VU-001]
- **系统级注入层**（`lib/index.cjs`，bundle 形态专属）：`harness.sysInfo` / `execCommand`（用户 PATH 自动注入，读 HKCU\Environment\Path 合并去重）/ `execDetached` / `probeEnv`；命令模板白名单二次校验（参数级比对 + tag 正则）；动态 Cordis 安装形态自动降级（UNSUPPORTED 提示）— [VU-001]
- 单测 U42–U45：安装命令构造 / 重启链模板 / PATH 合并去重 / 探测计划契约；全量 47/47 通过 — [VU-001]

### Changed
- host 新增 RPC `update/apply` / `update/envcheck`；PURE 区段新增 `ENV_PROBE_KEYS` / `buildInstallArgs` / `buildRestartChain` / `mergeEnvPath`（lib 层切片复用 mergeEnvPath 做 PATH 注入，单一事实源）— [VU-001]

## [2.4.8] - 2026-08-15

### Fixed
- **恢复 v2.4.4 槽位占位 id 修复**：`sidebar.footer.action` 占位 id 由 `cordis-panel` 改回插件唯一值 `cordis-panel-enh`——v2.4.5 曾无记录回退该修复（与基座 `dsh-client-ui-cordis` 同槽位同 id 冲突，update/重挂时 single-occupant duplicate / "Failed to load plugins"），v2.4.5–v2.4.7 的 GitHub 发布物均受影响；本版恢复并重建 `lib/client.cjs` — [PEN-001]

### Docs
- **新增 DSH 开发参考文档**：`docs/devref/DSH开发参考文档.md`（官方文档地图、插件开发要点、本机运维实况、2026-08-15 崩溃事件踩坑记录、命令速查；本地治理，不入库）— 供后续开发/排障参考

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
- README 安装章节改为实测通过的傻瓜式一条命令：`dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v2.4.4`（版本锁定 + pnpm 前提 + allowBuilds 兜底说明），降低新用户安装门槛 — [VU-001]
- Release 资产附 `dsh-prompt-enhancer-<版本>.tgz` 安装包，README 新增「下载安装包离线安装」方式（`dsh plugin add ./xxx.tgz`，含预构建 lib/，无需联网与构建授权）— [VU-001]

## [2.4.4] - 2026-08-15

### Added
- 协同治理落地：新增 `AGENTS.md`（agent 开工入口：改前影响分析 + 改后同步地图/日志）与项目地图 `docs/map/index.md`（root 模块级 / tree 文件级 / flow 功能链路，FLOW-ID: PEN / VU / DG）— [MAP-001]

### Fixed
- `sidebar.footer.action` 占位注册 id 由 `cordis-panel` 改为插件唯一值 `cordis-panel-enh`，回避与基座 `dsh-client-ui-cordis` 的 `CordisPanel`（同槽位同 id）冲突，修复 update/重挂时的 single-occupant duplicate 与 "Failed to load plugins"（历史 v2.4.1-fix2 同源问题）— [PEN-001]

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

[2.8.3]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.8.3
[3.0.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.0.0
[2.8.2]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.8.2
[2.8.1]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.8.1
[2.8.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.8.0
[2.7.1]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.7.1
[2.7.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.7.0
[2.6.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.6.0
[2.5.5]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.5.5
[2.5.4]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.5.4
[2.5.3]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.5.3
[2.5.2]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.5.2
[2.5.1]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.5.1
[2.5.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.5.0
[2.4.8]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.8
[2.4.7]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.7
[2.4.6]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.6
[2.4.5]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.5
[2.4.4]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.4
[2.4.3]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.3
[2.4.2]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.2
[2.4.1]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.1
[2.4.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.0
