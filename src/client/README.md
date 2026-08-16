# src/client

模块化 client 源码目录（M1 完成：legacy 已退役，build 直读本目录组装）。

结构：

- `skeleton.js`：bundle 骨架（头注释 + 全部注入标记），`scripts/build-client.mjs` 直读并注入 chunk 生成根 `plugin-client.js` 与 `lib/client.cjs`
- `i18n.js` / `constants.js` / `updater.js` / `state.js` / `helpers.js` / `model-helpers.js` / `styles.js` / `app.js`：JSON 文本 chunk（构建注入回 skeleton）
- `components/*.js`：10 个 React UI 组件 chunk（EnhanceButton/EnhanceBar/UpdaterCard/PluginsSection/CollapsibleSection/ModelMainSection/FallbackRow/ModelConfigTab/ParamsTab/ModelPluginsSection+CordisBadgePlaceholder）
- `index.js`：服务注册组合入口（M2 目标）

构建：

```sh
npm run build:client   # 或 npm run build（host+client）
```
