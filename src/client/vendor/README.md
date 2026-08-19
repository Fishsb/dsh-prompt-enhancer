# vendor · RecordRTC

| 项 | 值 |
|---|---|
| 库 | RecordRTC（MIT License，www.WebRTC-Experiment.com/licence） |
| 版本 | **5.6.2**（2021-03-09 UTC 发布） |
| 来源 | 官方 npm `recordrtc@5.6.2` 的 UMD 单文件 `RecordRTC.min.js`（unpkg 镜像，与官方仓库一致） |
| 文件 | `recordrtc.js`（**官方原码·只读**，license 头保留，78609 B） |
| 用途 | 浏览器录音（`StereoAudioRecorder` + `desiredSampRate:16000` → 16k mono WAV） |

## ⚠️ 禁止修改（项目硬性原则「不可动引用的框架」）

- `recordrtc.js` 为官方原码，**只经公开 API 调用，禁止修改任何源码**
- 生成物 `recordrtc.chunk.js`（GENERATED）由 `scripts/vendor-recordrtc.mjs` 转义生成，**禁手改**
- **升级流程**：下载新版本官方 UMD → 整体替换 `recordrtc.js`（保留 license 头）→ 重跑 `node scripts/vendor-recordrtc.mjs` → 更新本表版本号
- **改动即记录**：任何 vendor 变更必须同步更新本 README（版本/来源/日期），pre-commit 级约定

## 引用方式（路径 A·内联 chunk）

`build-client.mjs` 经 `// @dsh-client-vendor-recordrtc-inject` marker 注入 `recordrtc.chunk.js`，
client 运行时以字符串内联加载（P0.5 探针证实沙箱不遮蔽，路径 A 定案 2026-08-20）。
