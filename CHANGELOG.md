# Changelog

本项目所有重要变更记录于此文件。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。完整发布说明见 [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)。

> 🗺️ 本日志与项目地图[`docs/map/`](docs/map/index.md)交叉引用：新条目标注涉及 map/flow-id（PEN/VU/DG）；agent 开工前先读 [`AGENTS.md`](AGENTS.md)。

## [Unreleased]

### Added
- **语音识别模块（新功能·P1 云端闭环）**：输入框旁新增 🎤 录音按钮——语音 → 云端识别 → 可选规整（去口水词）→ 填入草稿 → 可一键优化。**P1 内容**：① host `lib/asr.cjs`——cloud 双协议 ASR（阿里 Qwen3-ASR `chat/completions+input_audio` 默认 / OpenAI `/audio/transcriptions` 兼容），出网走 `node:https` 直连（通道 C，P0.5 探针实测通过）；规整层（refine，OpenAI 兼容，失败自动降级原文）；② RPC `voice/status`·`voice/transcribe`（rpc-schema 双份 + data URL 校验 + 30s/15s 超时 + 错误码）；③ client `src/client/voice/`——recorder（RecordRTC 16k mono wav，≤60s，仅内存）/ mic-button（状态机 + 双暂存时序防护：优化中/发送期暂存自动填入）/ voice-insert（能力探测 append/insert）/ voice-section（模型配置 tab 段落块，apiKey 仅存磁盘）；④ **config/set 升级「顶层键级 merge」**（enhancer+voice 双写入方互相清空修复，向后兼容）；⑤ vendor RecordRTC 5.6.2（官方原码只读 + 转义工具 + GENERATED chunk）；⑥ 契约测试 voice-persist（12 项）+ config merge（2 项）。— [VOICE-003]
- **语音识别模块（P2·本地离线引擎）**：新增 sherpa-onnx + SenseVoice 本地识别——完全离线、零 key、隐私（音频不出本机）。**P2 内容**：① `lib/asr-worker.cjs` 独立 worker 进程（端口 3082，对齐 updater executor 模式）+ 部署脚本 `scripts/asr-deploy.mjs`（装 sherpa-onnx + 模型校验 + 启动 + 健康检查，清单化防漏复制）；② SenseVoice int8 模型（228MB）下载管理（HF 源）；③ `lib/asr.cjs` local 引擎分派（worker HTTP 调用）+ `voice/status` local 字段实时探测（installed/modelReady/workerUp）；④ 本地识别链路实测通过（正弦波 → "Okay."）。— [VOICE-003]
- **语音识别模块（P3·VAD 静音自动停）**：说完话停顿 1.2s 自动停止录音并进入识别——不再需要手动点停止。**内容**：① recorder 新增 VAD（AudioContext + AnalyserNode 实时 RMS，**EMA 平滑 + 连续静音帧计数**抗底噪抖动——曾因 mp3 底噪偶发帧超阈值致静音计时不断重置）；② mic-button 经 `stopRef`（ref 取最新闭包，修复 VAD 异步回调持旧闭包致守卫误判）；③ 设置「语音识别」段落新增**静音自动停**开关（默认开启，`voiceCfgState.vad.enabled` + host sanitize 白名单）；④ 端到端实测通过（fake-audio-capture 循环播放「语音+2s静音」→ 录音→自动停→识别→回待机）。— [VOICE-003]

### Fixed
- **优化按钮模型序号改为「设置链序号」（用户需求）**：按钮显示的「{n}正在优化」数字改为**用户模型链（设置里）的对应序号**——host 侧 `buildTryChain` 会去重/过滤导致 chain 索引与配置偏移，现在 llm 阶段按 fallback 原始数组匹配当前模型位置（第 N 条即显示 N，自动随设置数量 1..N）；进度 total 同步为设置模型总数。— [PEN-002]

### Changed
- **优化按钮文字迭代（用户需求·上轮优化调整）**：① 模型 1（默认）直接显示「正在优化」——去掉序号与三点动态；失败切换模型后显示「{n}正在优化」（2正在优化、3正在优化…），统一不再区分「重试」；② 移除三点 1→2→3 循环动态效果；③ hover 提示（title）全面精简：一键优化 / 继续优化 / 点击取消 / 点击恢复原文 / 命令无可优化 / 当前不可优化 / 点击切换记忆（≤6 字）；④ 阶段文案「准备中」→「正在准备」。— [PEN-002]

### Changed
- **优化按钮文字精简 + 动态「优化中」效果（用户需求）**：① 按钮可见文字全部 ≤6 字（标准 4 字）——模型序号文案 `{n} 优化中`→`{n}优化中`、`{n} 正在重试`→`{n}重试中`、结果态「可撤回」→「撤销优化」；② 优化中状态动态点：基础文案 + 三点按 1→2→3 循环（400ms/步，经 timerSvc 定时器，与进度轮询一致）；③ 移除优化中按钮的秒数追加（动态点提供持续动态反馈，保证文字 6 字内）。— [PEN-002]

### Changed
- **Issue #1 修复审查补充（v3.2.4 发布后代码审查）**：① 新增 `test/config-persist.test.cjs`（7 项契约测试：config/get·config/set 参数校验行为、lib 与 src/host 双份 rpc-schema 同步防漂移、lib/index.cjs 注册存在、plugin-client.js 产物注入防漂移）；② 首次安装继承条件加固——`hostSync !== null` 收紧为 `hostSync === true`：host 磁盘同步超时放弃（20s）时不再执行自动继承，杜绝「磁盘有配置但同步失败」场景下默认链覆盖用户配置的残余路径。— [PEN-002]

## [3.2.4] - 2026-08-19

### Fixed
- **桌面端 (DSH Desktop) 每次重启插件设置被重置（GitHub Issue #1 用户反馈）**：DSH Desktop 主进程每次启动动态分配端口（`listen(port 0)`），Chromium localStorage 按 Origin（协议://域名:端口）隔离 → 每次重启新 Origin 下配置「消失」→ client 误判 `fresh=true` 用默认模型链覆盖用户配置（模型链/模板/参数全丢）。**修复**：① host 新增 `config/get`·`config/set` RPC（`$DSH_HOME/dsh-prompt-enhancer.config.json` 磁盘持久化，原子写 tmp+rename，≤1MB）；② client `saveConfig` 双写（localStorage + 磁盘 fire-and-forget）；③ 启动时 `syncConfigFromHost()` 从磁盘恢复配置并回填 localStorage（host 未就绪重试 10×2s，覆盖冷启动）；④ 首次安装模型链继承加 `hostSync` 门控——磁盘同步完成前不判定 fresh，杜绝「配置待恢复」被误判为「首次安装」覆盖；⑤ web 固定端口场景不受影响，磁盘为空时自动迁移 localStorage 存量配置写盘。— [PEN-002]

## [3.2.3] - 2026-08-19

### Fixed
- **环境检测误报「安装 nssm」（用户实测·v3.2.1-w）**：nssm 已装且服务模式生效（port-mode=service）时，环境检测仍显示「检测到 DSH 未以系统服务运行（无 nssm）。是否现在安装？」——根因：v3.2.1-v 删除 host `service` 探测项后，client `updater-card.js` **三处 `svcNeedInstall` 判定仍写死 `its.find((i) => i.key === 'service')`** → 永远 undefined → 永远判「需要安装」。修复：判定改用 `port-mode` 四态——仅 `default`（前台模式·用户会话）/ `no-listener`（未运行）提示安装；`service`（nssm 接管）/ `service-stopped`（已装未运行）/ 未知态（pid-only / tool-unreachable）一律不再误报。— [PEN-002]
- **端口重启服务模式根治（v3.2.1-u）**：实测发现 `schtasks /create` 的 **`/tr` 参数有 261 字符上限**——A+B 方案把完整 PowerShell 任务链塞进 `/tr` 超长 → create 失败（status=2147500037）→ 旧降级分支 `sc stop`（只停不启）→ 服务挂死、3080 空、页面全报错（08-19 18:32 实测）。**修复**：① 任务链改为**独立 node 脚本**（host 生成 `restart-service-<ts>.cjs` 到 executor/cli，`/tr` 只指 `node.exe <script>`，远小于 261 字符）；脚本内（SYSTEM 运行、脱离 nssm Job 树）`sc.exe stop` → **轮询 SCM 状态 STOPPED**（nssm stop 后 SCM 可能仍 STOP_PENDING，立即 start 会被拒）→ 轮询 3080 端口释放（≤30s，残留单 PID 杀）→ `sc.exe start` 重试 3 次 → 删任务 + 自删脚本。② 降级分支**安全化**：create 失败不再 `sc stop`（杜绝只停不启），返回 `SCHEDULE_FAILED` 明确错误，client 终止轮询显示错误。③ 新增 **test/e2e-restart.cjs 端到端回归**（真实 RPC 链路：netstat 观测 3080 → POST update/portRestart → 校验新 PID 会话 0 接管/任务自删/无 EADDRINUSE）——**实测 5/5 PASS**（每轮 ~3.5s 接管、PID 变化、无 EADDRINUSE）。— [PEN-002]

### Changed
- **环境检测去重收敛 + 端口托管四态状态机（用户审核·v3.2.1-v）**：删除冗余的 `service`/`svc-type`/`svc-bin` 三项环境检测项（信息被 port-mode 覆盖：service↔监听者会话 0、svc-type↔是否在跑、svc-bin↔能否接管）；host `ENV_PROBE_KEYS` 与 client `ENV_ITEMS` 收敛为 4 项（tools/net/port-mode/port-pid）。`port-mode` 扩展为四态：`service`（nssm 接管·监听者会话 0）/ `service-stopped`（服务已装未运行，重启可拉起）/ `default`（前台默认·用户会话）/ `no-listener`（无监听无服务）。专业术语文案统一：服务模式（nssm · Session 0）/ 服务模式 · 已安装未运行 / 前台模式（用户会话）/ 进程模式（会话未知）/ 未运行（无端口监听），EN 同步；测试 U45 更新 4 项断言。— [PEN-002]

## [3.2.2] - 2026-08-19

### Fixed
- **端口重启 UI 卡住·架构根因修复（用户实测「端口重启成功但一直显示正在重启」·v3.2.1-t 补丁）**：根因链——host 就是 DSH 服务进程，`scheduleServiceRestart` 在 host 进程内**同步执行 `sc stop` 杀自己**，`spawnSync` 未返回、`portRestart` 的 RPC 响应在竞态中丢失（杀树快时响应发不出）；而 client 把恢复轮询的启动**门控在 RPC 响应上**（`trigger().then` 才 `pollRestored`）→ 响应丢失 → 轮询永不启动 → UI 永远停在「正在重启端口」，但服务实际已重启成功。这是 v3.2.1「端口重启独立化」（从执行器移到 host）引入的架构退化。**修复（A+B 双保险）**：**B（host 根治）**——`sc stop` 也移进 schtasks 调度任务（任务内 powershell：3s → sc.exe stop → 2s → 清 3080 残留占用 → 2s → sc.exe start → 自删），host **只创建+触发任务+立即返回响应**，不再自己杀自己（注：必须 `sc.exe`，PowerShell 的 `sc` 是 Set-Content 别名）；**A（client 兜底）**——轮询**立即启动**（fire-and-forget，不依赖 RPC 响应），并引入 `sawDown` 判定（仅「曾观察到服务断开→恢复」才判完成，避免冷启动时 fetch 一直 200 误报）。全量测试 158/158（1 环境 skip）。— [PEN-002]

### Changed
- **架构调整·版本单一事实源 + 同步自动化（用户评审·v3.2.1-t）**：根治「改一个版本、运行的却是另一个」的六面漂移问题。① **版本单一事实源**：源码 `PLUGIN_VERSION` 硬编码删除，改为 `build-host.mjs` 从 package.json 构建注入（`__DASH_PLUGIN_VERSION__` 占位符替换）——产物版本永远=package.json，杜绝「发版忘 bump → 检测永远旧版」。② **漂移检测**：`build-host.mjs` / `build-client.mjs` 新增 `--check` 模式（重建到内存对比磁盘产物，不一致报错退出 1）——从机制上杜绝「只改产物被重建冲掉」「改源码不重建」两类历史问题。③ **同步自动化**：新增 `scripts/sync-runtime.mjs`——一条命令完成 build → --check → 同步运行环境 → md5 校验 → 提示重启 DSH + 刷新页面（不再手动 cp 漏文件）。④ **执行器内容哈希重建**：`executorEnsure` 判断过期条件从「仅版本号相等」升级为「版本号 + 内容哈希（lib 全部 .cjs + plugin-host.js 的 sha1）」——执行器代码一变即使 EXECUTOR_VERSION 没 bump 也强制重建（历史教训：v3.2.1-p 镜像 fallback 因版本号不变、执行器副本不重建而一直不生效）。⑤ **发布全自动**：新增 `scripts/release.mjs`（bump → build --check → 全量测试 → npm pack → git tag → GitHub Release + 资产上传，需 GITHUB_TOKEN）——tgz 永远等于当前代码。全量测试 158/158（1 环境 skip）。— [PEN-002]

### Added
- **一键更新/端口重启进度反馈（用户需求·v3.2.1-s）**：① 一键更新下载改为 **Node https 流式下载**（替代 curl，跟随重定向、Content-Length 总字节、每 400ms 回报进度）——client 下载阶段实时显示「下载 N% · 源 X/Y（直连/镜像切换）」，并展示步骤序号「[第 N 步] 校验/下载/环境检测/安装…」；② **端口重启倒计时改为 1 秒一更新**——原实现把递归放在 `fetch('')` 回调里，DSH 被杀时 fetch 挂起（5s abort）→ 倒计时 3~5s 一跳；改为 doneFlag + fetch 检查独立于倒计时节奏，每轮 1s 无条件递归，倒计时稳定每秒刷新。执行器版本 0.1.11 → 0.1.12（触发 ensure 重建副本）。全量测试 158/158（1 环境 skip）。— [PEN-002]

### Fixed
- **一键更新→端口重启 90s 超时·根因修复（用户全流程实测·v3.2.1-r）**：完整根因链——v3.2.1-q 把 staging 安装塞进 host 的 `update/portRestart`（`spawnSync('dsh plugin add', timeout=120s)`，而 `dsh plugin add` 实际是转发 **pnpm 在 profile 目录执行 `pnpm add`**，该 profile 正是 host 自己所在、正在运行的服务环境）→ pnpm 卡死 → **host 事件循环冻结 ≥90s → DSH 网页服务器无响应 → client 90s 轮询报「端口重启超时」** → 120s 后安装失败、服务从未重启。**修复**：① `installStagedTarball` 不再用 dsh/pnpm——npm pack tgz 是标准 tar（顶层 `package/`），直接**解包 + 文件级覆盖复制到运行环境目录**（`$DSH_HOME/profiles/<profile>/node_modules/dsh-prompt-enhancer`），秒级完成、无网络/无依赖树/无锁（插件加载走 cordis include，不依赖 pnpm 依赖登记，手动 cp 覆盖重启即生效早已验证）；tar 用 `System32\tar.exe`（bsdtar）绝对路径，规避 Git Bash GNU tar 把 `C:\` 解析成远程主机。② **版本检测失真修复**：`PLUGIN_VERSION` 构建硬编码与 package.json 脱节（发版后未重建产物 → 永远 local=3.2.0 → 永远检测到更新）——`update/check` 的本地版本改为**运行时读取运行环境 package.json**（lib 注入 `harness.readPluginVersion`），动态形态/读取失败回退常量。③ **幽灵目录修正**：`update/check` 的 `defaultDir`（v2.4.1 逐文件写入遗留的 `<workspaceRoot>/dsh-prompt-enhancer-<tag>/`）改为真实运行环境目录（`harness.pluginRuntimeDir`）。④ 同步源码：v3.2.1-o 的 ENV_PROBE_KEYS（exec-port→port-mode/port-pid）此前只改了构建产物，本次回灌 src/host/pure.js（重建不再丢失）。全量测试 158/158。— [PEN-002]

## [3.2.1] - 2026-08-18

### Fixed
- **端口重启无窗口优化（用户实测·黑窗问题）**：端口重启过程中弹多个命令窗口黑窗、最后残留一个——根因：host 用 `windowsHide` 启动 cmd 外壳（CREATE_NO_WINDOW，无控制台），但脚本内 `start /B` 启动的 node（console 程序）**没有可复用的控制台 → Windows 为其新建控制台窗口**（黑窗），且 DSH 常驻导致黑窗残留。**修复**：重启脚本由 `.cmd` 改为 **`.cjs`（node 辅助脚本直接执行）**——host `spawn(process.execPath, [script], { detached, windowsHide: true })` 启动辅助进程，辅助进程内 `spawnSync('taskkill', ..., { windowsHide: true })` 杀旧 DSH（不带 /T，防递归杀树连带自己）+ `spawn(execPath, argv, { windowsHide: true })` 拉起新 DSH——**全程 CREATE_NO_WINDOW，零窗口**。实测闭环：调用 RPC → `.cjs` 脚本执行 → 杀旧 DSH(20932) → 拉起新 DSH(8744) → 3080 恢复 → 索引更新 ✅。全量测试 135/135。— [PEN-002]
- **端口重启独立化（用户指令·不再依赖执行器拉起链）**：用户实测 10 次×2s 重试后仍误报「更新执行器未能启动」——**方向调整：端口重启从「执行器拉起链」中剥离，做成自包含功能**。新增 host 独立 RPC `update/portRestart`：读进程索引（`$DSH_HOME/dsh-prompt-enhancer.json`，host 加载时自写）→ 生成**自包含脚本**（`taskkill /F /PID <旧DSH>` 只杀主进程 + 用原启动参数拉起新 DSH，仅依赖 node 内置/系统命令，零插件模块依赖）→ `detached` spawn 脚本（脚本由 DSH 子进程执行，**taskkill 不能带 /T**——实测 /T 递归杀树会把脚本自身连带杀掉、新 DSH 起不来）→ 完成杀旧起新。client 端 `runRestart` 重写：直接调 `update/portRestart`（不再 tryPing/ensureThenPing/executorEnsure/执行器轮询），触发后**轮询页面恢复**（fetch 自身），恢复显示「✓ 端口重启完成，请刷新页面」，90s 超时兜底；host 未就绪（冷启动）时触发重试最多 10 次×2s。**全程不依赖执行器进程/schtasks/cpSync/watchdog**。实测闭环：调用 RPC → 杀旧 DSH(12576) → 拉起新 DSH(3028) → 3080 恢复 → 索引自动更新 ✅。全量测试 135/135。— [PEN-002]
- **重启电脑后首次点「端口重启」误报「更新执行器未能启动」修复（用户实测·host 冷启动时序）**：重启电脑后刚启动 DSH 立即点端口重启——DSH 冷启动加载插件（host 半部注册 RPC）需数秒~十几秒，而 client `ensureThenPing` 固定 **3 次 × 1s** 重试窗口太短 → `host.call('update/executorEnsure')` 全失败 → 误报「更新执行器未能启动（端口 3081）」。现场铁证：执行器日志无新记录、TEMP 无拉起脚本、执行器副本 mtime 未更新（cpSync 从未执行）= executorEnsure 从未被 host 执行；host 就绪后复现 0.9s 成功且 cpSync 正常。**修复**：`ensureThenPing` 改为最多 **10 次 × 2s**（总窗口 ~20s 覆盖冷启动），且 executorEnsure 成功后执行器尚未就绪（spawn 后初始化）时 ping 失败同样等待重试。（注：本修复后续被「端口重启独立化」取代——端口重启不再经过执行器拉起链。）全量测试 135/135。— [PEN-002]

### Added
- **桌面快捷方式独立化（审查优化·解耦执行器）**：旧「重启DSH」快捷方式调 `updater-host --cli restart`（执行器不在时失效）。改为生成**自包含 CLI 重启脚本**（restart-dsh.cjs：读索引 → 杀旧 DSH（taskkill 不带 /T）→ 拉起新 DSH（windowsHide）→ 轮询 3080 恢复 → 打印结果），cmd 只做 `node restart-dsh.cjs` 包装——执行器在不在都能用。实测：运行 restart-dsh.cjs → 杀 22836 → 拉起 16804 → 3080 恢复 ✅。
- **执行器拉起无服务 detached 优先（审查优化·简化降级链）**：旧 spawnExecutor 无条件走 schtasks 三级降级（SYSTEM 被拒 → 当前用户任务 → detached），普通用户环境既慢又易在冷启动/权限边界出错。改为**无服务场景直接 detached**（最快最可靠），仅服务化场景（sc stop 杀服务树）才走 schtasks 任务链。实测：executorEnsure 无服务 → detached 直拉（无 schtasks 任务残留）✅。
- **服务化接管改「重启电脑主导」方案（用户建议·杀进程不可靠，重启是系统级干净清理）**：实测确认「确认安装 nssm 服务化」后服务 RUNNING 但 3080 仍被旧 DSH 占 → 服务 node EADDRINUSE 崩溃循环。**用户定调：杀进程不可靠，重启/注销会重置干净环境，nssm 自启动自然接管**——安装完成后 UI 提示改为「**✓ 服务化安装完成 —— 重启电脑（或注销）后，nssm 将自动接管端口；不想重启可点「端口重启」立即接管**」（i18n ZH/EN）。前置已就位：服务 `Start=SERVICE_AUTO_START` 开机自启 + `AppEnvironmentExtra` 用户环境注入（SYSTEM 下能加载插件）。同时保留两条即时路径：① `restartService` 服务路径接管增强——每轮 start 后记录该轮前 3080 监听者（`listenerPid` netstat 解析），healthy 判定升级为「监听者已变化 + 服务 PID 已更新」，旧进程占端口时 `killPidTree` 杀掉释放让服务 node 接管（用户主动点重启 = 授权）；② watchdog 让位杀掉自己拉起的 DSH。全量测试 135/135。— [PEN-002]
- **执行器拉起健壮性（重启电脑后首次端口重启失败修复·用户实测）**：① `currentUserSid()` whoami 解析失败时**不再兜底返回 SYSTEM SID（S-1-5-18）**——那会让「当前用户任务」XML 变成 UserId=SYSTEM+InteractiveToken 的非法组合、schtasks 必败白费一轮；改为返回 `null`，spawnExecutor 仅在 SID 可用时才尝试当前用户任务，否则直接落 detached。② **执行器日志文件 EBUSY 防护**：日志 `%TEMP%\dsh-updater-host.log` 可能被运行中的执行器进程持有句柄（Windows 下实测两个进程同时 'a' 打开同一文件，后开者抛 `EBUSY`）→ 新增 `resolveExecutorLogPath()`：拉起前探测可写性，被占用时降级带 pid+时间戳后缀的独立日志，避免 spawnExecutorDirect 的 openSync / cmd 重定向 EBUSY 抛错导致执行器拉起失败且无日志（现象：重启电脑后首次端口重启报「更新执行器未能启动（端口 3081）」，日志无记录、TEMP 无拉起脚本）。实测：日志被锁时修复前 `EBUSY` 崩溃 → 修复后自动降级后缀日志 ✅。全量测试 135/135。— [PEN-002]
- **服务化实测两处关键修正（用户实测 nssm 安装）**：① `serviceInstall` 的 nssm 脚本**注入当前用户环境变量**（AppEnvironmentExtra：HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP）——nssm 服务默认以 LocalSystem 运行，若不注入，DSH 的 `$DSH_HOME` 解析到 SYSTEM 的 `.dsh`（插件/配置全空、host 半部不加载、页面空壳）；② **watchdog 动态让位**：watchdogTick 每轮先检测服务，服务出现（用户点了 serviceInstall）→ 立即停止 watchdog——否则旧 watchdog 拉起的 DSH 持续占着 3080，系统服务的新 node 起不来（端口冲突 + 假 healthy，两条路径打架）。实测闭环：服务 RUNNING（nssm → node 监听 3080）→ 执行器 watchdog `enabled:false` → 服务路径端口重启 `healthy on round 1 (pid 20780→5236)` ✅。已装服务用 `nssm set dsh-web AppEnvironmentExtra ...` 补齐；新装服务自动带。全量测试 135/135。— [PEN-002]
- **端口重启完成后无服务化行内引导（用户需求·非弹窗）**：端口重启完成（「✓ 重启成功，请刷新页面」）后检测 envcheck 的 service 项——无 nssm 服务时**换一行**显示引导文案 + 最右侧**「确认安装」按钮（与「刷新页面」按钮右对齐）**；点确认 → host 新 RPC `update/serviceInstall`：探测 nssm（PATH → `EXECUTOR_ROOT/tools/nssm.exe` → 官方 zip 下载解压）→ 生成 PowerShell 脚本（nssm install dsh-web + AppDirectory/AppStdout/AppStderr/Start AUTO_START/AppExit Restart + nssm start）→ `Start-Process -Verb RunAs` 提权执行（**弹一次 UAC，用户确认后以管理员装服务**）→ 校验服务存在返回。服务程序优先**全局 dsh-install 稳定路径**（resolveDshBin，npx 缓存路径可能被清理）。装好后端口重启走服务路径、watchdog 自动让位；安装中/完成/失败状态就地展示（完成即隐藏按钮）。nssm 下载解压链路已实测（python 直连 nssm.cc 351KB zip → win64/nssm.exe）；全量测试 135/135。— [PEN-002]
- **Watchdog 降级守护（PM2 God-Daemon 式，无 nssm 时 DSH 崩溃自动拉起）**：参考 PM2 守护模型——执行器在「非服务化部署」（无系统服务 + 有进程索引）时自动升级为守护层，每 10s 健康检查 DSH 端口，崩溃即按进程索引自动拉起（崩溃自愈；比 nssm 的"服务进程重启"更强——应用级崩溃也管）。防重启风暴（PM2 语义）：`restart_delay 3s` / `min_uptime 5s`（闪退不计稳定）/ `max_restarts 15次/分钟`（超限暂停，防崩溃循环打爆系统）。`--no-watchdog` 或 `DSH_EXECUTOR_NO_WATCHDOG=1` 关闭；status RPC 暴露 watchdog 状态。实测：杀 DSH → 16s 内自动 relaunch 新进程接管 3080 ✅。与 nssm 服务化并存（有服务走服务路径，无服务走 watchdog），两条路都可靠。— [PEN-002]
- **执行器拉起三级降级（schtasks SYSTEM → 当前用户任务 → detached）**：普通用户无管理员时 SYSTEM 任务创建被拒（旧实现直接落 detached）；新增**当前用户 + InteractiveToken + LeastPrivilege** 任务（免管理员，登录会话必存在——执行器由 DSH 拉起），SYSTEM 失败自动降级。— [PEN-002]
- **端口重启服务感知·nssm 接管修复（用户实测·让 nssm 接管失败）**：旧 `update/portRestart` 永远按进程索引拉起一个**新前台 DSH**，与已安装的 nssm 服务 node 抢 3080，导致「让 nssm 接管」永不生效（服务 node 因 EADDRINUSE 抢不到端口）。修复：handler 新增**服务检测分支**（`platformService.detectService`）——命中 nssm 服务时走 `buildPortRestartServiceScript`：① 按端口查真正占用 3080 的进程并**单 PID `taskkill` 杀掉**（不树杀，detached 脚本自身存活；索引 pid 可能过期，必须按端口查）；② 依赖 **nssm `AppExit Default Restart` 自动重启 node** 接管端口（端口释放后 node 绑定成功）；③ 兜底 `sc start`（脚本已独立于服务树，可安全调用）。**关键教训**：首版用 `sc stop` 树杀服务，会连带杀掉作为服务 node 子进程的脚本本身，且 `sc start` 与未释放端口竞态导致 EADDRINUSE——改为单 PID 杀 + 靠 nssm 自动重启，4s 内 3080 恢复在全新服务 node（Services 会话）。非服务场景仍走原索引式 detached 重启（不受影响）。实测：触发服务感知端口重启 → t=2s 无监听 → t=4s 3080 恢复在 Services 会话新 node、服务 RUNNING ✅。全量测试 135/135。— [PEN-002]

### Changed
- **端口重启改为「判断 + 双路径」，彻底移除易出错的 nssm 接管逻辑（用户最新指令·v3.2.1-g）**：用户实测确认此前「端口重启强制 nssm 接管」路径过于脆弱（sc stop 树杀辅助脚本致 sc start 来不及、nssm AppExit 自检首次易拉不起来）。改为：① 安装流程 `serviceInstall` 的 nssm 脚本**移除即时 `nssm start`**——装好后不再立即与当前前台 DSH 抢 3080，改为 `SERVICE_AUTO_START` + 提示「**重启电脑或注销当前用户，让 nssm 以系统服务接管**」（i18n `svcInstallDone` 同步去除「点端口重启立即接管」诱导）；接管交给系统重启/注销，安装即返回。② `update/portRestart` 新增**判断能力**：`backend.detectService` + `!isStopped` 判定「nssm 服务接管态（RUNNING）」vs「默认态（前台 DSH）」——接管态走新增 `scheduleServiceRestart`（用 **Task Scheduler 注册一次性 `sc start`**，运行于 session 0/SYSTEM、**完全在 nssm Job 树之外** → 再 `sc stop` 当前服务；nssm 树杀只影响自身，调度任务 ~12s 后确定性拉起全新 node 接管端口，任务自删），**不依赖 nssm 自检（AppExit）**；默认态仍走原独立 detached 脚本（杀旧前台 + 拉起新前台）。移除旧的 `buildPortRestartServiceScript` 与 `launchRestartScript` 服务模式分支。— [PEN-002]
- **桌面快捷方式同样加「服务/默认」判断（用户指令·v3.2.1-h）**：`buildCliRestartScript`（restart-dsh.cjs）原为无脑「杀索引 pid + 拉起新前台 DSH」——nssm 服务已接管 3080 时双击快捷方式会再拉前台 DSH 抢端口（EADDRINUSE 复现）。修复：脚本开头 `sc query` 检测服务接管态——**RUNNING 走服务模式**（`sc stop` → 等 STOPPED → 显式 `sc start` → 等 3080 恢复；CLI 由用户双击 cmd 运行、在交互会话，**不在 nssm Job 树内**，可顺序执行完整重启，无需 schtasks）；**默认态走原逻辑**（杀旧前台 + 拉起新前台）。与 `update/portRestart` 判断口径完全一致。— [PEN-002]
- **插件重构为「服务端口」+「提示词增强」两个独立功能模块（用户指令·v3.2.1-i）**：审查确认原结构两处跨模块耦合——① UpdaterCard（服务端口）的 repo/targetDir/serviceName/profile/executorPort 配置**寄生在提示词增强模块的 configState**（`saveConfig` 会触发提示词增强模块的「保存校验状态机」，属逻辑打架）；② UpdaterCard **嵌套渲染在提示词增强容器**「模型与插件」页的插件 tab 内。**解耦**：① 服务端口模块配置**完全独立**——updater.js 新增 `updaterCfgState`（独立 localStorage key `dsh.prompt-enhancer.updater` + `loadUpdaterConfig/saveUpdaterConfig/subscribeUpdaterConfig`），updater-card 不再读写 configState/saveConfig；旧配置仅做**一次性数据迁移**（纯 localStorage 读取，不依赖提示词增强模块 JS API）。② UpdaterCard **独立注册为 settings.section「服务与更新」**（app.js 新增 `svc-updater` 入口，i18n `navServiceUpdater` ZH/EN），从 plugins-section 移除嵌套渲染——插件管理 tab 与提示词增强模块解耦。**两模块边界**：服务端口模块（lib/index.cjs `update/*` RPC + lib/updater-host.cjs 执行器 + client updater.js/updater-card.js）与提示词增强模块（plugin-host.js `enhance/models/template` RPC + client constants/state/model-helpers/helpers 增强逻辑 + enhance-* 组件）RPC 命名空间天然分离（`update/*` vs `enhance|models|template/*`）、无交叉调用；共享层仅限显示样式（styles/i18n 字典）与 UI 基件（collapsible-section/marquee-select/makeT/dshEnhId）。全量 158/158。— [PEN-002]
- **v3.2.1-j：四项实测问题统一修复（用户全流程实测）**：① **UI 回滚**——用户确认解耦要的是**功能/逻辑分离而非 UI 分离**：删除独立「服务与更新」设置栏（app.js svc-updater + i18n navServiceUpdater），UpdaterCard 放回插件管理 tab 原位置（插件清单上方），**逻辑解耦保留**（updaterCfgState 独立配置、不触发提示词增强保存状态机）。② **判断规则修正**——用户明确规则「有 nssm 服务就重启/拉起 nssm，默认前台仅作兜底」：`update/portRestart` 与快捷方式脚本的「服务模式判断」从「服务 RUNNING」改为「**服务存在**」（RUNNING→sc stop→sc start；**Stopped→清理 3080 前台占用后显式 sc start 拉起**），杜绝「服务存在却拉前台」与「服务接管时再拉前台抢端口」两类问题。③ **schtasks 触发修复**——v3.2.1-g 的一次性时间点任务**实测错过触发**（LastTaskResult=267011、NEXT_RUN 空）导致 sc start 永不执行、服务挂死；改为创建后**立即 `schtasks /run` 手动触发**（不依赖时间点，任务在 session 0/SYSTEM、nssm Job 树之外），任务内 `timeout 8s` 等端口释放后显式 `sc start`，执行后自删；host 侧加 2s 后清理 3080 残留占用者兜底。④ **文案修正**——i18n `svcInstallDone` 去掉「或注销」（实测注销不会触发 Auto 服务启动，只有系统重启才接管），EN 同步（顺带清除旧「click Port Restart」诱导）。全量 158/158。— [PEN-002]
- **v3.2.1-k：快捷方式管理员权限 + 防误报 + 残留清理（用户实测·待办修复）**：① **创建管理员快捷方式**——`update/makeShortcut` 新增 `markLnkRunAs`：cscript 生成 .lnk 后在 ExtraData 区（TerminalBlock 前）插入 **RunAsDataBlock**（BlockSize=0x08、BlockSignature=0xA000000A），双击即弹 UAC 提权，服务模式 sc 操作不再因权限被拒（返回 5）。② **脚本权限检测**——restart-dsh.cjs 服务模式开头检测管理员（`net session`），非管理员**明确提示「✗ 执行失败：服务模式需要管理员权限」并以非 0 退出**（不静默、不误报）。③ **防误报**——poll 成功条件改为「3080 监听者 PID ≠ 重启前 beforePid」（修掉 `sc start 返回 5` 后旧进程仍占端口却显示「✓ 已恢复」的假成功）。④ **脚本自删**——默认模式 port-restart-*.cjs 执行完 4s 后自删（`fs.unlinkSync(__filename)`），杜绝 cli 目录残留累积（现有 17 个残留已清理，保留 restart-dsh.cjs/cmd）。⑤ **pre-commit hook 路径修复**——机器 lk→FF 后 hook 内 NODE/SKILL/PROJ 路径过期（此前靠 cd 旧路径失败兜底跳过）；更新为 FF 路径 + skill 未安装时显式跳过。全量 158/158。— [PEN-002]
- **v3.2.1-l：默认模式「杀实际监听者 + 新 PID 防误报」（用户实测·待办修复）**：实测复现「索引滞后恶性循环」——索引 pid 指向已崩溃进程（host 崩溃前覆盖索引）→ 端口重启 taskkill 死 pid 无效 → 新 DSH 因 3080 被真实进程占用 EADDRINUSE 崩溃 → 崩溃前又写新索引（仍指向死进程）→ 重启永远失败；且默认模式脚本 poll 只查「3080 有监听」→ taskkill 失败时旧进程仍占端口却显示「✓ DSH 已恢复」（假成功）。**修复（buildPortRestartScript 设置内 + buildCliRestartScript 快捷方式默认分支同步）**：① **taskkill 目标改为「3080 实际监听者」**（netstat 查端口监听者，索引 pid 仅兜底）——索引失效也能杀对进程，根治恶性循环；② **poll 成功条件 = 新进程接管**（监听者 PID ≠ 被杀进程，旧进程仍在则持续提示不报成功，40s 超时明确失败）；③ 自删逻辑并入成功/超时分支（防 exit 提前截断）。全量 158/158。— [PEN-002]
- **v3.2.1-m：快捷方式全模式权限拦截（用户指令）**：用户实测 lnk RunAs 标志未生效（双击无 UAC 弹窗）且默认模式 taskkill 也可能命中**管理员令牌 DSH**（管理员快捷方式拉起的 DSH 是管理员进程，普通权限杀不掉）→ 普通双击总失败。**修复**：权限检测（`net session`）从服务模式分支**移到脚本最开头**——**无论服务/默认模式，非管理员一律拦截**并提示「✗ 执行失败：本快捷方式需要管理员权限，请以管理员身份运行（右键 → 以管理员身份运行）」+ 非 0 退出（不再执行任何操作、不再假报）。全量 158/158。— [PEN-002]
- **v3.2.1-n：死代码与遗留清理（用户指令·审查）**：① 删除死代码 `buildLnk`（Node 手写 .lnk 方案，已被 cscript 取代、全文件无调用）；② host 侧 `update/serviceInstall` 返回 message 同步去「或注销当前用户」（v3.2.1-j 只改了 client i18n，host 未同步——注销不触发 Auto 服务启动已实测确认）；③ 快捷方式脚本头注释版本标记更新至 v3.2.1-m。审查确认非死代码：执行器链路（executorEnsure/updater-host/isStopped 仍被一键更新使用）、launchRestartScript（默认模式在用）、markLnkRunAs（写入但 Windows 未采用，保留无副作用）；serviceActive/buildPortRestartServiceScript/svc-updater/navServiceUpdater 零残留。全量 158/158。— [PEN-002]
- **v3.2.1-o：环境检测项重构（用户需求·重新检索检测项）**：用户实测「更新端口独立」（exec-port）**永远失败**——`readServicePort` 解析服务配置 `--port`，而 DSH 服务参数是 `bin.js web`（无显式端口，3080 为默认值）→ 解析必然失败 → no-port；且 v3.2 执行器已支持**动态端口 fallback**（固定端口被占自动换动态），exec-port 检查已无实际意义。**重构**：① 删除 exec-port（sys.cjs probeEnv + plugin-host.js ENV_PROBE_KEYS + client ENV_ITEMS/ENV_DETAIL_TEXT + i18n ZH/EN 全链路清理）；② 新增 **port-mode**（3080 托管模式：`nssm 服务接管（会话 0）` / `前台默认运行（用户会话）` / `无监听`——netstat 查监听者 + tasklist 查会话号判定）与 **port-pid**（3080 实际监听者 PID）；③ client detail 渲染升级：有 i18n 映射走映射、无映射（如动态 PID 值）直接显示原文；④ 顺带删除死代码 `probePortOccupied`（exec-port 删除后无调用），`readServicePort` 保留（执行器健康检查仍用）；⑤ 测试 U45 更新为 7 项断言（service/svc-type/svc-bin/tools/net/port-mode/port-pid）。全量 158/158。— [PEN-002]
- **v3.2.1-p：一键更新下载镜像 fallback（用户实测·大陆网络 curl 56）**：用户更新时 `curl: (56) Recv failure: Connection was reset`——github releases/download 直连被网络重置（发布资产本身有效，WorkBuddy 环境完整下载 HTTP 200 验证）。**修复**：执行器 `stageTarball` 下载失败（非 0 / 超时 / 空文件）后**依次尝试镜像前缀**（`ghproxy.net` / `gh-proxy.com` / `ghfast.top`，URL 前缀拼接），全部失败才报错并提示「检查网络/代理，或手动下载 tgz 放入 staging 目录」；每次尝试独立超时（INSTALL_TIMEOUT_MS）。执行器由 ensureExternalExecutor 目录级复制，插件包同步后一键更新自动生效。全量 158/158。— [PEN-002]
- **v3.2.1-q：端口重启前安装 staging tarball（用户实测·一键更新安装未生效）**：镜像下载修复后一键更新（staged）成功、staging 目录出现 `dsh-prompt-enhancer-v3.2.1.tgz`，但**端口重启后本地仍 3.2.0**——根因：v3.1.x「一键更新只下载，安装由端口重启完成」的 staging 检查在**执行器 restart** 里，而 v3.2.1 端口重启独立化后（服务模式 schtasks / 默认模式独立脚本）**两条路径都不经过执行器 → 安装从未执行**。**修复**：`update/portRestart` handler 在触发重启前检查 `staging/` 待装 tarball（`findStagedTarball`）→ 有则先 `dsh plugin --profile <profile> add <tgz>` 安装（`installStagedTarball`，成功删 tgz 防重复），安装失败阻断并返回 `STAGED_INSTALL_FAILED` 明确错误。全量 158/158。— [PEN-002]

## [3.2.0] - 2026-08-18

### Changed
- **桌面快捷方式图标白纸根治 + 生成方案收敛为 cscript（用户反馈·关键修复）**：排查确认白纸**根因是 ICO 文件损坏**（`scripts/build-icon.cjs` 的 `Buffer.concat` 把 ICONDIRENTRY 与图像数据交替排列，违反 MS-ICON「entry 全在前、数据全在后」布局 → Shell 加载失败）——重建布局修正；同时确认 **Node 手写 .lnk（无 LinkTargetIDList）即使 IconLocation/ICO 正确也显示白纸**，WScript.Shell（cscript/pywin32 等价）生成的完整 .lnk（含 IDList）可正常显示。**方案收敛**：`update/makeShortcut` 改用 `lib/shortcut-win.cjs` —— 写临时 VBS（UTF-16LE BOM）→ spawn `cscript.exe`（Windows 自带，无 Python/pywin32 依赖）→ WScript.Shell 创建完整 .lnk → 清理临时文件；图标内嵌 `lib/shortcut-icon.cjs`（base64，由 build-icon.cjs 生成，修正布局后 16/32/48/64 四尺寸 BITMAPINFOHEADER）。**实测**：用户会话 + DSH 服务（SYSTEM 会话）makeShortcut RPC 均成功（`method:cscript`、`iconApplied:true`），桌面显示蓝色鲸鱼 ✅。移除调试产物（koffi/pywin32/VBS 测试脚本、临时 .lnk）。129/129 — [PEN-002]
- **快捷方式名跟随 UI 语言（用户需求·中英双语）**：client 按当前语言传 `locale`（t('updMakeShortcut')==='桌面'→zh / else en）→ host 创建「**重启DSH.lnk**」（zh）/「**Restart DSH.lnk**」（en），旧名（重启DSH服务 / Restart DSH Service）自动删除避免重复；i18n `updShortcutOk` 文案双语同步。实测：zh/en 均创建正确 + 鲸鱼图标写入（iconApplied=true）— [PEN-002]
- **快捷方式名改「重启DSH」（用户需求）**：makeShortcut 创建 `桌面\重启DSH.lnk`（原「重启DSH服务」删除避免重复）；i18n `updShortcutOk` 文案同步。实测：桌面只剩「重启DSH.lnk」、鲸鱼图标保留（iconApplied=true）— [PEN-002]
- **桌面快捷方式图标实现改 Node 直接生成 .lnk（修复 SYSTEM 会话图标不写入）**：实测 WScript.Shell 在 SYSTEM 会话（DSH 服务进程）下**写 IconLocation 被静默忽略**（TargetPath 等正常、图标字段不落盘）——改为 `buildLnk()` **Node 按 Shell Link 二进制格式直接生成 .lnk**（Header + LinkInfo LocalBasePath + StringData 含 IconLocation + TerminalBlock），完全可控、跨环境一致；makeShortcut 读回 .lnk 验证图标（iconApplied 字段）。**实测 iconApplied=true**（此前 WScript.Shell 方案恒 false）— [PEN-002]
- **桌面快捷方式图标 + 按钮文案优化（用户需求）**：① 快捷方式图标换 **DeepSeek 蓝色鲸鱼**——新增 `assets/deepseek.ico`（官方 favicon 下载入库），makeShortcut 时复制到 `EXECUTOR_ROOT/icons/deepseek.ico` → `.lnk` IconLocation（复制失败回退默认图标，不阻断）；② 端口重启确认态按钮文案「快捷」→「**桌面**」（i18n `updMakeShortcut`）；③ 按钮加悬停提示（title）「创建桌面快捷方式」（i18n 新增 `updShortcutTooltip` zh/en）；成功提示文案补充鲸鱼图标说明。全量测试 **152/152** — [PEN-002]
- **桌面快捷方式 CLI 重启（用户需求·脱离 Web 重启端口）**：① **确认按钮文案**「确认重启服务？」→「确认」；② 端口重启确认态新增「**快捷**」按钮——经新 RPC `update/makeShortcut`（host）生成 CLI 脚本（`EXECUTOR_ROOT/cli/restart-dsh.cmd`：node + `updater-host.cjs --cli restart` + pause）并创建桌面快捷方式「重启DSH服务.lnk」（PowerShell WScript.Shell，USERPROFILE 由 nssm 设为 lk → 桌面路径正确）；③ **执行器 CLI 模式**（`updater-host.cjs --cli restart [--service dsh-web] [--profile web]`）——不 listen 端口，优先探测运行中执行器（3081，SYSTEM 权限有权 sc 控制）调 restart RPC + 轮询 status 打印步骤到 stdout（cmd 窗口展示：stopping → round N → healthy）；执行器未运行则本进程直接重启（无权限提示以管理员运行）；④ i18n 新增 `updMakeShortcut`/`updShortcutOk`/`updShortcutFail`（zh/en）。核心场景：3080 崩溃页面打不开 → 双击桌面快捷方式 → CLI 窗口重启服务。全量测试 **152/152**；CLI 重启实机验证通过（PID 1432→23592）+ makeShortcut 实机验证通过（.lnk/.cmd 生成正确）— [PEN-002]
- **执行器端口冲突自动 fallback 动态端口（用户指令·可选优化落地）**：固定端口（3081）被占用时执行器不再直接退出——`lib/updater-host.cjs` listen 捕获 EADDRINUSE → 自动 `listen(0)` OS 动态分配 → 实际端口写入 `EXECUTOR_ROOT/executor.port`（`{port,pid,ts}`）；`lib/index.cjs` `update/executorEnsure` 在固定端口拉起失败后读端口文件发现真实端口并 ping 验证，返回 `{ port: 动态 }` 供 client 使用；client（updater-card.js）apply/restart/轮询/失败重试全部改用 executorEnsure 返回的实际端口；`probeEnv` exec-port 语义调整——端口冲突（same-as-service / exec-occupied）降为 warn（提示「将使用动态端口」），不再 block，client `EXECUTOR_LINK_BLOCKS` 只保留 `tools`；i18n 新增 `envExecPortDynamic`（zh/en）。新增 `sys.readExecutorPortFile`（可注入路径）+ 单测。全量测试 **152/152**；动态 fallback **实机验证通过**（占 3081 → 执行器 fallback 62864 → 端口文件正确）— [PEN-002]
- **重启链路对照成熟产品优化（用户指令·检索 PM2/systemd/openclaw/Windows SCM 参考）**：① **进程级 kill 三级升级**（参考 PM2 信号流 + systemd EADDRINUSE 经验）——原实现 SIGTERM 后只等端口释放最多 10s 就 spawn（旧进程没死会直接 EADDRINUSE）；现改为 SIGTERM → 等 PID 消失（kill-timeout 5s）→ 未退出强杀（win `taskkill /F /T` 进程树 / linux·mac SIGKILL）→ 再等端口释放才 spawn；② **macOS startService 顺序修正**（参考 openclaw 竞态事故 + launchd 文档）——原实现 bootout 后先 `launchctl start`（对已卸载 job 必然失败）再 bootstrap；现改为 bootstrap 重新注册优先 → kickstart 启动，已加载时 `kickstart -k` 快速重启（launchd 无 restart 动词的标准做法）；③ **停止等待 10s→20s**（参考 sc stop 异步坑 + SCM 30s 停止超时窗口）——三处共用循环统一加长，慢停止服务不再误判 STOP_FAILED。新增 darwin.startService 2 单测。全量测试 **151/151**；Windows 实机 restart 验证通过 — [PEN-002]
- **三平台服务化对照社区实践修正（用户指令·检索 Linux/macOS 参考）**：① **修复 macOS launchctl 解析 bug**——`launchctl list` 官方输出是 `PID Status Label`（PID 第一列），原实现把 Status 当 PID（`parseLaunchctlList` 字段错位，导致 darwin.pid/检测错误）→ 修正为 PID 第一列；② **Linux MainPID 优化**——`systemctl show -p MainPID --value` 直接输出纯数字（社区惯例），解析兼容两种格式；③ **Linux readPort 补充 `Environment=PORT=3000`**——systemd unit 社区惯例用 Environment 设端口（无 `--port` 时回退解析）；④ macOS 参考确认 `kickstart -k` 是现代重启标准（当前 bootout/bootstrap 可用，记录为可选优化）。测试更新 + 新增 Environment PORT 用例。全量测试 **149/149** — [PEN-002]
- **进程级重启降级路径（用户指令·参考 dsh-restart 生态实现）**：非服务化部署（无系统服务）时执行器改用**进程级重启**——host 在 DSH 进程内启动时写进程索引 `$DSH_HOME/dsh-prompt-enhancer.json`（pid/execPath/cwd/argv，尽力而为）；执行器 `restartService` 在「平台不支持服务管理或服务不存在」时读索引 → kill 旧进程 → spawn 同参数新进程（detached + 日志）→ 端口探测（最多 30s）；与服务管理器路径互补（服务化 → sc/systemctl/launchctl；裸跑 → 进程级）。`readProcessIndex` 抽到 platform-service（无副作用可单测）；新增 2 单测。全量测试 **148/148** — [PEN-002]
- **跨平台更新重启链（用户指令·扩展 Windows/Linux/macOS）**：新增 `lib/platform-service.cjs` 平台服务管理后端——六接口（detectService/readPort/stopService/startService/isStopped/pid）按 `process.platform` 分发：**win32** sc/reg/nssm（原逻辑迁入，行为不变）/ **linux** systemctl（is-active/is-enabled/show ExecStart/MainPID）/ **darwin** launchctl（list/print/bootout/bootstrap + plist 回退）；提取纯解析函数（parseSystemdActive/parseLaunchctlList/parsePortFlag 等，可单测）。改造：`lib/sys.cjs` probeEnv/readServicePort 平台化（服务检测/端口解析/tools 检查按平台；exec-port 端口占用 win netstat+tasklist / linux·mac lsof）；`lib/updater-host.cjs` 重启链平台化（stop/start/PID 走后端；`portListening` 改 Node net 跨平台连接探测；非服务平台明确 UNSUPPORTED_PLATFORM 提示）。新增 `test/platform-service.test.cjs` 17 单测（含 linux/darwin mock 命令输出验证）。方案见 `docs/internal/方案-跨平台更新重启链-2026-08-18.md`。全量测试 **146/146**；Windows 实机 restart RPC 验证通过；执行器磁盘文件已同步（下次执行器重启生效）— [PEN-002]
- **复查补充：删除 en-only 死键 `cfgEngine`（审计遗漏）**：EN 段 `cfgEngine`（'Engine'）无 zh 对应、全项目 0 引用（首次清理按 zh 键集扫描漏掉 en-only 键）。删除后 zh/en 键数平衡（209/209）；复查确认无其他遗漏（死函数/常量/导出/组件/样式/模板/测试全部干净）— [PEN-002]
- **删除 `main` 死配置字段（用户指令·不维护老用户迁移）**：顶层 `main`（provider/model/reasoning）从配置体系彻底移除——① config-schema.js：CONFIG_DEFAULTS/validateConfig/migrateLegacyConfig 的 main 处理删除（v1 平铺 provider/model 不再迁移）② pure.js validateConfig：main 解析段 + 输出 `provider/model/reasoningEffort` 字段删除（host 从未消费，只用 fallback 模型链；`effortOf` 保留——fallback 条目级使用）③ client state.js：cloneDefaults/sanitizeV2/migrateFromV1 的 main 处理删除 + `migrateMainIntoChain` 函数及 2 处调用删除 ④ constants.js CONFIG_DEFAULTS.main 删除 ⑤ 测试更新（CFG-03、validateConfig 平铺/边界断言、battery canon/canonSchema 去 main）。全量测试 129/129 — [PEN-002]
- **死代码/死配置全量清理（用户指令·审计后清理）**：① i18n 死键 38 个 ×2（zh/en）删除——旧版 UI 遗留（upd* 14 / sec* 6 / cfgReasoning* 4 / cfgTestEstimate* 3 / cfgCustom* 4 / cfgNav·cfgProvider·cfgModel / cfgTemplateBuiltin·Custom·Note / cfgEmptyModels / navPlugins / pluginsApprove / titleEmpty），全部为删功能后未清的文案 ② pure.js 死常量 2 个删除（`INJECT_FILE_TOP_N`、`RELEVANCE_WINDOW_MAX_CHARS`，定义后从未引用）③ logger.js 死导出 `LEVELS` 删除 ④ helpers.js 死函数 `readSeen` 删除（关联的 clearSeen/seenKey/SEEN_KEY_PREFIX 为活保留）。构建产物验证死代码清零；全量测试 129/129 — [PEN-002]
- **设置导航 label 前加 ✨ 图标（用户需求·与输入框优化按钮一致）**：settings.section 导航「提示词增强」label 前拼 `'✨ '`（与输入框优化按钮 EnhanceButton 的 dsh-enh-icon 图标一致）— [VU-001]
- **设置界面导航名改名（用户需求）**：`navModelPlugins`「模型与插件」→「**提示词增强**」（en：Models & plugins → **Prompt Enhancer**）；同步页面标题、tablist aria-label 与设置导航 label — [VU-001]
- **模型配置栏提示文案微调（用户指定表述）**：`cfgRestoreNote` →「「恢复默认」重置模型链为官方模型配置，不清除自定义模板、优化参数与记忆设置」（去掉「仅」与「1 Flash、2 Pro」细节）；`cfgFallbackNote` →「按顺序逐一尝试，失败则用下一条，可增删改序」（去掉「每条可设思考」）。en 同步 — [PEN-002]
- **模型行操作 hover 提示（用户需求·类似测试连通性按钮提示）**：MarqueeSelect 组件透传 `title` 给 trigger；模型配置栏**思考开关**加 hover 提示「启用/关闭该模型思考能力」（`selThinking`）；模型行末尾 **↑↓✕ 三按钮** title 从无意义字符改为「上移（优先级更高）/ 下移（优先级更低）/ 删除该模型」（`rowUp`/`rowDown`/`rowRemove`）；测试结果区 ✕ 关闭按钮 title 对齐 `dismiss`。i18n 新增 4 键（中/英）— [PEN-002]
- **设置界面提示文案精简排版（用户需求·优化参数介绍太详细）**：params-tab 超长介绍全部压缩到一句话要点——`cfgMemoryNote` 181→40 字（保留核心：开启累积记忆链/关闭不读写/发送清空）；`tplNote` 132→42 字（默认只重述/增量补大逻辑/自定义 ≤4000）；`cfgModeHintPublish` 131→45 字（**顺带修正过时信息：去掉已取消的「记忆强制开启」**）；`cfgContextNote` 112→40 字（去档位数值表，下拉本身可见）；`cfgHint` 55→28 字（去主题提示）；`cfgModeHintLite` 45→29 字。另修正 `cfgRestoreNote` 过时语义（「自适应当前可用模型」→「官方两个模型（1 Flash、2 Pro）」，与上一轮恢复默认改动一致）。en 同步精简 — [PEN-002]
- **恢复默认/首次安装 = 官方两个模型（用户需求）**：新增 `DEFAULT_MODEL_CHAIN`（官方两模型：1 Flash、2 Pro）——「恢复默认」按钮与 fresh install 首次安装都填官方两模型（不再走 autochain 自适应解析）；**非运行时兜底**——模型可删除可改，增强时模型链为空仍报 `NO_MODEL`（不自动使用，上一轮「删内置兜底链」语义保留，BUILTIN_CHAIN 不恢复）— [PEN-002]
- **删除内置兜底链 BUILTIN_CHAIN（用户需求·完全按模型配置顺序）**：增强不再自动用内置 DeepSeek 官方模型兜底——① `buildTryChain` 去掉 adaptive 补足分支，模型链完全按用户配置顺序尝试；② 模型链为空时增强报 `NO_MODEL`「未配置模型，请在设置中添加模型」（host friendlyMessage + client errorKey + i18n zh/en）；③ 「恢复默认」不再填内置链（autochain 失败清空，由用户配置）；④ fresh install 不再静态补齐内置链（autochain 失败留空）；⑤ 删除 `constants.js` BUILTIN_CHAIN 定义；测试断言更新（空链 → 空链）。实测：空链增强返回 `code=NO_MODEL` ✅ — [PEN-002]
- **会话历史显式内容提取上限调大（用户需求）**：`V2_MSG_TEXT_MAX` 1200 → **2400**——rounds 检索提取的会话历史单条消息不再轻易截断（覆盖长回复/表格，显式内容更完整）；最终注入量仍由上下文预算（roundsChars）控制 — [PEN-003]
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

[3.2.4]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.2.4
[3.2.3]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.2.3
[3.2.2]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.2.2
[3.2.1]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.2.1
[3.2.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v3.2.0
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
