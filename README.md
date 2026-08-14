# dsh-prompt-enhancer

DeepSeek Harness (DSH) 提示词增强插件：输入模糊提示词 → 一键增强（独立 LLM 调用）→ 直接替换输入框 → 不满意可撤回。

## 功能

- ✨ **一键增强**：输入框工具行 ✨ 按钮，独立 LLM 调用，完成后直接替换草稿
- ↩️ **随时撤回**：不满意一键恢复原文；手动编辑草稿自动退出撤回（撤回同时清除上一轮记忆）
- ⏹️ **真取消**：增强进行中点击即取消并恢复原文（AbortSignal 透传终止）
- 🛡️ **守卫逻辑**：空输入 / 斜杠命令 / 提交中状态自动禁用；命令正文可优化（保留 `/cmd` 前缀）
- 🌐 **语言跟随**：按钮与提示文案跟随 DSH 界面语言设置（中文 / English）
- 🎛️ **4 模式（v2.2.0）**：基础（直发，最快最省）/ 轻量（本地规则分析）/ 标准（规则 + 工作区/会话检索注入）/ 智能（LLM 任务进度分析 + 全量检索）
- 🧠 **记忆功能独立开关（v2.2.0）**：所有模式可开/关；开启后上一轮优化结果作为记忆注入下一轮（首次自动走轻量兜底）；关闭后完全不读取/写入记忆；开启期间写入记忆、撤回清除
- 🔀 **组合叠加**：模式上下文块 + 记忆块可同时注入（记忆优先占用预算 ≤1200 字符，模式块用剩余预算）
- 🔄 **配置自动迁移**：v2.1 的 `mode:'memory'`/`autoMemory` 自动迁移为 `mode:'lite'` + `memory:true`；显式 `memory` 字段最高优先（含 false 关闭）
- 🧪 **单测保障**：host 纯函数单测（node:test，31/31 通过），PURE 区段切片求值保证测试即发布代码
- 📊 **步骤进度（v2.3.0）**：增强进行中按钮实时显示当前阶段（准备中… / 读取会话… / 分析任务… / 检索文件… / 检索会话… / 组装上下文… / LLM 优化中…），避免长时间等待误判卡死；鼠标悬停切换为红色「取消」提醒
- 🏷️ **模式短标签（v2.3.0）**：输入框 ✨ 按钮显示当前模式（基础/轻量/标准/智能），切换即时同步
- 🧠 **输入区记忆开关（v2.3.0）**：输入框工具行左端「记忆」开关——开启=高饱和橙色，关闭=变暗置灰（不可选中视觉，点击可重新开启）；与设置面板记忆下拉双向即时同步

## 安装

### 方式一：bundle 一键安装（推荐）

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer
```

安装后重启 DSH（`dsh web`），输入框工具行出现 **✨** 按钮即安装成功。更新用 `dsh plugin --profile web update dsh-prompt-enhancer`，卸载用 `dsh plugin --profile web remove dsh-prompt-enhancer`。

### 方式二：动态 Cordis 安装

动态 Cordis 插件（host + client 双半部），在 DSH 会话内通过 cordis 工具链安装：

1. 在 DSH 会话中让 agent 读取本仓库的 `plugin-host.js`（host 半部）与 `plugin-client.js`（client 半部）
2. 用 `cordis_define` 定义插件：`code.host` 填 plugin-host.js 全文，`code.client` 填 plugin-client.js 全文（新插件 `plugin.kind: 'new'`），返回 `pluginId` / `packageId`
3. 用 `cordis_run` 运行（mode: `run`）
4. 首次运行 client 半部需在浏览器批准授权
5. 授权后输入框工具行出现 ✨ 按钮即安装成功

> 提示：动态插件 client 半部附着于激活时的页面连接，页面刷新后会卸载，重新 `cordis_run` 即可恢复。

### 快捷安装指令（复制给任意 DSH 会话）

```
帮我安装 dsh-prompt-enhancer 插件：
1. 读取 https://github.com/Fishsb/dsh-prompt-enhancer 里的 plugin-host.js 和 plugin-client.js
2. 用 cordis_define 定义插件：code.host 填 plugin-host.js 全文，code.client 填 plugin-client.js 全文，plugin.kind 用 new
3. cordis_run 运行返回的 pluginId/packageId（mode: run）
4. 等待我在浏览器授权后完成
```

> bundle 分发（`dsh plugin add` 一键安装）已支持，见上方「方式一」。

## 使用

1. 输入任意非空、非斜杠命令的文本
2. 点击 **✨** 按钮（或聚焦后按 Enter）
3. 等待独立 LLM 调用完成，草稿被直接替换为增强版本
4. 不满意点击 **✓ 已优化，可撤回** 恢复原文

## 配置

设置页 →「模型与插件」→「优化参数」：

| 配置项 | 说明 |
|---|---|
| 优化模式 | 基础（默认，直发）/ 轻量 / 标准 / 智能；切换即时生效并持久化 |
| 记忆功能 | 开 / 关；开启后下一轮注入上一轮优化对（首次自动轻量兜底），关闭后不读取/写入 |
| 上下文预算 | 0 / 2000 / 4000 / 8000 字符；0 = 不注入上下文（等价基础优化），记忆块同样受预算约束 |
| 超时时间 / Token 上限 / 输出上限 | 优化请求参数 |
| 模板 | 内置模板 / 自定义模板 |

模型链在「模型配置」tab 配置：按序尝试、可增删改序、逐条思考开关与等级、行内连通性测试、恢复默认。

## 隐私

- **模式上下文**：按需注入「会话近期消息 + 工作区相关文件摘要 + 相关会话片段」，受预算上限约束；敏感文件（.env / 密钥 / 凭据 / 日志等）硬过滤，绝不注入
- **记忆**：仅存于浏览器 localStorage（`dsh.enhance.seen.*` 布尔标记，无内容），记忆对仅存在于当前页面内存；关闭开关后不再读取/写入
- 插件本身不记录、不上报任何数据；诊断日志仅含模式、耗时等元信息
- 增强结果来自外部 LLM，发送前请自行核对；取消后底层请求可能在 provider 侧短暂运行

## 兼容性

- 依赖 DSH 运行时注入 API（`llm` / `slots` / `harness` / `inputActions` / `sessionQuery` / `fs`），随 DSH 版本升级可能调整
- 建议使用最新版 DeepSeek Harness

## License

[MIT](LICENSE)
