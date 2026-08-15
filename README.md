# dsh-prompt-enhancer

DeepSeek Harness (DSH) 提示词增强插件：输入模糊提示词 → 一键增强（独立 LLM 调用）→ 直接替换输入框 → 不满意可撤回。

[![Release](https://img.shields.io/github/v/release/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Release date](https://img.shields.io/github/release-date/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![License](https://img.shields.io/github/license/Fishsb/dsh-prompt-enhancer)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer)

## 功能

- ✨ **一键增强**：输入框工具行 ✨ 按钮触发独立 LLM 调用，完成后直接替换草稿
- ↩️ **随时撤回**：不满意一键恢复原文（同时清除上一轮记忆）；手动编辑草稿自动退出撤回
- ⏹️ **真取消**：增强进行中点击即取消并恢复原文
- 🛡️ **守卫逻辑**：空输入 / 斜杠命令 / 提交中状态自动禁用；`/命令 正文` 只优化正文、保留前缀
- 🌐 **语言跟随**：按钮与文案跟随 DSH 界面语言（中文 / English）
- 🎛️ **4 种优化模式**：基础（直发，最快）/ 轻量（本地规则）/ 标准（规则 + 工作区/会话检索）/ 智能（LLM 任务进度分析 + 全量检索）
- 🧠 **记忆独立开关**：开启后上一轮优化结果作为记忆注入下一轮；关闭后完全不读取/写入；撤回即清除
- 📊 **实时进度**：优化中按钮显示当前阶段（准备中… → LLM 优化中…），悬停切换红色「取消」，宽度恒定无闪烁
- 📏 **视觉对齐**：按钮字体（等线）/字重/胶囊/灰字/悬停深色椭圆背景与 DSH 模型选择器一致
- 🚀 **版本检测与一键更新**：内置更新器检测新版本并一键拉取发布文件（[Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)）
- 🧪 **单测保障**：host 纯函数单测（node:test）切片 PURE 区段，测试即发布代码

## 截图

![设置面板](docs/screenshots/settings-v2.4.3.png)

## 安装

### 方式一：一条命令（推荐）

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v2.4.8
```

安装后重启 DSH（`dsh web`），输入框工具行出现 ✨ 按钮即安装成功。

> 前提：本机已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，且 `pnpm` 在 PATH 中（`npm i -g pnpm` 或 `corepack enable`）。
> `#v2.4.8` 为版本锁定（可换成任意 [Release tag](https://github.com/Fishsb/dsh-prompt-enhancer/releases)），避免装到未发布的主分支。
> 若 pnpm 提示需要授权构建（`allowBuilds`），把提示的包 key 加进 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 后重跑即可。

更新 / 卸载：

```sh
dsh plugin --profile web update dsh-prompt-enhancer
dsh plugin --profile web remove dsh-prompt-enhancer
```

### 方式二：下载安装包离线安装

从 [Releases 页面](https://github.com/Fishsb/dsh-prompt-enhancer/releases) 下载 `dsh-prompt-enhancer-<版本>.tgz`（如 `dsh-prompt-enhancer-2.4.8.tgz`），然后安装：

```sh
dsh plugin --profile web add ./dsh-prompt-enhancer-2.4.8.tgz
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
| 优化模式 | 基础（默认，直发）/ 轻量 / 标准 / 智能；切换即时生效并持久化 |
| 记忆功能 | 开 / 关；开启后下一轮注入上一轮优化对（首次自动轻量兜底），关闭后不读取/写入 |
| 上下文预算 | 0 / 2000 / 4000 / 8000 字符；0 = 不注入上下文（记忆块同样受预算约束） |
| 超时时间 / Token 上限 / 输出上限 | 优化请求参数 |
| 模板 | 内置模板 / 自定义模板 |

模型链在「模型配置」tab 配置：按序尝试、可增删改序、逐条思考开关与等级、行内连通性测试、恢复默认。

## 更新日志

各版本变更说明见 [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)，完整历史见 [CHANGELOG.md](CHANGELOG.md)。

## 隐私

- **模式上下文**：按需注入「会话近期消息 + 工作区相关文件摘要 + 相关会话片段」，受预算上限约束；敏感文件（.env / 密钥 / 凭据 / 日志等）硬过滤，绝不注入
- **记忆**：仅存于浏览器 localStorage 布尔标记（无内容），记忆对仅存在于当前页面内存；关闭开关后不再读取/写入
- 插件本身不记录、不上报任何数据；诊断日志仅含模式、耗时等元信息
- 增强结果来自外部 LLM，发送前请自行核对；取消后底层请求可能在 provider 侧短暂运行

## 兼容性

- 依赖 DSH 运行时注入 API（`llm` / `slots` / `harness` / `inputActions` / `sessionQuery` / `fs`），随 DSH 版本升级可能调整
- **版本检测与一键更新**：由浏览器直连 `api.github.com`（CORS 可用，host 无需出网）；网络受限环境请确保浏览器可访问 GitHub（代理等）
- **内置兜底模型链**：指向 DeepSeek 官方（`deepseek-official`），使用该链需配置 DeepSeek API key；未配置时请在「模型与插件」中配置模型链——首次安装会自动继承当前使用模型，通常无需手动配置
- 建议使用最新版 DeepSeek Harness

## License

[MIT](LICENSE)
