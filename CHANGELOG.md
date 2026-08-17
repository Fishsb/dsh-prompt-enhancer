# Changelog

本项目所有重要变更记录于此文件。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。完整发布说明见 [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)。

> 🗺️ 本日志与项目地图[`docs/map/`](docs/map/index.md)交叉引用：新条目标注涉及 map/flow-id（PEN/VU/DG）；agent 开工前先读 [`AGENTS.md`](AGENTS.md)。

## [Unreleased]

### Changed
- **rounds 模式补「读取会话」步骤（用户需求·审查其他模式）**：lite/standard/smart 的会话历史读取（fetchSessionHistory）补 `setProgress(STAGE_HISTORY)` 进度点（与 publish 一致）——真实使用有会话历史时显示「读取会话 → 判定 1/1（或 1/3）→ …」；测试环境无真实会话历史故判定步骤不触发（正常）；base 无检索直发。审查结论：五模式步骤完整 — [PEN-001]
- **publish 步骤细化 + 进度数字修复（用户需求）**：实测 publish 原仅 3 步且「搜索 /」数字为空——根因 buildV2ContextBlock mark 的 step/total 未进 detailArgs，按钮模板 {current}/{total} 取 detailArgs 为空。修复：按钮替换 {current}/{total} 优先 detailArgs、缺失回退 progress 的 step/total（judge/search 数字恢复）。实测 publish：规划检索 1s → 读取会话 2s → 搜索 2/3 3s → 1 优化中 4s ✅（步骤细化、数字正确）；全部文案 ≤6 字 — [PEN-001]
- **每模式步骤进度补充（用户需求·分析各模式步骤）**：梳理各模式增强管道步骤——base 直发（无检索，直接模型调用）/ lite·standard 会话关联判定（逐窗口）/ smart 关联判定→开发意向→文档分析→代码检索 / publish 检索主题规划→多主题网络搜索。补充缺失进度点：analyze 阶段开始上报「分析任务」、assemble 阶段上报「组装上下文」（host enhance-handlers 补 `setProgress`）；实测（smart）：判定意向 → 分析文档 → 1 优化中 ✅；base 无检索故直接模型调用（正常）— [PEN-001]
- **优化按钮全部提醒精简到 4~6 字（用户需求）**：stage/stageDetail 文案统一压缩——stage 键（准备中/读取会话/分析任务/检索文件/检索会话/组装上下文/模型调用中）；detail 键保留进度数字去冗余（「判定 {current}/{total}」「判定意向」「分析文档」「检索代码」「规划检索」「搜索 {current}/{total}」「扫描工作区」「重试 {current}/{total}」「连通 {current}/{total}」，Search 去 query）；en 同步短词 — [PEN-001]
- **修复优化按钮步骤进度从未显示（用户反馈·prog 覆盖 bug）**：`enhance-button` 进度文案生成中 `let prog = t('enhancing')` 把进度**对象**覆盖成**字符串**，导致 `prog.stage/detailKey/elapsedMs` 判断全部失效——各阶段步骤进度（正在分析/检索/搜索 2/3…）与模型序号从未显示，按钮恒定「优化中」。修复：分离 `st`（进度对象·判断用）与 `progText`（文案·显示用），llm 阶段显示「{n} 优化中」/「{n} 正在重试」，其余 stage 保留 detail 模板。实测（smart）：判定开发意向 → 分析项目文档 → 1 优化中 Ns ✅ — [PEN-001]
- **优化按钮提示精简（用户需求）**：llm 阶段「优化中」→「{n} 优化中」（n = 当前尝试模型序号，失败切换递增 1→2→3，用户可判断是模型配置问题）；重试精简为「{n} 正在重试」（原「模型 {n} 优化中 · 正在重试」过长）；成功态「✓ 已优化，可撤回」→「可撤回」（result/resultFallback 统一）；新增 `enhancingModel`/`enhancingRetryModel` i18n（中/英）— [PEN-001]
- **开启思考模型红色耗时提醒（用户需求）**：模型配置栏任一模型开启「思考开关」后，配置栏最下面显示红色提醒「高推理强度会极大增加优化所需时间（思考模式耗时可数倍于普通模式），请按需选择强度」（`cfgReasoningWarn` i18n + `.dsh-plg-reasoning-warn` 红色警示样式，`fallback.some(reasoning.enabled)` 触发）— [PEN-002]
- **插件管理模块自动版本检测（用户需求）**：打开设置页「插件管理」板块时自动执行一次版本检测（UpdaterCard 挂载 useEffect 触发 doCheck；React tab 切换重挂载则每次进入自动检查，checking 防重入；手动按钮保留）— [VU-001]
- **插件管理板块加项目地址跳转链接（用户需求）**：设置页「插件管理」板块「版本检测与更新」卡片下方另起一行，新增项目地址链接（GitHub · Fishsb/dsh-prompt-enhancer，新标签页打开，品牌色下划线可点样式）；新增 `cfgProjectLink` i18n 键（中/英）+ `.dsh-plg-project-link` 样式 — [VU-001]
- **取消记忆兜底 + publish 参数强制（用户指令）**：① **记忆开关不再兜底轻量模式**——原「记忆开 + 无记忆 + 首次 → 强制轻量模式」取消（client resolveActualMode），记忆只负责携带 rounds 链，优化模式始终按用户选择执行（base/lite/standard/smart/publish 均不兜底）；② **一键发布四项限制取消**——原 publish 记忆强制开启（client state.js / host pure.js / config-schema 三处）、超时强制 ≥240s、maxTokens 强制 0、outputLimit 强制 0（host enhance-handlers 参数强制）全部取消：publish 记忆/超时/Token 上限/字符上限均可调（默认档 60s/4k/16k 按上一轮实测覆盖），UI 置灰移除（params-tab memoryLocked + 三下拉 disabled + 切 publish 强制记忆）、i18n 死键 cfgPublishMemoryLocked 删除。实测验证：publish 配置 memory:false/maxTokens=4000/outputLimit=16000 生效（日志 ctx=none、参数用配置值），9292 字符输出不截断。129/129 — [PEN-002]/[PEN-003]
- **模板优化后参数档位重审（用户指令·默认模板 ×3 重测定档）**：5 模式默认模板 ×3 次真实增强重测（模板已按模式定制+方法论强化后旧数据过时）——base 6.5s/94 字、lite 9.9s/132、standard 9.0s/117、smart 24.5s/310、publish 44.3s/6469 字（≈1848 token）。结论：**仅 publish 默认档不适配**（实测 max 51.1s / 8593 字符 / 2455 token 超原默认 30s/2k/8k），上调 `MODE_PARAMS_DEFAULT.publish` → **60s/4k/16k**（与档位池 [0,60s,120s,240s] 一致，消除原 30000 不在池内的切换重置不一致）；其余 4 模式默认档余量充足（≥1.6 倍），预留档（思考档×2 / 复杂档×4）覆盖增量模板（最大 636 字/182 token）不变。三处同步（pure.js + config-schema.js + client constants），U 测试改 publish 断言 — [PEN-002]
- **每模式增量模板（用户指令·保守增量 + 方向差异化）**：在每模式默认模板基础上，为 5 模式各新增**唯一增量模板**（`prompts/increment*.md` → `SYSTEM_INCREMENT[_LITE/_STANDARD/_SMART/_PUBLISH]_PROMPT`），并**收敛原共享 T2/T3（supplement/dev）**——每模式内置模板由 3 个减为 2 个（default/increment）。概念分工（模板内【与默认模板的分工】明示）：**默认模板只把当前语句重构描述得更清晰、不扩展任何信息**；**增量模板先理解语句实际想执行什么任务，再保守补充「这个任务语句没说的、缺失会让执行模型误判」的大逻辑与信息**——只补任务类型/对象范围/交付形态/关键边界/必要默认值，不补细节、不盲目扩充任务范围、不臆造（未明确处用「如无特别说明/默认」标注）。**每模式增量方向不同**：base 通用保守增量（无上下文）/ lite 上轮延续（结合上轮已确认决策补缺口，不重复已确认）/ standard 多轮演进（+禁入集合=已否决方向）/ smart 开发向（任务映射工程大逻辑，不臆造接口文件名，可输出【调整方案】）/ publish 九章规格（保留已确认设计，只补范围边界/交付形态/核心机制/验收维度，含保守性自评）。运行时：`BUILTIN_TEMPLATES` 与 `template/default` catalog 改为 [T1, T2]；旧配置 pick `supplement`/`dev` 自动迁移为 `increment`（pure.js + config-schema.js 双镜像）；client `TEMPLATE_BUILTIN_KEYS`/i18n 改为 2 内置模板（`增量模板`），tplNote 更新。新增 U39c 契约测试（保守增量红线 + 每模式方向断言），U57/U41/CFG-05 改 increment 语义，测试 129/129 — [PEN-002]
- **语义重构方法论升级为五步法（用户指令·论文检索驱动）**：检索并吸收高可信论文洞见后，把【语义重构】从四手法扩为**五步法**：① 原子拆解（VisualPrompter：拆成最小语义单元）② 要素盘点·不可删集合（RiOT：残差保留防语义漂移）③ 逻辑重组 ④ 明确化与强化（OPRO/DSPy：明确性=可执行性）⑤ 保真自检·防漂移（Sem-DPO：语义漂移上界、输出前逐要素核对；LLM 行为漂移论文：等价不只是「看起来相同」而是「下游执行结果一致」）；新增【保真优先】原则（paraphrase 综述：语义保真第一目标、表达多样性其次）。已同步 system.md / system-lite / standard / smart 四模板，U39b 增五步法断言，测试 128/128 — [PEN-002]
- **每模式默认模板按场景定制（用户指令·模板体系）**：分析确定各模式作用场景（base 快速通用 / lite 上轮延续 / standard 多轮演进 / smart 开发向 / publish 规格生成）后，为 lite/standard/smart 新增专属默认模板（`prompts/system-lite.md` / `system-standard.md` / `system-smart.md`，经 sync-prompts 内联为 `SYSTEM_LITE/STANDARD/SMART_PROMPT`）：lite 含【上轮参考处理】（上轮结果为主要依据、延续已确认决策）、standard 含【多轮脉络处理】（识别已确认决策/已否决方向）、smart 含【项目事实优先】（以文档与代码为准、不臆造接口结构）；**全部模板新增【语义重构】方法论**（先理解再重组：抽象提升 / 条件具体化 / 约束强化 / 例证支撑）+ 用户示例（执行器独立：口语→结构化原则），base 通用模板同步升级；`BUILTIN_TEMPLATES` 与 `template/default` RPC 的 defaults/catalog 按模式指向专属 T1（T2/T3 仍通用可切换）。新增 U39b 契约测试，SMK-10/11/12 的 SMART_TAIL 断言改精确（模板含「调整方案」不再误判），测试 128/128 — [PEN-002]
- **超时/Token/字符档位实测驱动 + 切换模式重置默认（用户指令·不猜）**：对 4 模式（base/lite/standard/smart）× 3 次真实增强（默认模板 T1、不带思考）实测——base avg 2.6s / lite 5.7s / standard 2.2s / smart 6.7s（最大 9.8s）、输出 156–336 字符（≈40–85 token）。据此定档：**标准档（= 各模式默认）** 超时 base/lite/standard 30s / smart 60s、Token 2k / smart 4k、字符 8k / smart 16k（实测 × 余量 + 模板语义保真上限）；**两个更高档预留**：思考档（超时 ×2、Token/字符 ×2）与复杂模板档（超时 ×4、Token/字符 ×4 上限）。新增 `MODE_PARAMS_DEFAULT`（host pure.js + client constants + config-schema 三处同步，validateConfig 按模式回退默认、显式设置含 0 优先）；**切换模式自动重置** params + budgetChars 到该模式默认（替代上一版就近校正）；档位池 `MODE_TIMEOUT/MAXTOKENS/OUTPUTLIMIT_OPTIONS` 按实测更新（Token 去 1k 档、字符去 4k 档、smart 最高 16k token / 50k 字符）— [PEN-002]
- **超时/Token/字符上限每模式档位（用户需求·延续预算方案）**：结合模式逻辑（smart 常带 effort、host 自动 ≥120s、publish 由 host 硬覆盖不设限）+ 模板逻辑（T1 简单 ≤800 字符 / 复杂可超出；effort 思考消耗）重构三下拉档位——**移除陷阱档**（超时 10s 基本必然超时 / Token 500 太小 / 字符 2000 会截断复杂输出）；**每模式独立档位**（`MODE_TIMEOUT_OPTIONS` / `MODE_MAXTOKENS_OPTIONS` / `MODE_OUTPUTLIMIT_OPTIONS`）：超时 base/lite/standard 0/30s/60s/120s、smart 0/60s/120s/240s；Token base/lite/standard 0/1k/2k/4k、smart 0/2k/4k/8k；字符统一 0/4k/8k/16k；切换模式时**就近校正**三项到新模式档位（避免残留非法档被静默回退）；渲染时对旧配置值**就近显示**（不改实际配置）；清理 plugins-section 旧 `TIMEOUT_OPTIONS` 等死代码 — [PEN-002]
- **端口重启「更新执行器不可用」误报根治（用户反馈·v3.1.6 迭代）**：执行器未运行/中途不可达时，client 报「更新执行器不可用——请确认插件为 bundle 安装」误导用户（bundle 安装但执行器未拉起）。三层修复：① `runRestart` 的 `executorEnsure` 自动拉起**最多重试 3 次（间隔 1s）**——拉起执行器需 2-5s（schtasks + 进程启动 + ping 轮询），前端 RPC 瞬时失败可恢复；② 失败分支**补清残留阶段文案**（此前只报错不清「正在重启服务…」，UI 双行误导）；③ `pollExecutorStatus` 连续失败 15 次报错前**最后尝试经 host 重新拉起执行器并重发 restart**（拉起成功重置计数继续轮询，仅拉起失败才终止）。文案同步改为准确提示「已自动重试仍失败，请刷新页面后重试；若仍失败请重启 dsh-web 服务」 — [VU-001]
- **执行器独立化：移除非自身链路的限制（用户指令）**：更新执行器是独立端口（3081）的独立功能——除影响**执行器自身链路执行**的检查（`exec-port` 端口可用、`tools` 重启工具）外，服务相关检查（`service`/`svc-type`/`svc-bin`）不再 block 一键更新。理由：apply 为 staged 下载+校验、零端口操作、不依赖服务状态；真正安装重启时执行器内部自行校验报错（STOP_FAILED 等）。服务相关项仍展示在「环境检测」结果里（warn 提示），不阻止执行器使用。保留的执行器自身限制：版本门槛（≥0.1.8 才支持 staged/restart 承载安装，能力检查）、版本对齐（executorEnsure kill 旧重建）、端口独立（exec-port）— [VU-001]
- **重启提示文案中性化（用户反馈·「第 1 次失败」误导）**：`updApplyRetry` 旧文案「第 {n} 次重启未恢复，执行器自动重试中…」在 attempt=1（round 1 正在执行，健康探测最长 20s）时就显示，服务尚未失败却提示「未恢复」，用户误以为第一次必然失败。改为中性「正在尝试第 {n} 次重启（服务启动中，最长 20 秒）…」——轮次更新保留（attempt≥2 立即可见），真正失败（failed 终态 / 5 轮全败）才显示失败文案 — [VU-001]
- **设置页「优化模式」下拉框跟随语言（用户反馈）**：ParamsTab 模式下拉选项原先直接渲染 `MODE_OPTIONS[].label`（硬编码中文「基础模式/轻量模式…」），切换语言（EN）时选项文字不变。现新增 `modeLabel*` i18n 键（ZH/EN 五模式全称）+ `modeLabel(t, mode)` 解析函数（i18n 优先、`MODE_OPTIONS.label` 中文回退），下拉框选项改用 `modeLabel(t, m.value)`——语言切换即时生效 — [PEN-002]
- **下拉箭头点击不弹出修复（用户反馈·双重触发修正）**：MarqueeSelect 箭头原为 trigger 的兄弟元素且在 trigger 外（点击不触发 toggle，arrow 的 `pointer-events:none` 穿透到无 onClick 的 root）。修复：①箭头移入 trigger 内 + CSS `pointer-events:auto` + `cursor:pointer`——点击箭头事件冒泡到 trigger → `onClick toggle` 一次弹出/收起；②**箭头不绑 onClick**（若绑则点击箭头同时触发箭头与 trigger 两次 toggle → 状态不变弹不出来）。箭头 `absolute` 定位与右侧 28px 占位（v2.8.4 防遮挡）保持不变。所有使用 MarqueeSelect 的下拉框一并修复 — [PEN-002]
- **下拉框内容禁止选中（用户反馈·双击选中）**：MarqueeSelect 的 root（`.dsh-plg-mselect`）加 `user-select:none;-webkit-user-select:none`——下拉框 trigger 显示文字与下拉弹窗选项均不可被鼠标选中（双击不再高亮内容）；`-webkit-` 前缀兼容 WebView2/Chromium — [PEN-002]
- **上下文预算真正生效 + 每模式独立档位（用户需求·方案 2）**：预算此前只在 publish 模式生效（v3.0 重构后 base/lite/standard/smart 走 rounds 会话检索、不消费 `budgetChars`，5 个档位形同虚设）。现让预算对所有模式生效：① **rounds 模式（lite/standard/smart）消费预算**——budget 0 = 跳过检索（不注入参考，等价 base 直发）；budget > 0 时会话参考注入上限随档位伸缩（`BUDGET_RETRIEVE_TABLE`：roundsChars 1200→16000）；② **smart 工作区随预算伸缩**——文档扫描数/深度/文档与代码内容上限按档位递增（2~12 文件 / 1500~12000 字符）；③ **每模式独立档位**（`MODE_BUDGET_OPTIONS`）：base [0] / lite [0,2000,4000] / standard [0,2000,4000,8000] / smart [0,2000,4000,8000,16000] / publish [0,4000,8000,16000,32000]（新增 32000 档 maxFiles 14/depth 5），下拉按当前模式渲染、最大档显示「无限制」；④ **默认值修正**——`MODE_BUDGET_DEFAULT`（base 0 / lite 2000 / standard/smart/publish 4000），修复旧行为（base/lite 默认被全局 4000 覆盖、lite 不注入却读会话）；⑤ **切换模式自动校正预算**到新模式档位内（避免残留非法档被静默回退）。更新 U1/U19/U20 + 新增 resolveRetrieveBudget 断言，测试 127/127 — [PEN-002]
- **优化参数 4 个下拉框加「无限制」选项（用户需求）**：上下文预算/超时时间/输出 Token 上限/输出字符上限各加「无限制」选项——值语义：`timeoutMs/maxTokens/outputLimit = 0`（不设超时 / provider 默认上限 / 不截断）、`budgetChars = 16000`（最大扫描档 maxFiles 10/depth 4）。改动：client 下拉选项 + `cfgUnlimited` i18n；host `pure.js`（BUDGET_OPTIONS/WORKSPACE_TABLE 加 16000、validateConfig params 允许 0）、`enhance-handlers.js`（timeoutMs<=0 不挂超时、effort 放宽不覆盖 0）、`config-schema.js`（sanitize 允许 0）；新增 CFG-06 测试 + U20 更新 — [PEN-002]

## [3.1.4] - 2026-08-17

### Changed
- **连通性测试新增「基础模式默认模板预计耗时」（用户需求）**：测试连通性成功后，结果区展示实测连通耗时，并**将「实测」与「历史」分开标注、两者都显式展示**（可换行）。实测来自本次 200-token 探测的 TTFT/吞吐（usage 优先/字符估算兜底）；历史数据只按模型名匹配（不区分 provider 路由）。预计耗时按当前输入长度动态估算输出 token（字符数 / 4，最低 200 token）；实测/历史任一缺失时分别明确提示。新增 `models/stats` RPC 与 U68 单测 — [PEN-004]
- **连通性测试结果区展示优化（用户指令）**：实测/历史行不再与「测试 #N」标题同行——测试区改为纵向布局（标题 + ✕ 一行，实测、历史各占一行），且实测/历史字号与标题对齐（12px）；预计耗时显式标注**两个模式的时间参考**：`基础模式预计约 X`（默认模板，字符数 /4、最低 200 token）+ `轻量模式预计约 Y`（**按模式实际功能**——轻量模式含「检索引入会话」：读取最近 1 轮会话 + LLM 关联判定（RELEVANCE 调用，输出预算 400 token），相对基础模式多一次关联判定 LLM 调用（自身 TTFT + 判定输出吞吐），预计耗时更长）；host 新增 `estimatedLiteSeconds` 返回字段与 `estimateLiteModeSeconds` 纯函数，新增 U68b 单测；实测/历史任一缺失时轻量预计显示占位「—」 — [PEN-004]
- **连通性测试 TTFT 显示单位修复（用户实测反馈）**：此前「首 token」误把毫秒当秒格式化——TTFT 4705ms 显示成 `78m25s`、5874ms 显示成 `97m54s`（离谱数据）。现新增 `fmtEstMs`（<1s 显示 `78ms`，≥1s 显示 `4.7s`），实测/历史行的 TTFT 均改用毫秒格式化 — [PEN-004]
- **连通性测试探测改长文（方案 2 · 用户确认）**：此前探测 maxTokens=200 + prompt 要求「short text」，模型只吐几个 token、decode 窗口仅 ~2ms，tps = token/极短时间 被数学放大（实测虚高到 4500 tok/s，真实量级 75–267 tok/s）。现改为 maxTokens=1200 + 要求写 ~800 词纯散文长文，decode 窗口拉到秒级，tps 才有意义；探测保持「未开思考」口径（不传 reasoningEffort，TTFT 不含思考时间、更贴近纯生成速度）；`models/test` 超时 15s → 30s（最慢档 75 tok/s × 1200 token ≈ 16s 留余量）— [PEN-004]
- **连通性测试结果区布局微调（用户指令）**：✓ 可用/✗ 失败状态移入头部行，与「测试 #N · 厂商 / 模型」同行（标题靠左、✕ 靠右），实测/历史仍各占一行；头部行内部元素 white-space:nowrap 防折行 — [PEN-004]
- **端口重启自动拉起更新执行器（用户反馈·执行器未运行时误报）**：`runRestart` 原先直接 ping 3081，执行器未运行时立刻报「更新执行器不可用——请确认插件为 bundle 安装」（误导——bundle 安装但执行器未拉起）；现改为**先直连 ping，未运行则尝试 host `update/executorEnsure` 自动拉起**（服务存活时有效，schtasks 链路拉起后继续执行重启），host 也不可达（服务已停且执行器未运行，异常场景）才报错 — [VU-001]
- **重启第一次必然失败修复（用户实测·执行器 0.1.8 → 0.1.9）**：`restartService` 的 `sc start` 后健康检查从「固定等 8s 检查一次」改为「**最长 20s 健康探测循环，每 1s 探测、端口通了立即 healthy**」——DSH 冷启动（加载插件/执行器/数据库）常超 8s，旧 8s 窗口导致 round 1 稳定判失败、round 2 才成功（用户实测「重启第一次必然失败」）；探测循环让慢启动服务首次尝试即成功、且快了立即返回。实测：0.1.9 round 1 即 healthy（+26.3s）— [VU-001]
- **重启重试提示轮次不更新修复（用户反馈）**：`pollExecutorStatus` 原先每 tick `setApplyErr(null)` 清空红色提示、只在 10s 倒计时归零瞬间 flash 一次（下一秒又被清掉），用户看到的总是「第 1 次重启未恢复」；改为**每次轮询持续显示当前轮次**（跟随执行器 `s.attempt`，attempt≥1 即 stop+start 已开始才显示红色，stopping/settling 阶段不误报），轮次递增立即可见 — [VU-001]
- **重启假 healthy 修复（用户实测·执行器 0.1.9 → 0.1.11）**：`restartService` 的 `sc stop` 后 10 秒循环**不检查是否真的 STOPPED**，直接假装已停止继续——执行器无权限（sc stop 拒绝访问）时服务根本没停、旧进程仍占 3080 端口，round 1 探测立即通过 → **误报 healthy**（实测：restart 前后 3080 PID 不变，服务从未真正重启，重启横幅也因此永不消失）。现两处加固：① **stop 后必须确认服务到达 STOPPED**，未停成直接失败返回 `STOP_FAILED`（含轮内 stop 同样校验），不再假成功；② **重启成功判定升级为「端口监听 + 服务 PID 已更新」**（用户指令·PID 校验）——关闭前记录服务 PID（`sc queryex`），重启后新 PID 有效且 ≠ 旧 PID 才算 healthy，仅端口监听会被旧进程残留误判；失败信息同步带上 listening/pid 状态 — [VU-001]
- **README 展示页重构为平衡派（用户指令）**：对标同生态高星插件展示格式，将 README.md / README.en.md 从原文档式结构重写为精炼展示页（功能亮点 → 安装 → 使用 → 效果展示 → 配置 → 文档）；删除冗长的隐私 / 兼容性大段文字，改为「一句话 + 链接 `docs/compatibility-matrix.md`」；替换 v2.4.3 残留旧截图 `settings-v2.4.3.png` 为用户提供的当前模型配置页（`settings-models.png`）与优化参数页（`settings-params.png`）并排展示；中英文对称 — [FLOW-PROMPT-ENHANCE]

### Fixed
- **连通性测试历史统计卡「测试中…」（用户实测）**：`models/stats` 原先逐个 `readSession` 全量历史日志导致 30s+ 超时；改为 live 会话走内存、persisted 会话有界扫描（单次最多 5 个，用户确认足够）并缓存 route/projection，客户端另加 8s 超时兜底，不再无限等待 — [PEN-004]
- **「暂无该模型历史统计」误报（用户实测）**：此前按 provider+model 完全匹配，provider 路由别名不同（如 deepseek-official vs opencode）时同模型也判无数据；现改为**只按模型名匹配** — [PEN-004]
- **移除重复的「（TTFT xxxms）」展示（用户反馈）**：连通性测试本身的耗时即首 token 延迟，不再单独重复显示 TTFT — [PEN-004]
- **README 记忆功能描述修正（用户指出）**：原展示页记忆开关沿用 v2.x 废弃规则「记忆链最近 4 轮滚动保留、发送不清除」，与最新行为不符；对齐 CHANGELOG [3.0.0]（发送消息即清空记忆链，仅发送前优化轮次内累积）与 [3.1.3]（继续优化基于本轮改动直接优化、跳过检索），更新中英文 README 记忆开关说明 — [FLOW-PROMPT-ENHANCE]
- **README 轻量模式描述修正（全文核对发现）**：原展示页写「轻量（本地规则）」，与 v3.0 模式重构后行为不符——`enhance-handlers.js` 已移除 lite 规则检查、改为「前 1 轮会话关联参考」；更新中英文 README 模式说明为「轻量（结合上一轮对话参考）」/「Lite (previous-round context)」 — [FLOW-PROMPT-ENHANCE]
- **README 撤回术语统一（用户指令）**：功能亮点「一键撤回」与简介/使用步骤的按钮实际文案「可撤回」不统一，统一为「可撤回」（与按钮文案、CHANGELOG 实证一致）；英文 highlights 已用 undo，无需改 — [FLOW-PROMPT-ENHANCE]

## [3.1.3] - 2026-08-17

### Fixed
- **修复「恢复默认模型链」失效（日志诊断发现）**：`models/autochain` RPC handler 签名漏了 `args` 参数，但函数体引用了 `args.noCache`（v3.1.0 加 noCache 旁路时引入）——每次调用抛 `ReferenceError: args is not defined` 返回 `AUTOCHAIN_FAILED`，client「恢复默认」只能回退静态兜底链；补上 `async (args) =>` 签名，自适应默认链恢复可用 — [PEN-002]

### Changed
- **模型响应看门狗超时 3s → 5s（用户指令）**：`WATCHDOG_TIMEOUT_MS` 3000→5000——首条模型 3 秒无输出即判死过于激进（模型偶发慢启动被误杀、频繁换链拖慢体验），放宽到 5 秒再判；探测/缓存阈值不变 — [PEN-002]
- **参考上下文从「仅供背景」改为「吸收明确需求」（实测驱动）**：此前检索/记忆参考只追加“禁止复述”护栏，模型把参考当背景噪音，实测“有参考”未提升输出质量反而更慢。现重写 `prompts/context-guard.md` 为参考使用规则——要求将参考中明确的需求、约束、默认值、已确认决策吸收进优化结果，仍禁止逐字复述/回显，原文冲突时以原文为准；同步在 `system.md`/`system-supplement.md`/`publish.md` 补充“吸收参考”约束，并将检索注入标签改为「相关会话参考（仅吸收明确需求，禁止复述）」；新增 U40b 断言防回归 — [PEN-001]/[PEN-003]
- **记忆链「继续优化」改为基于本轮改动直接优化（用户定义修正）**：此前继续优化仍走完整模式流程（会做会话/文档检索），与“基于改动直接优化”的语义不符。现新增 `isContinuation` 判定（记忆链有轮次且本轮存在新增/删除改动）——继续优化时 **retrieve 阶段直接跳过**（不再拉历史/调 judge/检索工作区/网络），新增 `prompts/continue.md` 指令要求“以本轮修改为主要方向、不要重新从零优化、输出完整更新后的提示词”，assemble 将【本轮修改】摘要置于消息最前作为主要优化方向；client 继续优化时显式传 `continue:true`；新增 SMK-08b 断言防回归 — [PEN-003]

## [3.1.2] - 2026-08-17

### Fixed
- **修复一键更新后端口重启按钮点不了（用户报告）**：v3.0.0 职责划分后一键更新（staged 模式）终态为 `staged`（新版本已下载、服务未重启），但 `startConfirm` 白名单只放行 `idle/installed`，staged 态下点击端口重启被静默忽略——放行 `staged` 态下的 restart（端口重启），点击进入确认态完成安装+重启 — [VU-001]

## [3.1.1] - 2026-08-17

### Fixed
- **下拉框超长文本自动滚动彻底修复（用户反馈，三轮根因）**：① 滚动显示仍是被压缩的省略号内容——`MarqueeSelect` 改为双层结构（外层裁剪/测量、内层全宽文字承载跑马灯动画），动画不再平移被 `max-width/ellipsis` 裁剪的盒子，滚动能真正露出全文；② 弹性宽度下拉（模型选择）不滚动——内层改用 `width:max-content`（`inline-block` 的 `max-width:none` 无法达到内容自然宽），弹出列表加 `max-width:min(92vw,420px)` 防被长文本撑宽；③ 初始不滚、切换后才滚——测量时机修复（`options.length` 入依赖 + `requestAnimationFrame` 补测 + `ResizeObserver` 容器尺寸变化重测），页面加载即正确滚动；另补传 `MarqueeOption` 缺失的 `hovered` 属性，列表悬停行滚动恢复 — [PEN-002]
- **模型配置行操作按钮与模型控件左对齐（用户反馈）**：蓝色模型行带序号占位、红色按钮行无，导致按钮行偏左 26px——按钮行补 `visibility:hidden` 序号占位，两行控件左缘对齐 — [PEN-002]

## [3.1.0] - 2026-08-17

### Changed
- **模板体系扩展：每模式 3 个内置模板 + 多自定义模板（用户需求）**：设置页「模板」由「内置/自定义」全局开关升级为**每模式模板选择**——每个优化模式（base/lite/standard/smart/publish）现各有 3 个内置模板：**模板1 默认模板**（现有提示词，行为零变化）、**模板2 增量补充完善**（在原有内容基础上补充与完善）、**模板3 增量完善（开发向）**（面向开发人员，开发化表达、技术术语与代码相关名词；publish 模式独立适配九章规格）；**自定义模板可添加多个**（每模式 ≤10 个，各 ≤4000 字符，可命名/编辑/删除），新建时以当前选中模板内容预填。实现：新增 4 个提示词事实源（`prompts/system-supplement.md`/`system-dev.md`/`publish-supplement.md`/`publish-dev.md` → `SYSTEM_SUPPLEMENT_PROMPT`/`SYSTEM_DEV_PROMPT`/`SYSTEM_PUBLISH_SUPPLEMENT_PROMPT`/`SYSTEM_PUBLISH_DEV_PROMPT`）；配置新增 `template.pick`（每模式选中键 default/supplement/dev/custom:N，非法/越界回退 default）与 `template.custom`（每模式多自定义列表），旧 `template.mode`+`texts` 配置自动迁移（custom 且有内容 → 迁为 custom:0，行为等价）；host 组装改走纯函数 `resolveTemplateSystem`（PURE 可单测），`template/default` RPC 新增 `catalog`（每模式 [T1,T2,T3]）供 client 下拉与预填；client sanitize 与 M3 脚手架同步白名单；单测 U40 扩展 4 常量一致性 + U41 扩展 pick/custom + 新增 U57/CFG-05 + U-parity 扩展，121 → 123 — [PEN-002]
- **端口重启默认可用（用户指令）**：插件管理更新卡「端口重启」按钮不再依赖「检测到新版本」（`outdated`）前置——去掉 `portRestartDisabled` 的 `!outdated` 禁用条件，端口重启**始终可点**；纯重启服务本就不需新版本（`runRestart` 无 tag 走纯重启循环，逻辑已支持），点击即拉起执行器（3081）执行重启；「一键更新」按钮语义不变（仍须检测到新版本）；纯 client 改动，RPC/执行器/构建物版本零变化 — [VU-001]
- **README 卸载/更新说明修正（用户反馈驱动）**：「更新 / 卸载」段落此前只列命令、未说明生效条件，导致 remove 后不重启被观感为「卸载不掉」——① 明确 **remove 后必须重启 dsh-web 才从运行中卸载**（dsh plugin 只清理磁盘安装与层列表，不重挂载运行实例）；② 注明重复 remove 报 `no such dependency found` 即表示已卸载；③ 注明 tag 锁定安装（`github:...#tag`）下 `update` 不跨 tag 升级，升级应用 `add github:...#新tag`；④ 注明卸载不清除浏览器端插件配置（localStorage `dsh.enhance.config.v2`），重装后保留 — 文档
- **所有下拉框箭头占位预算（用户需求）**：设置页所有 `.dsh-plg-select` 下拉右侧预留 28px 箭头位（右内边距 12px→28px），避免文字与末尾向下小箭头重叠；固定宽度窄下拉（思考开关/等级/记忆）同步加宽 16px（43px→59px、56px→72px），保持原内容宽度不变 — [PEN-002]
- **下拉选项溢出循环滚动动效（用户需求）**：下拉框选中文本超出显示宽度时，在可见区域内左右循环滚动（未溢出保持省略号静止）——新增 `MarqueeSelect` 组件替换设置页全部原生 `<select>` 渲染层，原生 select 保留交互/无障碍/下拉列表，视觉层负责动效；同步新增 `.dsh-plg-mselect*` 样式与构建注入 — [PEN-002]
- **下拉超长文本改为滚动条浏览（用户需求）**：将原先的自动左右循环动效替换为水平滚动条——当选中文本超出显示宽度时，`MarqueeSelect` 文本区显示细滚动条，可手动浏览完整内容；未溢出时保持省略号静止；同步移除 marquee keyframes，新增 `.dsh-plg-mselect-text-scroll` 及 WebKit 滚动条样式 — [PEN-002]
- **下拉超长文本恢复自动滚动（用户修正）**：按用户确认，回退手动滚动条方案，恢复“选中文本超宽时自动左右循环滚动”——无需手动拖动，未溢出仍保持省略号；移除滚动条相关样式与自定义下拉列表，保留原生 select 交互 — [PEN-002]
- **下拉打开态悬停选项自动滚动（用户需求）**：下拉框打开后，鼠标悬停到超宽选项上时，该选项文本自动左右循环滚动展示完整内容；关闭态选中文本继续自动滚动——`MarqueeSelect` 升级为自定义下拉列表，新增 `MarqueeOption` 与 `.dsh-plg-mselect-option-text-marquee` — [PEN-002]

### Fixed
- **模型配置残留与错位修复（配置卫生专项，方案 `docs/internal/方案-模型配置残留与错位修复.md`）**：① **失效条目可见化**——模型链条目指向不可用 provider/模型（DSH 侧禁用、模型下线、卸载重装后旧 id 残留）时显示 ⚠ 标记 + 顶部提示 + 一键清理；② **effort 自动纠偏**——已启用思考的条目 resolve 时校验存储的思考等级，不在模型能力列表 → 按默认等级修正；模型不支持思考 → 自动移除 reasoning（不再把失效 effort 随请求发给 LLM）；③ **切换厂家/模型不再静默重置思考等级**（保留字段，能力纠偏接管）；④ **自定义模板清空可持久**——新增 `template.touched` 标记，编辑过的模式不再被 prefill 自动回填，未编辑模式保留首访预填；⑤ **sanitize 版本门控**——`version>2` 的未来结构配置不 sanitize、不写回（保护用户数据不被白名单摧毁），以默认配置运行并提示；⑥ **M3 脚手架语义对齐**——`config-schema.validateConfig` 补齐 main/fallback/customModels/order/template/updater 白名单（此前会清空模型链，一旦接入运行时即错位），新增 **U-parity 奇偶单测**锁定与运行时 validateConfig 语义一致；⑦ **删除/移动行不再错标**——测试结果区按条目身份（provider/model）而非 index 定位；⑧ **残留清理**——order 幽灵键打开设置页自动清理、遗留 `template.text`（texts 存在时）写回即清除、关闭思考不再写入 `{enabled:false}` 冗余；⑨ 「恢复默认」走 noCache 最新自适应链 + README/设置页明确其语义（仅重置模型链）；`models/resolve`/`models/autochain` 新增 `noCache` 旁路参数；测试 120 → 121 — [PEN-002] — 架构治理
- **修复 MarqueeSelect 引入的两处回归（用户反馈）**：① 模型行溢出导致顺序调整/删除/测试按钮被推出设置面板——根因是 `.dsh-plg-mselect` 包装层默认 `content-box`，固定宽度下拉被 padding+border 撑大；补 `box-sizing:border-box` 后行宽恢复，按钮重新可点；② 下拉字体颜色异常——原生 `<select>` 曾设 `color:transparent` 影响下拉文本/选项颜色，改为 `var(--dsw-alias-label-primary)`，视觉层文本同步显式声明同色，常规/聚焦/禁用状态显示正常 — [PEN-002]
- **修复滚动条不可交互（用户反馈）**：超长文本滚动条此前被透明原生 `<select>` 覆盖导致无法拖动——原生 select 改 `pointer-events:none`，视觉文本区与右侧箭头改为可交互；点击文本/箭头仍通过 `showPicker()`/`click()` 打开下拉，滚动条可正常拖动浏览 — [PEN-002]

## [3.0.0] - 2026-08-16

### Fixed
- **检测版本缓存导致新版本检测不到（用户报告）**：手动「检测版本」曾受两层缓存影响——host 侧 `update/check` 5 分钟进程缓存（`UPDATE_CACHE_TTL_MS`）可能在刚发布 tag 后返回旧值、浏览器对 GitHub tags API 响应的 HTTP 缓存。修复：手动检测**总是取最新**——client fetch 加 `cache:'no-store'`、`update/check` 传 `noCache:true`（host 命中时先清缓存再拉取）；实测：同步安装副本后页面检测正确显示本地/远端版本差异并提示「发现新版本」（远端正确），本地版本号随 dsh-web 重启对齐 — [VU-001] — 架构治理
- **更新完成后「端口重启」误报执行器不可用（用户报告）**：根因 = `runRestart` 依赖 host RPC（`ensureExecutor` 的 envcheck/executorEnsure）——而「一键更新」（apply restart:false）安装完成后**服务已停止**，host 不可达导致 RPC 失败，被外层 catch 误报「更新执行器不可用——请确认插件为 bundle 安装（端口 3081）」（实际插件是 bundle 安装、执行器 0.1.7 一直在线）。修复：**端口重启绕过 host，直连执行器**（ping 确认在线 → fire-and-forget restart → 1s 轮询）——执行器是独立进程（3081），服务停止不影响它；执行器确实不可达时才显示该提示（语义此时才正确）；顺带：安装完成（installed）后主动刷新「未重启」提醒横幅（host 可达时出现，不可达静默）、重启成功（healthy）后清除横幅；实测：执行器直连 ping 200、confirm/取消交互完好、112/112 测试 — [VU-001] — 架构治理
- **一键更新误触发服务重启（用户报告）**：根因 = 运行中的更新执行器仍是 0.1.6（旧 dsh-web 进程内 `EXECUTOR_VERSION` 被 require 缓存锁在旧值，executorEnsure 与旧执行器恒等匹配、永不升级），旧执行器无 `restart:false` 支持、忽略该参数走完整「安装+重启」流程。修复双管齐下：① **client 执行前版本守卫**——`runPullApply` 调 apply 前先 ping 执行器，版本 <0.1.7 则阻止并提示「请重启 dsh-web 升级执行器」；② **executorEnsure 目标版本改从磁盘解析**（`readLatestExecutorVersion` 每次调用读安装副本 `sys.cjs`，不再依赖进程 require 缓存）——旧 host 也能 kill 旧执行器并拉起新版；③ 顺带修复 `result` 为空时 `result.remoteTag` 抛 TypeError 被外层 catch 误报「执行器不可用」的问题（新增 `updCheckFirst` 提示）；新增 i18n `updExecutorTooOld`/`updCheckFirst`（中英）；实测：手动复刻 envcheck/executorEnsure/ping/apply 全链路 200、执行器确认 0.1.7 在线且状态 idle、null-result 路径正确提示 — [VU-001] — 架构治理
- **测试覆盖缺口（审查发现）**：`test/bundle-smoke.test.cjs`（生成物运行时冒烟，SMK-01..17）自 M2 加入后从未挂入 `npm test` 脚本与 CI——CHANGELOG 的测试数字口径（95+17=112）一直包含它但实际只跑 95；修复为脚本收录，`npm test` 现为 112/112，与日志口径一致 — 架构治理

### Changed
- **历史会话参考仅注入「结论信息」（用户需求）**：lite/standard/smart 的「相关会话参考」与 publish 的 v2 历史段此前把会话事件预拼接文本整段代入——**工具调用名 + 参数 JSON（含命令全文/文件内容）占注入文本的 85-92%**（实测 f535f8ac 会话窗口 [1,2]：text 2654 字符 vs tool-call 29813 字符）。修复：历史提取改走 `sessionQuery.readSurface`（原始事件，保留 content 块结构）→ 新增块级 `extractHistoryConclusions` 只取 user/assistant 消息的 `text` 块（显式结论/正文），丢弃 reasoning（思考过程）、tool-call（工具名+参数）、tool-result（工具输出）块，并剥除 user 消息内 `<system-reminder>` 系统注入块；readSurface 缺失时回退旧路径。实测同会话窗口 [1,2] 注入变为纯结论（工具参数 0 残留）— [PEN-001]
- **会话轮次覆盖修正（审查发现）**：旧 `V2_MSG_SEQ_SCAN=16` 事件上限只够 ~8 轮，会话 >8 轮时 standard 的 [6,10] 窗口会静默滑向最旧可用轮（20 轮会话实际判 13-16 轮）；现按 `V2_ROUNDS_SCAN_MAX=10` 轮向后扫描（1 = 最近一轮，对齐最深窗口 [6,10]），窗口语义恢复正确；单测 U64/U65/U65b + smoke readSurface mock，115/115 — [PEN-001]
- **优化响应看门狗 + 延迟连通性预检（用户需求）**：点击「优化」不再立即探测——按原模式直接生成，首条模型 3s（`WATCHDOG_TIMEOUT_MS`）内无任何输出 → 判为不通 → 中断并逐个探测剩余链（`pingStream` 短输入可达性，每条 3s 超时 `PROBE_TIMEOUT_MS`，30s 缓存 `PROBE_CACHE_TTL_MS`）→ 第一个通畅模型接手生成（不再挂看门狗防死循环）；剩余全不通时回头探测首条（慢但健康不误杀），仍不通 → 秒级 `ALL_MODELS_UNAVAILABLE`（对比此前固定 30s 超时）；`llm.stream` 同步抛错也走链回退；单测 U66/U67 + SMK-17/18/19，120/120 — [PEN-001]
- **fallback 完成按钮反馈（用户需求）**：由非首个模型完成优化时，成功后按钮显示「✓ {模型} 优化，可撤回」（host 结果新增 `fallbackUsed` + 沿用 `model`；client `prettifyModel` 映射显示名），点击仍为撤回（功能不变）；首条正常完成维持「✓ 已优化，可撤回」— [PEN-001]
- **保存反馈全状况显式化（用户需求）**：设置「已保存」提示此前在无 timer 服务环境降级为**无条件常驻「✓ 已保存」**（未经验证）；现任何环境一律走真实校验状态机——无 timer 服务时改动后同步执行 localStorage 读回逐字校验，结果「✓ 已保存 / ✗ 保存失败，请重试」**常驻显示直到下次改动**（有 timer 服务维持 1s 防抖 + 转圈 + 3s 后消失）；删除 UI 无条件「已保存」分支，杜绝「未落实也显示已保存」— [PEN-002]
- **一键更新与端口重启职责划分（用户指令）**：「一键更新」**仅执行更新操作**——执行器 `apply` 改为只下载 + 校验新版本 tarball 到 staging（终态 `staged`），**不停止服务、不安装、不触碰任何端口**（服务全程在线）；所有端口相关操作（断开/监听/重启）与安装统一交由「端口重启」模块——执行器 `restart` 新增可选 `tag`：停服窗口内安装 staging tarball → 重启 + 健康检查（重启失败自动回滚旧版本）；client：一键更新轮询 `staged` 终态显示「✓ 新版本已下载，请点击端口重启完成安装并重启」，端口重启带 tag 直连执行器（安装/重启一体），纯重启（无 tag）不受影响；执行器 EXECUTOR_VERSION 0.1.7→0.1.8（executorEnsure 磁盘版本自动对齐）、client 版本守卫同步 ≥0.1.8；实测：执行器 apply 不再含 stop/install、restart 承载安装、安装副本同步验证、UI 渲染正常、112/112 测试 — [VU-001] — 架构治理
- **重启过程反馈机制优化（用户需求）**：① 「端口重启」由**挂起等待**执行器完成（最长 1-2 分钟界面零更新）改为 **fire-and-forget + 1s 轮询**——发起即返回，进度由轮询接管；② 轮询间隔 2s→1s，**倒计时改为每秒更新**（原每 2s 跳 2 秒）；③ restarting 阶段状态行展示执行器阶段消息（正在停止服务 / 服务已停止，等待稳定 / 第 N 次重启：停止+启动 / 端口未就绪，准备重试）+ 轮次 + 剩余秒 + **已用秒数**（如「第 2 次重启：停止+启动（第 2 次 · 剩余 8 秒 · 已用 21s）」）；④ apply 安装阶段同样显示已用秒数；⑤ 轮询连续失败 15 次（约 15s 无响应）判定执行器不可达并终止，避免无限等待；新增 i18n 阶段文案 4 组（中英）——纯 client 改动，新旧执行器均兼容（旧版挂起模式由轮询接管展示）— [VU-001] — 架构治理
- **「一键拉取更新」按钮改名（用户指令）**：更新卡合并按钮显示文案「一键拉取更新」→「一键更新」（EN `Pull update`→`Update`），确认态文案同步「确认更新？」——仅名称变更，功能与交互行为（执行器 apply restart:false 只装不重启、确认/取消流程）保持不变 — [VU-001] — 架构治理
- **更新按钮拆分（用户指令）**：插件管理更新卡「一键拉取更新」与「一键更新」合并为单一「一键拉取更新」按钮——执行器 `apply` 新增 `restart:false`（下载/校验/停服/安装后**不重启**，服务保持停止，phase 终态 `installed`）；「重启」拆为独立「端口重启」按钮（复用执行器既有 `restart` RPC，仅重启循环）；两按钮同置于「目标目录」行末，均带确认态（danger 文案 + 取消）与互斥禁用（installed 态拉取禁用、重启可用——引导生效）；安装完成显示「✓ 已安装，请点击端口重启生效」；退役 doPull 浏览器拉取路径与「应用指引」区块（i18n 键保留兼容）；执行器 EXECUTOR_VERSION 0.1.6→0.1.7（executorEnsure 自动版本对齐 kill 旧执行器）；实测验证（CDP）：目标目录行两按钮、确认/取消/互斥状态机全部命中 — [VU-001] — 架构治理
- **设置页纵向间距修复（用户反馈：优化参数板块行间距过近）**：① 「优化参数」tabpanel 平铺子元素原先零间距（`display:block` 无 gap）——新增行间统一 12px、提示行贴紧其控件 4px（与下一控件行保持 12px，对齐官方 fields 的 label→hint 从属节奏）；② 排查其余板块：「模型配置」链区块 `sec-body` gap 8→10px；「插件管理」自带 root gap 12px、更新卡内部 gap 10px，经实测无需调整；③ 实测验证（CDP 计算样式）：参数 tab 行间 12px / hint 4px 全部命中 — [PEN-002] — 架构治理
- **设置界面样式与交互逻辑对齐官方 Harness（方案 `docs/internal/方案-设置界面样式与交互对齐官方.md`）**：① 样式全面对齐官方 design platform——控件字号 12→13px、圆角 6/10→8/12、边框 l1→l2、背景层 1/2→2/3、卡片新增 hover 反馈、hint 11→12px、内容区 max-width 760px、主按钮改官方实底范式（`dsh-plg-btn-primary`，danger 保留描边红 + 新增 hover 底）；② tab 视觉对齐官方 PluginsSettingsSection（13px、gap 22px、label-primary 下划线 + business-primary focus outline），新增 roving tabindex + 方向键/Home/End 键盘导航与 tab/panel aria 关联；③ 可访问性补齐——label htmlFor/id（ParamsTab/PluginsSection/UpdaterCard）、hint aria-describedby、CollapsibleSection aria-controls/region、设置页 section 新增标题+简介（新增 i18n `secPluginsIntro` 中英）；④ composer 按钮硬编码 rgba 背景 → 令牌 color-mix（hover 用 `interactive-bg-hover`）——纯 client 视觉/交互调整，host RPC 与即时保存契约零改动 — [PEN-002] — 架构治理
- **细粒度进度反馈（v3.0r，用户需求）**：标准/专家/一键发布等检索重模式执行期间，按钮进度提示全程动态变化，消除"卡顿"误判——① `enhance/progress` RPC 返回扩展字段（`detailKey`/`detailArgs`/`step`/`total`/`elapsedMs`，`stage` 兼容保留）；② host 新增子步骤注入点：会话窗口判定（i/n）、开发意向判定、文档分析、代码检索、检索主题规划、逐主题搜索（「正在搜索 2/3：体素引擎」）、链节重试（i/n）、工作区扫描；`rec` 增加 `startedAt` 计时；③ client 进度文案优先级 detailKey 模板（i18n 中英新键 8 个，`{current}/{total}/{query}` 占位）> stage 文案 > 默认；末尾追加**已用秒数**（如「正在搜索 2/3：体素引擎 · 8s」）；新增 SMK-17（publish 期间轮询断言 detailKey 序列与字段），测试 111 → 112 — 架构治理
- **工作区文档清理（用户指令）**：① 删除 5 个历史版本快照目录（`dsh-prompt-enhancer-v2.4.5/2.4.8/2.5.1/2.7.0/2.8.3`，本地归档备份，git tag 已有完整备份）与旧工作副本目录（`prompt-enhancer-release - 提示词增强脚本`）；② 删除旧版本发布说明 `release-notes/v2.4.0–v2.8.3`（22 个，保留 3.0.0；完整说明见 GitHub Releases 页）；③ 删除已完成使命的开发方案文档 `docs/internal/architecture-refactor-plan.md`（M0-M6 已全部落地）与 `docs/internal/方案-publish路由与自评.md`（已被 v3.0p 取代）；保留 `.internal/` 排障经验沉淀、`CONTRIBUTING.md`、模块结构说明、项目地图与 devref；`prompt-enhancer-plugin`（早期开发记录唯一副本）按用户指示删除不备份 — 架构治理
- **记忆链发送清空（v3.0s，用户修正）**：发送消息（基座 submit 成功，phase 经 submitting/adjudicating 飞行期）即清空记忆链并重置 seen 标记——「持续记忆」仅限发送前一轮优化内的会话，发送后新一轮迭代从零开始（链空 + 无标记 → 重新「首次轻量兜底」）；仅手动清空输入框不清除（内容删除可能表示方向调整）；发送失败（draft 保留）不清除 — 架构治理
- **智能模式更名为专家模式（用户指令）**：设置页「优化模式」下拉展示名「智能模式」→「专家模式」，按钮短标签「智能」→「专家」，英文 Smart→Expert（README 中英同步）；内部 mode value `smart`、配置存储键与模板键保持不变，存量配置零迁移 — [PEN-002] — 架构治理
- **清理死代码（审查遗留）**：删除 `src/client/constants.js` 中遗留的重复 `module.exports` 段（v3.0 时代旧文案整段，`require` 只取末条、从未生效，含旧「智能模式」字样）；导出 chunk 逐字节不变，生成物与测试零改动 — 架构治理
- **一键更新执行器外挂 + staging 预拉取流程**：执行器不再从 `node_modules/dsh-prompt-enhancer/lib` 启动，改为复制到外部版本化目录（`%LOCALAPPDATA%\dsh-prompt-enhancer\executor\<version>`）并以外部目录为 WorkingDirectory；修复 Windows 下执行器自锁导致 pnpm 替换插件目录 EPERM 的根因。`apply` 流程改为：先在线下载 tarball 到 staging 并校验 → envcheck → 停止服务 → 本地安装 staging tarball → 启动 + 健康检查；重启失败自动回滚旧版本；安装失败恢复原服务；EXECUTOR_VERSION 0.1.5→0.1.6 — [VU-001]
- **更新状态文案补充**：client 轮询新增 `staging/envcheck/preparing/rollback/rolledback` 状态展示，避免新阶段被误显示为“重启中”；失败时直接展示执行器返回的具体错误 — [VU-001]
- **新增架构重构方案文档**：`docs/internal/architecture-refactor-plan.md`，记录从单文件 monolith 到 Cordis 子插件 / 服务化 / 契约化 / 平台热更新的完整调整方案 — 架构治理
- **M0 基线固化**：
- **M1 源码模块化脚手架**：
- **M2 服务化/事件化脚手架**：
- **M3 RPC 契约化脚手架**：
- **M4 更新链路平台化脚手架**：
- **M5 可观测性与安全加固**：
- **M6 工程化收尾**：
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
[3.1.4]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.1.4
[3.1.3]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.1.3
[3.1.2]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.1.2
[3.1.1]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.1.1
[3.1.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.1.0
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
