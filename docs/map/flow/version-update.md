# 功能链路 · 版本检测与一键更新（FLOW-VERSION-UPDATE）

> 记录外部「从 GitHub 拉更新」的完整链路。FLOW-ID 前缀 `VU-`。
> ⚠️ 本链路的网络边界与 RPC 约束最容易踩坑，改动前务必通读。

---

## 主链路 VU-001：版本检测与一键更新

| 环节 | 载体 | 说明 |
|---|---|---|
| 用户触发 | `plugin-client.js` UpdaterCard（插件管理 tab 顶部） | repo 输入 + 检测按钮 → 状态徽标 → 目标目录 → 拉取结果 |
| 网络出网 | `plugin-client.js` → `window.fetch` | **必须用 `window.fetch`**：client 沙箱的全局 `fetch` 是教学 trap（抛错重定向 host）；出网 CORS 直连 `api.github.com`（实测 200） |
| 检测 RPC | client → `update/check` | host 解析 tags/releases 载荷，比较版本，返回 `{remoteTag, defaultDir, status, ahead}` |
| 拉取 RPC | client → `update/pull` | client 用 contents API 下载文件（base64→atob），host 校验后落盘 |
| host 校验 | `plugin-host.js` `validateManifestFiles` | 权威校验；`UPDATE_MANIFEST` 与 client 侧同步 |
| host 写入 | `plugin-host.js` | 基于**会话策略** `resolve({session})`；无会话时回退 DSH 安装目录（写工作区会 FS_SANDBOX_DENIED）；in-flight 锁防重入 `PULL_BUSY` |
| 落盘目标 | 默认 `<workspaceRoot>/dsh-prompt-enhancer-<tag>/` | root 取自会话策略 |
| 防注入 | tag 白名单校验 | 防路径注入 |

---

## 版本比较纯函数族（PURE 区段，可单测）

`parseVersion / compareVersions / versionStatus / normalizeRepo / pickMaxTag / rawFileUrl / defaultDirFor / isValidTag` —— 集中在 `plugin-host.js` PURE 区段，供 `test/lib.test.cjs` 切片测试。

---

## 关键常量 / 缓存

| 项 | 说明 |
|---|---|
| `PLUGIN_VERSION` | 本地版本单一事实源，发布时 bump |
| `UPDATE_MANIFEST` | 拉取文件清单（与 client 同步） |
| TTL | `update/check` 300s 缓存 tags/releases |
| 残缺包 | 缺 host/client 半部的历史包 → 版本下拉禁用 + 标注「（不完整）」 |

---

## 风险与红线

- **host 不出网**：v2.4.1 起 host 无出网能力（web.fetch 无 provider），所有数据获取在浏览器侧完成。
- **sessionId 必须带**：RPC 需携带 sessionId，host 依会话策略解析沙箱边界。
- **`lib/client.cjs` 生成文件**：改更新逻辑走 `plugin-client.js` + build。

---

## 变更纪律

任何对版本/更新逻辑、清单、会话策略、出网方式的改动 → 标记 `VU-xxx` 并同步 `CHANGELOG.md`。
