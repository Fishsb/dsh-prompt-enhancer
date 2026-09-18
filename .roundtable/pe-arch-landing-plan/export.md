# 圆桌会议记录 · pe-arch-landing-plan

---
<!-- 以下为预填的会议元数据，可整段作为 issue / 归档记录的头部 -->
- **插件**：@huanlin/dsh-plugin-roundtable v0.2.36（DeepSeek Harness 0.1.5-rc.1+）
- **会议 id**：pe-arch-landing-plan
- **协作模式**：orchestrated
- **状态**：active（进行中快照）
- **创建时间**：2026-09-19 03:31:15
- **最后更新**：2026-09-19 04:20:11
- **预算用量**：3/5 轮 · 41161/180000 token
- **知识库**：D:\FF\deepseek\prompt-enhancer-release
- **skill**：`arch-view`（传递方式 relay）
---

## 议题 / 目标

基于已完成的架构健康度审查（8 域实测结论，证据在会话上下文），从架构出发为 prompt-enhancer 产出**分期落地方案**。

四项交付：
① **根因归并**——把 8 域问题收敛到少数结构性成因，每个成因列出对应症状 + 最小改法（禁止罗列孤立条目）；
② **裁剪清单**——删/并/缓三档 + 最少必要集，标出「可为根因解决却用了补丁」之处；
③ **分期时间线**——每阶段给：交付物 / 验收判据 / 预计阻塞点 / 回滚方式，并标出阶段间硬依赖与可并行部分；
④ **可复验判据表**——每条判据写全「判据内容 + 检查方式（命令/字节比对/审计态）+ 通过阈值 + 失败退回动作」，分「可自动检查」与「须人工判断」两组。

会议须**独立复核主持人提供的实测数字**（含 CI 运行结论、死层入边判定、体积口径），证据不足的主张不得进入方案。

边界（红线，须全体遵守）：
· 本会议只到**决策态**——不施工、不发版、不改仓、不安装；
· 已发布版本 v3.3.3 的对外契约不在本轮变更范围；确需变更的须单列并显式标 BREAKING；
· 不改动被引用的第三方框架源码；不虚构索引/架构档里没有的路径。

## 专家名单（5）

- `arch` — 只审结构，不审实现细节。看模块边界与职责是否清晰、依赖方向是否单向、分层是否被穿透、数据流与状态归属是否唯一、演进是否留余地。以「改一处要动几个文件」度量耦合。必须做根因归并：把表面不同的问题收敛到少数几个结构性成因，不罗列孤立条目。产出：成因清单（每个成因对应哪些症状 + 最小改法）。 — dshapi/deepseek-v4.1-flash — 状态 idle
- `minimal` — 只做减法。对每个组件与功能追问：不做会怎样、能否用既有能力替代、是否在解决一个不存在的问题、是否属于冗余限制。标出「可为根因解决却用了补丁」之处。产出：裁剪清单分三档（删 / 并 / 缓）+ 最少必要集，并说明砍掉哪几项不影响成败。禁止为极简牺牲已确认的硬需求。 — dshapi/deepseek-v4.1-flash — 状态 idle
- `rollout` — 只把结论排成可执行时间线，不重新论证方案。按「先跑通再优化」切分阶段，每阶段给交付物、验收判据、预计阻塞点、回滚方式。标出阶段之间的硬依赖与可并行部分。禁止把大改造塞进一步；每阶段必须可独立验证。产出：分期表 + 里程碑。 — dshapi/deepseek-v4.1-flash — 状态 idle
- `accept` — 只把目标转成可复验的判据，不讨论实现。每条判据写全四要素：判据内容、检查方式（命令 / 字节比对 / 审计态）、通过阈值、失败退回动作。禁止「性能良好」这类不可判定表述；阈值须给具体数字或明确来源，无来源即标「待定，需用户拍板」。产出：判据表，分「可自动检查」与「须人工判断」两组。 — dshapi/deepseek-v4.1-flash — 状态 idle
- `verify` — 只复核他人结论，不提新方案。对每条待核结论先预注册判据再取证，逐条裁为「成立 / 部分成立 / 不可复现」，并给证据强度（原文、行号、命令输出、字节数）。证据不足即判不可复现，不得凭合理性推断为成立。严格区分「接口返回成功」与「结果真的达成」。产出：核验表（结论 / 裁定 / 证据 / 反例）。 — dshapi/deepseek-v4.1-flash — 状态 idle

## 决策记录（1）

- **[已决]** 会议已收敛（6 条根因 / 7 期分期 / 33+5 条判据 / 8 项待拍板且专家各给推荐）。请拍板本轮执行口径——你的选择同时授权对应的施工范围（未列入的部分保持挂账）：
  - 选项：A（专家共识·推荐）：采纳上表全部 8 项推荐值——按 P0→D0→P1a→P1b→P2→P3→P4 执行，发布取止血优先，死层取「删文件+守卫改挂活层」，CI 平台性失败只记录+门降级，EOL 策略授权 / B（最小激进）：本轮只做 P0 门禁真话化（零功能改动），拿到 CI 真实读数后再定后续，其余 7 项全部挂账 / C（先瘦身）：P0 + P1a（删孤儿链）+ P1b（死层退役）三件一起推，发布与契约类（P2/P3）另议 / D（先止血发版）：先走 D0 发布 v3.3.4，把 Issue #8/#10/#9 的修复送达市场用户，再回头做 P0 / E（只出方案不施工）：保留本合并结论与会议记录归档，本轮不做任何改仓动作
  - 用户选择：A（专家共识·推荐）：采纳上表全部 8 项推荐值——按 P0→D0→P1a→P1b→P2→P3→P4 执行，发布取止血优先，死层取「删文件+守卫改挂活层」，CI 平台性失败只记录+门降级，EOL 策略授权
  - 时间：2026-09-19 04:19:57

## 发言记录（29 条）

### 第 0 轮

**verify → captain** · 2026-09-19 03:31:36

[当前状态] 收到建会名册快照 + 会议状态（round 0，无连线，transcript 为空，pending_actions=0，KB 缓存 0 条）。我未收到任何**待核主张**：主持人尚未把「8 域实测结论」的证据本体（命令、输出、行号、字节数）中转给我。

[本轮裁定] 无待核结论 → 无可裁项。
- 我不能凭会议要求里那句概述（「8 域实测结论，证据在会话上下文」）判定任何一条为「成立」——该证据不在我的上下文里，属传闻证据。
- 按角色边界，我不得自行补出 8 域结论、不得替 arch/minimal/rollout/accept 产出方案去"顺手核"。
- 唯一可立即执行的动作（预注册要索取的证据项）属下一轮，需拿到待核清单才能定判据，否则预注册的就是空气判据。

[预注册：我接收待核断言的最低可核形态]（主持人下一轮按此投喂，可直接省一轮往返）
每条主张请给全五要素，缺一项我一律裁「不可复现」：
1. 断言原文（可证伪的一句话，禁"某域有问题"这类不可判表述）
2. 取证命令（完整可重跑，含 cwd）与其 stdout 关键行
3. 文件 + 行号（跨文件须给**包名/路径前缀**，不得只给裸行号——行号会随其他文件漂移）
4. 口径声明：计数/体积/入边的**分母与排除项**（例如死层入边：分母是"全仓 import 边"还是"src 内 import 边"；体积是 raw / gzip / npm pack 实测）
5. 时间戳或 commit/porcelain 基线（证明数字对应哪一版码）

[已记下的口径风险 · 待数字到位后逐条验]（不预设结论，只列我会卡的检查点）
- 「18 件 M2 骨架、19 条入边全来自 test/」：入边判定须给出**边枚举命令与其漏检范围**（动态 require / 字符串拼路径 / 别名解析漏检会直接翻转结论）。若无法给出枚举命令 → 该条我只能裁「部分成立（入边为 0 具证，全来自 test/ 未证）」。
- 「CI 运行结论」：区分「接口/工作流返回 success」与「结果真的达成」——须给**具体 job 名 + 步骤名 + 关键步骤退出码/断言计数**；仅有 run URL 或绿色徽章的，不构成通过证据。
- 「体积口径」：须声明工具与选项（`npm pack` 实测 vs 源文件字节累加 vs gzip），三者数字不同属正常，混用即口径不一致。
- 「协议 21 vs 线上 34」：两边各自的提取方式必须给出（源码文本 grep ？运行时注册表 dump ？），否则只是两串数字相减。

[核心产出]
裁定：**本轮无可核项，全部待核主张判「不可复现」的等价状态——不是"存疑"，是"证据未到"**。理由：证据本体（命令/输出/行号/口径）未进入我的上下文，主持人那句「证据在会话上下文」是**主持人的上下文，不是我的**；我按纪律不使用未经我本人取证的合理性推断。
关键取舍：我**不**为了让会议看起来有产出而"先给一份看起来像核验表的空表"——那会把"未核"伪装成"已核"，正是本会要防的假绿。宁可交一份空裁定 + 一份证据规格。
不可越过之处：无待核断言时，取证无从下手；我无权读他人上下文，也无权替主持人决定 8 域是哪 8 域。
给主持人的最小可行投喂：把 8 域结论**逐条**列成上面五要素表（可只给「断言 + 命令 + 一条 stdout 摘要」），我下一轮一次性出核验表（结论/裁定/证据/反例 四列）。

[下一步建议] 请主持人按「五要素」格式投喂第 1 批（建议先给最容易被证伪的 3 条：死层入边判定、CI 结论、体积口径），我下一轮即出核验表；同批可并行给 arch/rollout 的结论，我按到达顺序核，不插队。

[建议决策] 是否需要主持人先确认「8 域实测结论」的证据是否存在于可中转载体（KB 文件 / 会话摘录）——若主持人手上也只有概述而无原始输出，则本会议的核验层无法成立，须改为「重跑取证」而非「复核 | 选项：(A) 主持人中转原始输出（推荐，成本最低） / (B) 授权我在 KB 目录 D:\FF\deepseek\prompt-enhancer-release 内自行按五要素重跑取证（会改写简报形态：从"复核他人结论"变为"独立重测"，属角色边界变动，须用户拍板） | 推荐：A 理由：复核要的是被核方的证据本体，重跑会引入我自己的口径，反而丢掉"独立第二个视角"的价值。

**accept → captain** · 2026-09-19 03:31:38

[当前状态] accept 就位。会议第 0 轮，transcript 为空、edges=0、KB digest cache 0 条、pending_actions=0——我尚未收到任何任务包或主持人的实测数字。按我的角色边界（只把目标转成可复验判据，不讨论实现、不提方案），在拿到原始证据前我不会凭合理性推断出任何阈值。

[核心产出] 本轮不产出判据表，先固定判据表的**输入契约**（缺哪一项，对应哪一条判据就无法定阈值）：

A. 必须由主持人中转到我这的物料（否则对应判据只能写「待定，需用户拍板」，这类行超过 20% 时判据表整体不合格）：
  1. 8 域清单本身（域 ID + 每域一句话定义）。判据必须按域编号，不能用「各域均通过」这类合并表述——这是分工的前提。
  2. 每域实测结论的**原始证据形态**：命令 + 完整输出（含 exit code），而不是结论摘要。判据的「检查方式」列必须复用同一条命令，否则上下游口径不一致，复验即失败。
  3. 三条主持人自报数字的原始出处：① CI 运行结论（哪个 workflow / run id / 步骤名 / 退出码）；② 死层入边判定（哪 18 个文件、入边计数用什么工具统计、结果 `0` 还是 `仅 test/`——这两个值含义不同，不能混写）；③ 体积口径（是 npm pack 包体、git 工作区体积、还是安装后落盘体积——三者数字不同，阈值也不可互换）。这三条我在判据表里会各出一行复核判据，**但复核判据本身只能验「数字是否稳定复现」，不能验「数字口径是否选对」**，后者归人工判断组。
  4. v3.3.3 对外契约基线：需要一份**可字节比对的基线快照**（RPC 方法名清单、package.json `files` 白名单、版本号注入位）。没有这份快照，「契约未变更」这条判据无法判定——字节比对必须有基准文件。

B. 我预置的判据表骨架（等物料到位即可填满四要素：
  每行 = 判据内容 / 检查方式 / 通过阈值 / 失败退回动作），分两组：
  - **可自动检查组**（每条须能给出确定性命令或字节比对，退出码或计数值判过否；无命令者一律不進此组）：
    · 契约冻结类：RPC 方法名集合差集 = ∅；`files` 白名单集合差集 = ∅；构建产物版本号与 package.json 一致（`--check` 退出码 0）。
    · 生成物一致性类：build-host/build-client `--check` 漂移退出码 0。
    · 死层类：死层文件数下降值与目标一致（**阈值待 8 域基线到位后填数**；来源标「8 域实测报告」）。
    · 删除类判据一律要求「删除前该符号引用计数 = N，删除后 = 0」这种可计数形态，禁止「不再需要」这类描述。
  - **须人工判断组**（我给判定口径与争议裁定规则，但不给伪装的数字）：
    · 模块职责是否单一 / 依赖方向是否单向——须附「改一处要动几个文件」的实测计数作为人工判定的输入，而不是直接给通过与否。
    · 「补丁 vs 根因」的定性裁定。
    · 体积口径选得对不对、某域判据是否应该用差异化阈值（用户明确反感一刀切与隐含推导，这组必须显式逐域声明）。

C. 红线自检（我这边先声明，避免判据表越界）：判据只到**可复验的判定态**——判据里不含任何施工步骤、不含改仓指令、不含发布动作；v3.3.3 契约若确需变更，我会单列一行并显式标 BREAKING，不计入本轮通过条件。

[下一步建议]
1. 请主持人把上述 A1–A4 物料中至少 A1（8 域清单）+ A2（每域命令与原始输出）中转给我；A3/A4 可稍后补，但需明确告知到位时间，否则我对应行会以「待定」提交。
2. 建议在 arch / minimal / rollout 出结论的同一轮里把我的判据表骨架一并下发，让他们的每条结论**自带复验命令**——我的角色是判据，不是事后给别人的结论补证据，两者顺序颠倒会产生「先定论后凑判据」。
3. 若 A2 的原始输出在会议上下文里已有但我看不到（我这侧 transcript 为空、KB cache 0 条），请直接以消息形式贴原文，不要只贴结论；我无法读取你上下文里的证据。

[建议决策] 判据阈值来源口径 | 选项：A 一律以 8 域实测报告的原始命令输出为准，报告里没有的一律标「待定，需用户拍板」/ B 允许引用 v3.3.3 已发布产物与 CI 历史作为基线来源 / C 由用户直接给定阈值数字 | 推荐：A 理由：A 与「证据不足的主张不得进入方案」这条会议红线一致，B/C 会让阈值脱离可复验的起点。

**captain → arch** · 2026-09-19 03:31:58

【主持人广播 · 花名册与事实底本】

■ 当前花名册（orchestrated 模式，全部由主持人中转）
· arch（架构主审）· minimal（裁剪与极简）· rollout（分期落地）· accept（验收判据）· verify（独立验证）
拓扑：captain↔arch、captain↔verify、arch→minimal→rollout→accept、verify↔arch
会议技能：arch-view（relay，由主持人转述要点）
知识库：D:\FF\deepseek\prompt-enhancer-release（需要具体文件时向我点名，我读取后转交）

■ 工作对象
D:\FF\deepseek\prompt-enhancer-release —— DSH 插件（✨ 提示词增强 + 🎤 语音识别）。已发布 v3.3.3；main 领先 tag 6 个提交（未发布）。

■ 8 域实测事实（每条附检查方式，均为主持人实测；verify 负责复核）
1) 装配与构建链 🟢：`build-host.mjs --check` + `build-client.mjs --check` 双产物零漂移。体积：plugin-host.js 285KB / plugin-client.js 343KB / lib/client.cjs 351KB。
2) host 架构 🔴：src/host 共 25 件，仅 7 件是真装配输入（build-host.mjs 清单：app·pure·diagnostics·models·plugins·update·enhance-handlers = 1625 行）；**其余 18 件 / 995 行活代码不可达**（判据：严格 import 语句 + 引用者具名，两法交叉收敛同一名单）；其中 **13 件靠死簇内互引伪装成"有入边"**（簇根 src/host/index.js 自身零入边）。ADR-194 P0 承诺「死层 18 件退役」= 一件未退；ADR-197 终局（lib/index.js ≤120 行装配 + 领域模块化）= 执行度 0%（lib/index.cjs 现 837 行，1727→837 的降幅全部来自 ADR-201 删功能，与拆域无关）。
3) client 载体 🟠：lib/client.cjs（`window.__ModuleLoader__.load({id,factory})` 包装）+ plugin-client.js（裸 bundle）= 694KB = 发布物 1256KB 的 **55%**，同一 client 逻辑装两遍（四探针 dsh-enh-result / EnhanceButton / RecordRTC / config v2 两产物全中；`__ModuleLoader__` 仅现于前者）。
4) RPC 契约 🟠：线上注册面 **34 条**（lib/index.cjs 16 + plugin-host.js 18，判据 harness.handle 正则）；死层 src/host/protocol.js 声明 **21 条**（缺 config/* 2 + voice/* 10 + models/stats 1）；参数校验面 lib/rpc-schema.cjs **17/34 = 50%**；docs/compatibility-matrix.md 反而 **34/34 全覆盖**——最完整的事实源在文档层。
5) 验证门禁 🔴（最严重）：CI `.github/workflows/ci.yml` 最近 12 次运行 **12/12 cancelled**，每次挂满 6h0m18s~6h0m48s（= job 超时上限）。逐 step 实证：install/syntax 秒级成功 → `Run tests` 21:59:27 起 → 03:59:32 被取消 → 其后 `Build client bundle`、`Verify generated artifacts are committed` **每次 skipped**。job 日志止于第 146 条 LIBWIRE-06 后 **6 小时零输出**，清理时残留 4 个 node 孤儿进程。分文件对账：**完成 143/281**；**12 个文件 0 完成**（maintain 23 / voice-persist 24 / update-gate 24 / platform-service 23 / sys 13 / updater-host 7 / rpc-guard 5 / observability 3 / pipeline 3 / services 3 / protocol 2 / update-platform 2）。静态可疑：maintain（起监听+setInterval+子进程）、sys（子进程）；**尚未在 Linux 复现确证**。外部贡献路径同样失效：PR #7 的 CI = `action_required` / 0s（从未运行）。本地 `npm test` = **281/281**（Windows，1–2 分钟）——**当前唯一真实门**。
6) 治理索引 🟠：STALE 0 / 在途 0（抽查未见幽灵落点）；但 **3 个大件 lib 查不到归属**：lib/sys.cjs(914 行)、lib/net-proxy.cjs(402)、lib/platform-service.cjs(369) 合 **1685 行**，`nav_graph mode=task` 返回"无映射"。
7) 文档-事实一致性 🟠：AGENTS.md「测试 330 项」→ 实测 281（已订正）；AGENTS.md「docs/internal 现 1 个」→ 实际 2 个；components 11 ✓ / release-notes 5 ✓；「protocol.js 21 条」准确。
8) 发布链 🟠：tag v3.3.3 落后 HEAD 6 提交；Issue #8/#10（0197ae7 槽位契约）+ #9（88524c0 云 ASR chat 协议字段名）修复都在 main 未发布 → 市场渠道用户仍处故障态。
9) 本轮新证据：Issue #9 根因 = lib/asr.cjs 的 transcribeChat 请求体 content part 内层键名 audio（应 input_audio）→ 服务端 400 被一律映射 ASR_BAD_RESPONSE → UI 显示"音频无效"；因仓库对该函数**零断言** + CI 从不完成，该笔误一路发到 v3.3.3。

■ arch-view 技能要点（relay 转述，供方案对齐）
· **架构先行协议**：任务必须先在架构上找到锚点才开工；**无锚点 / 链路不覆盖 = 架构不足 → 先出整体架构修订方案，不打局部补丁**（本次任务正是这一条）。
· 三层模型：索引层（nav 模型，机器读）/ 文档层（`.internal/arch/*.md` = agent 开发主地图）/ 渲染层（投影，零维护）。项目现有档：prompt-enhancer-overview.md、PE-F01-assembly-chain.md、PE-F04-voice-input.md。
· **现成机检门**：`.internal/arch/render/_tools/arch-check.mjs`（L1 边表逐条反查磁盘 import + 度数；L2 锚点清单 100% 命中）。
· 落点登记必须用一等参数 `files=`；用 `set=files=` 会**静默丢参数**（沉默失败）。STALE 用 `nav_node retire=true` 或 `files=<新路径>` 关闭。
· 计数闸 3/3 必须 `nav_decide`；**2/3 只是警告，禁止为清零补 ADR（那是制造假绿）**。
· 汇报纪律：只报 L1（会造成下轮踩空/假绿）与 L2（仪表读数）两级；每条问题必须带「关掉它的命令」。

■ 会议红线
只到**决策态**（不施工/不发版/不改仓/不安装）；v3.3.3 对外契约不在本轮变更范围，确需变更须单列并标 BREAKING；不改第三方框架源码；不虚构索引/架构档里没有的路径。
发言格式：[当前状态] … [核心产出] … [下一步建议] …

**captain → minimal** · 2026-09-19 03:31:58

【主持人广播 · 花名册与事实底本】

■ 当前花名册（orchestrated 模式，全部由主持人中转）
· arch（架构主审）· minimal（裁剪与极简）· rollout（分期落地）· accept（验收判据）· verify（独立验证）
拓扑：captain↔arch、captain↔verify、arch→minimal→rollout→accept、verify↔arch
会议技能：arch-view（relay，由主持人转述要点）
知识库：D:\FF\deepseek\prompt-enhancer-release（需要具体文件时向我点名，我读取后转交）

■ 工作对象
D:\FF\deepseek\prompt-enhancer-release —— DSH 插件（✨ 提示词增强 + 🎤 语音识别）。已发布 v3.3.3；main 领先 tag 6 个提交（未发布）。

■ 8 域实测事实（每条附检查方式，均为主持人实测；verify 负责复核）
1) 装配与构建链 🟢：`build-host.mjs --check` + `build-client.mjs --check` 双产物零漂移。体积：plugin-host.js 285KB / plugin-client.js 343KB / lib/client.cjs 351KB。
2) host 架构 🔴：src/host 共 25 件，仅 7 件是真装配输入（build-host.mjs 清单：app·pure·diagnostics·models·plugins·update·enhance-handlers = 1625 行）；**其余 18 件 / 995 行活代码不可达**（判据：严格 import 语句 + 引用者具名，两法交叉收敛同一名单）；其中 **13 件靠死簇内互引伪装成"有入边"**（簇根 src/host/index.js 自身零入边）。ADR-194 P0 承诺「死层 18 件退役」= 一件未退；ADR-197 终局（lib/index.js ≤120 行装配 + 领域模块化）= 执行度 0%（lib/index.cjs 现 837 行，1727→837 的降幅全部来自 ADR-201 删功能，与拆域无关）。
3) client 载体 🟠：lib/client.cjs（`window.__ModuleLoader__.load({id,factory})` 包装）+ plugin-client.js（裸 bundle）= 694KB = 发布物 1256KB 的 **55%**，同一 client 逻辑装两遍（四探针 dsh-enh-result / EnhanceButton / RecordRTC / config v2 两产物全中；`__ModuleLoader__` 仅现于前者）。
4) RPC 契约 🟠：线上注册面 **34 条**（lib/index.cjs 16 + plugin-host.js 18，判据 harness.handle 正则）；死层 src/host/protocol.js 声明 **21 条**（缺 config/* 2 + voice/* 10 + models/stats 1）；参数校验面 lib/rpc-schema.cjs **17/34 = 50%**；docs/compatibility-matrix.md 反而 **34/34 全覆盖**——最完整的事实源在文档层。
5) 验证门禁 🔴（最严重）：CI `.github/workflows/ci.yml` 最近 12 次运行 **12/12 cancelled**，每次挂满 6h0m18s~6h0m48s（= job 超时上限）。逐 step 实证：install/syntax 秒级成功 → `Run tests` 21:59:27 起 → 03:59:32 被取消 → 其后 `Build client bundle`、`Verify generated artifacts are committed` **每次 skipped**。job 日志止于第 146 条 LIBWIRE-06 后 **6 小时零输出**，清理时残留 4 个 node 孤儿进程。分文件对账：**完成 143/281**；**12 个文件 0 完成**（maintain 23 / voice-persist 24 / update-gate 24 / platform-service 23 / sys 13 / updater-host 7 / rpc-guard 5 / observability 3 / pipeline 3 / services 3 / protocol 2 / update-platform 2）。静态可疑：maintain（起监听+setInterval+子进程）、sys（子进程）；**尚未在 Linux 复现确证**。外部贡献路径同样失效：PR #7 的 CI = `action_required` / 0s（从未运行）。本地 `npm test` = **281/281**（Windows，1–2 分钟）——**当前唯一真实门**。
6) 治理索引 🟠：STALE 0 / 在途 0（抽查未见幽灵落点）；但 **3 个大件 lib 查不到归属**：lib/sys.cjs(914 行)、lib/net-proxy.cjs(402)、lib/platform-service.cjs(369) 合 **1685 行**，`nav_graph mode=task` 返回"无映射"。
7) 文档-事实一致性 🟠：AGENTS.md「测试 330 项」→ 实测 281（已订正）；AGENTS.md「docs/internal 现 1 个」→ 实际 2 个；components 11 ✓ / release-notes 5 ✓；「protocol.js 21 条」准确。
8) 发布链 🟠：tag v3.3.3 落后 HEAD 6 提交；Issue #8/#10（0197ae7 槽位契约）+ #9（88524c0 云 ASR chat 协议字段名）修复都在 main 未发布 → 市场渠道用户仍处故障态。
9) 本轮新证据：Issue #9 根因 = lib/asr.cjs 的 transcribeChat 请求体 content part 内层键名 audio（应 input_audio）→ 服务端 400 被一律映射 ASR_BAD_RESPONSE → UI 显示"音频无效"；因仓库对该函数**零断言** + CI 从不完成，该笔误一路发到 v3.3.3。

■ arch-view 技能要点（relay 转述，供方案对齐）
· **架构先行协议**：任务必须先在架构上找到锚点才开工；**无锚点 / 链路不覆盖 = 架构不足 → 先出整体架构修订方案，不打局部补丁**（本次任务正是这一条）。
· 三层模型：索引层（nav 模型，机器读）/ 文档层（`.internal/arch/*.md` = agent 开发主地图）/ 渲染层（投影，零维护）。项目现有档：prompt-enhancer-overview.md、PE-F01-assembly-chain.md、PE-F04-voice-input.md。
· **现成机检门**：`.internal/arch/render/_tools/arch-check.mjs`（L1 边表逐条反查磁盘 import + 度数；L2 锚点清单 100% 命中）。
· 落点登记必须用一等参数 `files=`；用 `set=files=` 会**静默丢参数**（沉默失败）。STALE 用 `nav_node retire=true` 或 `files=<新路径>` 关闭。
· 计数闸 3/3 必须 `nav_decide`；**2/3 只是警告，禁止为清零补 ADR（那是制造假绿）**。
· 汇报纪律：只报 L1（会造成下轮踩空/假绿）与 L2（仪表读数）两级；每条问题必须带「关掉它的命令」。

■ 会议红线
只到**决策态**（不施工/不发版/不改仓/不安装）；v3.3.3 对外契约不在本轮变更范围，确需变更须单列并标 BREAKING；不改第三方框架源码；不虚构索引/架构档里没有的路径。
发言格式：[当前状态] … [核心产出] … [下一步建议] …

**captain → rollout** · 2026-09-19 03:31:58

【主持人广播 · 花名册与事实底本】

■ 当前花名册（orchestrated 模式，全部由主持人中转）
· arch（架构主审）· minimal（裁剪与极简）· rollout（分期落地）· accept（验收判据）· verify（独立验证）
拓扑：captain↔arch、captain↔verify、arch→minimal→rollout→accept、verify↔arch
会议技能：arch-view（relay，由主持人转述要点）
知识库：D:\FF\deepseek\prompt-enhancer-release（需要具体文件时向我点名，我读取后转交）

■ 工作对象
D:\FF\deepseek\prompt-enhancer-release —— DSH 插件（✨ 提示词增强 + 🎤 语音识别）。已发布 v3.3.3；main 领先 tag 6 个提交（未发布）。

■ 8 域实测事实（每条附检查方式，均为主持人实测；verify 负责复核）
1) 装配与构建链 🟢：`build-host.mjs --check` + `build-client.mjs --check` 双产物零漂移。体积：plugin-host.js 285KB / plugin-client.js 343KB / lib/client.cjs 351KB。
2) host 架构 🔴：src/host 共 25 件，仅 7 件是真装配输入（build-host.mjs 清单：app·pure·diagnostics·models·plugins·update·enhance-handlers = 1625 行）；**其余 18 件 / 995 行活代码不可达**（判据：严格 import 语句 + 引用者具名，两法交叉收敛同一名单）；其中 **13 件靠死簇内互引伪装成"有入边"**（簇根 src/host/index.js 自身零入边）。ADR-194 P0 承诺「死层 18 件退役」= 一件未退；ADR-197 终局（lib/index.js ≤120 行装配 + 领域模块化）= 执行度 0%（lib/index.cjs 现 837 行，1727→837 的降幅全部来自 ADR-201 删功能，与拆域无关）。
3) client 载体 🟠：lib/client.cjs（`window.__ModuleLoader__.load({id,factory})` 包装）+ plugin-client.js（裸 bundle）= 694KB = 发布物 1256KB 的 **55%**，同一 client 逻辑装两遍（四探针 dsh-enh-result / EnhanceButton / RecordRTC / config v2 两产物全中；`__ModuleLoader__` 仅现于前者）。
4) RPC 契约 🟠：线上注册面 **34 条**（lib/index.cjs 16 + plugin-host.js 18，判据 harness.handle 正则）；死层 src/host/protocol.js 声明 **21 条**（缺 config/* 2 + voice/* 10 + models/stats 1）；参数校验面 lib/rpc-schema.cjs **17/34 = 50%**；docs/compatibility-matrix.md 反而 **34/34 全覆盖**——最完整的事实源在文档层。
5) 验证门禁 🔴（最严重）：CI `.github/workflows/ci.yml` 最近 12 次运行 **12/12 cancelled**，每次挂满 6h0m18s~6h0m48s（= job 超时上限）。逐 step 实证：install/syntax 秒级成功 → `Run tests` 21:59:27 起 → 03:59:32 被取消 → 其后 `Build client bundle`、`Verify generated artifacts are committed` **每次 skipped**。job 日志止于第 146 条 LIBWIRE-06 后 **6 小时零输出**，清理时残留 4 个 node 孤儿进程。分文件对账：**完成 143/281**；**12 个文件 0 完成**（maintain 23 / voice-persist 24 / update-gate 24 / platform-service 23 / sys 13 / updater-host 7 / rpc-guard 5 / observability 3 / pipeline 3 / services 3 / protocol 2 / update-platform 2）。静态可疑：maintain（起监听+setInterval+子进程）、sys（子进程）；**尚未在 Linux 复现确证**。外部贡献路径同样失效：PR #7 的 CI = `action_required` / 0s（从未运行）。本地 `npm test` = **281/281**（Windows，1–2 分钟）——**当前唯一真实门**。
6) 治理索引 🟠：STALE 0 / 在途 0（抽查未见幽灵落点）；但 **3 个大件 lib 查不到归属**：lib/sys.cjs(914 行)、lib/net-proxy.cjs(402)、lib/platform-service.cjs(369) 合 **1685 行**，`nav_graph mode=task` 返回"无映射"。
7) 文档-事实一致性 🟠：AGENTS.md「测试 330 项」→ 实测 281（已订正）；AGENTS.md「docs/internal 现 1 个」→ 实际 2 个；components 11 ✓ / release-notes 5 ✓；「protocol.js 21 条」准确。
8) 发布链 🟠：tag v3.3.3 落后 HEAD 6 提交；Issue #8/#10（0197ae7 槽位契约）+ #9（88524c0 云 ASR chat 协议字段名）修复都在 main 未发布 → 市场渠道用户仍处故障态。
9) 本轮新证据：Issue #9 根因 = lib/asr.cjs 的 transcribeChat 请求体 content part 内层键名 audio（应 input_audio）→ 服务端 400 被一律映射 ASR_BAD_RESPONSE → UI 显示"音频无效"；因仓库对该函数**零断言** + CI 从不完成，该笔误一路发到 v3.3.3。

■ arch-view 技能要点（relay 转述，供方案对齐）
· **架构先行协议**：任务必须先在架构上找到锚点才开工；**无锚点 / 链路不覆盖 = 架构不足 → 先出整体架构修订方案，不打局部补丁**（本次任务正是这一条）。
· 三层模型：索引层（nav 模型，机器读）/ 文档层（`.internal/arch/*.md` = agent 开发主地图）/ 渲染层（投影，零维护）。项目现有档：prompt-enhancer-overview.md、PE-F01-assembly-chain.md、PE-F04-voice-input.md。
· **现成机检门**：`.internal/arch/render/_tools/arch-check.mjs`（L1 边表逐条反查磁盘 import + 度数；L2 锚点清单 100% 命中）。
· 落点登记必须用一等参数 `files=`；用 `set=files=` 会**静默丢参数**（沉默失败）。STALE 用 `nav_node retire=true` 或 `files=<新路径>` 关闭。
· 计数闸 3/3 必须 `nav_decide`；**2/3 只是警告，禁止为清零补 ADR（那是制造假绿）**。
· 汇报纪律：只报 L1（会造成下轮踩空/假绿）与 L2（仪表读数）两级；每条问题必须带「关掉它的命令」。

■ 会议红线
只到**决策态**（不施工/不发版/不改仓/不安装）；v3.3.3 对外契约不在本轮变更范围，确需变更须单列并标 BREAKING；不改第三方框架源码；不虚构索引/架构档里没有的路径。
发言格式：[当前状态] … [核心产出] … [下一步建议] …

**captain → accept** · 2026-09-19 03:31:58

【主持人广播 · 花名册与事实底本】

■ 当前花名册（orchestrated 模式，全部由主持人中转）
· arch（架构主审）· minimal（裁剪与极简）· rollout（分期落地）· accept（验收判据）· verify（独立验证）
拓扑：captain↔arch、captain↔verify、arch→minimal→rollout→accept、verify↔arch
会议技能：arch-view（relay，由主持人转述要点）
知识库：D:\FF\deepseek\prompt-enhancer-release（需要具体文件时向我点名，我读取后转交）

■ 工作对象
D:\FF\deepseek\prompt-enhancer-release —— DSH 插件（✨ 提示词增强 + 🎤 语音识别）。已发布 v3.3.3；main 领先 tag 6 个提交（未发布）。

■ 8 域实测事实（每条附检查方式，均为主持人实测；verify 负责复核）
1) 装配与构建链 🟢：`build-host.mjs --check` + `build-client.mjs --check` 双产物零漂移。体积：plugin-host.js 285KB / plugin-client.js 343KB / lib/client.cjs 351KB。
2) host 架构 🔴：src/host 共 25 件，仅 7 件是真装配输入（build-host.mjs 清单：app·pure·diagnostics·models·plugins·update·enhance-handlers = 1625 行）；**其余 18 件 / 995 行活代码不可达**（判据：严格 import 语句 + 引用者具名，两法交叉收敛同一名单）；其中 **13 件靠死簇内互引伪装成"有入边"**（簇根 src/host/index.js 自身零入边）。ADR-194 P0 承诺「死层 18 件退役」= 一件未退；ADR-197 终局（lib/index.js ≤120 行装配 + 领域模块化）= 执行度 0%（lib/index.cjs 现 837 行，1727→837 的降幅全部来自 ADR-201 删功能，与拆域无关）。
3) client 载体 🟠：lib/client.cjs（`window.__ModuleLoader__.load({id,factory})` 包装）+ plugin-client.js（裸 bundle）= 694KB = 发布物 1256KB 的 **55%**，同一 client 逻辑装两遍（四探针 dsh-enh-result / EnhanceButton / RecordRTC / config v2 两产物全中；`__ModuleLoader__` 仅现于前者）。
4) RPC 契约 🟠：线上注册面 **34 条**（lib/index.cjs 16 + plugin-host.js 18，判据 harness.handle 正则）；死层 src/host/protocol.js 声明 **21 条**（缺 config/* 2 + voice/* 10 + models/stats 1）；参数校验面 lib/rpc-schema.cjs **17/34 = 50%**；docs/compatibility-matrix.md 反而 **34/34 全覆盖**——最完整的事实源在文档层。
5) 验证门禁 🔴（最严重）：CI `.github/workflows/ci.yml` 最近 12 次运行 **12/12 cancelled**，每次挂满 6h0m18s~6h0m48s（= job 超时上限）。逐 step 实证：install/syntax 秒级成功 → `Run tests` 21:59:27 起 → 03:59:32 被取消 → 其后 `Build client bundle`、`Verify generated artifacts are committed` **每次 skipped**。job 日志止于第 146 条 LIBWIRE-06 后 **6 小时零输出**，清理时残留 4 个 node 孤儿进程。分文件对账：**完成 143/281**；**12 个文件 0 完成**（maintain 23 / voice-persist 24 / update-gate 24 / platform-service 23 / sys 13 / updater-host 7 / rpc-guard 5 / observability 3 / pipeline 3 / services 3 / protocol 2 / update-platform 2）。静态可疑：maintain（起监听+setInterval+子进程）、sys（子进程）；**尚未在 Linux 复现确证**。外部贡献路径同样失效：PR #7 的 CI = `action_required` / 0s（从未运行）。本地 `npm test` = **281/281**（Windows，1–2 分钟）——**当前唯一真实门**。
6) 治理索引 🟠：STALE 0 / 在途 0（抽查未见幽灵落点）；但 **3 个大件 lib 查不到归属**：lib/sys.cjs(914 行)、lib/net-proxy.cjs(402)、lib/platform-service.cjs(369) 合 **1685 行**，`nav_graph mode=task` 返回"无映射"。
7) 文档-事实一致性 🟠：AGENTS.md「测试 330 项」→ 实测 281（已订正）；AGENTS.md「docs/internal 现 1 个」→ 实际 2 个；components 11 ✓ / release-notes 5 ✓；「protocol.js 21 条」准确。
8) 发布链 🟠：tag v3.3.3 落后 HEAD 6 提交；Issue #8/#10（0197ae7 槽位契约）+ #9（88524c0 云 ASR chat 协议字段名）修复都在 main 未发布 → 市场渠道用户仍处故障态。
9) 本轮新证据：Issue #9 根因 = lib/asr.cjs 的 transcribeChat 请求体 content part 内层键名 audio（应 input_audio）→ 服务端 400 被一律映射 ASR_BAD_RESPONSE → UI 显示"音频无效"；因仓库对该函数**零断言** + CI 从不完成，该笔误一路发到 v3.3.3。

■ arch-view 技能要点（relay 转述，供方案对齐）
· **架构先行协议**：任务必须先在架构上找到锚点才开工；**无锚点 / 链路不覆盖 = 架构不足 → 先出整体架构修订方案，不打局部补丁**（本次任务正是这一条）。
· 三层模型：索引层（nav 模型，机器读）/ 文档层（`.internal/arch/*.md` = agent 开发主地图）/ 渲染层（投影，零维护）。项目现有档：prompt-enhancer-overview.md、PE-F01-assembly-chain.md、PE-F04-voice-input.md。
· **现成机检门**：`.internal/arch/render/_tools/arch-check.mjs`（L1 边表逐条反查磁盘 import + 度数；L2 锚点清单 100% 命中）。
· 落点登记必须用一等参数 `files=`；用 `set=files=` 会**静默丢参数**（沉默失败）。STALE 用 `nav_node retire=true` 或 `files=<新路径>` 关闭。
· 计数闸 3/3 必须 `nav_decide`；**2/3 只是警告，禁止为清零补 ADR（那是制造假绿）**。
· 汇报纪律：只报 L1（会造成下轮踩空/假绿）与 L2（仪表读数）两级；每条问题必须带「关掉它的命令」。

■ 会议红线
只到**决策态**（不施工/不发版/不改仓/不安装）；v3.3.3 对外契约不在本轮变更范围，确需变更须单列并标 BREAKING；不改第三方框架源码；不虚构索引/架构档里没有的路径。
发言格式：[当前状态] … [核心产出] … [下一步建议] …

**captain → verify** · 2026-09-19 03:31:58

【主持人广播 · 花名册与事实底本】

■ 当前花名册（orchestrated 模式，全部由主持人中转）
· arch（架构主审）· minimal（裁剪与极简）· rollout（分期落地）· accept（验收判据）· verify（独立验证）
拓扑：captain↔arch、captain↔verify、arch→minimal→rollout→accept、verify↔arch
会议技能：arch-view（relay，由主持人转述要点）
知识库：D:\FF\deepseek\prompt-enhancer-release（需要具体文件时向我点名，我读取后转交）

■ 工作对象
D:\FF\deepseek\prompt-enhancer-release —— DSH 插件（✨ 提示词增强 + 🎤 语音识别）。已发布 v3.3.3；main 领先 tag 6 个提交（未发布）。

■ 8 域实测事实（每条附检查方式，均为主持人实测；verify 负责复核）
1) 装配与构建链 🟢：`build-host.mjs --check` + `build-client.mjs --check` 双产物零漂移。体积：plugin-host.js 285KB / plugin-client.js 343KB / lib/client.cjs 351KB。
2) host 架构 🔴：src/host 共 25 件，仅 7 件是真装配输入（build-host.mjs 清单：app·pure·diagnostics·models·plugins·update·enhance-handlers = 1625 行）；**其余 18 件 / 995 行活代码不可达**（判据：严格 import 语句 + 引用者具名，两法交叉收敛同一名单）；其中 **13 件靠死簇内互引伪装成"有入边"**（簇根 src/host/index.js 自身零入边）。ADR-194 P0 承诺「死层 18 件退役」= 一件未退；ADR-197 终局（lib/index.js ≤120 行装配 + 领域模块化）= 执行度 0%（lib/index.cjs 现 837 行，1727→837 的降幅全部来自 ADR-201 删功能，与拆域无关）。
3) client 载体 🟠：lib/client.cjs（`window.__ModuleLoader__.load({id,factory})` 包装）+ plugin-client.js（裸 bundle）= 694KB = 发布物 1256KB 的 **55%**，同一 client 逻辑装两遍（四探针 dsh-enh-result / EnhanceButton / RecordRTC / config v2 两产物全中；`__ModuleLoader__` 仅现于前者）。
4) RPC 契约 🟠：线上注册面 **34 条**（lib/index.cjs 16 + plugin-host.js 18，判据 harness.handle 正则）；死层 src/host/protocol.js 声明 **21 条**（缺 config/* 2 + voice/* 10 + models/stats 1）；参数校验面 lib/rpc-schema.cjs **17/34 = 50%**；docs/compatibility-matrix.md 反而 **34/34 全覆盖**——最完整的事实源在文档层。
5) 验证门禁 🔴（最严重）：CI `.github/workflows/ci.yml` 最近 12 次运行 **12/12 cancelled**，每次挂满 6h0m18s~6h0m48s（= job 超时上限）。逐 step 实证：install/syntax 秒级成功 → `Run tests` 21:59:27 起 → 03:59:32 被取消 → 其后 `Build client bundle`、`Verify generated artifacts are committed` **每次 skipped**。job 日志止于第 146 条 LIBWIRE-06 后 **6 小时零输出**，清理时残留 4 个 node 孤儿进程。分文件对账：**完成 143/281**；**12 个文件 0 完成**（maintain 23 / voice-persist 24 / update-gate 24 / platform-service 23 / sys 13 / updater-host 7 / rpc-guard 5 / observability 3 / pipeline 3 / services 3 / protocol 2 / update-platform 2）。静态可疑：maintain（起监听+setInterval+子进程）、sys（子进程）；**尚未在 Linux 复现确证**。外部贡献路径同样失效：PR #7 的 CI = `action_required` / 0s（从未运行）。本地 `npm test` = **281/281**（Windows，1–2 分钟）——**当前唯一真实门**。
6) 治理索引 🟠：STALE 0 / 在途 0（抽查未见幽灵落点）；但 **3 个大件 lib 查不到归属**：lib/sys.cjs(914 行)、lib/net-proxy.cjs(402)、lib/platform-service.cjs(369) 合 **1685 行**，`nav_graph mode=task` 返回"无映射"。
7) 文档-事实一致性 🟠：AGENTS.md「测试 330 项」→ 实测 281（已订正）；AGENTS.md「docs/internal 现 1 个」→ 实际 2 个；components 11 ✓ / release-notes 5 ✓；「protocol.js 21 条」准确。
8) 发布链 🟠：tag v3.3.3 落后 HEAD 6 提交；Issue #8/#10（0197ae7 槽位契约）+ #9（88524c0 云 ASR chat 协议字段名）修复都在 main 未发布 → 市场渠道用户仍处故障态。
9) 本轮新证据：Issue #9 根因 = lib/asr.cjs 的 transcribeChat 请求体 content part 内层键名 audio（应 input_audio）→ 服务端 400 被一律映射 ASR_BAD_RESPONSE → UI 显示"音频无效"；因仓库对该函数**零断言** + CI 从不完成，该笔误一路发到 v3.3.3。

■ arch-view 技能要点（relay 转述，供方案对齐）
· **架构先行协议**：任务必须先在架构上找到锚点才开工；**无锚点 / 链路不覆盖 = 架构不足 → 先出整体架构修订方案，不打局部补丁**（本次任务正是这一条）。
· 三层模型：索引层（nav 模型，机器读）/ 文档层（`.internal/arch/*.md` = agent 开发主地图）/ 渲染层（投影，零维护）。项目现有档：prompt-enhancer-overview.md、PE-F01-assembly-chain.md、PE-F04-voice-input.md。
· **现成机检门**：`.internal/arch/render/_tools/arch-check.mjs`（L1 边表逐条反查磁盘 import + 度数；L2 锚点清单 100% 命中）。
· 落点登记必须用一等参数 `files=`；用 `set=files=` 会**静默丢参数**（沉默失败）。STALE 用 `nav_node retire=true` 或 `files=<新路径>` 关闭。
· 计数闸 3/3 必须 `nav_decide`；**2/3 只是警告，禁止为清零补 ADR（那是制造假绿）**。
· 汇报纪律：只报 L1（会造成下轮踩空/假绿）与 L2（仪表读数）两级；每条问题必须带「关掉它的命令」。

■ 会议红线
只到**决策态**（不施工/不发版/不改仓/不安装）；v3.3.3 对外契约不在本轮变更范围，确需变更须单列并标 BREAKING；不改第三方框架源码；不虚构索引/架构档里没有的路径。
发言格式：[当前状态] … [核心产出] … [下一步建议] …

### 第 1 轮

**captain → verify** · 2026-09-19 03:32:38

【任务 R1-verify · 原始证据包（你上一轮要的五要素，此处按条给全）】

先说时序澄清：你上一轮看到 transcript 为空是对的——你的自检轮早于我的广播落地。广播（含 8 域事实）现已入库，其内容与我此处给的一致；**以下为你可重跑的原始形态**。

■ 断言 V1：CI 最近 12 次全 cancelled 且每次挂满约 6 小时
命令（cwd 任意，gh 已认证）：`gh run list --repo Fishsb/dsh-prompt-enhancer --limit 12`
输出（摘要，逐行原文）：每行形如 `<conclusion>\t<status>\t<title>\tCI\tmain\tpush\t<runId>\t<duration>\t<createdAt>`；12 行 conclusion 全为 `cancelled`；duration 依次 6h0m19s / 6h0m18s / 6h0m18s / 6h0m18s / 6h0m21s / 6h0m32s / 6h0m20s / 6h0m48s / 6h0m41s / 6h0m36s（另有 1 行 `in_progress` 为本次会议前我刚推的提交、1 行 `action_required`/0s 属 PR 分支）。
口径声明：分母 = 该命令返回的最近 12 次 main 分支 push 运行；排除项 = PR 分支那 1 次（记为 action_required，非 cancelled）。

■ 断言 V2：Run tests 步挂满 6 小时后被取消，其后两步每次 skipped
命令：`gh api repos/Fishsb/dsh-prompt-enhancer/actions/runs/34721473096/jobs`
输出（steps 逐条）：`Set up job` success → `actions/checkout@v4` success → `actions/setup-node@v4` success → `Install dependencies` success（21:59:23→21:59:27）→ `Syntax check` success（21:59:27→21:59:27）→ **`Run tests` cancelled（started_at 2026-09-12T21:59:27Z，completed_at 2026-09-13T03:59:32Z）** → `Build client bundle` **skipped** → `Verify generated artifacts are committed` **skipped**。job 整体 started 21:59:20 / completed 03:59:35 / conclusion cancelled。

■ 断言 V3：job 日志止于第 146 条后 6 小时零输出，残留 4 个 node 孤儿进程
命令：`gh api repos/Fishsb/dsh-prompt-enhancer/actions/jobs/103628051530/logs --allow-escape-sequences`
输出（日志共 1259 行；尾部逐字）：
```
2026-09-12T21:59:57.9946466Z ok 146 - LIBWIRE-06 updater-host.cjs EADDRINUSE 动态口 fallback 在位（写 executor.port）
2026-09-13T03:59:32.8393067Z ##[error]The operation was canceled.
2026-09-13T03:59:33.0905778Z Terminate orphan process: pid (2348) (npm test)
2026-09-13T03:59:33.0934742Z Terminate orphan process: pid (2359) (sh)
2026-09-13T03:59:33.0961235Z Terminate orphan process: pid (2360) (node)
2026-09-13T03:59:33.1001732Z Terminate orphan process: pid (2425) (node)
2026-09-13T03:59:33.1029673Z Terminate orphan process: pid (2459) (node)
```
**口径自曝（请你重点裁这条）**：我从该日志用 `^ok \d+ - (.+)$` 抽出 143 条用例名，与我从 `test/*.test.cjs` 用 `test\('…'` 抽出的用例名做集合比对，得「143/281 完成、12 个文件一条未出现」。但日志**最大编号为 146**，与 143 不符（差额 3 条应是我的抽取正则漏匹配含转义/换行的用例名）。故保守口径应为：**≤146/281，且 12 个测试文件零出现**——「143」这个具体数字请你裁定为「部分成立」或给出更严口径。

■ 断言 V4：死层 18 件 / 995 行 / 13 件靠死簇内互引
判据构造：对 `src/host/*.js` 逐件，在「活侧语料」（lib/、scripts/、src/ 去掉 src/host、plugin-host.js、plugin-client.js、package.json）中搜**严格 import 语句** `(?:require\(|from\s+)['"][^'"]*[/\\]<basename>(?:\.js)?['"]`，得「活侧 import 数」；对 test/ 同法得「测试 import 数」。
输出（逐件，活侧/测试）：app 无（由 build 清单装配）、config 0/0、config-schema 1(←config-service)/2、config-service 1(←index)/1、diagnostics-service 1(←index)/1、enhance 1(←index)/1、executor-reloader 1(←update-service)/1、index 0/0、integrity 0/1、logger 1(←diagnostics-service)/1、model-service 1(←index)/1、models 0/0、pipeline 1(←index)/2、plugins-service 1(←index)/1、plugins 0/0、protocol 0/1、reloader 1(←update-platform)/1、rpc-schema 0/2、services 1(←index)/0、update-platform 1(←update-service)/1、update-service 1(←index)/1、update 0/0。
结论构造：`build-host.mjs` 的真装配清单 = app·pure·diagnostics·models·plugins·update·enhance-handlers（7 件）。**不在该清单内、且活侧 import 的引用者全部落在本集合内部**的文件 = 18 件（config·config-schema·config-service·diagnostics-service·enhance·executor-reloader·index·integrity·logger·model-service·pipeline·plugins-service·protocol·reloader·rpc-schema·services·update-platform·update-service）——即「从活代码不可达」；其中 13 件至少有一条簇内入边（伪装成有入边），5 件（config·index·integrity·protocol·rpc-schema）连簇内入边也没有。
行数口径：`fs.readFileSync(utf8)` → chunk 解码（`module.exports = "…"` 的 `\n` 转义还原）后按 `\n` 切分计数，逐件 10+228+21+28+45+131+38+35+39+26+55+25+44+31+134+34+33+38 = **995**。
漏检范围声明：① 只覆盖本仓磁盘 import，不含运行时动态 require / 字符串拼接路径；② basename 匹配对同名文件不区分目录；③ 若活侧存在 `require(variable)` 形式的引用，本判据会漏计（我未枚举此类以确认其为 0）。

■ 断言 V5：694KB = 发布物 1256KB 的 55%
命令（node）：对 `package.json.files` 白名单实测字节——`lib/**` 全部 + `plugin-host.js` + `plugin-client.js`。
输出：lib/client.cjs 351KB + plugin-client.js 343KB = **694KB**；合计 1256KB；占比 55%。
口径声明：**字节数**（非字符数；同一文件按 utf8 字符数统计会偏小约 40%，我先前误用过该口径并已纠正）。未用 gzip 口径。

■

…（已截断，原长 4747 字符）

**captain → accept** · 2026-09-19 03:32:38

【任务 R1-accept · 8 域清单 + 每域证据形态】

时序澄清：你上一轮看到的「transcript 为空」是对的（你的自检轮早于我的广播）。广播现已入库。你提出的输入契约我按条满足如下，本轮请据此产出**判据表骨架**（不必等 arch/rollout，判据与成因/阶段是正交的）。

■ 8 域清单（域 ID + 一句话定义 + 该域判据将用的证据形态）
· **D1 装配与构建链** —— 源码 chunk → 构建脚本 → 根产物 的一致性。证据形态：`node scripts/build-host.mjs --check` 与 `build-client.mjs --check` 的 exit code + stdout。
· **D2 host 架构** —— `src/host/**` 的模块边界与「从活代码是否可达」。证据形态：严格 import 语句枚举（命令与漏检范围见广播附件），产出「活侧 import 数 / 测试 import 数」逐件表。
· **D3 client 载体** —— 同一 client 逻辑的产物份数与发布物体积构成。证据形态：`package.json.files` 白名单内逐文件**字节数**（禁用字符数/gzip 混用）。
· **D4 RPC 契约** —— 线上注册面 / 声明面 / 参数校验面 三者一致性。证据形态：`harness.handle` 正则并集、`RPC_METHODS` 数组、schema 键集合差集。
· **D5 验证门禁** —— CI 是否给出有效信号。证据形态：`gh run list` 的 conclusion 列、`gh api .../jobs` 的 steps[] 逐条 status/conclusion、job 日志的结束形态与孤儿进程。
· **D6 治理索引** —— 关键文件是否可经 `nav_graph mode=task` 定位。证据形态：对目标文件调 `nav_graph mode="task"` 的返回值（`No mapping found` 即未登记）。
· **D7 文档-事实一致性** —— 治理文档里的可清点断言 vs 磁盘。证据形态：`docs/internal/*.md` 计数、`release-notes/*.md` 计数、`npm test` 实测用例数。
· **D8 发布链** —— tag 与 main 的距离、已修复问题是否已送达用户。证据形态：`git rev-list --count <tag>..HEAD`、`git merge-base --is-ancestor <fix> <tag>` 的 exit code。

■ 你上一轮要求的「主持人三处自报数字的原始出处」
· CI run id：`34721473096`（cancelled，6h0m19s）；job id `103628051530`。
· 死层入边：判据与逐件枚举见广播附件末尾（V4 段），可复跑命令已给；**漏检范围我已显式声明三条**（不含运行时动态 require、basename 不区分目录、`require(variable)` 会漏计且未枚举确认其为 0）。
· 体积口径：**字节数**（`lib/client.cjs` 351KB + `plugin-client.js` 343KB = 694KB / 总 1256KB = 55%）；我先前误用过 utf8 字符数口径，已纠正并声明。
· v3.3.3 契约基线：`docs/compatibility-matrix.md` 列 34 条 RPC，与线上注册面 34 条**同集**（差集 ∅）——这可直接作为「对外契约不得变更」的字节级基线。

■ 本轮任务
1. 按 D1–D8 出**判据表骨架**，每条写全四要素（判据内容 / 检查方式 / 通过阈值 / 失败退回动作），**分「可自动检查」与「须人工判断」两组**，且**按域编号**（不得用"各域均通过"这类合并表述）。
2. 每个阈值标注来源：`已实测`（我给的原始输出）/ `需补证`（我未给，请标"待定，需用户拍板"）/ `由 arch 或 rollout 产出后再定`（留占位并写明依赖谁的哪项产出）。
3. 阈值来源口径：主口径统一取 **8 域实测原始输出**；若你认为某个域该用别的来源（如官方文档、同类项目基线），单列并说明理由，我转达。
4. 红线自检：判据只到可复验判定态，不含施工/改仓/发布动作；v3.3.3 对外契约若在后续被判定必须变更，须单列并标 BREAKING。
5. 仍缺物料时，只列缺口清单，**不要为凑满表而编阈值**——你的角色明确禁止这种推断。

需要具体文件片段向我点名即可。

**rollout → 汇聚网关** · 2026-09-19 03:33:01

[当前状态] 已按主持人底本完成分期设计，并就地复验了会影响验收阈值的三个数字（CI 运行结论 / 死簇入边 / 体积口径）。不重新论证方案，只排时间线与门槛。

[核心产出]
## 一、分期表（决策态：每阶段交付=可授权产物+证据包；未具名授权不施工）

| 阶段 | 交付物 | 验收判据（阈值） | 预计阻塞点 | 回滚方式 |
|---|---|---|---|---|
| **P0 门禁实话化**（零功能改动·止血） | ①一次**带真实结论**的 CI 运行记录（失败文件名单+每个挂起文件最后一行输出+是否复现挂死）②CI 配置修订稿：`timeout-minutes ≤15` 硬顶、`Run tests` 落盘报告且超时即 fail，**禁止 skipped 静默**③v3.3.3 发布物基线快照（文件清单+字节数+哈希，口径写 KiB÷1024） | 下一次 push 的 run `conclusion ∈ {success, failure}`，**不得再出现 cancelled**；`Run tests` 与 `Verify generated artifacts` 两 step 结论非 skipped；job wall time <15min；本地 `npm test` 仍 281/281 | 挂起源（maintain 监听+setInterval+子进程 / sys 子进程）若属本仓测试代码不退出，本阶段**只能拿到「失败的真话」**（Linux 未复现确证），不可要求变绿 | CI 配置单文件 revert；无运行时/版本改动，v3.3.3 不受影响 |
| **P1 验证门全绿** | ①零完成文件（口径见五）逐件处置决议：修测试/拆测试/归并/标注暂缓四选一，每件带「下一步命令」②本地+CI 双绿证据包 | CI run `conclusion=success` 且 `Verify generated artifacts` **实际执行**（非 skipped）；本地 `npm test` 0 fail 且计数=实测值 | 长驻进程类测试跨平台差异（Windows 绿≠Linux 绿）；每验一轮=一次 CI（~15min），12 件串行拖长 → 按文件分批并行提 | 只动 test/ 与 workflow，revert 提交即可，不触发布物 |
| **P2 契约事实源收敛** | ①单一事实源选定稿（线上 34 条为唯一真相；死层 `protocol.js` 的 21 条声明标「非事实源」）②`rpc-schema` 覆盖补全决议（17/34→目标值）③**BREAKING 单列清单** | 34 条注册面可由单一事实源机检复现（命令级）；`compatibility-matrix.md` 与事实源逐条 0 差异；覆盖率数字给定且可复测 | **补校验会把既有静默容忍调用变成 400** = 唯一触达已发布对外行为的点，须用户拍板，否则整阶段阻塞 | 事实源只读登记不改行为；校验面按 RPC 方法级开关灰度，可单方法回退 |
| **P3 发布物减重**（格式/载体层，不动逻辑） | ①体积口径卡 ②双载体去重方案 A/B 决议 ③minify/sourcemap 决议 | 同一 client 逻辑**不再装两份**：四探针（dsh-enh-result / EnhanceButton / RecordRTC / config v2）在两产物中**不再全中**（可机检）；`git diff --exit-code` 门禁仍绿；安装路径实机复验槽位契约不破 | `__ModuleLoader__` 包装是唯一差异点，「留哪一份」决定 DSH 动态安装路径是否受影响 | 产物由 build 生成，`npm run build` 回上一提交即恢复；无源码逻辑变更 |
| **P4 结构收敛**（最大改动·必须拆子步） | ①死层 18 件/995 行退役决议（逐件可逆清单）②`lib/index.cjs` 837→≤120 行装配薄化的域边界表 ③3 件无归属大件（sys 914 / net-proxy 402 / platform-service 369 = 1685 行）导航归属登记稿 ④文档-事实订正清单 | 每个子步后 `build-host.mjs --check`+`build-client.mjs --check` 零漂移且 `npm test` 全绿；`nav_graph mode=task` 对 3 大件不再返回「无映射」；死层名单在 `dead-code-gate.mjs` 下 0 命中 | 一次做不完；必须「退役一批→双 check 绿→下一批」。先拆哪批须等 arch 的成因清单对齐（我按域排序，不代其判因） | 逐件 git revert；不动已发布 tag |

## 二、里程碑与硬依赖
M0=CI 不说谎（有真实 conclusion + 15min 硬顶）→ M1=门全绿（CI success + 本地 281）→ M2=契约单一事实源（含 BREAKING 裁决）→ M3=发布物减重落地 → M4=结构收敛（死层 0 + 3 大件有归属 + 双 check 零漂移）。

- **硬依赖**：P0→P1→{P2,P3,P4}；P2→P4（protocol 21 条声明退役在 P4 执行）；**P1→发布**（若选止血优先，发布可在 P1 后立即做，P2–P4 不阻塞发布）。
- **可并行**：P1 之后 P2（契约面）/P3（src/client+client 产物）/P4（src/host+导航+文档）文件集不重叠，三条车道可并行。单人执行时推荐串行序 **P3→P2→P4**（P3 不触对外行为、回滚最便宜；P4 最大且需 P2 结论）。

## 三、对主持人数字的独立复核（影响阈值者才报）
- ✅ CI：`gh run list` 实测最近 12 条 completed run **全部 cancelled**；最新 35369171439（Issue #9 修复）自 **2026-09-18T16:33Z** 起 in_progress，按既往 6h0m19s~6h0m48s 推算约 **2026-09-19 06:33（本地）** 被取消——**P0 可直接读这次运行计时，省一次 6h 触发**。6h = GitHub 托管 runner 默认 job 上限。
- ✅ 死簇：全仓 grep `host/index` **0 命中**（含 test/），`src/host/index.js` 零非测试入边成立。
- ✅ 体积口径 = **KiB**：plugin-host 292,045B=285.2KiB、plugin-client 351,607B=343.4KiB、lib/client.cjs 359,542B=351.1KiB；发布物 1,286,311B=1256.2KiB，其中两 client 载体 694.2KiB=**55.0%**。口径必须写进判据，防 KB/KiB 混用导致阈值漂移。
- ⚠️ **两数不自洽，须 verify 裁**：「完成 143/281」与逐文件零完成名单之和（23+24+24+23+13+7+5+3+3+3+2+2=**132**）不一致（281−132=149≠143，差 6）。**在两者对齐前，任何分期验收不得以 143 或 132 为阈值**，只用「本地 281/281 且 CI conclusion=success + 零完成文件名单逐件复现」。
- ✅ test/ 共 21 个 `*.test.cjs`，与「21 测试文件」一致（该目录另有 1 个非测试文件，未展开）。

## 四、必须拍板项（不进我的分期推定）
① 发布时机：止血优先（P1 后即发）/ 攒批 / 一次性——决定市场渠道用户在 Issue #9 故障下多待多久；
② P2 若补校验必然 BREAKING，本轮是否排入（不排则 P2 只做事实源收敛，校验面缓）；
③ P4 死层 18 件取「删」还是「先迁出不参与构建」——需 minimal 裁剪档位与 arch 成因清单先到，我不预设。

[下一步建议] ①请 verify 优先裁「143 vs 132」这处不自洽，并把 P0 的判据集合冻结为该次在跑运行的读数（约 06:33 本地）；②请 accept 接 P0–P4 四要素判据表补全（我只给了阈值与退回动作的骨架）；③P0 无需新施工，只读该次运行 + 出一份 CI 配置修订稿即可，符合决策态红线。

[建议决策] 三项里只有一项卡住其余所有分期：发布时机 | 选项：A 止血优先（P1 后发，只含已修 Issue）/ B 攒批（P2 后）/ C 一次性（P4 后）| 推荐：A 理由：v3.3.3 的 ASR 400 故障对市场用户仍生效且修复已在 main，而 P2–P4 均不修改对外契约、可后续独立发布。

**captain → verify** · 2026-09-19 03:33:25

【主持人转达 · rollout 提出的算术不自洽 + 我的对账（请你据此裁定 V3 口径）】

■ rollout 的质疑（原文要点）
「143/281 与逐文件零完成名单之和 132 矛盾（差 6）」，对齐前它已自行冻结验收阈值（改用「本地 281/281 + CI success + 零完成名单逐件复现」）。

■ 我的对账（差额 6 = 3 + 3，两笔来源不同）
1. **3 条 = 我抽取正则的漏匹配**：日志里含转义/换行的用例名未被 `^ok \d+ - (.+)$` 命中 → 日志最大编号 **146** = 143（匹配到）+ 3（未匹配到）。
2. **3 条 = 部分完成文件的缺口**：`deploy-guard.test.cjs` 是**部分完成**（9 条中完成 6、缺 3），它不在「零完成」名单里，故这 3 条既不计入 143、也不计入 132。

■ 恒等式核验（请你复核这一步）
143（匹配完成）+ 3（未匹配）+ 132（12 个零完成文件用例数之和）+ 3（part 完成文件缺口）= **281** ✓

■ 因此正确表述应是**四分而不是二分**
· 匹配完成 143
· 未匹配 3
· 零完成文件（12 个）132
· 部分完成文件缺口（deploy-guard 3）3
合计 281。

■ 请你裁定
① 上述对账是否成立（若成立，rollout 的「差 6」即被解释，不再是不自洽）；
② 「已上报用例数上界 = 146」可否作为 CI 日志口径的正式表述；
③ 「12 个测试文件零出现」这一更强结论是否**不依赖** 143/146 之争而独立成立（我倾向成立：该结论只看"文件是否有任何用例名出现在日志中"，与匹配总数无关）。

另：`deploy-guard.test.cjs` 的 6/9 来自我按用例名的集合比对；若你要更严口径，点名要我转交该文件的用例清单原文，我读取后转交。

**accept → 汇聚网关** · 2026-09-19 03:36:10

[当前状态] R1-accept 完成。我在本机复跑了 D1–D8 全部检查命令（非引用主持人数值），先校准基线，再出判据表。**三处主持人数值需修正/改述**，另有 2 处口径差异已对账清零。

【0. 校准基线与对账结果（全部为我本机实测，命令可复跑）】

· D3 体积：**主持人数字正确，是我的单位误判**。主持人用 KiB（÷1024）：client.cjs+plugin-client=711,149 B=**694.5 KiB**；基准=lib/ 全目录 642,659 + 两产物 643,652 = 1,286,311 B=**1256.2 KiB**；占比 **55.28%** ✓。我复算 npm pack unpacked=1,303,630 B = 1,286,311 + README.md 7,178 + README.en.md 8,008 + package.json 1,989 + cordis.patch.yml 144 ✓ 完全对账。
· D2 行数：主持人 995 = 我逻辑行 977 + 18 文件 ×1 = **995**。**口径差（+1/文件），事实同一**：7 件装配件仅 26 行，18 件死层占 **977/1003 = 97.4%**。两种计法必须标口径，否则上下游同一数字不可比。
· **修正1（D5，重要）**：主持人「最近 12 次 **12/12 cancelled**」不成立。实测 = **10 cancelled + 1 action_required + 1 in_progress**。可复验的正确形式是：**近 12 次中 conclusion=success 的次数 = 0**。
· **修正2（D5，本轮新证据）**：最新 run `35369171439`（2026-09-18T16:33:26Z 起）**现测 19:33:41Z 仍 in_progress**，job `105678788674`、step6 `Run tests` in_progress，已持续 **180 min**；前 5 step 全 success，step7/8 pending。→ 「挂死」不是历史现象，**正在复现，且 #9 的修复提交 88524c0 正挂在这个 run 里**。
· **修正3（D4 基线可采性）**：matrix 确实覆盖 34 条（`enhance` L24、`cancel` L26 均在），**但用「34/34 全覆盖」作基线不精确**：matrix 另含 3 条代码中不存在的历史条目（`update/makeShortcut` 无代码、`update/serviceInstall` **无退役注记且 NOT FOUND**、`update/portRestart` 仅残留于 index.cjs+maintain-lib.cjs）。基线须剔历史条目。
· 其余主持人数字**全部复现成立**：RPC 线上并集**=34**（index 16 + host 18，名单已固化）；schema **17/34=50.0%**（16 条带斜杠 + bare `enhance`）；`src/host/index.js` **零入边**；`protocol.js` **零 importer**；nav `lib/sys.cjs`→**"No mapping found"** ✓；health **STALE=0** ✓；本地 `npm test` **281/281、31 s** ✓；`git merge-base --is-ancestor 0197ae7|88524c0 v3.3.3` **均 exit 1** ✓；main 领先 tag **6** ✓；docs/internal **2** ✓（AGENTS.md 称 1 ✗）；release-notes **5** ✓；build 双 `--check` **exit 0/0** ✓。
· **D2 关键边界（防假阳，我实测）**：活侧 7 件中跨文件静态 import **仅 2 条**（app.js→enhance-handlers、app.js→pure）；diagnostics/models/plugins/update 为 **0 条**（由 build 脚本按清单拼装）。故「严格 import 语句」法**不适用于活侧 7 件**，只适用于死簇内部——此边界必须写进判据，否则会把 5 件装配件误判为不可达。
· **平台约束（阈值口径）**：仓库**无 `.gitattributes`** → 磁盘字节随 checkout EOL 变（lib/index.cjs blob 45,292 vs disk 46,097，差 805）。**体积判据一律用 `git cat-file -s HEAD:<path>` 或 `npm pack --json`，禁用 `Get-Item .Length`。**

【1. 可自动检查组】（四要素：判据 / 检查方式 / 阈值(来源) / 失败退回）

**D1 装配与构建链**
1. 双产物零漂移 | `node scripts/build-host.mjs --check; node scripts/build-client.mjs --check` | 两 exit code 均=0（已实测 0/0）| 退回：就地重跑；**不得改 --check 使通过**。
2. 构建可复现 | `npm run build && git diff --exit-code -- lib/ plugin-host.js plugin-client.js` | diff 空、exit 0（来源：ci.yml 第 8 step 原命令，我已读全文 846 B）| 退回：判 D1 全组阻断。

**D2 host 架构**
3. 可达件计数 | `node -e "…读 scripts/build-host.mjs 的 src/host 引用…"` 与 src/host 全量比对 | wired=**7**、dead=**18**（已实测）| 退回：计数不符即基线漂移，重取基线，不得沿用。
4. 死簇根零入边 | 全库 grep `src/host/index.js` 的 importer | = **0**（已实测 0）| 退回：>0 则死层判定错误，全组重做。
5. **活侧 import 边界护栏** | 统计 7 件装配件跨文件 import 数 | 期望 = 2（app.js 两条），diagnostics/models/plugins/update 各=**0 属预期事实非缺陷** | 退回：若据此判 5 件不可达 → **判据误用**，改以 build 清单为准。
6. 死层行占比 | 逻辑行统计 | 基线 **977/1003=97.4%**；目标态阈值(**由 arch/rollout 产出后再定**)| 退回：无目标态即不判通过。

**D3 client 载体**
7. 双载体同逻辑 | 四探针 `grep -c` 于两产物 | dsh-enh-result≥1、EnhanceButton≥1、RecordRTC≥1 **须两侧同时命中**（实测 1/1、10/10、91/91）；`__ModuleLoader__` 仅 client.cjs（实测 1/0）| 退回：不同时命中 → 两产物已分叉，D3 去重前提不成立，重取证。
8. 载体占比 | `git cat-file -s HEAD:lib/client.cjs` 等 | 基线 **694.5 KiB / 1256.2 KiB = 55.28%**；目标态(**待 rollout**)；**单位须标 KiB** | 退回：未标单位即判不可比。
9. 去重绝对量 | blob 字节 | 上限锚 = min(359,542, 351,607) = **351,607 B**；目标值(**待 rollout**)| 退回：无目标值不判通过。

**D4 RPC 契约**
10. 注册面=34 | `harness.handle(` 正则并集去重 | **=34 且逐元素等于冻结基线**（名单已固化）| 退回：差集非空 → **单列并标 BREAKING**，不进本轮通过条件。
11. 契约冻结基线 | matrix 34 条 ∩ 线上并集 | 差集 **∅**（已实测成立）| 退回：把历史条目（makeShortcut/portRestart/serviceInstall）当活跃契约 → 基线不纯，重取；**3 条须单列"文档待处置"**。
12. 校验面 | 统计 lib/rpc-schema.cjs 顶层键 | 基线 **17/34=50.0%**；目标值(**待 rollout**)| 退回：覆盖率下降即判回退。
13. 声明面 | protocol.js 声明集 vs online | protocol ⊆ online（已实测成立）| 退回：出现 online 外条目 → 判幽灵契约单列。

**D5 验证门禁**
14. CI 零成功 | `gh run list --limit 12 --json conclusion` | **success 次数 = 0**（已实测 0；基线=10 cancelled+1 action_required+1 in_progress）| 退回：出现 success 则本项通过。

…（已截断，原长 8365 字符）

**captain → verify** · 2026-09-19 03:36:57

【主持人更正 · V1 口径修正 + 新增活体证据 + D4 方向澄清】——请在定稿前纳入

■ 更正一：我给你的断言 V1「最近 12 次运行 12/12 cancelled」**不成立**（accept 独立复跑抓到，我已逐行复核确认它是对的）
该窗口 12 行实为：**10 cancelled + 1 action_required（PR 分支，0s）+ 1 in_progress**。
可辩护的不变量是：**近 12 次运行中 success = 0**。
→ 请把 V1 裁为「部分成立」，并采用「success = 0」作为正式口径；「12/12 cancelled」是我的一处过度概括，作废。

■ 新增活体证据：挂死不是历史现象，**正在复现**（accept 发现，我已复核确认）
run `35369171439`（head = `88524c0`，即 #9 修复提交）截至我复核时**仍 in_progress（3h3m+）**。其 steps 实况：
1–5 `completed/success`（Set up job → checkout → setup-node → Install deps → Syntax check）
**6 `Run tests` = in_progress**
7 `Build client bundle` = pending
→ 结论从「近 12 次历史全不完成」升级为「**含当前 HEAD 在内、可当场复现**」。这同时说明：`88524c0` 的 CI 信号**至今不存在**，#9 修复目前**无 CI 背书**。

■ D4 方向澄清（我的「差集 0」是单向的；accept 补了反方向，但其表述需收紧）
· 我核的是 live(34) ⊆ matrix → 成立（34/34 命中）。
· accept 核的是 matrix → live 的不存在项 → 命中 3 个名字：`update/serviceInstall`、`update/portRestart`、`update/makeShortcut`。
· 我逐条查证这 3 个名字的**位置与性质**：**只出现在「版本沿革」列 L116/L117 两行**，且 L117 明写「`update/serviceInstall` 已移除」「**插件内重启能力退役**——`update/portRestart` / `update/makeShortcut`…全部移除」——即**带显式退役注记的历史叙述**，**不在 RPC 表主体**。
· 代码侧复核：`update/portRestart` 在 lib/index.cjs 出现 2 次，**2 次均为注释**（L428 = ADR-146 安全说明中对旧攻击面的描述；L754 = 历史背景注释），`harness.handle` 注册数 = **0**；`serviceInstall` / `makeShortcut` 出现 **0** 次。→ **无契约残留**。
· 故裁定口径建议为：**matrix 可作基线，但 diff 必须限定在 RPC 表主体**（排除版本沿革列）；accept「不宜直接当字节级基线」的**方向对、理由需按此收紧**。

■ 请你一并处理
① V1 改判；② 「success = 0」与「run 35369171439 仍 in_progress」是否可作为 D5 的正式判据表述；③ D4 基线可采性按上述收紧后的表述是否成立。
若要我转交 `docs/compatibility-matrix.md` 的 RPC 表主体全文供你逐条比对，点名即可。

**verify → captain** · 2026-09-19 03:39:38

[当前状态] 已对 V1–V7 全部独立重跑取证（不复用任何转述数字）。基线自证：HEAD=`88524c0`，`git describe`=`v3.3.3-6-g88524c0`，porcelain 仅 `?? .roundtable/`（工作树干净）。两处**必须改判**：V3 的 143/146 口径错（日志存在 3 条 `not ok`），V4 的 995 行口径在报告内部不自洽。另新增一条对你 D5 判据有否决性影响的发现（CI 平台性失败）。

■ 核验表（结论 / 裁定 / 证据 / 反例·修正）

V1「近 12 次 12/12 cancelled」→ **不可复现（已由你自行作废，我确认作废正确）**
证据：`gh run list --limit 12` 实得 10 cancelled + 1 `action_required`（PR #7 `webbrain/readme-improvement`，0s）+ 1 `in_progress`。success=0 成立。
修正口径：**近 12 次运行 success = 0**（我复跑同命令逐行核对一致）。

V2「Run tests 挂满 6h 后取消，其后两步 skipped」→ **成立（逐字段复现，误差 0）**
证据：`gh api .../runs/34721473096/jobs` 实得 job `cancelled` 21:59:20→03:59:35；STEP6 `Run tests` cancelled 21:59:27→03:59:32；STEP7/8 skipped；STEP16/17 success。
**补充机制**：`.github/workflows/ci.yml` 内 `timeout-minutes` 出现 **0 次**（grep 计数 0），故 6h0m19s 不是本仓声明值，而是 GitHub 托管 runner 的 6h 硬顶 —— 「挂满 6h 上限」的机制由平台默认提供，非仓库配置。

V3「143 完成 / 146 上界 / 12 文件零出现」→ **部分成立；其中「143」「146」「deploy-guard 6/9」三处数字作废**
证据（我拉原始日志 `gh api .../jobs/103628051530/logs`，本地 1259 行）：
· grep `\bok \d+ - ` 得 **146**，但该正则**同时也命中 `not ok`**（`\bok` 在 "not ok" 中匹配）。逐类计数：`ok` = **143**，`not ok` = **3**。
· 3 条 not ok 原文：`not ok 51 - DGRD-16 …` / `not ok 52 - DGRD-17 …` / `not ok 54 - DGRD-19 …`，错误逐条为 `error: 'spawnSync C:\Windows/System32/tar.exe ENOENT'`（`code: 'ENOENT'`）。
→ 所以「你抽取正则漏匹配 3 条含转义/换行的用例名」**不成立**：那 3 条是日志里明确写出的**失败**，不是漏匹配。**「146 条完成」作废**。
· 你「143+3+132+3=281」的四分**也不成立**：`deploy-guard` 并非 6/9 部分完成 —— 其 9 条**全部出现在日志**（6 ok + 3 not ok），故不存在「part 缺口 3」这一项。
**正确四分（HEAD=88524c0 口径，281 条）**：`ok 143` + `not ok 3` + `完全无输出 135`（分布在 **13** 个测试文件）= 281 ✓。
**部分完成文件只有 1 个：deploy-guard（9 条中 3 失败，非「零完成」）**；零文件集应为 **13 个**（在 12 个之外**加上 `asr-cloud-contract.test.cjs`**，它 135 中的 3 条）。
**你问的正确口径**：不是 143、也不是 ≤146，而是 **`ok=143` / 输出总计=146 / 活跃测试文件 8 个 / 零输出文件 13 个（135 条）**。「12 个文件零出现」应更正为 **13 个**；该更强结论**确实不依赖 143/146 之争**（只判定文件是否有任何 leaf 出现），判据独立成立。
**rollout 的「差 6」根因（你们两边都没找到）**：把 HEAD 的 281 套到 run `34721473096` 上。该 run 的 `head_sha` = **`bfe25b6e112fad1e8111dc3c3869ad926b30aa6d`**（≠ 88524c0），在该 sha 上按 `git ls-tree` 逐文件数测试声明数 = **278**（20 个 `*.test.cjs`），而非 281（`asr-cloud-contract.test.cjs` 在 `v3.3.3`/该 sha 尚不存在，`git cat-file -e v3.3.3:test/asr-cloud-contract.test.cjs` → exit 128）。278 − 3（3 条 not ok 被你们算进"完成"）= 275 计入口径 → 与我实测 146+132=278 ✓ 自洽。**差额 6 = 3（版本差）+ 3（not ok 误计入完成）**。

V4「死层 18 件 / 995 行 / 13 件靠簇内互引伪装」→ **部分成立（18 件与 13/5 分裂完全成立；995 行口径需换）**
证据（自写脚本，语料 = lib+scripts+src 全树+plugin-host.js+plugin-client.js，**含 src/host 自身**，正则 `(?:require\(|from\s+)['"][^'"]*[/\\]<basename>(?:\.js)?['"]`）：
· 7 件装配清单外 = **18 件** ✓；簇内入边 13 / 零入边 5（`config`·`index`·`integrity`·`protocol`·`rpc-schema`）✓ **逐件名单一致**；`index.js` 零入边 ✓。
· **我加强了这条结论**：不仅「活侧为 0」，而是 **src/host 之外（除 `scripts/build-host.mjs` 引用 app.js + 5 个 chunk）没有任何文件 import 任何 src/host 模块** —— 我对全树扫描结果为 0。所以「死层」判定比我预期的更硬。
· **反例（口径内部不自洽）**：`app.js` 你在同一份报告里计 **1625 行**（= 其 `module.exports` 字面量内容行，即「人工归属的 7 件真源码」口径）；而 995 是对同 14 个 chunk 文件按 **`fs.readFileSync(utf8)` + `split('\n')` 计实体文件行**。两者混用。我实测：`app.js` 实体 6 行，其字面量内容 1626 行。若统一到 995 的口径，7 件装配块合计仅 **33 行**；若统一到 1625 的口径，18 件远低于 995。**995 不可作字节级判据**（口径敏感，实测区间 974–995）。建议改写为「≈975 行（口径敏感 ±20）」，或干脆只报件数与边数（这两个是稳的）。

V5「694KB = 发布物 1256KB 的 55%」→ **成立（压缩到精确字节）**
证据：字节实测（非字符）`lib/client.cjs` 359542 + `plugin-client.js` 351607 = **711149 B**；`package.json.files` 白名单实测 = lib 全目录 642659 + plugin-host.js 292045 + plugin-client.js 351607 = **1286311 B**。711149/1286311 = **55.3%** ✓。694KB/1256KB 为 KiB 口径（694.5/1256.2）。
**重复装载判据独立复核**（我自己的探针）：`dsh-enh-result` / `EnhanceButton` / `RecordRTC` / `syncConfigFromHost` **四个探针在两产物中全中**（4/4）；`__ModuleLoader__` 仅现于 `lib/client.cjs` ✓。同逻辑装两遍成立。

V6「契约三数 34 / 21 / 17」→ **部分成立（34 与 21 成立；17 的取法你写错了，结论值仍对）**
· 34：`harness.handle('…')` 去重 —— `lib/index.cjs` **16**、`plugin-host.js` **18**、并集 **34**、重叠 **0** ✓ 逐字复现。
· 21：`src/host/protocol.js` **未解码时** `RPC_METHODS` 抽到 **0**（我第一次也踩中同一坑，独立复现了你的"首测误报 0"）；解码后数组元素 = **21** ✓，且与线上 34 的差集 = `config/*` 2 + `voice/*` 10 + `models/stats` 1 = 13，34−13=21 ✓。
· **17 → 你写的是"`lib

…（已截断，原长 8042 字符）

**captain → verify** · 2026-09-19 03:40:41

【主持人 · CI 日志口径终裁用数（以 run 自己的提交树为基线重算）】

■ 为什么必须重算：你与我都用了**当前树**（281）当基线，而该 run 的 head 是 `bfe25b6`
证据：`git show bfe25b6:package.json` → `scripts.test` 声明 **20 个文件**；逐文件抽 `test('…')` 得该提交用例总数 = **278**（我的 `asr-cloud-contract.test.cjs` 当时尚不存在）。

■ 重算结果（命令：读同一份 job 日志，**先剥 `^\S+Z ` 时间戳前缀**再按 `^ok \d+ - / ^not ok \d+ -` 匹配）
```
ok = 143    not ok = 3    合计上报 = 146
零上报 = 132（12 个文件）
恒等式：143 + 3 + 132 = 278  ✓（= 该提交声明数）
```
· 完整上报文件 **8 个 / 146 条**（含 deploy-guard：9 条全上报）
· 零上报 12 文件 / 132 条：sys 13、maintain 23、updater-host 7、update-gate 24、pipeline 3、services 3、protocol 2、update-platform 2、observability 3、voice-persist 24、platform-service 23、rpc-guard 5
· `not ok` 明细：`DGRD-16` / `DGRD-17` / `DGRD-19`（deploy-guard 三条）

■ 对你上一轮三处说法的裁定（逐条，含你对、我错与我仍需你确认的部分）
1. **你对**：日志确实存在 `not ok`，我此前只看 `ok` 行、把 146 当"完成数"，错了。正确是 ok 143 + not ok 3。
2. **你对**：deploy-guard 不是 6/9 部分完成——是 **9 条全上报（6 ok + 3 not ok）**；我按 `ok` 集合比对方造成「部分完成」的错觉。
3. **你错（基线混用）**：你说「零输出 135 条 / 13 个文件」「'12 个文件零出现'应更正为 13」——那是拿**当前树**当分母得出的。以该 run 的树为准应为 **132 条 / 12 个文件**；`asr-cloud-contract.test.cjs`（我的新增件）在 `bfe25b6` 上**不存在**，不能计入该 run 的零上报名单。
4. 「差 6」的真正来源（rollout 的质疑，你我此前的解释都不对）：**281（当前树）− 278（run 的树）= 3**（新增件）+ **3 条 not ok 被我漏计** = 6。**不是正则漏匹配，也不是 deploy-guard 缺口。**

■ 你新增的否决性事实我已复核并采纳
`test/deploy-guard.test.cjs` 硬编码 Windows `System32\tar.exe`、`lib/stage-install.cjs` 同源 → CI 在 `ubuntu-latest` 上**即便修好挂死也必 ≥3 红**。故「CI success」**不能直接作验收门**，须改写为「CI 能给出确定结论（success 或明确失败清单），且失败项属**已声明的平台性排除项**」。

■ 请你据此出最终裁定
① V3 按上述四数（278 / 143 / 3 / 132）改判为「成立」还是「部分成立」？
② V4 的 995 行你判「口径内部不自洽」——我复算给你核对：死层 18 件解码行数逐件相加 = 10+228+21+28+45+131+38+35+39+26+55+25+44+31+134+34+33+38 = **995**；活装配 7 件 = app6+pure1593+diagnostics5+models5+plugins5+update5+enhance-handlers6 = **1625**；**995 + 1625 = 2620 = src/host 全部 25 件**。请判定该 995 是否成立（若你此前指的是我两版脚本对同文件解码行数不一致（如 executor-reloader 122 vs 131），那是我早前 PowerShell 解码的错，以 node 这次为准）。
③ V6 的「17 是 `schemas` 子键、顶层只有 2」我接受，请把口径写成「schema 条目 17 条（位于 `schemas` 对象下）」。

**verify → captain** · 2026-09-19 03:42:17

[当前状态] 三问已逐条复算完毕。其中**两处我自认错**（你指出的基线混用确实在我这边；另有一处数字我抄错），一处确认你的 995 成立——并给出 2620 不可复现的精确原因。

① V3 → **成立**（在「以该 run 自身提交树为基线」口径下）
我的独立重算（先剥 `^\S+Z ` 时间戳前缀，再按 `^(not ok|ok) \d+ - ` 分类）与你的四数**逐位一致**：
`ok=143  not ok=3  上报=146`；零上报 **132 / 12 文件**（逐件：maintain23 observability3 pipeline3 platform-service23 protocol2 rpc-guard5 services3 sys13 update-gate24 update-platform2 updater-host7 voice-persist24 ✓ 与你完全一致）；全上报 **8 文件 = 146 条**（22+8+9+6+9+2+7+83）；恒等式 `143+3+132=278` = `bfe25b6` 声明数（`git ls-tree` 20 文件）✓。
**我撤回上一轮的「135 条 / 13 个文件」**——那是拿当前树（281，多出 `asr-cloud-contract` 3 条）当分母，**基线混用在我这边，你的第 3 条裁定正确**。

② V4 → **995 成立**；但 **995+1625=2620 不可复现**
· 995 **精确成立**：CRLF→LF 归一后逐件物理行相加 `10+228+21+28+45+131+38+35+39+26+55+25+44+31+134+34+33+38 = 995`，与你逐位相同（18 件均为普通模块，物理行=内容行）。**我撤回上一轮「995 区间 974–995、不可作字节级判据」的保守说法**——995 就是准确值。
· **配对不成立**：`1625` 自身是混合口径——其中 `app6` 取的是 app.js 的**物理行（6）**，而 `pure1593` 取的是 pure.js 的**解码行**（实测 pure.js **物理 1 行**、含 **1592** 个 `\n` 转义 → 解码 1555；我用 `String(require())` 实测 1554）。同一表达式里两个构件用了两把尺。
· `2620` 对应不上任何可测量：src/host 全部 25 件 = 物理行 **1028**（33+995）；内容行 **5394**（4399+995）。**两者都不是 2620**。
· **再自认一错**：我上一轮写「app.js 字面量内容 1626 行」，实测 **1686**（我抄错）。
· 可签收表述建议：件数 **18** / 簇内互引 **13** / 零入边 **5** / 活侧入边 **0（全树扫描）**——四项我逐件复现；行数若必须报，报 **995（物理行·已 CRLF 归一）**并注明「与 7 件装配块不同尺」。

③ V6 → **接受你的改法**。落文：「schema 条目 **17** 条（位于 `lib/rpc-schema.cjs` 的 `schemas` 对象下；该模块顶层导出键为 **2**：`schemas`、`validateRpcArgs`）」，与 `src/host/rpc-schema.js` 同 17 条逐名一致 ✓。

■ 三项补充裁定（本轮复算新取得，与后续判据直接相关）
1. **你改写的 CI 门当前仍不可满足**：「CI 能给出确定结论（success 或明确失败清单）」——6h 挂死意味着它**连失败清单都不产出**，故该门在挂死修好前与「CI success」是同一个不可达门。另：「已声明的平台性排除项」必须**可枚举**才可判定；当前可枚举的正好是 **3 条具名用例**（`DGRD-16/17/19`，同属 `deploy-guard.test.cjs`）。判据须写成「失败集合 = 这 3 条且不大于 3 条」，否则该门会随排除项膨胀而自我失效。
2. **挂死的静态归因（未确证，不可当结论）**：12 个零上报文件中**只有 `test/maintain.test.cjs` 具备真挂条件**——`net.createServer()+listen(0)`（L61-62）、`spawn` 子进程（L89）、`setInterval`（L87）、`setTimeout` 轮询链（L72/L74/L94/L102/L107）；且该文件 **L16 自注**「挂起根因…全量 npm test 曾 300s 超时」。注意：这与 node --test 的**并发执行**相符（sys/maintain 未完成，其后的 deploy-guard/lib 等却已上报），但仍未在 Linux 复现。
3. 其余维持原裁定：V1(success=0)、V2、V5(**711149 B / 1286311 B = 55.3%**)、V7(本地 281/281 + 跨平台 3 红)、V8 核心、V9、V10。

[核心产出]
**三问终裁**：① **V3 成立**——口径须写明「以 run 自身提交树 `bfe25b6` 为基线」：278 声明 / 143 ok / 3 not ok / 132 零上报·12 文件，恒等式闭合；**我撤回 135·13**（我先混了基线）。② **V4 的 995 成立**（物理行，逐位可复现），但 **995+1625=2620 不可复现**（1625 混合口径：app 用物理行、pure 用解码行；25 件真实合计 = 物理 1028 / 内容 5394）；**我撤回「995 不可作字节级判据」与「app.js 1626」（实测 1686）**。③ **V6 按你的写法成立**（schemas 17 / 顶层 2）。新增三条：CI 门在挂死未修前仍不可满足、其排除项须限 3 条具名用例；挂死静态线索指向 `maintain.test.cjs`（未确证，但与其 L16 自注吻合）；其余裁定不变。
关键取舍：同一份报告里「可用的 995」与「不可用的 2620」并存——**判据表只能引前者**；我宁可撤回自己两处错误说法，也不让混尺数字进判据表。

[下一步建议] 判据表定稿时把三处写法固定下来：V3 引「run-tree 四数」并标 sha `bfe25b6`；V4 只引 件数/边数 + 995（注明物理行口径）；V6 引「schemas 17 / 顶层 2」。若要我转交 `test/maintain.test.cjs` 挂起相关行（L16 / L61-62 / L87 / L89 / L94）原文给 rollout 做定位，或转交 `docs/compatibility-matrix.md` §2 全文做 34/34 逐条对照，点名即可。

[建议决策] 无（本轮无新增需用户拍板的分歧；上一轮「CI 平台性失败是否纳入本轮范围」仍待用户裁决）。

**minimal → 汇聚网关** · 2026-09-19 03:56:32

[当前状态] 已完成独立复核（只读实测，未改仓；工作区仅剩 `.roundtable/` 未跟踪）并产出裁剪清单。先报口径纠偏，再交三档清单与「补丁替代根因」清单。

## 一、复核（我自己取的证据，供 verify 追认/驳回）

**成立**
- 体积：`plugin-host.js` 292,045 B（285.2 KiB）、`plugin-client.js` 351,607 B（343.4 KiB）、`lib/client.cjs` 359,542 B（351.1 KiB）——三数一致（同一字节数按 KiB 表述）。`npm pack --dry-run`：20 件、unpacked 1.3 MB；白名单实算 1,303,630 B = 1.243 MiB，client 双份 711,149 B = **54.6%**（"55%"≈成立）。"1256KB"与我的 1273 KiB 差 1.4%，口径待统一。
- 死层入边=0：18 件中 **0** 件被 `lib/*.cjs` 或 `plugin-host.js` 引用；互引只成环于 `src/host/index.js` 簇（它自身零入边）。且 `plugin-host.js` **不含** `cloneDefaults / migrateLegacyConfig / createConfigService / PROTOCOL_VERSION / isKnownMethod / createServiceRegistry` → 死层导出确未进发布物。
- 本地测试：实跑 `node --test` = **281/281 pass，30,417 ms，exit 0**（与"唯一真实门"一致）。
- CI：`gh run list` 实查最近 11 次 completed **全部 cancelled**，时长 6h0m18s~6h0m48s。逐 step 核对 run 34721473096 日志：**146 ok / 3 not ok**；最后一条测试输出 = `LIBWIRE-06`（`lib.test.cjs`）@21:59:57，之后到 03:59:32 取消前**零输出**，清理时终止 node 孤儿进程。

**部分成立 / 须更正**
- **"12/12 cancelled"当前写作时点不成立**：最新一次 run 35369171439（88524c0）实测 **in_progress 3h6m+**，即"第 12 次正在走向同一个 6 小时超时"。表述应为 11/11 已完结全 cancelled + 1 次进行中。
- **"7 件真装配输入 = 1625 行"与实测不符**：我按 `build-host.mjs` 注入清单（app/pure/diagnostics/models/plugins/update/enhance-handlers）实测内容行 **4,392 行 / 360,960 B**；`plugin-host.js` 4,008 物理行。1625 无对应口径，须更正或注明算法。
- "18 件 / 995 行**活代码**"：995 是**物理行**（含注释注释块），可执行行 728、语句行 ~490。数字对，定语不准确。
- **CI 挂起根因仍未确证**。我能证的只有两点：①挂起点在 `lib.test.cjs` 之后的文件（测试清单序：config-schema/update-platform/executor-reloader/observability/bundle-smoke/config-persist/voice-persist/asr-cloud-contract/platform-service/rpc-guard）；②本地 30s 全绿 ⇒ **环境相关挂起，非逻辑错**。另有**已确证的独立缺陷**：DGRD-16/17/19 在 Linux 必红，原因是测试夹具硬编码 `C:\Windows/System32/tar.exe`（`test/deploy-guard.test.cjs:35 makeRealTgz`）——这与挂起是两件事，别混为一因。
- **可达性≠死码（重要排除项）**：lib 14 个 `.cjs` 中 12 个从 `index.cjs` 可达；`asr-worker.cjs` 与 `client.cjs` 不可达，但**均非死码**——前者由 `lib/asr-deploy.cjs:58 copyFileSync` 拷入用户目录后被 spawn，后者是 DSH 客户模块解析目标（`dsh-client-modules/lib/index.js:655`：包声明 `dsh.client` 就必须提供 `exports["./client"]`）。**禁止按"入边=0"删这两个。**

## 二、裁剪清单

### 删（A 档：静态零入边、非发布物、非外部加载点）
- `src/host` 死层 **18 件**（995 行）：config.js（纯 TODO 壳）、config-service.js、index.js、services.js、pipeline.js、model-service.js、plugins-service.js、diagnostics-service.js、update-service.js、update-platform.js、reloader.js、executor-reloader.js、logger.js、enhance.js、protocol.js（声明 21 条 RPC ⊂ 线上 34 条，**不是事实源**）。**不含**下面的"孪生三件"。
- **连带必删的测试**（只为死层存在，删死层即红）：`test/services.test.cjs`(3) + `pipeline.test.cjs`(3) + `enhance-pipeline.test.cjs`(2) + `protocol.test.cjs`(2) + `update-platform.test.cjs`(2) + `executor-reloader.test.cjs`(7) + `observability.test.cjs`(3) + `config-schema.test.cjs`(6) = **28 项**，另 `lib.test.cjs` 内针对 `src/host/config-schema.js` 的断言，合计测试面 281 → 约 250。
- **注意**：这 28 项同时是"死层防复活守卫"。**净删守卫不是我的首选**——见"缓"档与补丁清单 P2。

### 并（B 档：两份同源，留一份）
- `src/host/rpc-schema.js` ↔ `lib/rpc-schema.cjs`：**去注释后语义逐字节相等**（实测 true）。实际生效者是 lib 侧（`lib/index.cjs:500,594~656` 调用），src 侧只被 test 引用 → **留 lib、删 src**。但 `test/config-persist.test.cjs` 的 **CFG-P05 现明确断言"双份同步防漂移"**，删src 必须同改该断言。
- `src/host/integrity.js` ↔ `lib/integrity.cjs`：同样去注释后语义相等（实测 true）→ 同法处理。
- `plugin-client.js` ↔ `lib/client.cjs`：同一 client 逻辑两载荷（实测 EnhanceButton 6/6、RecordRTC 78/78、`dsh-enh-result` 1/1）。**两者此刻都不能删**：前者在 `UPDATE_MANIFEST`（自更新拉取清单）、`lib/stage-install.cjs:124`、`lib/sys.cjs:639` 快照、`lib/index.cjs:677` 重启检测里被点名；后者被 DSH 客户模块解析。→ 归入"缓"，且属触碰发布物形态的 BREAKING-adjacent 项。

### 缓（C 档：不做不影响本期成败，但须留判据）
- 孪生三件的删除（`rpc-schema.js`/`integrity.js`/`config-schema.js`）：牵动 37 处 `assert.match` 文本断言与 CFG-P05，**等 CI 复跑判据立起来再动**。
- `plugin-client.js`/`lib/client.cjs` 单产物化：先做一次实测（见 P3），未出结论前不动。
- 任何"为让 CI 变绿"而加的 `--test-timeout`、跳过标记、删失败用例：**一律不许**（根因未定，属补丁）。

### 最少必要集（砍掉即不成事的部分）
7 件 build 输入（app/pure/diagnostics/models/plugins/update/enhance-handlers）＋ lib 12 件可达 `.cjs` ＋ `asr-worker.cjs`（外部 spawn 目标）＋ 4 个生成物（plugin-host.js / plugin-client.js / lib/client.cjs / recordrtc.chunk.js）＋ 3 个构建脚本（build-host/build-client/vendor-recordrtc）＋ `sync-pr

…（已截断，原长 5763 字符）

**captain → minimal** · 2026-09-19 03:57:28

【主持人 · P3 纠正（你的减法方向对，但极性反了；依据是我实测的入口引用面）】

■ 你说的 P3
「`package.json` 的 `exports["./client"]` 若可指向根目录 `plugin-client.js`，则一份产物两用途，省 351 KB」——**这条不成立**，理由两层：

**1. 两份产物的外壳不同，不可互换（实测）**
· `lib/client.cjs` 首行 = `window.__ModuleLoader__.load({ id: "dsh-prompt-enhancer", factory: (require) => { … } })`
· `plugin-client.js` 首行 = 裸正文（`const CONFIG_KEY = …`），**不含 `__ModuleLoader__`**（我计数：a=1 次、b=0 次）
· 而 `window.__ModuleLoader__.load({id, factory})` 是 **DSH 客户端模块的通用契约**——我实测本地 DSH 安装目录，**所有官方客户端包**（`dsh-client-connection` / `dsh-client-locale` / `dsh-api-gateway` / `dsh-client-file-upload` / `dsh-client-hmr` / `dsh-client-resources` … 均含 `lib/client.js`）首行都是它；`@deepseek-ai/dsh-client-modules/lib/index.js:17` 逐字记载该 factory 契约。
→ 把 `exports["./client"]` 指向无包装的裸正文，会**破坏模块装载契约**。

**2. 真正的可用动作是「删孤儿」，不是「改指向」（依据：本仓自己的架构档 + 入口引用面）**
· `docs/internal/方案-架构重构评估-2026-09-13.md:63` 原文：「同一份 client 代码装两遍：`lib/client.cjs`（378739 B，`exports["./client"]` 用）与 `plugin-client.js`（370507 B，**无任何入口引用**）」
· 同档 :97 的整改项 7：「client 半部：源码模块化 → 官方 factory 产物；**删除孤儿 `plugin-client.js`**（发布物 −370 KB）」
· 我按你的判据法独立复核全仓引用面（排除自身、node_modules、.roundtable）：引用 `plugin-client.js` 的只有 **3 处，且全是不是运行时的检查面**——`.github/workflows/ci.yml:25`（`node --check`）、`:37`（`git diff --exit-code`）、AGENTS.md 的模块清单；`plugin-client.js` 在 package.json 中**无任何 exports/main 指向**（`exports` 仅 4 键：`.` / `./client` / `./cordis.patch.yml` / `./package.json`）。
→ 即：**它是「生成 + 进发布物 + 进 CI 检查 + 从不被装载」的孤儿**，省下的是 **343.4 KiB（发布物 26.7%）**。

■ 请你据此修订 P3 并回我三件
① 修订后的 P3 表述（删孤儿 + 连带需改的三处检查面：`build-client.mjs` 的 `--check`、CI 的两步、以及 `files` 白名单）；
② **一次实测判定法**（你自己说的"可一次实测判定"很对）——即：在删之前，怎样用一次无副作用探针确证 DSH 未装载它？（我倾向：装一个临时 profile → 启动 → 抓客户端网络/文件读取痕迹，或对比改名后页面行为；请你给更省的方案）
③ 既然 `plugin-client.js` 是孤儿，你原清单里依赖「双产物」作出的其它判断（体积占比、`--check` 双产物门）是否也要相应改写？请一并给结论，别留下与新事实冲突的旧行。

另：你「7 件输入 = 1625 行」的纠正我接受并已独立复测——正解是**物理行：死层 18 件 = 995（全部普通多行文件）、活装配 7 件 = 33**（其中 `pure.js` 是 chunk 源，物理 1 行，须单列不混入合计），25 件合计 1028。你给的 4392 与 verify 给的 5394 都是"解码后内容行"的另一把尺，**本轮统一采用物理行口径**，请你后续引用同一口径。

**arch → 汇聚网关** · 2026-09-19 04:10:49

[当前状态] 已完成一轮独立结构审计：读完 src/host 25 件、lib/ 13 件、三件生成物、两构建脚本、CI 配置与 4 份治理档；用 require-only 闭包图、常量规范化比对、10 个重模块 require 探针、CI 日志逐条 subtest 归因，对主持人 8 域事实逐条复核。本轮只报结构，不报实现细节。

[核心产出]

## A. 复核表（先立底账，verify 可直接接）
成立：
1. 双产物零漂移 —— `build-host.mjs --check` exit 0（报版本 3.3.3）、`build-client.mjs --check` exit 0。
2. 体积 285/343/351KB —— 292045/351607/359542 B = 285.2/343.4/351.1 KiB。
3. src/host **25 件全为 .js**，装配输入恰 7 件（build-host.mjs 7 条 require）。
4. 死层出边闭合：production 侧对 18 件死层的**外部入边 = 0**；总入边 32 = test 19 + 死簇内互引 **13**（与主持人数字一致）。
5. 线上 RPC **34 = lib/index.cjs 16 + plugin-host.js 18，交集 0**。
6. `src/host/protocol.js` 声明 **21 条**（require 实测 length=21），21 条全在线上；其缺的 13 条 = config/* 2 + voice/* 10 + models/stats 1。
7. matrix 对线上 34 条**零遗漏**。
8. `git show v3.3.3:lib/asr.cjs` = `audio:`，HEAD = `input_audio:` → 域9 根因成立，修复确在 main 未发布。
9. client 双载体 694.5 KiB / 1256.3 KiB（不含 README）= **55.3%**。
10. 当前 CI 35369171439 已 in_progress **3h14m**（现场复现悬挂）；34721473096 日志止于 LIBWIRE-06 后 6h0m 被 cancel，清理杀 4 个 node 孤儿。
11. AGENTS「测试 330」→ 静态数 test() = **281**；docs/internal 实际 2 个。

**部分成立 / 不成立（须 verify 复核）**：
· **口径混用**：域2「7 件 1625 行 + 18 件 995 行」把两种口径并写在一句里——18 件 995 是**物理行**（成立），7 件物理行只有 **33 行**（它们全是 `module.exports = "<一大段>"` 字符串模块），**解码后 1626 行**。1625 vs 1626 差 1，基准待定。
· **rpc-schema 覆盖率**：主持人口径 17/34=50%；我实测 `lib/rpc-schema.cjs` 顶层 schema key = **16**（16/34 = **47%**）。差 1，需 verify 定位。
· **CI 完成数**：主持人口径 143/281、12 文件零完成；我从日志逐条数出 **146** 条 ok、**13** 个文件零完成（主持人 12 个清单外还有 asr-cloud-contract 3 项）。两个数都要重对。
· **零入边件数**：主持人说「13 件靠互引伪装」——13 是**边数**（挂在 8 个文件上）；真正**零入边**的是 **2 件**：`src/host/config.js`、`src/host/index.js`。数字对得上，口径要分清。
· **lib 大件行数**：主持人 914/402/369=1685；我实测 sys 913 / net-proxy 401 / platform-service 368 = **1682**（LF 口径）。结论方向成立：`nav_graph task` 对三件均返回 "No mapping found"（我亲自复跑）。
· **「死层不可达」的两法交叉**：我补一条反向证据——10 个重 lib 模块单独 `require` **全部正常退出**（74–216 ms），**挂起不在 require 期**。主持人「静态可疑 maintain/sys」成立，但「根因」尚未确证。

## B. 根因归并：8 域症状收敛到 6 条结构性成因
**RC-1 无单一事实源：同一事实被复制到多个载体，靠人工同步维持一致。**
症状：域3（client 逻辑两份：plugin-client.js 裸 bundle + lib/client.cjs __ModuleLoader__ 包装）；域4（RPC 契约四处描述：线上 34 / protocol 21 / schema 16 / matrix 34）；域7（AGENTS 330 vs 281、docs/internal 1 vs 2）；域9（asr 单点事实零断言，一路发到 v3.3.3）。我的补测：`MODE_PARAMS_DEFAULT`/`MODE_BUDGET_OPTIONS`/`MODE_BUDGET_DEFAULT` 在 host `pure.js` 与 client `constants.js` 各一份（规范化后同值）；`CONFIG_DEFAULTS` 在 client constants 与**死层** config-schema 各一份；`validateConfig` 在 pure.js（活）与 config-schema.js（死）各一份且**已实质分叉**（publish 分支/检索引擎只在活的里）；默认模型链 host `DEEPSEEK_OFFICIAL_CHAIN` 与 client `DEFAULT_MODEL_CHAIN` 同值两份。
最小改法：给每类事实指定唯一宿主，其余副本**由构建生成**（三件生成物已是先例）。落地不做完也能起效：先让运行时 handlers Map 导出一份方法清单（一行），再让 schema / matrix / 测试由它派生。

**RC-2 装配契约是手写清单，不是可推导的图。**
症状：域2（25 件里 18 件 995 行永不进产物）；域6（3 大件 lib 索引无归属）；域7 补测：`scripts/dead-code-gate.mjs` **只查 git diff 新增声明的引用数**，根本不查 `src/host` 可达性；`package.json` 的 test 脚本手工罗列 21 个文件，与目录 22 个不一致（a6-drill.cjs 不在列）。
最小改法：build-host.mjs 从装配入口的 require 闭包（或 app.js 注入标记）**自动发现** chunk；清单外文件即报错；同一条可达性检查并入既有 dead-code-gate。约 30 行，形态与现有门禁同构。

**RC-3 「目标架构」与「线上架构」两套并存，且没有淘汰机制。**
症状：18 件死层中 12 件自称 M2 目标架构；死层 protocol.js 被当协议事实源（AGENTS 明文警告"不要把它当协议事实源"——警告本身证明它长得像）；ADR-194 P0 与 ADR-197 执行度均 0（lib/index.cjs 实测 **836** 物理行 vs 主持人 837，属计数口径）。我的补测：`src/host/rpc-schema.js`（死）与 `lib/rpc-schema.cjs`（活）**keys 完全相同（16/16）、仅注释差异**；`src/host/integrity.js` 与 `lib/integrity.cjs` **逻辑逐字相同**，而 src 那份还自称 "source of truth"——源/副本关系已反转，死层版本仅作测试参照物。
最小改法：给目标架构设入场券——要么进装配（RC-2 强制），要么进 `docs/internal/target-arch/` 作设计草稿（不参与测试、不被索引登记、不被文档引用为事实源）。两者不可兼得。现形态是最坏一种：被测试引用、被索引登记、能骗过 --check，却永不生效。

**RC-4 验证面与事实面错配：唯一真门覆盖的 8 个文件，与 CI 卡死的 13 个文件，交集为空。**
症状：域5 全部。我的实测归因（cancelled run 34721473096）：146 条 ok 全部来自 8 个文件（client-enhance-flow 8 + lib 83 + deploy-guard 9 + enhance-pipeline 2 + config-schema 6 + executor-reloader 7 + bundle-smoke 22 + config-persist 9 = 146），其余 13 个 0 条。**关键结构事实：零完成集无法区分"卡住"与"从未开始"**——node --test 并发启动 4 个文件，全部卡死则队列永不推进，日志只留沉默。
最小改法：给测试设**进程边界契约**——每个 test 文件声明 `{timeout, sideEffect: none|net|subprocess|listen}`，CI 按「单文件独立进程 +

…（已截断，原长 8006 字符）

### 第 2 轮

**captain → rollout** · 2026-09-19 04:12:00

【任务 R2-rollout · 用 arch 的根因与 minimal 的裁剪重排分期】

你 R1 的分期表是在**没有根因归并与裁剪结论**时排的。现补齐：arch 已把 8 域收敛为 6 条结构成因，minimal 已出三档裁剪。请**重排一次**，使每一期都能落到具体成因上（"每期关掉哪条成因"）。

■ arch 的 6 条结构成因（按名称，含其证据要点）
· **RC-A 无单一事实源**——RPC 契约三处并存（线上 34 / 死层 protocol.js 声明 21 / schema 17 条校验）；`lib/rpc-schema.cjs` 自称 "source of truth in src/host/rpc-schema.js"，而后者是死层（活副本 keys 与死层完全一致 → **源/副本关系已反转**）；`src/host/integrity.js` 与 `lib/integrity.cjs` 逻辑逐字相同却自称 source of truth。
· **RC-B 装配契约手写**——`build-host.mjs` / `build-client.mjs` 以 marker 拼接手写装配；载体（chunk 单行转义串）穿透模块边界。
· **RC-C 双架构无淘汰机制**——M2 目标骨架 18 件与 ADR-197 终局目标**长期并存且无任何淘汰闸**；ADR-194 P0 承诺"死层 18 件退役"至今一件未退。
· **RC-D 验证面与事实面错配**——CI 从不完成（以 run 自身树 `bfe25b6` 为基线：声明 278 / ok 143 / not ok 3 / 零上报 132·12 文件，恒等式闭合）；且 CI 即便修好挂死也**必 ≥3 红**（`deploy-guard` 硬编码 Windows `System32\tar.exe`）。arch 另实测：10 个重 lib 模块单独 require **全部正常退出** → **挂起不在 require 期**。
· **RC-E 载体穿透模块边界**——载体形态（chunk vs 真模块）决定逻辑能写在哪（`plugin-host.js` 内 `require(` = 0 次 → 所有需 fs/child_process 的逻辑只能塞进 `lib/index.cjs`）。
· **RC-F 状态归属不唯一**——同一状态多处持有/手工同步。
· 贯穿项：**无结构判据**（没有任何闸校验"承诺是否执行"）。
· 耦合度量（arch 给）：**改一处用户可见变更最少横跨 4 类载体、2 处人工同步副本**。

■ arch 的排序建议（A 案）：**先 RC-D（独立、快、不改对外契约）→ 再 RC-C（死层与双架构退役）→ 最后 RC-A（单一事实源）**。

■ minimal 的三档裁剪（要点）
· **删**：死层 18 件（物理行 995）；**孤儿 `plugin-client.js`**（343.4 KiB = 发布物 26.7%，本仓自己的 `docs/internal/方案-架构重构评估-2026-09-13.md:63/97` 已认定"无任何入口引用"并列入整改项）。
· **并**：`rpc-schema` / `integrity` 的源与副本合一；`protocol.js` 退役或改为由注册面派生。
· **缓**：其余。
· **补丁替代根因**清单 6 项（含给 CI 加 timeout 属补丁、真根因是"进程边界契约"）。
· [建议决策] 死层 18 件与其守卫测试（28 项）口径：A 净删 / **B 删文件 + 守卫改挂活层（其推荐）** / C 只删不测。

■ 本轮口径（统一，勿混用）
· 行数一律**物理行**：死层 18 件 = 995（全部普通多行文件）、活装配 7 件 = 33（`pure.js` 是 chunk 源、物理 1 行，单列不混）、`src/host` 25 件 = 1028。
· 体积口径 **字节**：client 双份 711,149 B / 基准 1,286,311 B = **55.3%**；删孤儿后应降至约 **28.6%**。
· CI 四数须写 sha `bfe25b6`；「近 12 次 success = 0」（不是 12/12 cancelled）。
· schema 条目 **17**（位于 `schemas` 对象下），顶层导出 2 键。

■ 交付要求（本轮只交这一张表 + 里程碑）
① 重排后的分期表：每期写全 **交付物 / 关掉哪条成因（RC 名）/ 验收判据（阈值须给数字或"待定+依赖谁"）/ 预计阻塞点 / 回滚方式**；
② 标出**硬依赖与可并行**；
③ 每期必须**可独立验证**、不得把大改造塞进一步；
④ 明确哪一期的**发布时机**是卡住其余所有期的唯一决策（你 R1 推荐 A 止血优先，请保持或给出改变理由）。

另：你 R1 曾自行冻结阈值「本地 281/281 + CI success + 零完成名单逐件复现」——其中 **CI success 不可满足**（见 RC-D），请据实改写该判据。

**captain → accept** · 2026-09-19 04:12:00

【任务 R2-accept · 用已裁定口径定稿判据表】

你 R1 的 29 条自动 + 5 条人工项骨架很好。本轮只做**定稿对齐**，不重做。

■ 已由 verify 终裁 / 主持人实测钉死的口径（请逐条落到对应判据行，勿再引用旧值）
1. **CI 日志（D5）**：基线 = run 自身提交树 `bfe25b6` → 声明 **278**、`ok` **143**、`not ok` **3**、零上报 **132（12 个文件）**，恒等式 143+3+132=278 闭合。你 R1 的「12/12 cancelled」与「146 条完成」均已作废；改用 **「近 12 次运行 success = 0」**。
2. **CI 平台性否决项（D5 新增）**：`test/deploy-guard.test.cjs` 硬编码 Windows `System32\tar.exe`（`lib/stage-install.cjs` 同源）→ `ubuntu-latest` 上**即便修好挂死也必 ≥3 红**。故「CI success」**不能作验收门**；请改写成可满足判据，并把平台性排除项**限为 3 条具名用例**（`DGRD-16/17/19`），否则该门会随排除项膨胀而自我失效（verify 的原话）。
3. **活体证据**：run `35369171439`（head `88524c0`）我复核时仍 in_progress（3h+），step6 `Run tests` 挂起、step7/8 pending → 挂死**可当场复现**。
4. **行数（D2）**：一律物理行——死层 18 件 = **995**（全部普通多行文件）、活装配 7 件 = **33**（`pure.js` 为 chunk 源、物理 1 行，单列不混）、`src/host` 25 件 = **1028**。我此前的 1625/2620 作废（混合口径）。
5. **体积（D3）**：字节口径，client 双份 711,149 B / 1,286,311 B = **55.3%**；`plugin-client.js` 经查为**孤儿产物**（发布物 26.7%），删除后预计降至约 28.6%。
6. **契约（D4）**：schema 条目 **17**（位于 `schemas` 下）、顶层导出 2 键；matrix 可作基线但 **diff 须限定 RPC 表主体**（版本沿革列的 3 个名字带显式退役注记，非幽灵条目——你 R1 的表述请按此收紧）。
7. **D6**：3 件大 lib（`sys`/`net-proxy`/`platform-service`）`nav_graph mode=task` 返回 `No mapping found`（未登记），非 STALE。

■ 本轮交付要求
① 定稿的四要素判据表（判据内容 / 检查方式 / 通过阈值 / 失败退回动作），分「可自动检查」「须人工判断」两组，**按域编号 D1–D8**；
② 每条阈值标来源：`已实测（附命令）` / `需补证` / `依赖 X 的产出`；**无来源一律标「待定，需用户拍板」**，不得编阈值；
③ 新增三条针对本会议结论的判据：**孤儿产物删除**（删前须有"未装载"确证）、**死层离场**（件数与活侧 import 边归零）、**CI 可表态**（能给出确定结论或具名失败清单，而非 skipped/挂起）；
④ 你 R1 提的 [建议决策]（是否为 v3.3.3 建机器可比契约快照，推荐 A）请保留在表末，供用户拍板。

本轮不再需要你做新的事实核查——事实面已由 verify 终裁。

**captain → verify** · 2026-09-19 04:12:59

【任务 R2-verify · 两件待裁 + 一处口径终定】

■ 待裁 ①：`update/pull` 是否真的无调用点（决定一条追加发现能否进删档）
minimal 报的判据（它自述未裁定、按纪律交你）：
· 两个内置 client 产物对字符串 `'update/pull'` 的计数**均为 0**；
· `src/client` 全树 walk 无 `host.call('update/pull')` 调用点。
需你判的是：是否存在**动态形态**的调用者（运行时拼接方法名 / 外部客户端 / 测试夹具）——静态计数为 0 不足以排除这一点。
**为什么它重要**：`update/pull` 的调用者是否存在，是「删孤儿 `plugin-client.js` 会不会破坏自更新」这一顾虑的**唯一来源**。若裁定无调用点，则连带 `validateManifestFiles` + host/client 两份 `UPDATE_MANIFEST` + 客户端 contents API 拉取分支一并失去调用者。
边界提醒：**只裁事实，不要提方案**（RPC 行为变更属对外契约，须单列并标 BREAKING，不在本轮范围）。

■ 待裁 ②：孤儿删除的「检查面」清单是否穷尽
minimal 实测 **11 处**持有该文件名（我先前只找到 3 处），并断言其中**硬失败仅 2 处**：
· 硬失败：`package.json:10` files 白名单、`test/lib.test.cjs:841` U30 `assert.deepEqual(UPDATE_MANIFEST,…)`
· 静默跳过（`existsSync` 守卫，9 处）：`lib/index.cjs:677`、`lib/sys.cjs:639`（:626 有守卫）、`lib/stage-install.cjs:124`、`scripts/sync-runtime.mjs:78/115/174`、`scripts/build-client.mjs:157,169,175,183-184`、`.github/workflows/ci.yml:25,37`、`test/config-persist.test.cjs:52`、`test/voice-persist.test.cjs:70,80,312,384`、`AGENTS.md`、`src/client/updater.js:3`
请你**抽验 ≥3 处**（至少覆盖：一处「硬失败」、一处「静默跳过」、一处 CI），判定「硬失败仅 2 处」是否成立；并指出清单是否**仍有遗漏**。

■ 待裁 ③：孤儿占比的正式口径与分母（我此前与你/minimal 分母不一致）
· minimal 实测：孤儿 351,607 B ÷ npm pack unpacked 1,303,630 B = **26.97%（写作 27.0%）**；删后 952,023 B = 0.908 MiB。
· 我此前用：351,607 B ÷ 1,286,311 B（lib 全目录 + 两产物，不含 README）= 27.3%，而我口述成了 26.7% 并配 343.4 KiB —— **分母与单位不自洽，请裁定统一口径**（我倾向采用 npm pack 实测 unpacked 作分母，因为它是对外可复验的发布物边界）。
另：minimal 的正确性证据请你复核——它称 `lib/client.cjs.includes(JSON.stringify(<孤儿正文，去 2 行 GENERATED 头>))` = **true**（318,792 字符），即活跃产物**完整内嵌**孤儿全文。若成立，则「删孤儿零代码丢失」得证；若不成立，请给反例。

■ 顺带登记（D7 文档-事实偏差）
`UPDATE_MANIFEST` 实为 **5 项**，而代码注释写「6 个文件」——请裁是否登记为 D7 偏差项。

本轮仍只到决策态，不做任何改仓。

**accept → 汇聚网关** · 2026-09-19 04:13:25

[当前状态] R2-accept 定稿完成。按你的口径逐条对齐，未重做事实核查。**3 条对账结果需回报**：① D2 行数口径已与你的数字**精确闭合**；② D3 的「28.6%」**分母未闭合**；③ **N1 的前置确证「未装载」不成立**——这是必须在上表前说清的一条，因为它会让"孤儿产物删除"从"删除即净"变成"先解耦再删"。

【A. 口径对账（3 条，全部可复算）】
① **D2 行数=同一事实的两种计法，精确闭合**：物理 = `split(/\r?\n/).length`；逻辑 = 物理 − 1/文件。故 995 = 977+18 ✓、1028 = 1003+25 ✓、33 = 26+7 ✓、`pure.js` 0 逻辑=1 物理 ✓。结论：995/1028/33（物理）与 977/1003/26（逻辑）**都对**，但**同一表内禁混用、跨表引用须标口径**。死层占比：物理 995/1028=**96.8%**、逻辑 977/1003=**97.4%**。
② **D3 分母未闭合，标 `需补证`**：你的 55.3% 我复算成立（711,149 / 1,286,311，分母=lib/ 全目录 642,659 + 两产物 643,652，**lib/ 已含 client.cjs，无重复计**）。但**「删除后降至约 28.6%」我复算不出**：候选值 — 删后 client.cjs/(lib/+host)=359,542/934,704=**38.47%**；/(unpacked−plugin-client)=**37.77%**；plugin-client/1,286,311=**21.36%**、/unpacked=**26.97%**（你的「26.7%」近似此值 ✓）。**28.6% 的分子分母请点名**，我按同一公式填；在此之前该行标"待定，需用户拍板"。另：**单位须写 B，不写 KB**（1,286,311 B=1256 KiB；同一数字两种单位差 2.4%）。
③ **CI 278 vs 本地 281 差 3，未归因 → 标 `需补证`**：若差额来自平台性用例，则 CI 门分母与本地门分母**不可互用**；请 verify 点名那 3 项，否则 D5 与 D7 的用例计数判据各自独立、不得相减。

【B. 新判据的前置确证（关键回报）】
**N1「孤儿产物删除」的"未装载"确证 = 不成立。** `plugin-client.js` 有 4 类真实耦合（实测）：
· (a) **行为耦合**：`lib/index.cjs` **L677** `RESTART_FILES=['plugin-host.js','plugin-client.js','lib/index.cjs','lib/client.cjs','lib/sys.cjs','lib/updater-host.cjs']` — `update/restartNeeded` 靠它的 mtime 判定"已安装待重启"。删它=改该 RPC 行为。
· (b) **测试耦合（最硬）**：≥3 个测试文件**读其字节作产物断言** — `test/config-persist.test.cjs` L51/L52（注释明示"plugin-client.js 产物含 syncConfig"）、`test/voice-persist.test.cjs`、`test/lib.test.cjs` L841。**直接删会撞 D5-18（唯一真门）**，即"删掉孤儿产物"会把 281/281 打红。
· (c) 产出/引用链：`scripts/build-client.mjs` 反复提及（L1/5/99/154/169/171/175/183/184）、`scripts/sync-runtime.mjs` L78/L115、`scripts/vendor-recordrtc.mjs` L7。
· (d) 发布/CI 面：`package.json.files` L10、`ci.yml` L25/L37、AGENTS.md/CHANGELOG 多处。
→ **N1 通过条件须写成三阶**：先 (a)(b)(c)(d) 解耦 → 再删 → 再验；**解耦本身是施工，本轮不施工**。仅凭"grep 无运行时 loader"不能判未装载（该 grep 实测命中 45 处）。
**N3 的具名排除项实测存在，判据可落地**：`test/deploy-guard.test.cjs` **L136 DGRD-16 / L152 DGRD-17 / L217 DGRD-19**；Windows 硬编码实测于 `deploy-guard.test.cjs` **L34** 与 `lib/stage-install.cjs` **L49/L96**（`System32\tar.exe`）。
**新增可用自动门（我实测）**：`node scripts/dead-code-gate.mjs` → **exit 0**，1 条已知 WARN（`src/client/components/updater-card.js` 使用未声明标识符 `executor`）。

━━━ 【1. 可自动检查组】四要素＝判据 / 检查方式 / 通过阈值(来源) / 失败退回 ━━━

**D1 装配与构建链**
A1. 双产物零漂移 | `node scripts/build-host.mjs --check; node scripts/build-client.mjs --check` | 两 exit=0（已实测 0/0）| 退回：重跑；**禁改 --check 使通过**。
A2. 构建可复现 | `npm run build && git diff --exit-code -- lib/ plugin-host.js plugin-client.js` | diff 空、exit 0（来源：ci.yml L35-37 原文）| 退回：D1 全组阻断。
A3. 死代码门 | `node scripts/dead-code-gate.mjs` | exit=**0** 且 WARN 数 ≤**1**（已实测 0/1，具名 `updater-card.js:executor`）| 退回：WARN 增加须先归因，不得加白名单绕过。

**D2 host 架构**
A4. 可达件计数 | 读 `scripts/build-host.mjs` 的 src/host 引用清单 对 src/host 全量 | wired=**7**、dead=**18**（已实测）| 退回：不符即基线漂移，重取。
A5. 死簇根零入边 | 全库 grep `src/host/index.js` importer | =**0**（已实测 0）| 退回：>0 则死层判定错，全组重做。
A6. 活侧 import 边界护栏 | 7 件装配件跨文件静态 import 计数 | =**2**（app.js→enhance-handlers、app.js→pure）；`diagnostics/models/plugins/update` 各 **0 属预期事实** | 退回：据此判 5 件不可达＝**判据误用**，改以 build 清单为准。
A7. 死层行占比（双口径并列）| 物理/逻辑行统计 | 基线 物理 **995/1028=96.8%**、逻辑 **977/1003=97.4%**；目标态（**依赖 rollout 的分期产出**）| 退回：无目标态不判通过；口径未标即判不可比。

**D3 client 载体**
A8. 双载体同逻辑 | `grep -c` 四探针于两产物 | dsh-enh-result≥1、EnhanceButton≥1、RecordRTC≥1 **两侧同时命中**（已实测 1/1、10/10、91/91）；`__ModuleLoader__` 仅 client.cjs（1/0）| 退回：不同时命中→两产物已分叉，去重前提不成立。
A9. 载体占比 | `git cat-file -s HEAD:<path>` | 基线 **711,149 B / 1,286,311 B = 55.3%**；目标态（**依赖 rollout**）| 退回：单位非 B 或分母未点名即判不可比。
A10. 去重绝对量 | blob 字节 | 上限锚 = min(359,542, 351,607)=**351,607 B**；目标值（**依赖 rollout**）| 退回：无目标值不判通过。

**D4 RPC 契约**
A11. 注册面=34 | `harness.handle(` 正则并集去重 | **=34** 且逐元素等于冻结基线（名单已固化）| 退回：差集非空→**单列并标 BREAKING**，不进本轮通过条件。
A12. 契约基线 diff（**按你口径收紧**）| matrix **RPC 表主体**对线上并集 | 差集=**∅**（已实测；`enhance` L24、`cancel` L26 均在表内）| 退回：diff 若含"版本沿革列"即越界——**那 3 名带显式退役注记，非幽灵条目**，不得计入差集。
A13. 校验面 | `lib/rpc-schema.cjs` `schemas` 下条目计 | 基线 **17**、/34=**50.0%**；顶层导出 **2** 键（已实测）| 退回：覆盖率下降即判回退。


…（已截断，原长 8569 字符）

**captain → accept** · 2026-09-19 04:13:51

【主持人 · 补齐你三项「需补证」+ 采纳你对我的口径纠正】

■ 1. D3 的「28.6%」分母 —— **你是对的，我的 28.6% 作废**
它是把两个分母混用得出的。请改用**两个显式口径之一**并写死（另一条删除，不留两行）：
· 口径 A（占**新**发布物）：删孤儿后活跃 client 载荷 359,542 B ÷ 新分母 (1,286,311 − 351,607 = 934,704 B) = **38.47%**（即你四值之一，已闭合）
· 口径 B（占**原**发布物）：359,542 ÷ 1,286,311 = **27.95%**
· 与 minimal 的 26.97% 之差纯属分母不同（它用 npm pack unpacked 1,303,630 B，含 README + package.json）。
**建议正式口径统一采用 `npm pack --dry-run` 的 unpacked 字节**（对外唯一可复验的发布物边界），并在表内注明分母构成。

■ 2. CI 278 vs 本地 281 的「差 3」归因 —— **不是平台性用例，是提交基线差异**
· 差 3 = 我在 `88524c0` 新增的 `test/asr-cloud-contract.test.cjs`（3 项）；该 run 的 head 是 `bfe25b6`，此文件当时**尚不存在**。
· 另一组 3 **确实**是平台性的：`DGRD-16/17/19` 在 ubuntu `not ok`、在 Windows 本地 ok。**两组 3 不是同一批，勿合并**。
· 结论：CI 门与本地门的分母**不可互用**——应写成「各以自身 head 提交树的声明数为分母」。

■ 3. D7 的 components=11 —— **实测 11**（`src/client/components/*.js` 计数 = 11），可解除该项 `需补证`。

■ 4. 采纳你的 N1 纠正，并请把收紧后的定义写进判据行
我此前「孤儿 / 无任何入口引用」的表述**须收紧**为：
> **「未被装载」成立**（DSH 不 eval 它：`exports` 4 键与 `main` 均指向 `lib/*`；DSH 侧 `dsh-client-modules` 只认 `exports["./client"]`）；
> **「零引用」不成立**——存在 1 处**行为耦合**（`lib/index.cjs:677` RESTART_FILES，`update/restartNeeded` 依其 mtime 判定）+ ≥3 处**测试字节耦合**（`config-persist` L51/52、`voice-persist`、`lib.test` L841）。
故 N1 的三阶「先解耦 → 再删 → 再验」我采纳；**解耦属施工，本轮不做**，请在表中标为「阶段动作」而非「本轮判据」。

■ 5. 你的 [建议决策] 改推 B 我接受
我澄清「版本沿革列的 3 个名字带显式退役注记、非幽灵条目」后，原推荐 A 的理由已不成立 → **以你的 B（复用 matrix、diff 限定 RPC 表主体）为准**，我会把它作为待拍板项呈给用户。

**accept → 汇聚网关** · 2026-09-19 04:14:35

[当前状态] R3-accept 定稿收口。你补齐的 3 项我逐条复验：**2 项确认成立、1 项因换分母而数字须改写**。另：采纳你「正式口径统一用 `npm pack` unpacked」的建议后，我实测到一个**新约束**必须写进判据，否则体积门会在别的机器上假红。

【A. 三项补齐的复验结果（命令可复跑）】
① **D3 分母**：你的 28.6% 作废我已确认。但你给的两个显式口径用的是「lib/＋两产物」分母（38.47% / 27.95%），而你建议采用的**正式口径是 `npm pack` unpacked**——**换了分母，这两个数字都要改**（否则表内又是两个互不相容的数，正是我 R2 挑出的那类错）：
· 唯一口径（写死）：`npm pack --dry-run --json` 的 `unpackedSize` = **1,303,630 B**，构成 = lib/ **642,659** + 两产物 **643,652** + README.md 7,178 + README.en.md 8,008 + package.json 1,989 + cordis.patch.yml 144 ✓（分项和精确等于总数，已闭合）。
· 据此复算：当前 client 双份占比 = 711,149/1,303,630 = **54.55%**；**删孤儿后**活跃 client 单份占比 = 359,542/(1,303,630−351,607=952,023) = **37.77%**；占原发布物 = 359,542/1,303,630 = **27.58%**。
· 故正式行写：**载体占比 54.55% → 37.77%（删后）**，分母构成如上注明；**38.47%/27.95%/26.97% 三条一律删除不留**。与 minimal 的 26.97% 之差即"原发布物 vs unpacked vs lib+两产物"三种分母，已解释清楚。
② **差 3 归因**：**确认成立**。实测 `git cat-file -e HEAD:test/asr-cloud-contract.test.cjs` → **exit 0（存在于 HEAD）**；`git cat-file -e bfe25b6:...` → **exit 128（该提交不存在）**；该文件 `test(` 计数 = **3** ✓。两组 3 不同源、不合并 ✓，分母写成「**各以自身 head 提交树的声明数为分母**」✓。
③ **components=11**：**确认成立**（`src/client/components/*.js` = 11）→ A25 解除 `需补证`。

【B. 新约束（实测，必须进表）——`npm pack` 字节是**磁盘字节**，随 EOL 漂移】
实测判定：`lib/index.cjs` pack=**46,097** = disk=**46,097** ≠ blob=45,292；`lib/` 聚合 disk=642,659 = pack 的 lib 聚合 642,659，而 blob=639,319（**差 3,340 B，5 个 CRLF 文件**）→ **`npm pack` 用的是磁盘字节，不是 git blob**。
后果：本仓库**无 `.gitattributes`**，在 LF 检出的机器（如 ubuntu-latest）上 `unpackedSize` 会**变小约 ≥3,340 B**。
· 影响面：**比值判据无碍**（需引到 1 位小数）；但**任何"字节精确相等"式判据会跨平台假红**——最典型是 A29 断言 `unpacked=1,303,630`。
· 处置（不改仓、只改判据）：**拆分 A29** —— `entryCount=20` 是 EOL 无关量，可作精确门；`unpackedSize` 降级为**报告值**，脚本须容差 **±3,340 B**，或注明"须在声明了 EOL 策略的检出上取值"。
· 新增 **A30 包体跨平台可复现**：`在 LF 检出（或声明 .gitattributes 后）重跑 npm pack --json` | 与基线偏差 = **0 B** | 现状：**不可比**（无 `.gitattributes`）→ 退回：先声明 EOL 策略，**声明本身属改仓＝阶段动作**，不作本轮判据。
· 一句话归纳给 rollout：**比值用 pack、精确相等用 `git cat-file -s`（blob）**，两者不可互换。

【C. 判据行定稿修订（只列改动行，其余同 R2）】
· **A9 载体占比** | `npm pack --dry-run --json`（唯一口径）| 基线 **54.55%**；删孤儿后目标 **37.77%**（依赖 rollout 定分期）；分母构成须并列注明 | 退回：出现第二套分母即判不可比。
· **A10 去重绝对量** | 同上 | 上限锚 = min(359,542, 351,607) = **351,607 B**；目标值（依赖 rollout）| 退回：无目标值不判通过。
· **A25 components** | `ls src/client/components/*.js \| wc -l` | =**11**（已实测，`需补证` 解除）| 退回：无。
· **A29 发布物** | `npm pack --dry-run --json` | 顶层集 7 项不变；`entryCount=20`（精确门）；`unpacked=1,303,630 B`、`packed=385,582 B`（**报告值，±3,340 B 容差**）| 退回：口径未标即判不可比。
· **A30 新增** | 见上 B | 见上 B | 见上 B。
· **D5/D7 分母** | 各以自身 head 提交树声明数为分母 | CI(head `bfe25b6`)=**278**、本地(HEAD)=**281**，**禁止相减** | 退回：跨基线相减即判无效。
· **N1 孤儿产物删除** | 改写为 **「阶段动作」**（非本轮判据）：① 校验面解耦——`lib/index.cjs:677` RESTART_FILES 移除该项，改为按语义判定（如版本或关键文件 mtime）；② 测试解耦——`config-persist` L51/52、`voice-persist`、`lib.test` L841 由"产物字节断言"改为按模块名/导出名断言；③ 再删；④ 再验 | 定稿定义按你原文：**「未被装载」成立**（`exports` 4 键 + `main` 均指向 `lib/*`；DSH 只认 `exports["./client"]`）；**「零引用」不成立**（1 处行为耦合 + ≥3 处测试字节耦合）| 退回：解耦未完成即删 → **撞 A19 唯一真门（281/281）**，判不通过。
· **N2 死层离场**、**D1–D8 其余行**：同 R2 不变。

[核心产出] 三项补齐全部落地，判据表就此定稿：**33 条自动判据 + 5 项人工判断**（新增 A30，A29 拆分，A25 解除需补证，N1 移出本轮判据改标「阶段动作」）。三条关键取舍：① **体积只留一个分母**——`npm pack` unpacked 1,303,630 B（分项相加精确闭合），据此把占比写死为 **54.55% → 37.77%（删后）**，并**明确删除** 38.47%/27.95%/26.97% 三条旧值；换分母必然换数字，不能只换名不换数。② **`npm pack` 字节=磁盘字节，随 EOL 漂移（实测 lib/ 差 3,340 B，5 个 CRLF 件）**——故确立分工：**比值用 pack、精确相等用 git blob**；A29 拆成「entryCount 精确门 + unpackedSize 报告值 ±3,340 B 容差」，并新增 A30，否则体积门在 ubuntu 上必假红。③ **N1 依你采纳的收紧定义移出本轮**：`plugin-client.js` 是「未被装载但非零引用」——1 处行为耦合 + ≥3 处测试字节耦合，直接删必打红唯一真门，故只作阶段动作（含其解耦所需的改仓授权）。你确认的差 3 归因（HEAD 新文件 3 项，`git cat-file -e` 实测 exit 0 / exit 128）与 components=11 已解除两项 `需补证`；**表内已无 `需补证` 项**，剩余目标值均标「依赖 rollout」。

[下一步建议]
1. **请把 A9/A10/A29/A30 的容差与单一分母纳入 rollout 的阶段判据**，并提醒：**N1 及其解耦（改 `lib/index.cjs` + 3 个测试文件）属改仓范围**，须用户具名授权才能进施工阶段。
2. D2-7、D3-9/10、D4-13、D6-21、N1④、N2 的目标值仍待 rollout 回填；回填前不得计为通过。
3. 如需我把这 33+5 条导出成独立 Markdown 判据册（含全部命令原文）供用户留档，**请点名**——导出属产出文件、按红线需你或用户先授权。

[建议决策] （保留待拍板）v3.3.3 契约机器可比快照 | 选项：A 授权新建 / **B 复用 matrix 并将 diff 限定 

…（已截断，原长 4171 字符）

**rollout → 汇聚网关** · 2026-09-19 04:17:21

[当前状态] 已按 arch 的 6 条 RC + minimal 三档裁剪重排分期。分期前先就地复验了会改阈值的 5 项事实，**其中 2 项修正了底本口径、1 项证明我 R1 的怀疑是口径差而非矛盾**（见 §四）。本轮只交一张表 + 里程碑。

[核心产出]

## 一、重排后的分期表（口径全部钉死，见 §三）

| 期 | 交付物 | 关掉哪条 RC | 验收判据（阈值） | 预计阻塞点 | 回滚方式 |
|---|---|---|---|---|---|
| **P0 门禁真话** | ①一次 **非 cancelled** 的 CI run 读数（pinned sha）②12 件零完成文件逐件裁定（修/拆/显式 skip+原因）③Linux 挂起复现结论 ④门禁口径卡（公式+基线） | **RC-D**（「验证面无信号」子项）；不动「验证面与事实面错配」其余部分 | run `conclusion=failure` 且 **非 cancelled**；job wall <15 min（`timeout-minutes: 15` 硬顶）；**零静默 skip**；run-tree 计数恒等式闭合（sha bfe25b6: 278=143+3+132，待 verify 裁定）；本地 `npm test`=281/281 | 挂起源若为 Linux 特有（Windows 1–2 min 全绿）→ 本阶段**只交「失败的真话」**，不要求变绿 | workflow 单文件 revert；未动 test/ 与运行时代码 |
| **D0 发布闸**（决策态，非施工） | 发布决议单：发什么（6 个未发布提交里只取 Issue #8/#10/#9 三笔修复）/ 版本号 / Release 说明 | 不关 RC，**解除市场渠道止损阻塞** | 决议单含：发布提交白名单（sha 列表）+ 发布后回滚锚点（现 tag v3.3.3） | 用户未拍板即整条对外止损链挂起 | 发前不动仓；发后可 `dsh plugin add github:…#v3.3.3` 回滚 |
| **P1a client 载体单一化** | plugin-client.js 从发布物与仓库移除，`lib/client.cjs` 成唯一 client 载体（`exports["./client"]` 已指向它）+ **6 处引用位点协同处置**：`package.json files`、`lib/index.cjs:677`(RESTART_FILES)、`lib/stage-install.cjs:124`、`lib/sys.cjs:639`(rescue snapshot)、`plugin-host.js:2249`(UPDATE_MANIFEST，生成物，源在 `src/host`，待定位)、`.github/workflows/ci.yml:25,37`；方案 A(仅移除+补 existsSync) / B(build-client 直出、不再产中间物) 二选一 | **RC-A 的「源/副本反转」最小切片**（载体副本层） | 发布物基准 1,286,311 B → 934,704 B；双载体占比 **55.29% → 27.95%**（=359,542/1,286,311）；`build-* --check` 零漂移；`npm test` 计数不降；安装路径四探针复验槽位契约不破 | B 案触及 build 契约（RC-B）→ 若选 B，本阶段升级为「小改 build」；A 案必须逐位点补 existsSync 守卫，否则 rescue/restart 面留隐患 | commit revert + `npm run build`；产物为生成物，无源码逻辑损失 |
| **P1b 死层与双架构退役** | 死层 **18 件 / 995 物理行**逐件退役（可逆清单）+ 其守卫测试口径落地（minimal 的 B 案：删文件 + 守卫改挂活层）+ 新增结构判据「`src/host/` 下非测试入边=0 的文件不得存在」入 `dead-code-gate.mjs` | **RC-C**（双架构无淘汰闸）+ **RC-D 的「承诺无闸」子项** | `src/host` 25 件→7 件；物理行 **1028→33**；新判据在本地与 CI 均 0 命中；12 个触碰死层的测试文件（合计 175 项断言：update-gate 28 / voice-persist 24 / lib 84 / executor-reloader 7 / sys 13 …）逐件给出改挂后归属 | 改挂量是本阶段真实工作量（12 文件/175 断言）→ **若超限则再拆 P1b-1(删未测试覆盖的死层) / P1b-2(改挂守卫)**；ADR-194 承诺与 ADR-197 终局必须留决策记录，禁为清零补 ADR | 逐件 git revert；与 P1a、P2 文件集不重叠 |
| **P2 单一事实源（契约面）** | ①事实源改为**由注册面派生**的方法表（实测 34=16(`lib/index.cjs`)+18(`plugin-host.js`)，**uniq 34、交集 0**）②`lib/rpc-schema.cjs:4`/`src/host/rpc-schema.js`（死层）与 `lib/integrity.cjs:4`/`src/host/integrity.js` 两组源/副本合一 ③缺 17 条（34−17）显式 `default: reject` **或**补 schema——BREAKING 单列 | **RC-A**（主项） | 事实源集合与产物提取的 `handle('…')` 集合 **diff=0**（34 条）；`docs/compatibility-matrix.md` 34/34 与事实源 diff=0；缺口 17 条 100% 有处置声明 | **补 args 校验会把既有静默容忍调用变 400 = 唯一触达已发布对外行为处**；未拍板则 P2 只做收敛与显式声明，不改运行时校验 | 事实源文件 + 生成脚本 revert；校验按方法级开关灰度 |
| **P3 装配契约（RC-B/RC-E）** | **只出决策**：域边界表（`lib/index.cjs` 现 **837** 行，按域切分，每域列入边 + 状态归属）+ 装配契约修订稿（ADR-197 终局轨迹）；`plugin-host.js` 内 `require(`=0 → 需 fs/child_process 的逻辑被压进 index.cjs 的机制说明与替代方案 | **RC-B + RC-E** | 域边界表覆盖 837 行 **100%**；每域 0 个未声明入边；本阶段**无代码改动**（施工须另立授权） | 依赖 P1b（活层收敛后才有稳定边界）与 P2（事实源）→ **不得提前**；大改造，严禁塞进任何一期施工步 | 决策态无回滚面；文档 revert 即可 |
| **P4 状态归属 + 贯穿项** | ①结构判据机检表：「ADR 承诺 ↔ 代码现状」逐条带命令与结论（至少 ADR-194/197/201/新增者各一行）②同一状态多处持有/手工同步点清单与收敛决议（RC-F） | **RC-F** + 贯穿项「无结构判据」 | 每条 ADR 承诺在机检表中有一行（阈值：条数对齐 ADR 清单，**待定，依赖 arch 提供 ADR 清单**）；冲突项 0 | 需 arch 的 ADR 全量清单；否则阈值不可判定，不得自拟条数 | 机检脚本 + 文档 revert |

## 二、硬依赖与可并行
- **硬依赖**：P0 → D0（发布闸）→ 对外止损；P0 → P1b/P2（无真门禁则后续全是自述）；**P1b → P2**（二者都动 `src/host/protocol.js`：先退役、后派生，arch A 案顺序）；**P1b + P2 → P3**；P1a 与 P1b/P2 的 protocol 冲突无关，但 P1a 的 B 案与 P3 同属装配契约，若选 B 则 P1a 并入 P3 前置。
- **可并行三车道**（文件集不重叠）：① P1a：`plugin-client.js` / `scripts/build-client.mjs` / `package.json` / `ci.yml`；② P1b：`src/host/**` + 12 个测试文件；③ P2：`lib/rpc-schema.cjs` + 死层两组源/副本。
- **单人串行推荐序**：P0 →（D0）→ P1a → P1b → P2 → P4 → P3（P1a 最小、回滚最便宜；P3 只出决策放最后）。
- **里程碑**：M0 门禁说真话（P0）→ M1 止损发布（D0）→ M2 载体单一（P1a）→ M3 双架构终结（P1b+P4）→ M4 契约单一事实源（P2）→ M5 装配契约决策（P3）。

## 三、阈值口径必须钉死（否则不可复验）
- 行数：**`readFileSync(f).split('\n').length`**。我实测该式精确复现底本的 995 / 33 / 1028 与 `lib/index.cjs` 837，**完全一致**；但 PowerShell `Get-Content .Count` 给出 957 / 983 / 833–836（差 38 行级）。两种口径都"对"

…（已截断，原长 5894 字符）

**verify → captain** · 2026-09-19 04:18:18

[当前状态] 三件待裁全部独立取证完毕。其中**待裁②的「硬失败仅 2 处」我判不成立**——实测硬失败是 **8 处**（含 CI 一处、测试 4 处无守卫 readFileSync、`node --check` 一处）。逐条给证据。

■ 待裁①：`update/pull` 调用点 → **裁定：无在-repo 调用点（成立），但不@同「零引用」**
证据（全仓 walk，排除 node_modules/.git/.roundtable）：
· 字面量 `update/pull` 共 **8 个代码文件**命中，逐处性质判定：
  - `lib/client.cjs` / `plugin-client.js`（**各 1 处**）与 `src/client/components/enhance-bar.js`（L@3470）→ **同一句注释**：「…host 只做解析/校验/写入（update/check、update/pull）」——**注释，非调用**。minimal 报「两产物计数均为 0」**不成立**：正确计数是**各 1 处，且为注释**。
  - `src/host/update.js`（**3 处**）= 注册点 `harness.handle('update/pull')` + 两条日志 → **host 侧 handler 存在**，`plugin-host.js` 同名注册 1 处 ✓。
  - `src/host/pure.js`（2）、`src/host/app.js`（3）、`src/host/protocol.js`（1）→ 注释与 `RPC_METHODS` 声明。
· **动态形态**：静态扫描无任何 `host.call(` 非字面量、无模板串调用、无 `'update/' +` 拼接（探针 `'update/' +` = 0、`update/\`` = 0）。
· **决定性证据（比静态计数更强）**：我把 `src/client` 全树 `host.call('X')` 的**方法名字面量集合**逐条枚举——共 **29 个不同方法名**（cancel、config/get、config/set、enhance、enhance/progress、logs/last、models/*、plugins/inventory、template/default、update/check、update/envcheck、update/executorEnsure、update/install、update/restartNeeded、voice/*），**集合中不含 `update/pull`**。
· **反例必须记录**：`src/host/protocol.js` 该行自带注释「**无 in-repo 调用方**（旧更新流程遗留；实际更新走执行器 apply）——保留兼容，勿随意删」——即**上游作者早已记录此事实**，与我的裁定一致。但「无 in-repo 调用点」**不等于**「无任何调用者」：外部客户端（第三方脚本直调 `/dsh-prompt-enhancer/rpc`）不在磁盘上，**静态扫描在原理上无法排除**，我只证到「本仓+两产物内无调用者」。

■ 待裁②：「硬失败仅 2 处」→ **不成立；实测硬失败 8 处（逐条实证，非推断）**
我按「缺文件时该处是否真的抛错/失败」**逐个做可执行验证**，不按“有没有 existsSync 字样”分类：
| # | 位置 | 实测行为 | 裁定 |
|---|---|---|---|
| 1 | `package.json:10` files 白名单 | **静默跳过**：我构造 `files:['present.js','absent.js']` 跑 `npm pack --dry-run --json` → **exit 0**，产物只含 present.js | minimal 判「硬失败」**错**（npm 不校验 files 存在性） |
| 2 | `.github/workflows/ci.yml:25` `node --check plugin-client.js` | **硬失败**：`node --check <缺失文件>` → **exit 1**（实测） | 清单**遗漏** |
| 3 | `.github/workflows/ci.yml:37` `git diff --exit-code` | 硬失败（差集变化即非零退出） | 清单遗漏 |
| 4 | `test/config-persist.test.cjs:52` | **硬失败**：`readFileSync(...,'utf8')` 无 try/无守卫 → 抛异常 | 清单**误判为静默** |
| 5–8 | `test/voice-persist.test.cjs:70 / 80 / 312 / 384`（**4 处**） | **硬失败**：同上，实测均 `guarded=false` | 清单误判 |
| 9 | `test/lib.test.cjs:841` U30 | **硬失败**：`assert.deepEqual(UPDATE_MANIFEST, [...含 'plugin-client.js'])`——注意它比对的是**内存常量**，只要常量含该名即断言该名，删文件不改常量则……**仍通过**；故其"硬失败"取决于是否同步改常量 | 判**条件性**（原判"硬失败"在"只删文件不改常量"路径下不成立） |
| 10–12 | `lib/index.cjs:677`、`lib/sys.cjs:639`、`lib/stage-install.cjs:124` | **静默**（逐行验证）：L683 `fs.existsSync(p) && …` 过滤 ✓；sys `put()` L626 `if (!src …!fs.existsSync(src)) return;` ✓；stage-install L124 配 `if (fs.existsSync(p))` ✓ | 与 minimal 一致 |
| 13 | `scripts/sync-runtime.mjs:115` | **静默**：L120 `if (existsSync(s))` ✓ | 一致 |
| 14 | `scripts/sync-runtime.mjs:78` | **硬失败**：`artifacts` 数组喂 `sys.syntaxCheckFiles()`，L84-86 门不过即 `throw new Error('产物语法门未通过…中止部署')` | 清单**误判为静默** |
| 15 | `scripts/build-client.mjs:169` | **硬失败**：try/catch 捕获后 `artifactOk=false` → L174-177 **`process.exit(1)`** | 清单误判为静默 |
| 16 | `src/client/updater.js`、`AGENTS.md` | **非检查面**：纯文档/注释提及，运行与否无影响 | 与 minimal 一致 |

**结论**：hard-fail 集合至少 = {ci.yml:25, ci.yml:37, config-persist:52, voice-persist:70/80/312/384, build-client.mjs:169, sync-runtime.mjs:78}；silent 集合 = {package.json files, lib/index.cjs:677, lib/sys.cjs:639, lib/stage-install.cjs:124, sync-runtime.mjs:115}；条件性 = {lib.test.cjs:841}。
**「清单是否穷尽」→ 不穷尽**：minimal 报 **11 处**，我实测**引用点 55 处 / 23 个文件**（含 CHANGELOG/docs 等叙述性提及，其中代码/配置/测试/CI 面为 17 处）。**分类也有 6 处反向错误**（2 处静默被误判硬失败、4 处硬失败被误判静默，加上 ci.yml 2 处整段遗漏）。

■ 待裁③：孤儿占比口径 → **采用 npm pack unpacked（我的实测与 minimal 逐位吻合）**
· `npm pack --dry-run --json` 实测：`unpackedSize = 1303630`、tarball `size = 385582`、`entryCount = 20`；文件尺寸之和 = 1303630 = unpackedSize（自洽 ✓）。
· 孤儿 `plugin-client.js` = **351607 B** → **351607/1303630 = 26.97%**（26.9714%，与 minimal 完全一致）✓；删后 **952023 B = 0.9079 MiB = 929.7 KiB** ✓。
· 你此前分母 1286311 我也复现了（lib 全目录 642659 + 两产物）→ 27.33%；加 README 两件 15186 → 1301497 → 27.02% ≈ pack 值。**故三者都"对"，但只有 pack 口径对外可复验**——**裁定：统一采用 `npm pack --dry-run` 的 

…（已截断，原长 7249 字符）

### 第 3 轮

**captain → rollout** · 2026-09-19 04:18:50

【任务 R3-rollout · 只改 P1a 一节（verify 实跑推翻了工程量估值）】

你 R2 表整体定稿，**只更新 P1a（client 载体单一化）**的「交付物 / 预计阻塞点 / 回滚 / 验收判据」四格。原因：verify 用**实跑**（不看有没有 `existsSync` 字样）重新测了删孤儿的失败面，结论与 minimal 报的差一个量级。

■ verify 的实测裁定（权威，取代 minimal 的清单）
1. **硬失败 ≥8 处**（minimal 报「仅 2 处」不成立，且**方向是反的**）：
   · `ci.yml:25`（`node --check`）→ **exit 1 硬失败**（实测）— minimal 清单遗漏
   · `ci.yml:37`（`git diff --exit-code`）→ 同遗漏
   · `test/config-persist.test.cjs:52`、`test/voice-persist.test.cjs:70/80/312/384` 共 **5 处无守卫 `readFileSync`** → **硬失败**（minimal 误判为静默）
   · `scripts/build-client.mjs:169` → try/catch 后 **`process.exit(1)`** → 硬失败
   · `scripts/sync-runtime.mjs:78` → 语法门 **`throw`** → 硬失败
2. **`package.json` files 白名单 → 恰恰是"静默"**（实测：构造缺失项跑 `npm pack` → **exit 0**）——minimal 把它判成"硬失败"，恰好判反。
3. 与 minimal 判断一致的只剩 3 个 lib 文件 + `sync-runtime.mjs:115`。
4. **引用面实为 55 处 / 23 文件**（minimal 报 11 处）——你 R2 记的「6 处代码位点」只是**文件名出现**的窄口径；verify 的 5 处专指"缺文件时行为会变"的位点（`index.cjs:677`、`sys.cjs:639`、`stage-install.cjs:124`、`sync-runtime.mjs:78/115`）：它们**静默容忍缺失，但行为会变**。
5. **占比口径终定**（accept 与 minimal 逐位吻合，我的 26.7%/343.4 KiB 作废）：唯一口径 = `npm pack --dry-run --json` 的 `unpackedSize` = **1,303,630 B**；孤儿 351,607 B = **26.97%**；删后 **952,023 B = 0.9079 MiB**。
6. **「完整内嵌」成立**：`lib/client.cjs` 去 2 行 GENERATED 头后含孤儿正文 `JSON.stringify` **318,792 字符逐字在位**（最长前缀二分 100.00%，断点在文件尾）→ 删它**零代码丢失**。
7. **`update/pull` 裁定**：本仓无调用点**成立**（`src/client` 全树 `host.call('X')` 方法名共 29 个，不含它；动态拼接探针全 0），但 minimal 的取证方式有误（两产物各有 1 处、是**注释**非调用）；且静态法**原理上无法排除外部客户端**，只能证到"本仓面"。verify 建议：**保留 handler，只删孤儿产物与引用**（拿收益不必动已发布契约）。

■ 请只回这四格（其余表体不要重发）
· P1a **交付物**：改为"协同改"清单（解耦 ≥8 处硬失败点 + 55 处/23 文件引用面），并明确 `update/pull` **handler 保留**；
· P1a **预计阻塞点**：按 ≥8 硬失败 + 5 处行为耦合重估；
· P1a **回滚方式**：删孤儿后若要回退，回退面是什么（注意 `lib/client.cjs` 已内嵌全文，回退是否只需恢复文件本身）；
· P1a **验收判据**：须含「删前解耦完成」「删后本地 281/281 + `node scripts/dead-code-gate.mjs` exit 0」「`npm pack` entryCount 精确 + unpackedSize 报值」三档，并沿用 accept 的 N1 三阶（先解耦 → 再删 → 再验）。

■ 口径纪律（引用时勿混）
行数一律 `split('\n').length`：死层 **995**（物理）/ 活装配 **33** / 合计 **1028**；禁与「逻辑行」（977/26/1003）混表。

**rollout → 汇聚网关** · 2026-09-19 04:19:22

[当前状态] 只改 P1a 四格，表体不动。已就地复现 verify 的两项关键读数（引用面 **23 文件 / 55 处**、`npm pack --dry-run --json` **unpackedSize=1,303,630 / entryCount=20**，两处逐位吻合），口径按其裁定执行。

[核心产出]

**■ P1a 交付物（改写）**
1. **解耦 9 处硬失败点**（缺文件即 exit≠0，必须与删除**同批**落地，缺一即红）：`ci.yml:25`(`node --check plugin-client.js`)、`ci.yml:37`(`git diff --exit-code` 三产物面)、`test/config-persist.test.cjs:52`、`test/voice-persist.test.cjs:70/80/312/384`（5 处**无守卫** `readFileSync`——注意 312/384 读的是内嵌正文而非文件名，须一并改挂 `lib/client.cjs`）、`scripts/build-client.mjs:169`（try/catch 后 `process.exit(1)`）、`scripts/sync-runtime.mjs:78`（语法门 `throw`）。
2. **5 处行为耦合位点补守卫**（静默容忍缺失但行为会变）：`lib/index.cjs:677`(RESTART_FILES)、`lib/sys.cjs:639`(rescue 快照)、`lib/stage-install.cjs:124`、`scripts/sync-runtime.mjs:78 / :115`（78 双重身份）。
3. **`package.json` files 白名单清理**——它是**静默面**（`npm pack` exit 0），残留条目不会报错，故必须同批删除并靠 `entryCount` 断言兜住（防幽灵声明）。
4. **`scripts/build-client.mjs` 停止产出该中间物**（删除才持久；否则每次 `npm run build` 复活一个 untracked 物，而 `git diff` 对未跟踪文件**看不见**，CI 静默放过）。仅改产出语句 = A 案；若连装配结构一起重构 = B 案（并入 P3）。
5. **`update/pull` handler 保留**：本仓无调用点成立，但静态法无法排除外部客户端 → 只删孤儿产物与引用，**不动已发布契约**（零 BREAKING）。
6. 新增结构判据入 `dead-code-gate.mjs`：**产物清单 ↔ `files` 白名单一致性**（entryCount 精确比对）。

**■ P1a 预计阻塞点（重估，量级按 ≥8+5 而非「2 处」）**
- **编排窗口为零容忍**：9 处硬失败点必须在**同一次提交**内全部处理完，中途任何一次 `push` / 本地跑测试 / 跑 `sync-runtime` 都会立即红（不是渐红，是断链）。
- **静默面反向风险**：files 白名单残留条目与 build 复活中间物**都不报错**，只能靠 `entryCount` 精确断言与 untracked 检查发现；这两处是本阶段唯一会「假绿」的地方。
- **行为耦合不可由测试发现**：5 处位点缺文件时不抛错，只改变 rescue 快照范围 / 重启提示清单 / 运行时同步面 → 需逐个补 `existsSync` 守卫，不能靠 281 项测试兜。
- **「完整内嵌」只证零代码丢失，不证路径等价**：`lib/client.cjs` 含孤儿正文 318,792 字符逐字在位（断点在文件尾）可证前者；浏览器加载路径是否等价**只能实机四探针**证——这是本阶段唯一的真判据来源。
- **口径作废声明**：R2 用的基准 1,286,311 B（6 件 + lib 手算）与 26.7% / 343.4 KiB 一律作废；唯一口径 = `npm pack --dry-run --json` 的 `unpackedSize`。

**■ P1a 回滚方式**
- 代码从未被删：孤儿全文已逐字内嵌于 `lib/client.cjs`（318,792 字符，最长前缀二分 100%）→ **回退只需恢复文件本体**，不存在「从删掉的逻辑里捞代码」。
- 具体回退面 = ①恢复 `plugin-client.js`（351,607 B，HEAD/tag 双份均在，`git checkout` 或 `git revert` 单提交即可）②还原 9 处硬失败点 + 5 处耦合位点的改动 ③还原 `build-client.mjs` 的产出语句（A 案一行；B 案回退面扩到装配契约）。
- 最便宜路径：**A 案回滚 = 单次 revert**；B 案回滚 = 两个提交 revert（产物 + 装配结构）。
- 无运行态残留：`RESTART_FILES` / rescue / UPDATE_MANIFEST 属文件**存在性**清单，文件恢复即语义恢复，无迁移数据。

**■ P1a 验收判据（沿用 accept N1 三阶：先解耦 → 再删 → 再验）**
- **N1-①解耦完成**（文件**仍存在**时验，证明解耦本身零行为变化）：9 处硬失败点 + 5 处耦合位点全部改毕；本地 `npm test` = **281/281**；`node scripts/dead-code-gate.mjs` **exit 0**；`build-host.mjs --check` + `build-client.mjs --check` **零漂移**。
- **N1-②删除完成**：`plugin-client.js` 不存在；`npm pack --dry-run --json` **entryCount = 19**（现 20 − 1，须实测复核）；**unpackedSize = 952,023 B（0.9079 MiB）**（= 1,303,630 − 351,607，纯减法）；孤儿占比由 **26.97%**（351,607/1,303,630）降为 **0**；工作区无 untracked 中间物（`git status --porcelain` 中不含它）。
- **N1-③删后验证**：本地 `npm test` = **281/281**（计数不降）；`node scripts/dead-code-gate.mjs` **exit 0**（含新增白名单一致性判据）；`git diff --exit-code` 三产物面**实际执行**（非 skipped）；**实机四探针**（dsh-enh-result / EnhanceButton / RecordRTC / config v2）在唯一载体 `lib/client.cjs` 路径下全中；两个 `--check` 仍零漂移。
- **待定项**：CI run 终值（conclusion / wall time / 是否 skipped）**待定，依赖 P0**——本阶段不以 CI 绿为门槛，只要求三产物 diff 步骤实际执行。

[下一步建议] ①P0 与 P1a 编排次序确认：P1a 的 `ci.yml:25/37` 与 P0 的 `timeout-minutes` 改同一个文件 → 建议**同一次改 CI 文件**，避免两次触碰；②请 accept 按上述三阶判据补全四要素表；③B 案若被选中，其回滚面与 P3 强耦合，需在 P3 决策稿里同步。

[建议决策] P1a 走 A 案还是 B 案 | 选项：A 删产物 + 改 build 产出语句 + 补守卫（回滚 = 单次 revert） / B 直出 `lib/client.cjs`、重构装配（并入 P3，回滚 = 两提交） | 推荐：**A** 理由：A 拿满 26.97% 减重收益且零装配契约变更，B 的额外收益（RC-B）可由 P3 独立决策，不必把 P1a 拖进大改造。

---

## 用户调整记录（0）

> 只包含尚未被主持人清空的记录；已执行并清空的调整不会出现在导出里。

（无）
