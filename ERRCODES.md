# ERRCODES.md — 错误码与用户文案映射

平台：DSH「提示词优化」插件（`enh-1`）。错误码由 host 侧产生/归一化，client 侧经 `errorKey()` 映射为用户可读文案（zh/en，随 Harness 语言）。

## 错误码一栏表

| 错误码 | 触发场景 | host 用户文案（en） | client zh 文案键 | 严重度 |
|---|---|---|---|---|
| `GUARD` | 空输入 / 斜杠命令无正文 | (blocked before call) | errGUARD「空输入或斜杠命令不支持优化」 | 提示 |
| `NO_LLM` | `llm` 服务不可用 | llm service unavailable | errNO_LLM | 高 |
| `UNKNOWN_MODEL` | 模型不在服务目录/不可路由 | optimize model unavailable (not in catalog) | errUNKNOWN_MODEL | 中 |
| `NO_ADAPTER` | LLM 提供方未启用 | LLM provider not enabled | errNO_ADAPTER | 高 |
| `INVALID_CREDENTIAL` | API 密钥无效或缺失 | invalid or missing API key | errINVALID_CREDENTIAL | 高 |
| `QUOTA` | 模型额度不足 | model quota exceeded | errQUOTA | 中 |
| `CONTEXT_WINDOW_EXCEEDED` | 输入超出上下文窗口 | input exceeds context window | errCONTEXT_WINDOW_EXCEEDED | 中 |
| `EMPTY_RESPONSE` | 模型返回空结果 | model returned an empty response | errEMPTY_RESPONSE | 中 |
| `OUTPUT_TOO_LONG` | 结果超出输出上限 | optimization exceeds length limit | errOUTPUT_TOO_LONG | 中 |
| `TIMEOUT` | 请求超时 | request timed out, original text restored | errTIMEOUT | 中 |
| `ABORTED` | 取消/中止 | request cancelled | errABORTED | 提示 |
| `LLM_FAILED` | 通用 LLM 异常 | optimize failed | errLLM_FAILED | 中 |
| `NETWORK` | client 侧网络失败 | (client) | errNETWORK | 高 |

## 服务/内部 RPC 错误码（不直接显示给最终用户，供诊断日志/插件管理）

| 错误码 | 场景 |
|---|---|
| `MODELS_FAILED` | `models/list` 异常 |
| `BAD_ARGS` | 参数缺失/非法（provider+model 必填） |
| `RESOLVE_FAILED` | `models/resolve` 异常 |
| `NO_SERVICE` | 依赖服务不存在（agentDefaultModel / dynamicCordisRunner） |
| `EMPTY` | `models/current` 无当前选择 |
| `CURRENT_FAILED` / `AUTOCHAIN_FAILED` | `models/current` / `models/autochain` 异常 |
| `NO_AGENT` | 会话 agent 不可达 |
| `INVENTORY_FAILED` / `RUN_FAILED` / `STOP_FAILED` / `UNDEFINE_FAILED` | 插件管理操作异常 |

## 客户端映射规则（`errorKey`）

```
GUARD→errGUARD, NO_LLM→errNO_LLM, UNKNOWN_MODEL→errUNKNOWN_MODEL, NO_ADAPTER→errNO_ADAPTER,
INVALID_CREDENTIAL→errINVALID_CREDENTIAL, QUOTA→errQUOTA, CONTEXT_WINDOW_EXCEEDED→errCONTEXT_WINDOW_EXCEEDED,
EMPTY_RESPONSE→errEMPTY_RESPONSE, OUTPUT_TOO_LONG→errOUTPUT_TOO_LONG, TIMEOUT→errTIMEOUT,
ABORTED→errABORTED, LLM_FAILED→errLLM_FAILED, NETWORK→errNETWORK, 其余→errUNKNOWN
```

> 规则"LLM 通道错误码未命中 → 兜底 `errUNKNOWN`（"优化失败"）"，保证未知失败也有可读提示且不泄漏内部细节。
