# 项目地图 · 一级索引（root）

> dsh-prompt-enhancer — DeepSeek Harness 的「提示词优化」插件。
> 本文件是项目地图的**模块级**视图：每个模块负责什么、改动影响谁。
> 二层文件级见 `tree/`，功能链路见 `flow/`，总导航见 `./index.md`。

## 模块总览

| 区域 | 路径 | 职责 | 改动影响 |
|---|---|---|---|
| **host 半部入口** | `lib/index.cjs` | 读取 `plugin-host.js` 主体，把 `harness.handle` 注册的方法适配成 HTTP RPC 端点 `/dsh-prompt-enhancer/rpc`，注册到 profile webServer | 影响 client 侧所有 RPC 调用链；改它影响全插件可用性 |
| **host 逻辑本体** | `plugin-host.js` | 全部后端逻辑：增强引擎（v1/v2）、模型解析、版本检测更新、诊断日志、配置校验、纯函数族（PURE 区段可单测） | 核心行为区；改错影响增强输出/更新/模型链 |
| **client 半部源** | `plugin-client.js` | 前端 UI 逻辑源（被 build 打进 `lib/client.cjs`）：增强按钮、设置页、插件管理页 UI | 影响一切界面交互；**改它后需 build** |
| **client 半部生成物** | `lib/client.cjs` | ⚠️ GENERATED，禁止手改；由 `plugin-client.js` 经 build 生成 | —（被覆盖，别编辑） |
| **构建** | `scripts/build-client.mjs` | 把 client 源组装为 `lib/client.cjs`（闭包 React + host.call + styles） | 改 client 源后必须跑；构建逻辑错则产物坏 |
| **文档 / 发布** | `README*`、`CHANGELOG.md`、`release-notes/`、`docs/` | 用户文档、更新日志、版本发布说明、截图 | 影响对外呈现与治理一致性 |
| **测试** | `test/lib.test.cjs` | 单测（主要覆盖 PURE 纯函数族） | 缺覆盖 = 版本比较/解析回归风险 |
| **包元数据 / 打补丁** | `package.json`、`cordis.patch.yml` | 包入口/导出/peerDependency；cordis 打补丁清单 | 影响安装与 DSH 加载 |
| **社区 / 元数据** | `.github/`、`LICENSE` | issue 模板；MIT 许可证 | 影响对外协作 |

## 关键依赖（跨模块红线）

- `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-locale` —— peerDeps，client 侧运行基座。
- **生成链路**：`plugin-client.js` → (`scripts/build-client.mjs`) → `lib/client.cjs`。
- **桥接契约**：`lib/index.cjs` ↔ `plugin-host.js` 通过 `harness.handle(method, fn)`；client 侧通过 `window.fetch('/dsh-prompt-enhancer/rpc')` 调 host RPC。

## 变更纪律

- 新增/删除/移动文件 → 更新本 `root.md`（若影响模块构成）+ 对应 `tree/*`。
- 模块职责变化 → 更新本文件的「职责/影响」列。
