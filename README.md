# dsh-prompt-enhancer

DeepSeek Harness (DSH) 提示词增强插件：输入模糊提示词 → 一键增强（独立 LLM 调用）→ 直接替换输入框 → 不满意可撤回。

[![Release](https://img.shields.io/github/v/release/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Release date](https://img.shields.io/github/release-date/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![License](https://img.shields.io/github/license/Fishsb/dsh-prompt-enhancer)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer)

## 功能

- ✨ **一键增强**：输入框 ✨ 按钮触发独立 LLM 调用，完成后直接替换草稿；修改后可**继续优化**（纯文字按钮），不满意可**一键撤回**，增强中可**真取消**
- 🛡️ **守卫逻辑**：空输入 / 斜杠命令 / 提交中状态自动禁用；`/命令 正文` 只优化正文、保留前缀
- 🎛️ **5 种优化模式**：基础（直发，最快）/ 轻量（本地规则）/ 标准（规则 + 工作区/会话检索）/ 专家（LLM 任务进度分析 + 全量检索）/ **一键发布**（输入粗略想法 → 自动规划检索主题 + 多步网络检索 + 工作区参考，一键生成完善、边界明确的生成提示词规格：九章结构、场景自动路由（游戏/软件）、方案自评判定，检索要点跨轮记忆，多轮补充逐步细化）
- 🧠 **记忆独立开关**：开启后多轮「优化→修改→再优化」累积为记忆链（**持续记忆**：固定保留最近 4 轮，滚动更新；发送或清空输入框均不清除，撤回只弹出最后一轮），再优化以多轮对话代入全部轮次并感知修改方向；关闭后完全不读取/写入
- 🌐 **语言跟随**：按钮与文案跟随 DSH 界面语言（中文 / English）

## 截图

![设置面板](docs/screenshots/settings-v2.4.3.png)

## 安装

### 方式一：一条命令（推荐）

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v3.1.2
```

安装后重启 DSH（`dsh web`），输入框工具行出现 ✨ 按钮即安装成功。

> 前提：本机已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，且 `pnpm` 在 PATH 中（`npm i -g pnpm` 或 `corepack enable`）。
> `#v3.1.2` 为版本锁定（可换成任意 [Release tag](https://github.com/Fishsb/dsh-prompt-enhancer/releases)），避免装到未发布的主分支。
> 若 pnpm 提示需要授权构建（`allowBuilds`），把提示的包 key 加进 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 后重跑即可。

更新 / 卸载：

```sh
dsh plugin --profile web update dsh-prompt-enhancer
dsh plugin --profile web remove dsh-prompt-enhancer
```

> **卸载后必须重启 DSH**（`dsh web`）才从运行中移除——`remove` 只清理磁盘安装（package.json / node_modules / 层列表），host 半部仍在服务进程、client 半部仍在页面中加载；若重复执行 remove 提示 `no such dependency found`，即表示插件已卸载。
> 更新注意：tag 锁定安装（`github:...#v3.1.2`）时 `update` 不会跨 tag 升级——升级请用 `dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#<新tag>`。
> 卸载不会清除浏览器端的插件配置（localStorage `dsh.enhance.config.v2`），重装后配置仍保留。

### 方式二：下载安装包离线安装

从 [Releases 页面](https://github.com/Fishsb/dsh-prompt-enhancer/releases) 下载 `dsh-prompt-enhancer-<版本>.tgz`（如 `dsh-prompt-enhancer-3.1.2.tgz`），然后安装：

```sh
dsh plugin --profile web add ./dsh-prompt-enhancer-3.1.2.tgz
```

> 安装包为 pnpm 打包的完整产物（含预构建 `lib/`），无需联网、无需构建授权；装完同样重启 `dsh web` 生效。
> 注：GitHub 自动生成的 `Source code (zip)` 源码包也可解压后以目录方式安装（`add <解压目录>`），但目录安装为 link 形式，删除解压目录会导致插件失效——正式使用请用 tgz 安装包。

### 方式三：动态 Cordis 安装

在 DSH 会话中让 agent 读取本仓库 `plugin-host.js`（host 半部）与 `plugin-client.js`（client 半部），用 `cordis_define` 定义（`plugin.kind: 'new'`）后 `cordis_run`（mode: `run`），首次运行 client 半部需浏览器授权。

> 提示：动态插件 client 半部附着于激活时的页面连接，页面刷新后会卸载，重新 `cordis_run` 即可恢复。

### 快捷安装指令（复制给任意 DSH 会话）

```
帮我安装 dsh-prompt-enhancer 插件：
1. 读取 https://github.com/Fishsb/dsh-prompt-enhancer 里的 plugin-host.js 和 plugin-client.js
2. 用 cordis_define 定义插件：code.host 填 plugin-host.js 全文，code.client 填 plugin-client.js 全文，plugin.kind 用 new
3. cordis_run 运行返回的 pluginId/packageId（mode: run）
4. 等待我在浏览器授权后完成
```

## 使用

1. 输入任意非空文本（斜杠命令将保留前缀、只优化正文）
2. 点击 **✨** 按钮
3. 等待独立 LLM 调用完成，草稿被直接替换为增强版本
4. 不满意点击 **✓ 已优化，可撤回** 恢复原文

## 配置

设置页 →「模型与插件」→「优化参数」：

| 配置项 | 说明 |
|---|---|
| 优化模式 | 基础（默认，直发）/ 轻量 / 标准 / 专家 / 一键发布（生成完整开发规格：九章结构、多步网络检索、场景自动路由、方案自评判定，多轮补充逐步细化）；切换即时生效并持久化 |
| 记忆功能 | 开 / 关；开启后发送前多轮迭代累积为记忆链（最多最近 4 轮输入/输出，以多轮对话注入并感知修改方向；首次自动轻量兜底），关闭后不读取/写入 |
| 上下文预算 | 0 / 2000 / 4000 / 8000 字符；0 = 不注入上下文（记忆链同样受预算约束，链上限 2400 字符；一键发布模式预算 > 0 才启用检索） |
| 超时时间 / Token 上限 / 输出上限 | 优化请求参数；**一键发布模式不设输出限制**（超时自动 ≥240s、输出不截断），三项在该模式置灰不生效 |
| 模板 | 每模式 3 个内置模板：默认模板（现有）/ 增量补充完善 / 增量完善（开发向，面向开发人员、技术术语与代码名词）；**自定义模板可添加多个**（每模式 ≤10 个，各 ≤4000 字符，可命名/编辑/删除） |

模型链在「模型配置」tab 配置：按序尝试、可增删改序、逐条思考开关与等级、行内连通性测试、恢复默认。「恢复默认」**仅重置模型链**（自适应当前可用模型），不清除自定义模板、优化参数与记忆设置；已失效的条目（模型/提供方不可用）会标记 ⚠ 并提供一键清理。

## 更新日志

各版本变更说明见 [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)，完整历史见 [CHANGELOG.md](CHANGELOG.md)。

## 隐私

- **模式上下文**：按需注入「会话近期消息 + 工作区相关文件摘要 + 相关会话片段」，受预算上限约束；敏感文件（.env / 密钥 / 凭据 / 日志等）硬过滤，绝不注入
- **记忆**：仅存于浏览器 localStorage 布尔标记（无内容），记忆链（各轮输入/输出与修改摘要）仅存在于当前页面内存，随优化请求发送给所选模型厂商；关闭开关后不再读取/写入
- 插件本身不记录、不上报任何数据；诊断日志仅含模式、耗时等元信息
- 增强结果来自外部 LLM，发送前请自行核对；取消后底层请求可能在 provider 侧短暂运行

## 兼容性

- 依赖 DSH 运行时注入 API（`llm` / `slots` / `harness` / `inputActions` / `sessionQuery` / `fs`），随 DSH 版本升级可能调整
- **版本检测与一键更新**：由浏览器直连 `api.github.com`（CORS 可用，host 无需出网）；网络受限环境请确保浏览器可访问 GitHub（代理等）
- **一键更新并重启（v2.5.0+）**：需服务以 nssm/LocalSystem 运行（默认 `dsh-web`，可通过 `updater.serviceName` / `updater.profile` 配置覆盖）；安装命令自动注入用户 PATH（含 pnpm）；GitHub 拉取需代理时在 `~/.npmrc` 配置（同手动安装）；动态 Cordis 安装不支持此功能，请用 bundle 安装
- **内置兜底模型链**：指向 DeepSeek 官方（`deepseek-official`），使用该链需配置 DeepSeek API key；未配置时请在「模型与插件」中配置模型链——首次安装会自动继承当前使用模型，通常无需手动配置
- 建议使用最新版 DeepSeek Harness

## License

[MIT](LICENSE)
