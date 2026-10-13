# dsh-prompt-enhancer 兼容性矩阵

> 维护：架构重构 M0 基线
> 用途：明确 RPC / 配置 / 形态 / 版本兼容边界，作为重构期间防回归依据。

---

## 1. 支持形态

| 形态 | 持久性 | 更新方式 | 是否支持一键更新 |
|---|---|---|---|
| bundle | ✅ 持久 | `dsh plugin add/update` + 重启 | ✅ |
| 动态 Cordis | ❌ 会话级 | `cordis_define` + `cordis_run` | ❌ |
| 脚本副本 | ✅ 持久 | 覆盖文件 | ❌ |

---

## 2. RPC 方法清单

### host RPC（`/dsh-prompt-enhancer/rpc`）

| 方法 | 方向 | 说明 | 权限 |
|---|---|---|---|
| `enhance` | client → host | 执行增强 | 用户触发 |
| `enhance/progress` | client → host | 增强进度 | 只读 |
| `cancel` | client → host | 取消增强 | 用户触发 |
| `models/list` | client → host | 模型列表 | 只读 |
| `models/current` | client → host | 当前模型 | 只读 |
| `models/resolve` | client → host | 解析模型 | 只读 |
| `models/test` | client → host | 连通性测试 | 用户触发 |
| `models/stats` | client → host | 模型实测统计（扫会话投影聚合 TTFT / tokens-per-second，附 base/lite 预估秒数） | 只读 |
| `models/autochain` | client → host | 自适应链 | 只读 |
| `template/default` | client → host | 默认模板 | 只读 |
| `logs/last` | client → host | 诊断日志 | 只读 |
| `config/get` | client → host | 读取磁盘配置（$DSH_HOME/dsh-prompt-enhancer.config.json；DSH Desktop 动态端口配置恢复） | 只读 |
| `config/set` | client → host | 写入磁盘配置（原子写 tmp+rename，≤1MB） | 用户触发 |
| `voice/status` | client → host | 语音引擎就绪态（**委托官方 `ctx.speechToText.snapshot()`**）+ 规整就绪态 | 只读 |
| `voice/transcribe` | client → host | 音频（16k mono PCM16 WAV data URL）→ **委托官方 `ctx.speechToText`** 识别 → 可选规整，返回 `{text,raw,refined}` | 用户触发 |

> 注：`models/*` / `logs/*` / `template/*` / `enhance*` / `cancel` 共 **11** 条注册于 `plugin-host.js`（由 `lib/index.cjs` 读出 `BODY` 并桥接）；`config/*` / `voice/status`·`voice/transcribe` 共 **4** 条注册于 **host 半部 `lib/` 侧的真 CommonJS 模块**——`config/*` 在 `lib/rpc-config.cjs`、`voice/*` 在 `lib/rpc-voice.cjs`（P2-3 拆分批起；`lib/index.cjs` 现为**薄装配入口**，自身不注册 RPC）。两侧同挂 `/dsh-prompt-enhancer/rpc`，合计 **15** 条（以 `harness.handle(` 枚举逐条对照 —— **P2-3 起派生面 = `lib/` 下全部非生成 `.cjs` + `plugin-host.js`**，可由 `node scripts/rpc-manifest.mjs` 复算）。
>
> ⚠ **历史**（**已退役，不再注册**）：`plugins/*`（4）· `update/check`·`update/pull`·`update/envcheck`（3）· `update/executorEnsure`·`update/install`·`update/restartNeeded`·`update/diagTail`（4）· `update/portRestart`·`update/makeShortcut`（2）· `voice/model*`·`voice/deploy*`（8）⇒ 共 21 条已随「插件管理 tab 退役 / 更新执行器退役 / 插件内重启能力退役 / P1-a 语音缩批」移除。**上方表格为现行集合，本节历史条目仅供旧版本对照，不代表现行能力。**


> 注（**P2 · 2026-09-19 · 参数校验申报**）：上述 **15 条中 6 条有参数校验**（`lib/rpc-schema.cjs` 的 `schemas`），另 **9 条无校验且在此具名申报**——**禁止按类别笼统豁免**；新增线上方法却不申报、或申报过期，都会被 `node scripts/rpc-manifest.mjs --check` 拒绝（事实源由注册面派生，不靠人工清点）。
>
> | 方法 | 桶 | 理由 |
> |---|---|---|
> | `cancel` | **A** 无参/只读 | 只读：取消信号（无匹配时静默成功） |
> | `enhance/progress` | **A** 无参/只读 | 只读：查询优化进度（不存在的 seq 返回空） |
> | `logs/last` | **A** 无参/只读 | 无参只读：返回日志环 |
> | `models/autochain` | **A** 无参/只读 | 入参仅 noCache 布尔，宽松语义即契约 |
> | `models/current` | **A** 无参/只读 | 无参只读：读当前选择的模型 |
> | `models/list` | **A** 无参/只读 | 无参只读：列举 provider 与模型 |
> | `models/stats` | **A** 无参/只读 | 入参仅 provider/model/inputChars 展示用，非法值退化为空统计（无副作用） |
> | `template/default` | **A** 无参/只读 | 无参只读：返回内置模板目录 |
> | `models/resolve` | **B** 有参·保持宽松 | 有参（provider/model）保持宽松：非法值由下游 resolveModelInfo 兜底，收紧急属 BREAKING |
>
> **A 桶** = 无参 / 只读 / 无副作用入参，无可校验之物。**B 桶 = 有入参但保持宽松**——补校验会把既有「静默容忍」的调用变成 **400**，属**已发布对外行为变更**，须单列并标 BREAKING 由用户拍板，故本轮**只申报不收紧**（圆桌决策 A 的边界）。
### executor RPC（`127.0.0.1:3081/rpc`）· **已退役**

> ⚠ **P1-c（2026-10-13）：插件自建更新执行器整体退役**（`lib/updater-host.cjs` 已整件删除，3081 端口不再由本插件使用）——更新 / 安装全量交回官方 plugin manager。
>
> 历史方法（**仅供旧版本对照，现行不存在**）：`ping`（心跳/版本）· `status`（当前状态）· `apply`（安装：下载 → sha256 校验 → 落 staging → 安装 → 失败回滚，不含重启）。

---

## 3. 配置项清单

### host / 全局配置

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `mode` | string | `base` | 优化模式 |
| `memory` | boolean | `false` | 记忆开关 |
| `context.budgetChars` | number | `4000` | 上下文预算 |
| `timeoutMs` | number | 见代码 | 超时 |
| `maxTokens` | number | 见代码 | token 上限 |
| `outputLimit` | number | 见代码 | 输出上限 |
| `template.mode` | string | `builtin` | 模板模式（兼容保留；新 UI 以每模式 `pick` 为准） |
| `template.texts` | object | 内置 | 每模式模板（兼容保留；有 `pick` 时不再参与解析） |
| `template.pick` | object | 各模式 `default` | 每模式选中模板键：`default`（模板1 现有默认）/ `supplement`（模板2 增量补充完善）/ `dev`（模板3 增量完善·开发向）/ `custom:<index>`（自定义列表条目）；非法/越界回退 `default` |
| `template.custom` | object | 各模式 `[]` | 每模式自定义模板列表 `[{name, text}]`：≤10 条/模式，`text` ≤4000，`name` ≤40 |
| `fallback` | array | 内置 | 模型链 |
| `customModels` | array | `[]` | 自定义模型 |
| `order` | array | 内置 | 模型顺序 |

### updater 配置 · **已退役**

> ⚠ **P1-c（2026-10-13）判定：整节为幽灵配置**。判定依据（全仓 grep 原始读数）：`updater.serviceName` / `updater.profile` / `updater.executorPort` 三键在 `lib/` · `src/` · `plugin-host.js` · `scripts/` · `test/` 中**零命中** ⇒ **无任何代码读写**（配置读写面 = `config/get`·`config/set` 的 `$DSH_HOME/dsh-prompt-enhancer.config.json`，其中不含 `updater.*`）。
>
> 历史键（**仅供旧版本对照，现行无代码读写**）：`updater.serviceName`（服务名，默认 `dsh-web`）· `updater.profile`（profile，默认 `web`）· `updater.executorPort`（执行器端口，默认 `3081`）——三者随「插件自建更新执行器退役」一并失活。

### client localStorage

| key | 说明 |
|---|---|
| `dsh-prompt-enhancer:config` | 配置缓存（重构后迁移至 entry config） |
| 会话内存 `memoryRounds` | 记忆链（仅内存） |

---

## 4. 版本兼容矩阵

| 插件版本 | client protocol | executor protocol | 说明 |
|---|---|---|---|
| ≤ 2.8.3 | 隐式 | 0.1.5 / 0.1.6 | 无显式协议版本 |
| 3.0.0（重构目标） | `protocolVersion: 1` | `protocolVersion: 1` | 显式协商 |
| 3.2.x | `protocolVersion: 1` | 0.1.12+（内容哈希重建） | update/portRestart 独立化（服务模式 schtasks / 默认模式脚本）；执行器专注一键更新/watchdog（该 RPC 与 watchdog 已于 3.3.x 之后的迭代退役，此处仅作历史版本对照） |
| 3.3.x – 3.4.2（当前） | `protocolVersion: 1` | **已退役（无）** | ⚠ **P1-c（2026-10-13）：更新执行器整体退役**（`lib/updater-host.cjs` / `lib/stage-install.cjs` 已删）⇒ **executor protocol 概念不再适用**，更新/安装交回官方 plugin manager；**插件内重启能力退役**（`update/portRestart` / `update/makeShortcut` / 执行器 `restart` / watchdog / 维护救援 CLI 全部移除）；**`update/install` 亦已退役**（勿再误读为现行能力）——装完由官方流程提示重启 DSH 生效 |

兼容策略：

- host 与 client 通过 `protocolVersion` 协商，不匹配时返回明确错误。
- ~~executor 版本由 `EXECUTOR_VERSION` + 内容哈希（.executor-hash）管理，`executorEnsure` 负责对齐~~ → **P1-c（2026-10-13）已退役**：执行器与 `executorEnsure` 均不存在，本策略作废（保留删除线仅供历史对照）。
- 旧 client + 新 host：优先兼容层；无法兼容时提示刷新/升级。
- 版本检测：本地版本**运行时读运行环境 package.json**（非构建硬编码），发版后产物与版本号天然一致。

### 4.1 客户端依赖边界

| 依赖 | 声明处 | 版本边界 | 不满足时行为 |
|---|---|---|---|
| `@deepseek-ai/dsh-client-locale` | `package.json` `peerDependencies`（与 `dsh.client.inject` 同名列） | `>=0.1.0-rc.6`（覆盖 0.1.x 与 0.2.x 两线） | 宿主不满足 → 插件被 compatibility 门拒绝装载，**整个 bundle 在 profile 启动阶段被 skip**（✨/🎤/设置页 UI 均不出现，且客户端零提示） |
| `@deepseek-ai/dsh-client-ui-renderer` | **不在** `peerDependencies`，由宿主自带 | 会话级槽位条目契约自 `0.1.2-rc.1` 起 | 更早渲染器只提供 `props.session` / `props.input` 形态 → 插件走旧形态回退兼容；两种形态都无 → ✨/🎤 不渲染 |
| 客户端 `inputActions`（草稿插入能力） | 宿主 client 注入（能力判定，无版本号） | — | 无 `setDraft` → 识别结果追加到草稿末尾；完全不注入 → 🎤 禁用并提示 |

> **已移除（2026-10-06）**：`@deepseek-ai/dsh-client-runtime` 原列于上表首位（peer + `dsh.client.inject` 同名，边界 `^0.1.0-rc.6`）。该包自 DSH `0.2.0` 起**已从发行物中消失**（0.2.0-rc.2 的 62 个 `dsh-client-*` 中无它；npm 末版 `0.1.1-rc.2` @2026-08-21 后停发），而 `^0.1.0-rc.6` 在 semver 上**不含 0.2.x** ⇒ 二者叠加使插件在 0.2.0-rc.2 上被 `evaluatePluginCompatibility` 判为不兼容并 deny（远端 issue #11 / #12 与本机 `skipping profile bundle` 同根因）。实测本仓**对该包零真实引用**（`src/`、`lib/`、`scripts/`、`test/`、`cordis.patch.yml`、`plugin-host.js`、`README*` 全零命中；产物 `lib/client.cjs` 唯一 `require` 是 `'react'`），故**直接移除声明**而非放宽版本。依据与逐条证据见 `docs/internal/适配勘察-2026-10-06.md`（§3.1/§3.4）与 CHANGELOG `[Unreleased]` 2026-10-06 条目。

说明：`package.json` `dependencies` **现为空**（`{}`）——⚠ **P2 复核处置批（2026-10-13 · F3 级联）**：原唯一依赖 `undici` 的使用面（`lib/net-proxy.cjs` 的 `httpsGetProxied` / `httpsGetDirect` / `agentForProxy` 出网出口族）经复核确认从唯一活导出 `curlProxyArgs` **不可达**、全仓零消费者后**整体删除** ⇒ 全仓（`src/` · `lib/` · `scripts/` · `test/` · `plugin-host.js` · `cordis.patch.yml`）**零真实引用** ⇒ 按红线「只有声明、无真实引用 → 直接移除」连同 `package-lock.json` root 条目与 `scripts/sync-runtime.mjs` 的依赖同步段一并移除（更早背景：P1-c 起执行器已退役，`ensureExternalExecutor` 亦已随 P2-1 删除）；P1-a（2026-10-13）后**不再服务语音模型下载**——本地引擎及其模型获取链路已整体退役（识别改交官方 `speechToText`，见本文件 §语音条目与 `docs/internal/P1-a-缩批施工-2026-10-12.md`）；host 半部与执行器不声明 peerDependency。上表由 `package.json` `peerDependencies` 与 README「输入框工具行（✨/🎤）客户端契约」段落实读得出，改 peerDependency 或槽位契约时须同步本节。

> ⚠️ **声明面一致性契约**：`peerDependencies` 的包名集合与 `dsh.client.inject` 必须**逐项相等**（本节即该事实的记录处）；改一侧必须同步另一侧，否则形成自相矛盾的声明面。可复跑校验：`node -e "const p=require('./package.json');console.log(JSON.stringify(Object.keys(p.peerDependencies).sort())===JSON.stringify([...p.dsh.client.inject].sort()))"` 应为 `true`。

---

## 5. 兼容性红线

1. 动态 Cordis 安装必须始终可用 → `plugin-host.js` / `lib/client.cjs` 保持单文件产物。
2. 所有 RPC 方法名不得随意变更；变更必须走 `protocolVersion`。
3. 配置迁移必须可回退，禁止静默丢失用户设置。
4. 多 profile（web/headless/自定义）必须继续支持。
5. 安装/更新必须走**受控通道**：~~一键更新仅接受 GitHub Release 的 npm pack tgz（固定仓库 `buildTarballUrl`）+ staging 目录内的本地 tgz（路径白名单校验）；v3.2.2 起安装为直接解包复制到运行环境目录（`System32\tar.exe` + 文件级覆盖）~~ → ⚠ **P1-c（2026-10-13）：上述「插件自建安装通道」已整体退役**（`lib/updater-host.cjs` / `lib/stage-install.cjs` 已删），现行安装/更新**全量走官方 plugin manager**（`dsh plugin add/update`）。⚠ **本条红线表达的原则仍然有效并继续适用**：**禁止任意路径 / 任意命令执行安装** —— 安装包的来源与解包路径必须受控（现行形态 = 官方 plugin manager 的既有约束）；**不得为任何功能的实现引入「从任意 URL / 任意本地路径直接执行安装」的旁路**。
