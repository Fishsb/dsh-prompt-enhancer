# dsh-prompt-enhancer

DeepSeek Harness (DSH) 插件，两大核心能力：**提示词增强**（输入框草稿 → ✨ 一键改写，不满意可撤回）与 **DSH 服务异常一键重启**（网页打不开也能命令行恢复）。

[![Release](https://img.shields.io/github/v/release/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Release date](https://img.shields.io/github/release-date/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Stars](https://img.shields.io/github/stars/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer)

## ✨ 功能亮点

- **✨ 一键增强**：输入框 ✨ 按钮触发独立 LLM 调用，直接替换草稿；可继续优化、可撤回、增强中可取消
- **📋 5 种优化模式**：基础（直发）/ 轻量（结合上一轮对话参考）/ 标准（规则 + 检索）/ 专家（任务分析 + 全量检索）/ 一键发布（生成完整开发规格）
- **🧠 记忆开关**：开启后，发送前的多轮「优化→修改→再优化」累积为记忆链，下一轮代入历史并感知修改方向；**发送消息即清空**，关闭后完全停止读写
- **🔗 模型链**：按序尝试多个模型，可增删改序、开关思考、行内连通性测试
- **🔁 一键重启（独立功能）**：网页打不开也能重启 DSH——桌面快捷方式（鲸鱼图标）双击，或命令行直接调用；支持服务化重启与进程级降级
- **🌐 多语言**：按钮与文案跟随 DSH 界面语言（中文 / English）
- **🎤 语音输入**：输入框旁 🎤 录音 → 识别（**云端** Qwen3-ASR / **本地离线** SenseVoice 双引擎）→ 可选规整（去口水词）→ 填入草稿 → 可一键优化；**说完停顿自动停止**（VAD 静音检测），录音仅内存中转不落盘

## 🚀 安装

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v3.2.4
```

安装后重启 DSH（`dsh web`），输入框工具行出现 ✨ 按钮即安装成功。

> 需本机已装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 且 `pnpm` 在 PATH 中。
>
> **客户端兼容性（语音输入）**：🎤 语音输入依赖客户端注入 `inputActions.setDraft`（`dsh.client` 契约的一部分）——官方 web client 已满足；第三方客户端若实现同一契约即可加载，能力集不同时语音输入自动**降级**（无插入能力 → 识别结果追加到草稿末尾；完全不注入 → 🎤 禁用并提示）。**本地离线引擎为「框架 + 可选下载」模式**：插件安装**不携带/不默认下载模型**（发布物精简）；设置 → 模型配置 → 🎙 语音识别 → 引擎选「本地」→ 「本地模型」区点 **下载模型**（SenseVoice 228MB，带进度显示），下载完成自动生效。详见 [docs/map/flow/voice-input.md](docs/map/flow/voice-input.md)。

更新 / 卸载：

```sh
dsh plugin --profile web update dsh-prompt-enhancer
dsh plugin --profile web remove dsh-prompt-enhancer
```

> 卸载后必须重启 DSH 才能从运行中移除。

## 🔁 一键重启（独立功能）

DSH 服务异常、网页打不开时，仍可一键恢复——不依赖浏览器、不依赖 3080 端口。插件设置「端口重启」确认态点击「**桌面**」生成带鲸鱼图标的「重启DSH」快捷方式，双击即重启并显示进度；不生成快捷方式也能用，任意命令窗口直接调用：

```sh
node "<DSH_HOME>\AppData\Local\dsh-prompt-enhancer\executor\0.1.11\lib\updater-host.cjs" --cli restart --service dsh-web --profile web
```

## 📦 库说明

核心逻辑拆分为独立 Node 模块，可复用：`lib/shortcut-win.cjs`（Windows 快捷方式生成）、`lib/updater-host.cjs`（CLI 重启 / 更新执行器）、`lib/platform-service.cjs`（跨平台服务管理）、`lib/sys.cjs`（环境与路径）。详见各模块头注释。

## 🎯 使用

1. 输入任意非空文本（斜杠命令保留前缀，只优化正文）
2. 点击 **✨** 按钮
3. 等待独立 LLM 调用完成，草稿被替换为增强版本
4. 不满意点击 **可撤回** 恢复原文

## 📸 效果展示

**模型配置**（按序尝试多个模型）：

![模型配置](docs/screenshots/settings-models.png)

**一键重启 CLI**（服务异常时命令行恢复）：

![一键重启 CLI](docs/screenshots/restart-cli.png)

## ⚙️ 配置

设置 →「模型与插件」：

| Tab | 说明 |
|---|---|
| **模型配置** | 配置优化模型链，按序尝试、可增删改序 |
| **优化参数** | 优化模式 / 记忆开关 / 上下文预算 / 超时与输出上限 / 模板 |

## 📚 文档

- [Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
- [CHANGELOG](CHANGELOG.md)
- [兼容性说明](docs/compatibility-matrix.md)

> 隐私：插件不记录、不上报任何数据；增强结果来自外部 LLM，发送前请自行核对。
