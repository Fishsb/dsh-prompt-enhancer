# Changelog

本项目所有重要变更记录于此文件。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。完整发布说明见 [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)。

> 🗺️ 本日志与项目地图[`docs/map/`](docs/map/index.md)交叉引用：新条目标注涉及 map/flow-id（PEN/VU/DG）；agent 开工前先读 [`AGENTS.md`](AGENTS.md)。

## [Unreleased]

### Added
- 协同治理落地：新增 `AGENTS.md`（agent 开工入口：改前影响分析 + 改后同步地图/日志）与项目地图 `docs/map/index.md`（root 模块级 / tree 文件级 / flow 功能链路，FLOW-ID: PEN / VU / DG）— [MAP-001]
- README 安装章节改为实测通过的傻瓜式一条命令：`dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v2.4.4`（版本锁定 + pnpm 前提 + allowBuilds 兜底说明），降低新用户安装门槛 — [VU-001]

### Fixed
- `sidebar.footer.action` 占位注册 id 由 `cordis-panel` 改为插件唯一值 `cordis-panel-enh`，回避与基座 `dsh-client-ui-cordis` 的 `CordisPanel`（同槽位同 id）冲突，修复 update/重挂时的 single-occupant duplicate 与 "Failed to load plugins"（历史 v2.4.1-fix2 同源问题）— [PEN-001]

## [2.4.3] - 2026-08-15

### Added
- 模型配置栏默认展开——设置页打开即见完整模型链— [PEN-002]
- 插件管理版本选择与「当前 → 目标」确认切换（选中非当前版本显示核对行，确认后执行 update）— [VU-001]
- 残缺包防误切：缺 host/client 半部的历史包在版本下拉中禁用并标注「（不完整）」— [VU-001]

### Changed
- 优化按钮统一样式对齐模型选择器：等线字体（DengXian）、字重 600、24px 胶囊、label-secondary 灰字、hover 深色椭圆背景、左右留白 4/8px— [PEN-001]
- 清理 plugin-host.js 中 `defaultDirFor` 重复定义— [VU-001]

## [2.4.2] - 2026-08-15

### Fixed
- 动态 client 沙箱 `fetch` 限制：「版本检测与一键更新」改用 `window.fetch` 直连 GitHub API— [VU-001]
- locale 注册容错：update 场景页面残留实例不再抛 `locale namespace "enhance" already has locale "zh"`— [VU-001]

## [2.4.1] - 2026-08-15

### Changed
- host 不再出网：版本检测/拉取的数据获取改由浏览器直连 GitHub API（CORS），host 只做解析/校验/写入— [VU-001]
- 写入基于会话策略，修复无会话时 `FS_SANDBOX_DENIED`— [VU-001]

## [2.4.0] - 2026-08-15

### Added
- 版本检测与一键更新（update/check + update/pull，contents API 下载）— [VU-001]
- 插件管理页版本检测卡片；按钮三态字体锚点对齐模型选择器（13px/500/20px）— [VU-001]

[2.4.3]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.3
[2.4.2]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.2
[2.4.1]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.1
[2.4.0]: https://github.com/Fishsb/dsh-prompt-enhancer/releases/tag/v2.4.0
