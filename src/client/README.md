# src/client

目标模块化 client 源码目录。

当前阶段：

- `legacy/plugin-client.js`：现有单文件实现，仍由 `scripts/build-client.mjs` 读取并生成 `lib/client.cjs`
- `index.js`：目标组合入口，后续逐步拆分 components / state / services / i18n

构建：

```sh
npm run build:client
```
