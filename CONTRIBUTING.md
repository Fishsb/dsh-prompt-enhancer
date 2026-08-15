# Contributing

## 开发环境

- Node.js 22+
- pnpm 11+
- DSH v0.1.0-rc.6+（bundle 形态）

## 常用命令

```sh
# 安装依赖
npm install

# 构建 host 单文件产物（根 plugin-host.js）
npm run build:host

# 构建 client 产物（根 plugin-client.js + lib/client.cjs）
npm run build:client

# 构建全部产物
npm run build

# 运行测试
npm test

# 语法检查
node --check plugin-host.js
node --check plugin-client.js
node --check lib/*.cjs
```

## 代码结构

```
src/host/        # host 模块化源码（目标架构）
src/client/      # client 模块化源码（目标架构）
src/host/legacy/ # 当前单文件实现源（构建时注入模块）
lib/             # bundle-safe 运行时模块
test/            # 单元测试
docs/            # 架构方案 / 兼容矩阵 / 地图
```

## 修改流程

1. 改 `src/host/**` 或 `src/client/**` 源码
2. 运行 `npm run build`
3. 运行 `npm test`
4. 更新 `CHANGELOG.md [Unreleased]`
5. 运行项目地图 sync（如涉及结构变化）
6. commit + push（不主动发布）

## 发布

发布动作仅限维护者明确指示：bump 版本 → 构建 → 全量验证 → tag → Release。
