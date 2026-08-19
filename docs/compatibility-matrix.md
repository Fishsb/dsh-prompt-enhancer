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
| `models/autochain` | client → host | 自适应链 | 只读 |
| `template/default` | client → host | 默认模板 | 只读 |
| `update/check` | client → host | 版本检测（local 运行时读运行环境 package.json） | 只读 |
| `update/pull` | client → host | 拉取清单文件 | 用户触发 |
| `update/envcheck` | client → host | 环境检测 | 只读 |
| `update/portRestart` | client → host | 端口重启（服务模式 schtasks / 默认模式 detached 脚本） | 用户触发 |
| `update/serviceInstall` | client → host | nssm 服务化安装 | 管理 |
| `update/makeShortcut` | client → host | 创建桌面快捷方式（RunAs lnk + CLI 脚本） | 用户触发 |
| `logs/last` | client → host | 诊断日志 | 只读 |
| `plugins/inventory` | client → host | 插件清单 | 只读 |
| `plugins/run` | client → host | 运行插件 | 管理 |
| `plugins/stop` | client → host | 停止插件 | 管理 |
| `plugins/undefine` | client → host | 取消定义 | 管理 |
| `update/executorEnsure` | client → host | 拉起/对齐执行器（版本+内容哈希） | 用户触发 |
| `update/restartNeeded` | client → host | 检测未重启 | 只读 |

> 注：`update/executorEnsure` / `update/restartNeeded` 在 host RPC 清单中保留（部分版本由 client 直连执行器 3081），见 executor RPC。

### executor RPC（`127.0.0.1:3081/rpc`）

| 方法 | 说明 |
|---|---|
| `ping` | 心跳 / 版本 |
| `status` | 当前状态 |
| `apply` | 安装 + 重启 |
| `restart` | 仅重启 |

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
| 3.2.x（当前） | `protocolVersion: 1` | 0.1.12+（内容哈希重建） | update/portRestart 独立化（服务模式 schtasks / 默认模式脚本）；执行器专注一键更新/watchdog |

兼容策略：

- host 与 client 通过 `protocolVersion` 协商，不匹配时返回明确错误。
- executor 版本由 `EXECUTOR_VERSION` + **内容哈希**（.executor-hash）管理，`executorEnsure` 负责对齐（代码变自动重建，不依赖手动 bump）。
- 旧 client + 新 host：优先兼容层；无法兼容时提示刷新/升级。
- 版本检测：本地版本**运行时读运行环境 package.json**（非构建硬编码），发版后产物与版本号天然一致。

---

## 5. 兼容性红线

1. 动态 Cordis 安装必须始终可用 → `plugin-host.js` / `lib/client.cjs` 保持单文件产物。
2. 所有 RPC 方法名不得随意变更；变更必须走 `protocolVersion`。
3. 配置迁移必须可回退，禁止静默丢失用户设置。
4. 多 profile（web/headless/自定义）必须继续支持。
5. 安装/更新必须走**受控通道**：一键更新仅接受 GitHub Release 的 npm pack tgz（固定仓库 `buildTarballUrl`）+ staging 目录内的本地 tgz（路径白名单校验）；v3.2.2 起安装为**直接解包复制到运行环境目录**（`System32\tar.exe` + 文件级覆盖，不再经 `dsh plugin add`/pnpm——规避操作运行中 profile 卡死，v3.2.1-r 根因修复）；禁止任意路径/任意命令执行安装。
