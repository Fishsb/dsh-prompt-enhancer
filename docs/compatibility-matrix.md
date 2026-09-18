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
| `update/check` | client → host | 版本检测（local 运行时读运行环境 package.json） | 只读 |
| `update/pull` | client → host | 拉取清单文件 | 用户触发 |
| `update/envcheck` | client → host | 环境检测 | 只读 |
| `logs/last` | client → host | 诊断日志 | 只读 |
| `plugins/inventory` | client → host | 插件清单 | 只读 |
| `plugins/run` | client → host | 运行插件 | 管理 |
| `plugins/stop` | client → host | 停止插件 | 管理 |
| `plugins/undefine` | client → host | 取消定义 | 管理 |
| `update/executorEnsure` | client → host | 拉起/对齐执行器（版本+内容哈希） | 用户触发 |
| `update/install` | client → host | 安装已下载的 staged 包（sha256 校验 → 解包覆盖运行环境 → 写部署账本，返回 `{ok, installed, version, restartNeeded:true}`；**不重启**，装完提示手动重启 DSH） | 用户触发 |
| `update/restartNeeded` | client → host | 检测未重启 | 只读 |
| `update/diagTail` | client → host | 诊断日志尾部补取（只读·脱敏；更新/重启失败路径补 DSH err 日志根因） | 只读 |
| `config/get` | client → host | 读取磁盘配置（$DSH_HOME/dsh-prompt-enhancer.config.json；DSH Desktop 动态端口配置恢复） | 只读 |
| `config/set` | client → host | 写入磁盘配置（原子写 tmp+rename，≤1MB） | 用户触发 |
| `voice/modelList` | client → host | 本地模型清单（含已下载状态） | 只读 |
| `voice/modelDownload` | client → host | 下载本地模型（读配置 `download.proxy` 走显式代理；多源切换 + 断点续传） | 用户触发 |
| `voice/modelProgress` | client → host | 模型下载进度 | 只读 |
| `voice/modelApply` | client → host | 切换当前本地模型（重启 worker 加载） | 用户触发 |
| `voice/modelOpenDir` | client → host | 打开模型目录 | 用户触发 |
| `voice/modelDelete` | client → host | 删除已下载模型 | 用户触发 |
| `voice/deployRuntime` | client → host | 本地引擎运行时一键部署（复制 worker + 安装 sherpa-onnx，异步） | 用户触发 |
| `voice/deployStatus` | client → host | 部署状态轮询 | 只读 |
| `voice/status` | client → host | 语音引擎 / 规整就绪状态（local 字段实时探测 worker） | 只读 |
| `voice/transcribe` | client → host | 音频（data URL）→ 云端/本地识别 → 可选规整，返回 `{text,raw,refined}`；apiKey 不进 RPC 请求 | 用户触发 |

> 注：`models/*` / `plugins/*` / `logs/*` / `template/*` / `update/check`·`update/pull`·`update/envcheck` / `enhance*` / `cancel` 共 18 条注册于 `plugin-host.js`（经 `lib/index.cjs` 桥接）；`config/*` / `voice/*` / `update/executorEnsure`·`update/install`·`update/restartNeeded`·`update/diagTail` 共 16 条直接注册于 `lib/index.cjs`。两侧同挂 `/dsh-prompt-enhancer/rpc`，合计 **34** 条（插件内重启能力退役后重算：`update/portRestart` / `update/makeShortcut` 两条 RPC 已移除，`update/install` 与 `update/diagTail` 为现行集合；以两文件 `harness.handle(` 枚举逐条对照）。

> 注：`update/executorEnsure` / `update/install` / `update/restartNeeded` 在 host RPC 清单中保留（部分版本由 client 直连执行器 3081），见 executor RPC；执行器自插件内重启能力退役后只负责**下载 / 校验 / 安装 / 回滚**，不再重启。

> 注（**P2 · 2026-09-19 · 参数校验申报**）：上述 34 条中 **17 条有参数校验**（`lib/rpc-schema.cjs` 的 `schemas`），另 **17 条无校验且在此具名申报**——**禁止按类别笼统豁免**；新增线上方法却不申报、或申报过期，都会被 `node scripts/rpc-manifest.mjs --check` 拒绝（事实源由注册面派生，不靠人工清点）。
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
> | `plugins/inventory` | **A** 无参/只读 | 只读：列举插件清单 |
> | `template/default` | **A** 无参/只读 | 无参只读：返回内置模板目录 |
> | `update/restartNeeded` | **A** 无参/只读 | 只读：文件 mtime 比对，无副作用 |
> | `voice/deployRuntime` | **A** 无参/只读 | 无参动作：部署本地 ASR worker（固定流程，无用户入参） |
> | `voice/deployStatus` | **A** 无参/只读 | 无参只读：本地 worker 部署态 |
> | `models/resolve` | **B** 有参·保持宽松 | 有参（provider/model）保持宽松：非法值由下游 resolveModelInfo 兜底，收紧急属 BREAKING |
> | `plugins/stop` | **B** 有参·保持宽松 | 有参（pluginId）保持宽松：非法 id 由插件面自行返回 not-found |
> | `plugins/undefine` | **B** 有参·保持宽松 | 有参（pluginId）保持宽松：同上 |
> | `update/executorEnsure` | **B** 有参·保持宽松 | 有参（port）保持宽松：非法端口由执行器侧拒绝 |
> | `update/pull` | **B** 有参·保持宽松 | 有参（repo/sessionId）保持宽松：本仓无调用点（handler 按决策保留），收紧收益为零 |
>
> **A 桶** = 无参 / 只读 / 无副作用入参，无可校验之物。**B 桶 = 有入参但保持宽松**——补校验会把既有「静默容忍」的调用变成 **400**，属**已发布对外行为变更**，须单列并标 BREAKING 由用户拍板，故本轮**只申报不收紧**（圆桌决策 A 的边界）。
### executor RPC（`127.0.0.1:3081/rpc`）

| 方法 | 说明 |
|---|---|
| `ping` | 心跳 / 版本 |
| `status` | 当前状态 |
| `apply` | 安装（下载 → sha256 校验 → 落 staging → 安装 → 失败回滚；**不含重启**） |

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

### updater 配置

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `updater.serviceName` | string | `dsh-web` | 服务名 |
| `updater.profile` | string | `web` | profile |
| `updater.executorPort` | number | `3081` | 执行器端口 |

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
| 3.3.x（当前） | `protocolVersion: 1` | 0.1.12+（内容哈希重建） | v3.3.3 起执行器副本同步 `undici` 依赖（缺失时代理能力降级为直连，进程不崩）；`update/serviceInstall` 已移除（不再提供 nssm 服务化安装入口）；**插件内重启能力退役**——`update/portRestart` / `update/makeShortcut`、执行器 `restart` 方法、watchdog 与维护救援 CLI 全部移除；新增 `update/install`（安装已下载的 staged 包），**装完提示手动重启 DSH 生效** |

兼容策略：

- host 与 client 通过 `protocolVersion` 协商，不匹配时返回明确错误。
- executor 版本由 `EXECUTOR_VERSION` + **内容哈希**（.executor-hash）管理，`executorEnsure` 负责对齐（代码变自动重建，不依赖手动 bump）。
- 旧 client + 新 host：优先兼容层；无法兼容时提示刷新/升级。
- 版本检测：本地版本**运行时读运行环境 package.json**（非构建硬编码），发版后产物与版本号天然一致。

### 4.1 客户端依赖边界

| 依赖 | 声明处 | 版本边界 | 不满足时行为 |
|---|---|---|---|
| `@deepseek-ai/dsh-client-runtime` | `package.json` `peerDependencies`（与 `dsh.client.inject` 同名列） | `^0.1.0-rc.6` | 宿主缺失 → `dsh.client.inject` 不满足，client 半部不注入（✨/🎤/设置页 UI 均不出现） |
| `@deepseek-ai/dsh-client-locale` | `package.json` `peerDependencies`（与 `dsh.client.inject` 同名列） | `^0.1.0-rc.6` | 同上（同时是 i18n 取词源） |
| `@deepseek-ai/dsh-client-ui-renderer` | **不在** `peerDependencies`，由宿主自带 | 会话级槽位条目契约自 `0.1.2-rc.1` 起 | 更早渲染器只提供 `props.session` / `props.input` 形态 → 插件走旧形态回退兼容；两种形态都无 → ✨/🎤 不渲染 |
| 客户端 `inputActions`（草稿插入能力） | 宿主 client 注入（能力判定，无版本号） | — | 无 `setDraft` → 识别结果追加到草稿末尾；完全不注入 → 🎤 禁用并提示 |

说明：`package.json` `dependencies` 实测仅 `undici`（执行器副本由 `ensureExternalExecutor` 同步 `node_modules/undici`）；**undici 亦服务语音模型下载**（`asr-models.cjs` → `net-proxy`）；host 半部与执行器不声明 peerDependency。上表由 `package.json` `peerDependencies` 与 README「输入框工具行（✨/🎤）客户端契约」段落实读得出，改 peerDependency 或槽位契约时须同步本节。

---

## 5. 兼容性红线

1. 动态 Cordis 安装必须始终可用 → `plugin-host.js` / `lib/client.cjs` 保持单文件产物。
2. 所有 RPC 方法名不得随意变更；变更必须走 `protocolVersion`。
3. 配置迁移必须可回退，禁止静默丢失用户设置。
4. 多 profile（web/headless/自定义）必须继续支持。
5. 安装/更新必须走**受控通道**：一键更新仅接受 GitHub Release 的 npm pack tgz（固定仓库 `buildTarballUrl`）+ staging 目录内的本地 tgz（路径白名单校验）；v3.2.2 起安装为**直接解包复制到运行环境目录**（`System32\tar.exe` + 文件级覆盖，不再经 `dsh plugin add`/pnpm——规避操作运行中 profile 卡死，v3.2.1-r 根因修复）；禁止任意路径/任意命令执行安装。
