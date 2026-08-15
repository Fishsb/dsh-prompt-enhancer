# Changelog

本项目所有重要变更记录于此文件。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。完整发布说明见 [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)。

> 🗺️ 本日志与项目地图[`docs/map/`](docs/map/index.md)交叉引用：新条目标注涉及 map/flow-id（PEN/VU/DG）；agent 开工前先读 [`AGENTS.md`](AGENTS.md)。

## [Unreleased]

### Changed
- **环境检测收敛为执行器重启阶段检查**：envcheck 保留 service / svc-type / svc-bin / port（`sc stop/start` 前提、禁用拦截、可执行文件存在、端口占用防健康检查误判），**新增 exec-port 更新端口独立检查**（≠ 服务端口且未被占用，冲突 warn 提示并指引修改 `updater.executorPort`；显示名用「更新端口」用户口径）；清理 account（启动账号与 `sc start` 无关）与 restart（KillProcessTree 不影响 v2.6.0 独立 detached 执行器）— [VU-001]
- **AGENTS.md 发布 SOP 修订**（v2.7.0 实战教训固化）：发布前新增「先跑项目地图 sync」（release-notes 新文件会触发 pre-commit 漂移拦截，未 sync 即 commit 曾致 tag 错位断链）；新增「tag 错位修复」流程与打 tag 前 HEAD 核对约定 — 治理规则

## [2.7.0] - 2026-08-15

### Changed
- **按钮「继续优化」状态**：成功应用过至少一轮优化后，用户继续修改草稿时按钮由「✨ + 模式短标签」变为**纯文字「继续优化」**（无 ✨ 图标，hover 提示同步区分）；撤回 = 回到起点，按钮恢复「首次优化」形态；优化中 / 完成撤回 / 空输入记忆开关 / 守卫禁用等其余状态不变 — [PEN-001]
- **记忆升级为发送前多轮迭代链**：记忆由「上一轮优化对」升级为 rounds 链（client 内存保留最近 4 轮输入/输出）——发送前「优化→修改→再优化」的每轮改动都会累积，再优化时以**真多轮 user/assistant 消息**代入全部轮次，并通过行级 diff 感知本轮相对上一轮结果的修改方向（+新增/-删除摘要，≤300 字符）；预算规则：链 ≤2400 字符按轮等分（输入 1/3、输出 2/3），记忆注入同样触发防回显护栏；撤回改为只弹出最后一轮（更早轮次仍有效）— [PEN-003]
- **记忆开关文案同步**：设置页提示与 README（中/英）说明多轮累积语义与隐私边界（记忆链仅存页面内存，随优化请求发送给所选模型厂商）— [PEN-003]

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
