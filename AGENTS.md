# AGENTS.md — dsh-prompt-enhancer 协同治理入口

> 本文件供 **AI 编码 agent**（Cursor / Claude Code / Codex 等）每次开工前必读。
> 目的：避免「项目失忆」「牵一发动全身」「乱改影响范围不可控」。
> 本仓库 = **发布真相仓库（main 分支）**，代码/发布在此产生；开发记录见 `prompt-enhancer-plugin`（master）。

---

## 一、开工前必读（每次必做，不许跳过）

动手改任何代码/文档前，先按顺序完成三件事：

1. **读项目地图** → `docs/map/index.md`（含 root / tree / flow 三层的超链接）
   - 弄清楚「我要改的区域在哪个模块、它关联谁、改了会影响谁」
2. **读项目更新日志** → `CHANGELOG.md`
   - 弄清当前版本（Unreleased + 最新 released），避免重复改、避免语义冲突
3. **更新日志对齐** → 若你正在补一个已发布的 bug / 被 issue 点名的改动，先查日志里是否已有相关条目

> **切勿全项目扫描**。目标文件分散在 maps 里，按地图定位，省上下文、少误伤。

---

## 二、改前影响分析（Write-Before-Analysis 门禁）

动手前先在心里/草稿区回答下面 6 问，命中任一就同步更新地图：

1. 本次改动涉及哪些文件？（用 `docs/map/tree/*` 定位）
2. 涉及哪些功能链路？（用 `docs/map/flow/*` 定位，记 FLOW-ID）
3. 是否**新增**了文件/模块/FLOW 链路？
4. 是否影响已有 FLOW（改入口、改 API、改数据、改行为、改权限）？
5. 是否影响公共区域 / 跨模块依赖（`lib/*.cjs`、plugin 双半部 RPC、peerDependency）？
6. 是否需要同步更新 root / tree / flow 三层地图？

> 未完成影响分析，**禁止直接改代码**。

---

## 三、改后同步（每次落地必做，半自动管控）

只要发生以下任一变化，**必须**同步更新地图与日志：

| 变化 | 必须更新 |
|---|---|
| 新增 / 删除 / 移动 / 重命名文件 | `docs/map/tree/*` |
| 模块职责 / 目录结构变化 | `docs/map/root.md` |
| 新增 / 变更功能（入口、API、数据、行为） | `docs/map/flow/*`（新增或更新 FLOW-ID） |
| 任何可被用户感知或需要记录的改动 | `CHANGELOG.md` 的 `[Unreleased]`，**并标注涉及 map/flow-id** |

> 地图与代码是「同一事实」的两面：哪个过期了，另一个就是错的。
> 宁可多写一条地图备注，也不要让地图和代码漂移。

---

## 四、模块索引（速查，详情见地图）

```
├── lib/index.cjs            host 半部 bundle 入口（把 plugin-host.js 的 harness.handle 适配成 HTTP RPC）
├── lib/client.cjs           ⚠️ GENERATED·禁止手改 → 由 scripts/build-client.mjs 从 plugin-client.js 生成
├── plugin-host.js           host 半部逻辑本体（1733 行，含 v2.0–v2.4 全部特性与 FLOW 链）
├── plugin-client.js         client 半部逻辑源（由 build-client 打进 lib/client.cjs）
├── scripts/build-client.mjs 构建：client 源码 → lib/client.cjs
├── test/lib.test.cjs        单测（node --test）
├── cordis.patch.yml         cordis 打补丁清单
├── CHANGELOG.md             本仓库的更新日志（Keep a Changelog 格式）
├── release-notes/           各版本发布说明（v2.4.0–v2.4.3）
├── docs/screenshots/        截图素材
└── docs/map/                【项目地图】root / tree / flow / index
```

> 详细边界见 `docs/map/root.md`（模块级）与 `docs/map/tree/*`（文件级）。

---

## 五、契约与红线（改前必过）

- **`lib/client.cjs` 是生成文件**：改它无效且会被覆盖。要改 client 逻辑，改 `plugin-client.js` 再跑 `npm run build`。
- **`plugin-host.js` 不被打补丁**：`lib/index.cjs` 原样读取并桥接它，保持动态安装原样可用。
- **版本号**：`PLUGIN_VERSION`（plugin-host.js 常量）为本地单一事实源；`package.json` version 与之保持一致。
- **RPC 契约**：client 经 `window.fetch('/dsh-prompt-enhancer/rpc')` 调 host 的 `harness.handle` 注册的方法；client 侧 sandbox 的全局 `fetch` 是教学 trap，出网必须用 `window.fetch`。
- **红线**：不暴露密钥、不做破坏性操作、不虚构地图中没有的路径。拿不准先问人。

---

## 六、验证（改完必跑）

涉及代码时，按仓库既有规范执行：

```bash
node --check plugin-host.js plugin-client.js   # 语法
node --test test/lib.test.cjs                   # 单测
npm run build                                    # 改过 client 源后重建
```

涉及版本发布时：更新 `CHANGELOG.md` + `release-notes/<version>.md` + 打 tag（Conventional Commits 见 `prompt-enhancer-plugin/GIT_COMMIT_CONVENTION.md`）。
