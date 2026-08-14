# 项目地图 · 文件索引（tree）

> 文件级索引：每个具体文件负责什么、改动影响谁、关联哪些 FLOW。
> 按模块拆分；总导航见 `../index.md`。

## 入口与桥接

| 文件 | 职责 | 影响 | 关联 |
|---|---|---|---|
| `lib/index.cjs` | host 半部 bundle 入口；读取 `plugin-host.js` 主体，`harness.handle`→HTTP RPC `/dsh-prompt-enhancer/rpc`；注册到 `ctx.inject(['webServer'])` | 全局可用性；是 client 调 host 的唯一天关 | `flow/prompt-enhance`、`flow/version-update` |
| `lib/index.cjs` 的 `registerRpcRoute` | 建 RPC 端点，route method → handlers | 所有 host RPC 的 HTTP 层 | — |

## host 逻辑本体

| 文件 | 职责 | 影响 | 关联 |
|---|---|---|---|
| `plugin-host.js` | 全部后端逻辑（约 1733 行）：增强引擎 v1/v2、模型解析（models/*）、版本检测更新（update/*）、诊断日志（logs/*）、配置校验、纯函数族 | 核心行为；PURE 区段被单测切片 | `flow/*` 全部 |
| ↓ header 注释 | v2.0–v2.4.3 全部特性注释（版本演进权威记录） | 排查历史行为 | — |

## client 半部

| 文件 | 职责 | 影响 | 关联 |
|---|---|---|---|
| `plugin-client.js` | 前端 UI 逻辑源：增强按钮、设置页、插件管理页、UpdaterCard | **改此需 `npm run build`** | `flow/prompt-enhance`、`flow/version-update` |
| `lib/client.cjs` | ⚠️ GENERATED，禁止手改；由 build 生成 | 被覆盖；别编辑 | — |

## 构建 / 测试 / 配置

| 文件 | 职责 | 影响 | 关联 |
|---|---|---|---|
| `scripts/build-client.mjs` | 组装 client 为 `lib/client.cjs` | 改 client 源后必跑 | — |
| `test/lib.test.cjs` | 单测（`node --test`），覆盖 PURE 纯函数族 | 防回归 | — |
| `package.json` | 包元数据：main/exports/files/peerDeps/dsh bundle | 安装与加载 | — |
| `cordis.patch.yml` | cordis 打补丁清单 | DSH 加载 | — |

## 文档 / 发布

| 文件 | 职责 | 关联 |
|---|---|---|
| `README.md` / `README.en.md` | 用户文档（中/英） | — |
| `CHANGELOG.md` | 更新日志（Keep a Changelog） | — |
| `release-notes/v2.4.0.md` | v2.4.0 发布说明 | — |
| `release-notes/v2.4.1.md` | v2.4.1 发布说明 | — |
| `release-notes/v2.4.2.md` | v2.4.2 发布说明 | — |
| `release-notes/v2.4.3.md` | v2.4.3 发布说明 | — |
| `docs/screenshots/` | 界面截图素材（如 `settings-v2.4.3.png`） | — |
| `docs/map/` | 本项目地图（本目录） | — |
| `AGENTS.md` | 本仓库协同治理入口 | — |

## 元数据 / 社区

| 文件 | 职责 | 关联 |
|---|---|---|
| `.github/ISSUE_TEMPLATE/bug_report.md` | bug 报告 issue 模板 | — |
| `LICENSE` | MIT 许可证 | — |

## 变更纪律

- **`lib/client.cjs`**：任何情况下不手改；要改 client 逻辑走 `plugin-client.js` + build。
- 本文件（tree）是文件级唯一事实源——增删文件必须在此登记。
