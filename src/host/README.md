# src/host

模块化 host 源码目录（M1 完成：legacy 已退役，build 直读本目录组装）。

结构：

- `app.js`：bundle 骨架（装配/apply/RPC 分发 + 全部注入标记），`scripts/build-host.mjs` 直读并注入 chunk 生成根 `plugin-host.js`
- `pure.js` / `diagnostics.js` / `models.js` / `plugins.js` / `update.js` / `enhance-handlers.js`：JSON 文本 chunk（构建注入回 app.js）
- `enhance.js` / `services.js` / `pipeline.js` / `model-service.js` / `update-service.js` / `diagnostics-service.js` / `plugins-service.js` / `config-service.js` / `config-schema.js` / `protocol.js` / `rpc-schema.js` / `reloader.js` / `update-platform.js` / `executor-reloader.js` / `logger.js` / `integrity.js`：M2/M3/M4/M5 服务化层（真实 CJS 模块，测试直用）
- `index.js`：服务注册组合入口

构建：

```sh
npm run build:host   # 或 npm run build（host+client）
```
