# dsh-prompt-enhancer 架构重构完整调整方案

> 状态：已确认 / 执行中
> 日期：2026-08-16
> 范围：基于已完成架构审查与 DSH 官方设计特征对照，面向后期维护与功能模块扩展的根本性调整方案。

## 当前执行状态（2026-08-16）

| 阶段 | 状态 | 说明 |
|---|---|---|
| M0 基线固化 | ✅ | 兼容矩阵、测试 70、CI、文档对齐 |
| M1 源码模块化 | 🟡 大部分 | Host/Client 多模块已提取；enhance/React 组件仍部分在 legacy |
| M2 服务化/事件化 | ✅ 主体 | service registry、pipeline、各域服务接口 |
| M3 配置/RPC 契约化 | ✅ 主体 | protocol、rpc-schema、config-schema、RPC 边界校验 |
| M4 更新链路平台化 | ✅ 主体 | Reloader、UpdatePlatform、ExecutorReloader、update 服务接入 |
| M5 可观测/安全 | ✅ 主体 | logger、integrity、diagnostics 接入 logger |
| M6 工程化收尾 | ✅ | CONTRIBUTING、CI、全量验证 |

> 剩余：M1 中 enhance 大模块与 React 组件从 legacy 完全迁出；M5 完整性校验接入实际 staging 流程。

---

## 一、目标

1. **插件化**：能力按 Cordis 子插件拆分，独立生命周期。
2. **服务化**：模块间通过 `ctx.provide` / `inject` 解耦。
3. **事件化**：增强流程改为可注册管道。
4. **契约化**：配置/RPC 全部 schema 化、版本化。
5. **平台化更新**：优先平台热更新，外部执行器降级 fallback。
6. **安全与隐私不降级**：白名单、敏感过滤、权限模型在重构后只强不弱。
7. **兼容性优先**：动态安装、多 profile、旧配置迁移、旧版本降级路径全部保留。
8. **工程化保障**：CI、测试分层、可观测性、文档地图自动同步。

---

## 二、现状基线

| 项 | 现状 |
|---|---|
| host | `plugin-host.js` 2342 行单文件 |
| client | `plugin-client.js` 2631 行单文件 |
| 更新 | `lib/updater-host.cjs` 474 行外部执行器 + stop/start 重启 |
| RPC | 17+ 个方法，无 schema、无版本协商 |
| 配置 | 自定义 `validateConfig` + client localStorage |
| 测试 | 61 个，主要覆盖 PURE 纯函数 |
| CI | 无 |
| 文档 | 有地图/AGENTS/CHANGELOG，但存在漂移 |

---

## 三、目标架构

```
dsh-prompt-enhancer（bundle）
│
├── packages/contracts/
│   ├── rpc.schema.ts
│   ├── config.schema.ts
│   ├── pipeline.types.ts
│   └── update.types.ts
│
├── src/host/
│   ├── index.ts                 # 组装子插件、注册 RPC、生命周期
│   ├── enhance/
│   │   ├── pipeline.ts          # 管道注册/执行/错误隔离
│   │   ├── stages/              # 各阶段 handler
│   │   └── modes/               # 模式声明
│   ├── models/                  # 模型链服务
│   ├── update/
│   │   ├── service.ts           # 更新服务
│   │   ├── reload.ts            # 平台热更新适配器
│   │   ├── state-machine.ts     # 显式状态机
│   │   └── fallback/            # 外部执行器
│   ├── diagnostics/             # 结构化日志
│   ├── plugins/                 # 插件管理（对接官方 loader）
│   └── config/                  # Schemastery schema
│
├── src/client/
│   ├── index.ts
│   ├── components/
│   ├── state/
│   ├── services/
│   └── i18n/
│
├── scripts/
│   ├── build-host.mjs
│   ├── build-client.mjs
│   └── sync-contracts.mjs
│
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
└── docs/
    ├── architecture/
    └── map/
```

---

## 四、阶段方案

### Phase 0：基线固化与兼容性盘点

**目标**：为重构建立安全网，并明确所有兼容约束。

任务：

1. **兼容性盘点**
   - 列出所有 RPC 方法、参数、返回、调用方
   - 列出所有配置项、localStorage key、默认值
   - 列出所有支持形态：bundle / 动态 Cordis / 多 profile
   - 建立版本兼容矩阵

2. **测试基线**
   - 补 `lib/sys.cjs`、`lib/updater-host.cjs` 单测
   - 增加 RPC 契约测试
   - 增加配置迁移测试

3. **CI 基线**
   - GitHub Actions：语法检查、单测、build、地图漂移检查
   - 构建产物冒烟测试

4. **文档基线**
   - 修正文档漂移
   - 记录当前 workaround

**验收**：

- 版本兼容矩阵文档化
- 测试覆盖 80+
- CI 全绿
- 动态安装冒烟通过

---

### Phase 1：源码模块化（保持产物不变）

**目标**：源码可维护，运行行为不变。

任务：

1. Host 按 `enhance / models / update / diagnostics / plugins / config` 拆分
2. Client 按 `components / state / services / i18n` 拆分
3. PURE 区段继续独立导出
4. 构建产物行为等价验证

**验收**：

- 构建产物行为等价
- 动态安装可用
- 单测全绿

---

### Phase 2：Cordis 服务化与事件化

**目标**：模块边界从“文件”升级为“运行时服务”。

任务：

1. 定义服务接口（EnhanceService / ModelService / UpdateService / DiagnosticsService）
2. 使用 `ctx.provide` + `inject`
3. 增强管道支持 priority、超时、错误隔离、可注册/注销
4. 所有副作用挂 `ctx.effect`
5. RPC 权限分类：只读 / 用户触发 / 管理员级

**验收**：

- 新增模式/检索源 = 注册 handler
- 服务可 mock
- 卸载无泄漏
- RPC 权限分类文档化

---

### Phase 3：配置与 RPC 契约化

**目标**：消灭隐式契约。

任务：

1. Schemastery 定义配置 schema
2. 旧配置 → 新配置迁移器（localStorage → entry config）
3. 每个 RPC 定义 argsSchema / resultSchema
4. 增加 protocolVersion
5. 更新状态持久化，重启可恢复

**验收**：

- 非法参数统一拦截
- 旧配置无损迁移
- 状态机重启可恢复

---

### Phase 4：更新链路平台化

**目标**：一键更新不断端口。

任务：

1. 调研并实现 `entry.update()` / full reload
2. 抽象 Reloader 接口
3. 更新状态机显式化
4. 外部执行器降级 fallback
5. 多窗口/多实例并发控制
6. 回滚策略：备份 package.json / pnpm-lock.yaml / node_modules

**验收**：

- 主路径端口不关闭
- 失败自动回滚
- 并发更新被拒绝
- 状态机有单测覆盖

---

### Phase 5：可观测性与安全加固

**目标**：重构后系统可诊断、可审计、可防护。

任务：

1. 结构化 JSON 日志（sessionId / requestId / phase / 耗时 / 错误码）
2. 指标：增强请求量、成功率、耗时、更新成功/失败/回滚次数
3. staging 下载后 SHA256 校验
4. 敏感文件过滤在管道各阶段统一生效
5. 日志不记录 prompt 原文、API key、用户数据

**验收**：

- 日志可追踪一次完整更新
- 包 hash 校验有测试
- 敏感过滤在管道各阶段均生效

---

### Phase 6：工程化收尾与发布

**目标**：形成可持续维护的默认工程纪律。

任务：

1. 测试体系分层：unit / integration / e2e
2. 新增 `docs/architecture/` 架构文档
3. docs/map 全面同步
4. 重构期间使用内部基线 tag，不 bump 插件版本
5. 重构完成后 bump 大版本（如 3.0.0）
6. 发布资产包含构建产物与 hash
7. 贡献者指南

**验收**：

- CI 全绿
- e2e 冒烟通过
- 发布资产 hash 可验证
- 新贡献者可按文档完成一次功能扩展

---

## 五、横切关注点

### 1. 兼容性

- 保留动态 Cordis 单文件产物
- 多 profile 支持
- 旧 client 访问新 host：protocolVersion 明确降级

### 2. 安全

- 所有安装/更新命令继续走白名单
- staging 只允许官方 release 资产
- RPC 权限分层

### 3. 性能

- 构建产物体积预算（host ≤ 200KB，client ≤ 200KB）
- 管道 handler 超时与并发上限
- 热更新后内存泄漏检测纳入 e2e

### 4. 可维护性

- 模块职责单一
- 跨模块调用走服务接口
- 状态变化走状态机

### 5. 用户影响

- 设置 UI 入口尽量保持不变
- 旧配置自动迁移
- 一键更新按钮行为不变，底层从“重启”变为“热更新”

---

## 六、风险登记册

| 风险 | 影响 | 缓解 |
|---|---|---|
| 热更新平台能力不成熟 | 更新不断线目标无法达成 | 保留外部执行器 fallback |
| 模块化后动态安装失效 | 动态形态用户无法使用 | 构建产物单文件 + CI 冒烟 |
| 配置迁移丢失用户设置 | 用户信任受损 | 迁移器 + 备份 + 回退 |
| RPC 契约收紧破坏旧 client | 旧页面功能异常 | protocolVersion + 兼容层 |
| 多窗口并发更新 | 状态错乱 | 锁文件 + 持久化状态 |
| 管道化后错误隔离不足 | 单点失败拖垮主流程 | handler 级超时/降级策略 |
| 包体积膨胀 | 加载变慢 | 构建预算 + tree-shaking |

---

## 七、里程碑与 DoD

| 里程碑 | 内容 | Definition of Done |
|---|---|---|
| M0 | 基线固化 | 测试 80+、CI 绿、兼容矩阵文档化 |
| M1 | 源码模块化 | 构建等价、动态安装可用 |
| M2 | 服务化/事件化 | 服务接口稳定、管道可扩展 |
| M3 | 契约化 | Schema 校验、配置迁移、状态持久化 |
| M4 | 更新平台化 | 热更新主路径 + fallback + 回滚 |
| M5 | 可观测/安全 | 结构化日志、hash 校验、权限模型 |
| M6 | 发布收尾 | e2e 通过、文档零漂移、大版本发布 |

---

## 八、执行顺序建议

1. M0 基线固化（安全网）
2. M1 源码模块化（地基）
3. M2 服务化/事件化
4. M3 契约化
5. M4 更新平台化
6. M5 可观测/安全
7. M6 发布收尾
