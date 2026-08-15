# src/host

目标模块化 host 源码目录。

当前阶段：

- `legacy/plugin-host.js`：现有单文件实现，仍由 `scripts/build-host.mjs` 原样生成到根目录 `plugin-host.js`
- `index.js` / `enhance.js` / `models.js` / `update.js` / `diagnostics.js` / `plugins.js` / `config.js`：目标模块骨架，后续逐步从 legacy 提取

构建：

```sh
npm run build:host
```
