# dsh-prompt-enhancer

DeepSeek Harness (DSH) 提示词增强插件：输入模糊提示词 → 一键增强（独立 LLM 调用）→ 直接替换输入框 → 不满意可撤回。

## 功能

- ✨ **一键增强**：输入框工具行 ✨ 按钮，独立 LLM 调用，完成后直接替换草稿
- ↩️ **随时撤回**：不满意一键恢复原文；手动编辑草稿自动退出撤回
- ⏹️ **真取消**：增强进行中点击即取消并恢复原文（AbortSignal 透传终止）
- 🛡️ **守卫逻辑**：空输入 / 斜杠命令 / 提交中状态自动禁用；命令正文可优化（保留 `/cmd` 前缀）
- 🌐 **语言跟随**：按钮与提示文案跟随 DSH 界面语言设置（中文 / English）
- 🔒 **零上下文注入**：仅发送「模板 + 输入文本」到 LLM，不带会话历史 / 文件 / 附件 / 画像

## 安装

动态 Cordis 插件（host + client 双半部）：

1. 将 `plugin-host.js` 与 `plugin-client.js` 放到 DSH 会话可访问的目录
2. 在 DSH 会话中定义并运行插件（host + client 双半部均需注册）
3. 首次运行授权后，输入框工具行出现 ✨ 按钮即安装成功

> bundle 分发（`dsh.plugin` / `cordis.patch.yml` 一键安装）规划中。

## 使用

1. 输入任意非空、非斜杠命令的文本
2. 点击 **✨** 按钮（或聚焦后按 Enter）
3. 等待独立 LLM 调用完成，草稿被直接替换为增强版本
4. 不满意点击 **✓ 已优化，可撤回** 恢复原文

## 配置

增强复用 DSH 已配置的 LLM provider（读取 DSH 配置，不重复配置密钥）。

当前版本配置为代码常量，按需调整 `plugin-host.js` 顶部：

| 常量 | 默认值 | 说明 |
|---|---|---|
| `DEFAULT_CHAIN` | DeepSeek 官方模型兜底链 | 主模型 + 兜底链（provider 名须与你的 DSH 配置一致） |
| `DEFAULT_TIMEOUT_MS` | `30000` | 单次请求超时 |
| `DEFAULT_MAX_TOKENS` | `2000` | 输出 token 上限 |
| `DEFAULT_OUTPUT_LIMIT` | `8000` | 输出字符上限 |
| `SYSTEM_PROMPT` | 内置模板 | 增强模板 |

## 隐私

- 仅发送「固定模板 + 输入文本」到配置的 LLM provider；**零上下文注入**
- 插件本身不记录、不上报任何数据；日志不含提示词内容
- 增强结果来自外部 LLM，发送前请自行核对
- 取消后底层请求可能仍在 provider 侧短暂运行

## 兼容性

- 依赖 DSH 运行时注入 API（`llm` / `slots` / `harness` / `inputActions`），随 DSH 版本升级可能调整
- 建议使用最新版 DeepSeek Harness

## License

[MIT](LICENSE)
