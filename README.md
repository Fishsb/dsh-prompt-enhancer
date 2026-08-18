# dsh-prompt-enhancer

DeepSeek Harness (DSH) 提示词增强插件：输入框写草稿 → 点击 ✨ → 独立 LLM 调用一键改写 → 直接替换输入内容，不满意可撤回。

[![Release](https://img.shields.io/github/v/release/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Release date](https://img.shields.io/github/release-date/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Stars](https://img.shields.io/github/stars/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer)

## ✨ 功能亮点

- **一键增强**：输入框 ✨ 按钮触发独立 LLM 调用，直接替换草稿；可继续优化、可撤回、增强中可取消
- **5 种优化模式**：基础（直发）/ 轻量（结合上一轮对话参考）/ 标准（规则 + 检索）/ 专家（任务分析 + 全量检索）/ 一键发布（生成完整开发规格）
- **记忆开关**：开启后，发送前的多轮「优化→修改→再优化」累积为记忆链，下一轮代入历史并感知修改方向；**发送消息即清空**，关闭后完全停止读写
- **模型链**：按序尝试多个模型，可增删改序、开关思考、行内连通性测试
- **🔁 一键重启（独立功能）**：网页打不开也能重启 DSH——桌面快捷方式（鲸鱼图标）双击，或命令行直接调用；支持服务化（Windows/Linux/macOS）与进程级降级重启
- **多语言**：按钮与文案跟随 DSH 界面语言（中文 / English）

## 🚀 安装

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v3.2.0
```

安装后重启 DSH（`dsh web`），输入框工具行出现 ✨ 按钮即安装成功。

> 需本机已装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 且 `pnpm` 在 PATH 中。

更新 / 卸载：

```sh
dsh plugin --profile web update dsh-prompt-enhancer
dsh plugin --profile web remove dsh-prompt-enhancer
```

> 卸载后必须重启 DSH 才能从运行中移除。

## 🔁 一键重启（独立功能）

> 设计目标：**DSH 服务异常、网页打不开时，依然能一键恢复**——不依赖浏览器、不依赖 3080 端口。

### 方式一：桌面快捷方式（推荐）

安装后在插件设置「端口重启」确认态点击「**桌面**」按钮，即创建带鲸鱼图标的「重启DSH」快捷方式。以后双击它，命令行窗口会自动重启 DSH 服务并显示进度：

```
=== DSH 端口重启（CLI）===
  服务: dsh-web  执行器端口: 3081
[3s] stopping round 1 — 正在停止服务…
[12s] restart round 2 — 端口未就绪，准备重试
[18s] ✅ 服务已重启完成（healthy）
```

### 方式二：命令行直接调用

**不生成快捷方式也能用**——核心是执行器的 CLI 模式，任何命令窗口（cmd / PowerShell / Git Bash）直接运行：

```sh
node "<DSH_HOME>\AppData\Local\dsh-prompt-enhancer\executor\0.1.11\lib\updater-host.cjs" --cli restart --service dsh-web --profile web
```

参数（均有默认值）：

| 参数 | 默认 | 作用 |
|---|---|---|
| `--service` | `dsh-web` | 服务名 |
| `--profile` | `web` | DSH 配置档 |
| `--executor-port` | `3081` | 重启执行器端口 |

执行流程：优先调用**运行中的重启执行器**（SYSTEM 权限，有权控制服务）→ 轮询打印进度；执行器未运行则当前进程直接重启（如提示无权限，请以管理员身份运行窗口）。

### 重启能力说明

- **服务化部署**：Windows（`sc`/nssm）、Linux（`systemctl`）、macOS（`launchctl`）——由 `lib/platform-service.cjs` 统一管理
- **进程级降级**：非服务化部署时，读 DSH 进程索引 → 结束旧进程 → 同参数拉起新进程 → 端口健康探测（参考社区 dsh-restart 生态）
- **端口冲突自适应**：执行器端口被占用时自动 fallback 动态端口（`executor.port`），重启功能不受影响

## 📦 库（模块）说明

插件核心逻辑拆分为独立 Node 模块，可在其他工具/脚本中复用：

| 模块 | 职责 | 可复用能力 |
|---|---|---|
| `lib/shortcut-win.cjs` | Windows 桌面快捷方式生成 | `makeShortcutWin()`——写临时 VBS → cscript 创建完整 .lnk（含 IDList + 鲸鱼图标）→ 返回路径/大小；`fixTargetUnicode()` 修补图标字段 |
| `lib/shortcut-icon.cjs` | 快捷方式鲸鱼图标 | `shortcutIconBuffer()`——内嵌 base64 的 ICO（16/32/48/64，BITMAPINFOHEADER），由 `scripts/build-icon.cjs` 生成 |
| `lib/updater-host.cjs` | 更新执行器 + CLI 重启 | CLI：`node updater-host.cjs --cli restart --service <svc>`；HTTP RPC：`ping` / `restart` / `status`（端口 3081） |
| `lib/platform-service.cjs` | 跨平台服务管理 | `detectService` / `readPort` / `stopService` / `startService` / `isStopped` / `pid`——win32 sc/nssm、linux systemctl、darwin launchctl |
| `lib/sys.cjs` | 环境与路径 | `EXECUTOR_ROOT` / `executorDir()` / `readExecutorPortFile()` / `probeEnv` |

**示例：在其他 Node 脚本中直接生成「重启 DSH」快捷方式**

```js
const { makeShortcutWin } = require('dsh-prompt-enhancer/lib/shortcut-win.cjs');
const os = require('node:os');
const path = require('node:path');

const iconPath = path.join(os.homedir(), 'AppData', 'Local', 'dsh-prompt-enhancer', 'executor', 'icons', 'deepseek.ico');
const result = makeShortcutWin({
  lnkPath: path.join(os.homedir(), 'Desktop', '重启DSH.lnk'),
  target: 'C:\\Windows\\System32\\cmd.exe',
  args: '/c "C:\\Users\\lk\\AppData\\Local\\dsh-prompt-enhancer\\executor\\cli\\restart-dsh.cmd"',
  workingDir: os.homedir(),
  iconPath,
  iconPathEnv: '%USERPROFILE%\\AppData\\Local\\dsh-prompt-enhancer\\executor\\icons\\deepseek.ico',
});
console.log(result); // { ok: true, shortcutPath, size, ... }
```

## 🎯 使用

1. 输入任意非空文本（斜杠命令保留前缀，只优化正文）
2. 点击 **✨** 按钮
3. 等待独立 LLM 调用完成，草稿被替换为增强版本
4. 不满意点击 **可撤回** 恢复原文

## 📸 效果展示

| 模型配置 | 优化参数 |
|---|---|
| ![模型配置](docs/screenshots/settings-models.png) | ![优化参数](docs/screenshots/settings-params.png) |

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
