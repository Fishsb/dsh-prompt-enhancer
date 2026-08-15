// ============================================================================
// DSH「提示词优化」插件 · Host 半部（v2.5.0：一键更新并重启 + 环境检测）
// v2.6.1（记忆链·未发布迭代）：发送前多轮迭代记忆升级——client 记忆由单轮对升级为
// rounds 链（≤4 轮）；host 经 buildChatMessages 以真多轮 user/assistant 消息注入，
// computeEditDelta/buildMemoryDeltaHint 感知本轮相对上一轮输出的修改方向（+新增/-删除）；
// 预算规则：链 ≤2400 字符按轮等分（输入 1/3、输出 2/3），摘要 ≤300；shouldInjectMemory
// 语义不变（hasMemory = rounds 非空）；记忆注入同样触发 CONTEXT_GUARD。
// v2.5.0（方案「一键更新并重启方案.md」）：
// ① 新 RPC update/apply：官方路径安装（dsh plugin add github:...#<tag>，120s 超时，
//    失败绝不重启）→ 成功后才 spawn 分离重启链（net stop <svc> & timeout 2 & net start <svc>，
//    execDetached 脱离进程树，host 被终止是预期）；仅 bundle 形态可用（harness.execCommand
//    判空 → UNSUPPORTED）；防重入 APPLY_BUSY。
// ② 新 RPC update/envcheck：只读探测 7 项（net 连通性 curl 实测 / service 存在 / account
//    LocalSystem / restart KillProcessTree / port 占用者 / mode 形态 / pnpmInfo 注入机制），
//    探测执行在 lib/index.cjs（probeEnv），本侧合并 ENV_PROBE_KEYS 等级元数据（block/warn/info）。
// ③ PURE 新增：ENV_PROBE_KEYS / buildInstallArgs / buildRestartChain / mergeEnvPath
//    （lib/index.cjs 切片 PURE 区段复用 mergeEnvPath 做用户 PATH 注入）。
// ④ 单测 U42-U45（命令构造/重启链/PATH 合并/探测计划）。
// v2.4.8（发布断链修复）：v2.4.5 曾无记录把 sidebar.footer.action 占位 id 从
// cordis-panel-enh 回退为 cordis-panel（与基座同槽位同 id 冲突，update/重挂时
// single-occupant duplicate / "Failed to load plugins"）——本版在 client 半部恢复
// cordis-panel-enh（见 plugin-client.js 注册处注释），并重建 lib/client.cjs。
// v2.4.7（用户需求：自定义提示词给默认内容、每模式独立对应）：
// ① validateConfig 新增 template.texts（4 模式键白名单，各 ≤4000）——每模式独立
//    自定义模板；无 texts 时旧全局 templateText 迁移到全部 4 模式（保持"全局一份"
//    语义不丢内容）；非法键/超长忽略；缺省全空。
// ② enhance system 组装：custom 且当前模式 texts 非空 → 用该模式文本；当前模式
//    空串 → 回退内置 SYSTEM_PROMPT（不空白、不报错）。
// ③ 新增 RPC template/default：返回 4 模式默认提示词（当前同值 = SYSTEM_PROMPT，
//    取自生成区）——client 首次切换自定义且无内容时预填（client 侧无内置文本）。
// ④ 单测 U41：texts 解析/非法键/超长/旧值迁移/新结构优先断言（43/43 通过）。
// v2.4.6（提示词外置，用户需求）：
// ① SYSTEM_PROMPT / TASK_ANALYSIS_PROMPT / CONTEXT_GUARD 三个静态提示词外置为
//    prompts/*.md（system.md / task-analysis.md / context-guard.md）——事实源；
//    plugin-host.js 中 ==PROMPTS-BEGIN== / ==PROMPTS-END== 标记区由
//    scripts/sync-prompts.mjs 生成内联（node scripts/sync-prompts.mjs；--check 校验漂移）。
//    为什么构建时内联而非运行时读文件：host 半部经 lib/index.cjs 以
//    new Function('harness', BODY) 执行（动态安装同样无 require/fs 作用域），
//    运行时读外部文件在两种安装形态下都不可靠；内联保持 plugin-host.js 单文件
//    自包含（动态/静态安装均不受影响）。lite 规则强化与 V2 上下文块为运行时
//    动态拼接，属代码逻辑，不入 prompts。
// ② 单测：U40 prompts 外置一致性断言（生成区 = md 逐行求值，防双向漂移）；
//    U39 契约断言继续对生成区生效（42/42 通过）。
// v2.4.5（语义保真，用户反馈"优化结果对提示词理解不够、语义理解错误"）：
// ① SYSTEM_PROMPT 重写：新增【理解原文（第一优先）】阶段——先逐条列出已明确信息
//    （动作对象/动作/约束/范围/术语/数字/语气），区分「原文明确需求」与「推测」；
//    明确化原则仅允许"模糊但可推断"的表述具体化，无法推出不得添加；"怎么做"细节
//    完整保留；删除旧版"只写做什么不解释怎么做"（与示例 2 自相矛盾，诱导删细节）；
//    删除"补充缺失的必要上下文"（诱导臆造）；长度改为"服从语义保真"（简单 ≤800，
//    复杂可超出但禁冗余，与 outputLimit=8000 一致）；语言改为"主体语言"（混合输入
//    保留术语，避免中英混杂误判）；示例扩至 4 条（新增语义保真/模糊明确化示范）；
// ② analyzeInputRules（lite 规则）保守化：suggestions 措辞全部改为"仅当可合理推断
//    且不偏离原意时才明确化，否则保持原文"——修复旧文案（"请在优化结果中补充合理
//    约束（如长度上限…）"）诱导模型添加原文未提及的新要求、造成语义漂移的问题；
//    lite 强化段拼接措辞同步改为「优化时请遵循以下原则」。
// ③ PLUGIN_VERSION bump 2.4.3 → 2.4.5（2.4.4 开发库提交时漏 bump；本次一并纠正，
//    发布仓库 v2.4.4 tag 缺 lite 规则代码，本版为完整语义保真版）。
// ④ 单测：U38 断言不变（missing/suggestions 结构契约未动，仅文案保守化）；新增
//    U39 SYSTEM_PROMPT 语义保真关键约束存在性断言（理解原文/语义等价/禁臆造）。
// v2.4.1（方案 §9-T5/T6 实测回填）：host 不再出网/会话策略写入
// v2.4.1（方案 §9-T5/T6 实测回填）：
// ① 架构修订：本部署 ctx.web.fetch 无可用 provider（实机抛错）——检测/下载改由 client 浏览器
//    直连 GitHub API（CORS 实测 200），host 经 update/check（tagsPayload/releasePayload 载荷）
//    与 update/pull（files 清单载荷）只做解析/校验/比较/写入；
// ② 写入/默认目录基于**会话策略**（resolve({ session })）——无会话时 workspaceRoot 回退 DSH
//    安装目录且写工作区 FS_SANDBOX_DENIED；带会话后 root=会话工作区（实机验证写 ok）。
// v2.4.0（方案「插件版本检测与一键更新方案.md」）：
// ① 新增 PLUGIN_VERSION（本地版本单一事实源，发布时 bump）/ UPDATE_MANIFEST（拉取文件清单）常量，
//    与版本比较纯函数族（parseVersion/compareVersions/versionStatus/normalizeRepo/pickMaxTag/
//    rawFileUrl/defaultDirFor/isValidTag，入 PURE 区段供单测切片）；
// ② 新增 update/check RPC——检测指定 GitHub 公开仓库版本（tags 主路径取最大，releases 仅作同名展示
//    元数据；300s TTL 缓存；返回 remote/remoteTag/defaultDir/status/ahead）；
// ③ 新增 update/pull RPC——校验客户端拉取的 6 个发布文件清单（validateManifestFiles），
//    按会话策略零写入落盘到目标目录（默认 <workspaceRoot>/dsh-prompt-enhancer-<tag>/，
//    root 取自会话策略；in-flight 锁防重入 PULL_BUSY；tag 白名单校验防注入）。
// v2.3（方案「提示词优化方案.md」§7）：① STAGE_* 常量 + pending 记录 stage 标记
// （prepare→history→analyze→files→events→context→llm），buildV2ContextBlock 注入 onStage 回调；
// ② 新增 enhance/progress 轮询 RPC（client 500ms 轮询展示步骤进度，纯展示、失败静默降级）；
// ③ 记忆状态改由 client 输入区记忆开关自身表达（关=变暗置灰 / 开=高饱和橙），host 无行为变化。
// v2.2（方案「提示词优化方案.md」§0.2/§2/§6）：
// ① 模式体系收敛 4 模式（base/lite/standard/smart），MODE_TABLE 表驱动（阶段 A/B/C 分发）；
// ② 记忆功能改为所有模式可开/关的独立开关（config.memory，缺省 false）——记忆块作为
//    叠加模块注入（shouldInjectMemory），记忆优先占用预算（≤1200），模式块用剩余预算；
// ③ 配置迁移：mode='memory' → mode='lite' + memory=true；autoMemory 并入 memory；
// ④ 日志 mode=base|lite|standard|smart（seed 场景标注 (seed)），ctx 日志含 memory chars=。
// v2.1：记忆模式（5 模式）——v2.2 已删除，历史值迁移见 ②。
// v14：新增日志环形缓冲 + logs/last 诊断 RPC（供客户端诊断日志查看器与故障排查）
// v17：① models/resolve：逐模型解析 reasoning 元数据（efforts/defaultEffort，懒加载）
//      ② models/test：连通性测试（resolveCallConfig 预校验失败不阻断 + 探测流计时，15s 超时）
//      ③ enhance 支持 reasoningEffort（主模型思考等级透传 llm.stream；cfg 日志加 effort=）
// v17.3：探测请求带 system + 明确指令 + maxTokens=16（真实请求形态）
// v18：① validateConfig v2：main/fallback/customModels/order/params/template（兼容 v1 平铺）
//      ② models/current：agentDefaultModel.currentSelection()（fresh install 兜底链继承）
//      ③ enhance 尝试链 = main + fallback 按序（每条独立 reasoningEffort）；cfg 日志加 chain=
// v19：新增 resolveAdaptiveChain（60s TTL 缓存）与 models/autochain RPC
// v20：内置兜底链硬编码指向 DeepSeek 官方模型（deepseek-official/deepseek-v4-flash、deepseek-v4-pro），
//      不再扫描任意 provider——主模型优先 currentSelection，兜底补足固定 DeepSeek 官方。
// v21：P1-4 模型能力解析缓存（resolveModelInfoCached，TTL 5min，按 provider:model 键，200 条上限清理）
// v23：模型链整合——enhance 不再区分 main/fallback，直接按链顺序逐一尝试（buildTryChain）；
//      老 v2 main 字段保留解析但尝试逻辑忽略（client 侧已迁移为链首条）。
// v2.0.0：引擎共存——engine=v1（默认，行为零变化）/ engine=v2（上下文感知：阶段 A 任务进度
//      smart|basic → 阶段 B 工作区文件/会话事件相关性检索 → 阶段 C 预算组装注入）；
//      各阶段独立降级；阶段 A/B 在优化超时计时器前执行（独立超时）；防上下文回显约束；
//      敏感文件硬过滤（shouldIgnoreFile）。
// ============================================================================

// @dsh-diagnostics-inject

// @dsh-models-inject

// ==PROMPTS-BEGIN==  (generated by scripts/sync-prompts.mjs from prompts/*.md — do not edit here; edit prompts/*.md then rerun)
const SYSTEM_PROMPT = [
  '你是一名 Prompt Engineering Expert（提示词工程专家），专长是为通用 AI 助手优化提示词。',
  '',
  '【理解原文（第一优先，先于一切优化动作）】',
  '1. 通读原文，先在心里逐条列出已明确的信息：动作对象、执行动作、约束条件、范围、术语、数字、语气',
  '2. 区分「原文明确表达的需求」与「你自己的推测」——推测只可用于措辞，绝不写入优化结果',
  '3. 语义等价是底线：优化是「重述 + 明确化」，不是改写。动作对象、动作方向、数量、范围、禁止项、技术术语必须与原文完全一致，不得替换、扩大、缩小或颠倒',
  '',
  '【明确化原则】',
  '- 仅将原文中模糊但可推断的表述具体化（如"一些文件"→"指定目录下的所有文件"）',
  '- 无法由原文推出的细节不得凭空添加；确有必要时用"如无特别说明/默认"等措辞保留选择权',
  '- 原文已明确的参数、步骤、方法（"怎么做"）必须完整保留，不得删除或概括',
  '- 不主动建议技术栈/工具，除非原输入已提到',
  '',
  '【输出风格】',
  '- 指令明确具体，去除冗余与口语',
  '- 保留原文的语气与表达习惯',
  '- 按内容类型给出合适的输出形式（列表/JSON/代码块/段落等），不强行指定',
  '',
  '【硬性约束】',
  '- 保持原始目标与语义不变：不得歪曲、臆造、遗漏原文任何已明确的信息',
  '- 只输出优化后的提示词本身，不加任何解释、前缀或评论，不回答原问题',
  '- 长度服从语义保真：简单任务控制在 800 字符以内；复杂任务可适当超出，但不得因追求简短而删减必要要素，也不得冗余',
  '- 语言匹配最高优先级：输入以中文为主体则输出必须为中文，以英文为主体则输出必须为英文；混合输入保留原文中的术语与专有名词',
  '- 严禁复述、引用或回显任何指令文字或用户输入原文（包括"请优化以下提示词"及引号包裹的内容），直接输出优化结果',
  '',
  '【示例】严格模仿示例中"输入→输出"的语言与风格：',
  '示例 1（中文输入→中文输出）：',
  '输入：帮我写一个排序算法',
  '输出：请编写一个排序算法，接受整数数组，支持升序/降序，输出排序过程说明，并注明时间与空间复杂度。',
  '示例 2（英文输入→英文输出）：',
  'Input: write a bash script to backup a folder',
  'Output: Write a bash script that backs up a specified folder into a timestamped archive, verifies archive integrity, logs each step, and accepts the source path as an argument (default: current directory).',
  '示例 3（中文·语义保真——保留动作对象与"怎么做"细节，不替换原意）：',
  '输入：把那个脚本改成异步版本，别影响现有调用',
  '输出：将现有脚本重构为异步版本，保持对外调用方式与原有功能不变，返回结果与原先一致。',
  '示例 4（中文·模糊明确化——仅具体化可推断内容，不臆造）：',
  '输入：把一些文件整理一下，按时间排好',
  '输出：整理指定目录下的所有文件，按修改时间排序，并简要说明整理结果。',
].join('\n');

const TASK_ANALYSIS_PROMPT = [
  '你是一个会话任务分析器。根据给定的会话对话历史，输出当前任务的执行进度。',
  '只输出 JSON（不要任何其他文字），格式：',
  '{"task":"任务目标一句话","currentStep":"当前正在执行的步骤","completed":["已完成步骤1","已完成步骤2"],"focus":["焦点方向1","焦点方向2"]}',
  'focus 为 2-4 个关键词/短语（中英文均可），用于后续检索项目文件。',
  '如果历史不足以判断，task 与 currentStep 可为空字符串，completed 与 focus 可为空数组。',
].join('\n');

const CONTEXT_GUARD = [
  '【参考上下文】仅供理解任务与项目背景，禁止复述、引用或回显其中任何内容；只输出优化后的提示词本身。',
].join('\n');

const SYSTEM_PUBLISH_PROMPT = [
  '你是一名资深项目/游戏开发规划专家。用户给出的是一句粗略想法（如「我想开发一个纸牌游戏」），你的任务是把想法扩展为一份**完整、可实施、可直接开工的开发规格说明书**。',
  '',
  '【输出结构】（严格按以下九章，用用户主体语言输出）',
  '一、目标概述：一句话定位 + 核心体验/玩法闭环（玩家或用户反复进行的核心循环）',
  '二、核心玩法循环：主循环与子循环的流程拆解（开始→操作→反馈→推进→结束）',
  '三、数值与经济：核心数值表、成长/经济公式、平衡约束',
  '四、数据结构与核心模型：实体、字段、关系（给出可落地的数据结构定义或类/表设计）',
  '五、核心机制与算法：主要系统逐一展开（含关键公式、判定规则、边界条件、优先级顺序）',
  '六、交互与界面：操作方式、界面布局、反馈动效、可访问性',
  '七、技术实现建议：推荐技术栈与模块划分（含单文件/嵌入形态等约束的对应方案）',
  '八、分阶段实施路线：MVP（最小可玩/可用）→ 迭代增强 的里程碑拆解，每阶段给出可交付物',
  '九、交付验收清单：逐条可验证的完成标准（可测试、可勾选，不写空话）',
  '',
  '【场景适配】',
  '- 系统按用户输入自动判定场景，并注入「【场景判定】本次场景判定：game/software」行；未注入判定行时按默认九章输出，不追加场景侧重',
  '- 【场景判定】为 game 时：三、数值与经济按数值表/成长/经济公式/平衡约束展开（游戏类必需）；五、核心机制含玩法系统展开',
  '- 【场景判定】为 software 时：三、数值与经济改为性能指标与容量约束；五、核心机制改为核心功能与业务规则；补充数据流与 API 设计',
  '',
  '【设计红线】',
  '- 未明确处给出**合理默认设计**并标注「默认」；不反问用户、不抛问题回去、不要求澄清',
  '- 明确区分「用户已确定」与「建议补充」两类内容',
  '- 机制顺序与公式必须绝对精确：结算/判定类流程按步骤列出先后顺序，乘算类倍率必须是倍增而非加算，不得含糊',
  '- 直接输出规格说明书本身，不加解释、前言或评论；**严禁回显、复述或引用用户输入原文**',
  '- 【网络参考】段内容仅供了解业界同类实现与结构参考，不得照抄，须结合用户想法重新设计',
  '',
  '【多轮扩充规则】',
  '- 第一轮：输出完整九章框架 + 关键实现细节（宁可详尽，不可缺章）',
  '- 后续轮次（用户补充/修改后继续优化）：**每一轮都必须输出完整九章规格**（不得输出精简版、摘要或仅回应补充），在保持已确认设计不变的前提下，将补充内容融入对应章节并细化展开（如新增机制 → 展开其数据结构与算法）；不推翻已确认决策，除非用户明确要求改变',
  '',
  '【方案自评判定】（输出九章规格后必须追加以下自评块，不改变九章框架；以【方案自评】开头，按一~四逐项输出）',
  '一、一致性核对：用户已明确需求逐条是否都有章节覆盖？缺项列出。',
  '二、完整性核对：九章是否全部展开？缺章列出。',
  '三、可实施性核对：是否存在未标注「默认」的设计空白？列出。',
  '四、判定结论：【保留】（全部通过，可开工）或【调整】（列出差距项 + 调整方向，并在「调整建议」小节给出 ≤5 条修订要点）。',
  '锚点规则（防自嗨）：任一「用户明确需求未覆盖」或「九章缺章」→ 必须判【调整】。',
  '【自评段豁免条款】：自评段不受「不加解释/严禁回显」红线约束——允许概括引用用户需求点以核对覆盖，禁止逐字回显输入原文；其余正文仍严守红线。',
].join('\n');
// ==PROMPTS-END==

// @dsh-pure-inject

// ================= V2 上下文感知优化 · 运行时（阶段 A/B/C） =================
// v2.0.0 方案 §3：阶段 A 任务进度（smart LLM / basic 规则）→ 阶段 B 相关性检索
// （工作区文件 + 会话事件）→ 阶段 C 预算组装注入。各阶段独立降级，不阻断优化。
// v2.4.6：TASK_ANALYSIS_PROMPT / CONTEXT_GUARD 已外置 prompts/*.md（见生成标记区）。

const V2_WORKSPACE_IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', '.cache', 'coverage', 'target', '.idea', '.vscode']);

// 阶段 A：任务进度理解（表驱动 phaseA：none 跳过 / rule 正则 / llm 智能（失败降级 rule）/ memory 读记忆对）
// 返回值：{ progress, mode }；mode: 'smart'|'rule'|'memory'|'none'
async function v2ResolveProgress(services, historyText, cfg) {
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  if (row.phaseA === 'llm' && services.llm && services.chain && services.chain.length > 0 && historyText.trim() !== '') {
    const entry = services.chain[0];
    let timedOut = false;
    const timer = services.timer.timeout(() => { timedOut = true; }, V2_PROGRESS_TIMEOUT_MS);
    try {
      const stream = services.llm.stream({
        provider: entry.provider,
        model: entry.model,
        ...(entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
        maxTokens: V2_PROGRESS_MAX_TOKENS,
        system: TASK_ANALYSIS_PROMPT,
        messages: [{
          id: 'enhance-task-progress',
          role: 'user',
          content: [{ type: 'text', text: historyText.slice(0, V2_HISTORY_MAX_CHARS) }],
          source: { kind: 'user' },
        }],
      });
      const iterator = stream[Symbol.asyncIterator]();
      const result = await collectStream(iterator, V2_PROGRESS_OUTPUT_LIMIT);
      if (!timedOut && result.kind === 'ok') {
        const parsed = parseTaskProgress(result.text);
        if (parsed) {
          hlog('[enhance] v2 smart progress ok');
          return { progress: parsed, mode: 'smart' };
        }
        hlog('[enhance] v2 smart progress bad-json');
      } else {
        hlog('[enhance] v2 smart progress ' + (timedOut ? 'timeout' : 'empty'));
      }
    } catch (e) {
      hlog('[enhance] v2 smart progress failed', e && e.message ? e.message : e);
    } finally {
      timer();
    }
  }
  // rule 规则提取（零成本；无历史时返回空 focus）——phaseA: rule / llm 降级 / memory 无记忆时兜底
  const focus = inferFocusRules(historyText);
  if (focus.length > 0) return { progress: { focus }, mode: 'rule' };
  return { progress: null, mode: 'rule' };
}

// 阶段 B：工作区文件检索（fs 扫描 + 名称/内容命中 → Top-3 摘要；2s 超时降级）
// v2.0.7：fs 契约修正——listDir/readText 接收 FsTarget（resolve 产出），条目 shape 为
// {name, type:'file'|'directory', target}；不再传字符串路径。
async function v2SearchWorkspace(services, keywords, cfg) {
  const fsSvc = services.fs;
  const root = services.sandboxPolicy && services.sandboxPolicy.workspaceRoot;
  if (!fsSvc || !root || typeof fsSvc.listDir !== 'function' || typeof fsSvc.readText !== 'function' || typeof fsSvc.resolve !== 'function') return [];
  // 表驱动：phaseB 非 file+event 跳过；扫描上限按 scanLimit（by-budget 查联动表 / fixed 固定）
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  if (row.phaseB !== 'file+event') return [];
  const lim = resolveScanLimit(cfg.mode, cfg.context.budgetChars);
  const depth = lim.depth;
  const maxFiles = lim.maxFiles;
  let aborted = false;
  const timer = services.timer.timeout(() => { aborted = true; }, V2_WORKSPACE_TIMEOUT_MS);
  try {
    let rootTarget;
    try {
      rootTarget = await fsSvc.resolve(root);
    } catch (e) {
      hlog('[enhance] v2 workspace resolve-root failed', e && e.message ? e.message : e);
      return [];
    }
    const files = [];
    const walk = async (target, rel, level) => {
      if (aborted || files.length >= SCAN_FILE_LIST_MAX || level > depth) return;
      let entries;
      try {
        entries = await fsSvc.listDir(target);
      } catch (e) { return; }
      for (const en of entries || []) {
        if (aborted) return;
        const name = en && en.name;
        if (!name) continue;
        if (V2_WORKSPACE_IGNORE_DIRS.has(name)) continue;
        const relPath = rel ? rel + '/' + name : name;
        if (en.type === 'directory') {
          await walk(en.target, relPath, level + 1);
        } else if (en.type === 'file') {
          files.push(relPath);
        }
      }
    };
    await walk(rootTarget, '', 1);
    if (aborted) { hlog('[enhance] v2 workspace scan timeout'); return []; }
    hlog('[enhance] v2 workspace scanned files=' + files.length);
    // 名称匹配 → 候选；v2.7.0：名称 0 命中时内容兜底（中文场景名称匹配几乎必然落空——
    // 中文关键词 vs 英文文件名；降级取前 N 个文本文件按内容关键词命中，救活
    // 「文件内容相关但文件名无关」场景；读取受 V2_WORKSPACE_TIMEOUT_MS 总超时保护）
    const candidates = rankFiles(files, keywords, 10).map((c) => c.path);
    if (candidates.length === 0) {
      const textRe = /\.(?:md|txt|py|ts|js|tsx|jsx|json|yaml|yml|toml|css|html|go|rs|java|cpp|c|h|sh|sql|vue)$/i;
      // 文档类（md/txt）优先——描述性内容最可能命中主题词
      const docFirst = files.slice().sort((a, b) => {
        const da = /\.(?:md|txt)$/i.test(a) ? 0 : 1;
        const db = /\.(?:md|txt)$/i.test(b) ? 0 : 1;
        return da - db;
      });
      const kws = (keywords || []).filter((k) => typeof k === 'string' && k.length >= 2);
      const contentScored = [];
      let scanned = 0;
      for (const rel of docFirst) {
        if (aborted || scanned >= CONTENT_FALLBACK_SCAN) break;
        if (!textRe.test(rel) || shouldIgnoreFile(rel)) continue;
        scanned++;
        let text = '';
        try {
          const target = await fsSvc.resolve(rel, { cwd: root });
          text = await fsSvc.readText(target);
        } catch (e) { continue; } // 只读权限/读取失败 → 跳过该文件
        const lines = text.split('\n');
        let contentHits = 0;
        for (const ln of lines) {
          if (kws.some((k) => ln.toLowerCase().includes(k.toLowerCase()))) contentHits++;
          if (contentHits >= 8) break;
        }
        if (contentHits > 0) contentScored.push({ path: rel, lines, contentHits });
      }
      hlog('[enhance] v2 workspace content-fallback scanned=' + scanned + ' hits=' + contentScored.length + ' kws=' + JSON.stringify(keywords));
      if (contentScored.length === 0) {
        hlog('[enhance] v2 workspace no-name-match files=' + files.length + ' kws=' + JSON.stringify(keywords));
        return [];
      }
      contentScored.sort((a, b) => b.contentHits - a.contentHits);
      const top = contentScored.slice(0, maxFiles);
      return top.map((f) => ({ path: f.path, snippet: snippetFromLines(f.lines, keywords, SNIPPET_BUDGET) }));
    }
    // 内容命中加分 → 排序 Top-maxFiles
    const scored = [];
    for (const rel of candidates) {
      if (aborted) break;
      if (shouldIgnoreFile(rel)) continue;
      let text = '';
      try {
        const target = await fsSvc.resolve(rel, { cwd: root });
        text = await fsSvc.readText(target);
      } catch (e) { continue; } // 只读权限/读取失败 → 跳过该文件
      const lines = text.split('\n');
      let contentHits = 0;
      const kws = (keywords || []).filter((k) => typeof k === 'string' && k.length >= 2);
      for (const ln of lines) {
        if (kws.some((k) => ln.toLowerCase().includes(k.toLowerCase()))) contentHits++;
        if (contentHits >= 8) break;
      }
      if (contentHits > 0) scored.push({ path: rel, lines, contentHits });
    }
    if (scored.length === 0) {
      hlog('[enhance] v2 workspace no-content-match candidates=' + candidates.length + ' kws=' + JSON.stringify(keywords));
      return [];
    }
    scored.sort((a, b) => b.contentHits - a.contentHits);
    const top = scored.slice(0, maxFiles);
    return top.map((f) => ({ path: f.path, snippet: snippetFromLines(f.lines, keywords, SNIPPET_BUDGET) }));
  } finally {
    timer();
  }
}

// 阶段 B3：会话事件检索（增强；searchEvents 契约：{sessionId,query,limit} → {items:[{snippet}]}；失败跳过）
async function v2SearchEvents(services, sessionId, keywords, cfg) {
  const sq = services.sessionQuery;
  const kws = (keywords || []).filter((k) => typeof k === 'string' && k.trim() !== '');
  // 表驱动：phaseB 非 file+event 跳过
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  if (row.phaseB !== 'file+event') return [];
  if (!sq || typeof sq.searchEvents !== 'function' || kws.length === 0) {
    hlog('[enhance] v2 searchEvents skipped kws=' + kws.length);
    return [];
  }
  try {
    const page = await sq.searchEvents({ sessionId, query: kws.join(' '), limit: 3 });
    const hits = page && Array.isArray(page.items) ? page.items : [];
    hlog('[enhance] v2 searchEvents kws=' + JSON.stringify(kws) + ' hits=' + hits.length);
    if (hits.length === 0) return [];
    return hits.slice(0, 3).map((h) => {
      const txt = h && (typeof h.snippet === 'string' ? h.snippet : (typeof h.text === 'string' ? h.text : ''));
      return txt ? txt.slice(0, 300) : '';
    }).filter(Boolean);
  } catch (e) {
    hlog('[enhance] v2 searchEvents failed', e && e.message ? e.message : e);
    return []; // 服务缺失/请求形状不符/失败 → 跳过事件段
  }
}

// 阶段 A/B/C 汇总：返回 { block, log }（全部不可用 → { block: '', log: 'none' }）
// v2.2（§6.5）：4 模式管道（base/lite 空块 / standard/smart 检索）。
// v2.6.1（记忆链）：记忆不再作为文本块叠加（改由 enhance 入口以真多轮消息注入，
// 见 buildChatMessages），模式块独享预算；log 仅含模式块口径（记忆见入口 memory 日志）。
// v2.3（§7.3）：onStage 回调（由 enhance handler 注入，写 pending 记录的 stage 字段；
// 纯函数本体不接触模块状态，回调缺省为 no-op 保持 PURE 区段可切片）。
async function buildV2ContextBlock(services, sessionId, text, cfg, onStage) {
  const mark = typeof onStage === 'function' ? onStage : () => {};
  const row = MODE_TABLE[cfg.mode] || MODE_TABLE[DEFAULT_MODE];
  const budget = cfg.context.budgetChars || 0;
  // ===== 模式管道（base/lite：phaseB='none' 无检索 → 空模式块）=====
  let modeBlock = '';
  let modeLog = 'none';
  if (row.phaseC === 'inject') {
    // 历史 + 阶段A + 阶段B
    let events = [];
    let historyText = '';
    const sq = services.sessionQuery;
    if (sq && typeof sq.listEvents === 'function' && typeof sq.filterEvents === 'function') {
      try {
        mark(STAGE_HISTORY);
        const records = await sq.listEvents(sessionId);
        // 尾部反向找最近的消息事件 seq（listEvents 升序，无文本；seq 用于 filterEvents 范围过滤）
        const msgSeqs = [];
        for (let i = records.length - 1; i >= 0 && msgSeqs.length < V2_MSG_SEQ_SCAN; i--) {
          const r = records[i];
          const t = String(r && r.type || '');
          if (t === 'user/message' || t === 'assistant/message') msgSeqs.push(r && r.seq);
        }
        if (msgSeqs.length > 0) {
          const minSeq = msgSeqs[msgSeqs.length - 1];
          const docs = await sq.filterEvents(sessionId, [{ kind: 'seq', from: minSeq }]);
          events = extractHistory(docs, V2_HISTORY_LIMIT);
          historyText = events.map((e) => (e.type === 'user' ? '[用户] ' : '[助手] ') + e.text).join('\n');
          hlog('[enhance] v2 history raw=' + records.length + ' msgSeqs=' + msgSeqs.length + ' minSeq=' + minSeq + ' docs=' + (docs ? docs.length : 'null') + ' events=' + events.length + ' chars=' + historyText.length + ' firstType=' + (events.length ? events[0].type : '-'));
        } else {
          hlog('[enhance] v2 history raw=' + records.length + ' msgSeqs=0 tailTypes=' + JSON.stringify(records.slice(-3).map((e) => e && e.type)));
        }
      } catch (e) {
        hlog('[enhance] v2 listEvents/filterEvents failed', e && e.message ? e.message : e);
      }
    } else {
      hlog('[enhance] v2 sessionQuery unavailable');
    }
    const root = services.sandboxPolicy && services.sandboxPolicy.workspaceRoot;
    hlog('[enhance] v2 workspaceRoot=' + (root || '(none)') + ' fs=' + (services.fs ? 'yes' : 'no'));
    // 阶段 A（表驱动 phaseA：llm 智能 / rule 正则 / none 跳过）
    mark(STAGE_ANALYZE);
    const { progress, mode } = await v2ResolveProgress(services, historyText, cfg);
    // 阶段 B（表驱动 phaseB：file+event 全量 / none 跳过）
    const focus = progress && Array.isArray(progress.focus) ? progress.focus : [];
    const keywords = extractKeywords(text, focus);
    mark(STAGE_FILES);
    const files = await v2SearchWorkspace(services, keywords, cfg);
    mark(STAGE_EVENTS);
    const eventsHits = await v2SearchEvents(services, sessionId, keywords, cfg);
    // 阶段 C（inject）：模式块独享预算（记忆链不占文本块）
    modeBlock = buildContextBlock(progress, files, eventsHits, budget);
    // v2.7.0（一键发布 · 网络检索）：publish 专属——依据草稿主题词 + 记忆链 delta
    // 改动方向构造检索词，经 ctx.web 搜索同类项目结构参考，注入模式块（预算余量内）。
    // 独立超时/降级：搜索失败/服务缺失 → 跳过，不阻断规格生成。
    let webLog = 'none';
    let query = '';
    if (cfg.mode === 'publish' && budget > 0) {
      mark(STAGE_FILES); // 复用 files 阶段标记（检索类）
      // 检索词先构造（不依赖 web 可用性；delta 为记忆链改动方向）
      query = buildWebQuery(text, keywords, services.delta || null);
      // v2.8.0（一键发布 · 场景路由）：检索词场景化——按会话缓存判定的场景追加方向词
      // （game → 游戏实现；software → 软件架构；generic 不追加）
      if (services.scenario === 'game') query = (query ? query + ' 游戏实现' : '游戏实现');
      else if (services.scenario === 'software') query = (query ? query + ' 软件架构' : '软件架构');
      const web = services.web;
      if (web && typeof web.search === 'function') {
        let timedOut = false;
        const timer = services.timer.timeout(() => { timedOut = true; }, WEB_SEARCH_TIMEOUT_MS);
        try {
          const res = await web.search({ query, maxResults: WEB_SEARCH_MAX_RESULTS });
          if (!timedOut && res && Array.isArray(res.sources) && res.sources.length > 0) {
            const lines = res.sources.slice(0, WEB_SEARCH_MAX_RESULTS).map((s) => {
              const title = s && s.title ? String(s.title) : '';
              const url = s && s.url ? String(s.url) : '';
              const summary = s && s.summary ? String(s.summary).slice(0, 200) : '';
              return '- ' + title + (url ? ' (' + url + ')' : '') + (summary ? '\n  ' + summary : '');
            }).join('\n');
            const webBlock = '【网络参考】\n' + lines.slice(0, Math.min(WEB_REF_MAX, Math.max(0, budget - modeBlock.length)));
            if (webBlock.length > 20) {
              modeBlock = modeBlock ? modeBlock + '\n\n' + webBlock : webBlock;
              webLog = 'web=1 sources=' + res.sources.length + ' chars=' + webBlock.length;
            } else {
              webLog = 'web=0';
            }
          } else {
            webLog = 'web=0' + (timedOut ? ' timeout' : '');
          }
        } catch (e) {
          webLog = 'web=failed';
        } finally {
          timer();
        }
      } else {
        webLog = 'web=none';
      }
      hlog('[enhance] v2 web ' + webLog + ' query=' + query.slice(0, 120));
    }
    modeLog = modeBlock === '' ? 'none' : (mode + ' files=' + files.length + ' events=' + eventsHits.length + (webLog !== 'none' ? ' ' + webLog : '') + ' chars=' + modeBlock.length);
  }
  // ===== 汇总（记忆链由 enhance 入口以多轮消息注入，不占文本块）=====
  mark(STAGE_CONTEXT);
  return { block: modeBlock, log: modeBlock === '' ? 'none' : modeLog };
}

function selfState(reference) {
  const status = reference.latestRun && reference.latestRun.status;
  if (status === 'awaiting-approval') return 'awaiting-approval';
  if (status === 'client-pending' || status === 'starting-host') return 'client-pending';
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'failed';
  if (status === 'waiting') return 'waiting';
  if (status === 'running') return 'running';
  if (reference.activeRun !== undefined) return 'running';
  return reference.currentPackageId === undefined ? 'defined' : 'stopped';
}

function summarize(reference) {
  const latest = reference.latestRun;
  const state = selfState(reference);
  return {
    pluginId: String(reference.pluginId),
    name: reference.name,
    state,
    // v2.4.3-fix：透传每包半部完整性——client 版本下拉据此禁用残缺包（防误切致 UI 消失）
    ...(reference.packages ? { packages: reference.packages.map((p) => ({ packageId: String(p.packageId), name: p.name, purpose: p.purpose || '', hasHostHalf: p.hasHostHalf === true, hasClientHalf: p.hasClientHalf === true })) } : { packages: [] }),
    ...(reference.currentPackageId === undefined ? {} : { currentPackageId: String(reference.currentPackageId) }),
    ...(reference.nextPackageId === undefined ? {} : { nextPackageId: String(reference.nextPackageId) }),
    ...(reference.activeRun === undefined ? {} : { activeRun: { pluginRunId: String(reference.activeRun.pluginRunId), packageId: String(reference.activeRun.packageId) } }),
    ...(latest && latest.status === 'awaiting-approval' ? { pendingApproval: { pluginRunId: String(latest.pluginRunId), packageId: String(latest.packageId), mode: latest.mode } } : {}),
  };
}

return {
  inject: ['timer'],
  apply(ctx) {
    const llm = ctx.get('llm');
    const pending = new Map();
    // v2.8.0（一键发布 · 场景路由）：会话级场景缓存（sessionId → game/software/generic）。
    // 首轮判定写入、后续轮读取不重判（场景决定九章骨架，翻转会推翻已确认设计）；
    // 生命周期 = 插件进程，进程重启后缓存 miss → 用记忆链最早轮输入兜底判定（enhance 内判定源规则）
    const publishScenarioCache = new Map();

    function requestKey(sessionId, seq) {
      return String(sessionId) + ':' + String(seq);
    }

    function markAndAbort(key, flag) {
      const rec = pending.get(key);
      if (!rec) return;
      rec[flag] = true;
      if (rec.iterator && typeof rec.iterator.return === 'function') {
        try { rec.iterator.return(); } catch (e) { /* 忽略 */ }
      }
    }

    function resolveAgent(sessionId) {
      const agents = ctx.get('agents');
      if (!agents || typeof agents.get !== 'function') return null;
      return agents.get(sessionId) || null;
    }

    harness.handle('models/list', async () => {
      const llmService = ctx.get('llm');
      if (!llmService || typeof llmService.listProviders !== 'function') {
        return { ok: false, code: 'NO_LLM', message: 'llm service unavailable' };
      }
      try {
        const providers = llmService.listProviders();
        const out = [];
        for (const p of providers) {
          let models = [];
          try {
            const list = await llmService.listModels(p.id);
            models = (list || []).map((m) => ({ id: m.id, name: m.name || m.id }));
          } catch (e) { models = []; }
          out.push({ provider: p.id, name: p.name, models });
        }
        return { ok: true, providers: out };
      } catch (e) {
        herr('[enhance] models/list failed', e);
        return { ok: false, code: 'MODELS_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('models/resolve', async (args) => {
      const provider = args && typeof args.provider === 'string' ? args.provider : '';
      const model = args && typeof args.model === 'string' ? args.model : '';
      const llmService = ctx.get('llm');
      if (!llmService || typeof llmService.resolveModelInfo !== 'function') {
        return { ok: false, code: 'NO_LLM', message: 'llm service unavailable' };
      }
      if (!provider || !model) return { ok: false, code: 'BAD_ARGS', message: 'provider and model required' };
      try {
        // v21（P1-4）：走 TTL 缓存，避免重复适配器能力查询
        const info = await resolveModelInfoCached(llmService, provider, model);
        const reasoning = info && info.reasoning ? {
          efforts: info.reasoning.efforts.map((e) => ({
            id: String(e.id),
            name: e.name,
            ...(e.description ? { description: e.description } : {}),
          })),
          ...(info.reasoning.defaultEffort ? { defaultEffort: String(info.reasoning.defaultEffort) } : {}),
        } : undefined;
        return {
          ok: true,
          provider,
          model,
          ...(reasoning ? { reasoning } : {}),
          ...(info && info.context ? { context: info.context } : {}),
          ...(info && info.defaultMaxTokens ? { defaultMaxTokens: info.defaultMaxTokens } : {}),
        };
      } catch (e) {
        herr('[enhance] models/resolve failed', e);
        return { ok: false, code: 'RESOLVE_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('models/current', async () => {
      const adm = ctx.get('agentDefaultModel');
      if (!adm || typeof adm.currentSelection !== 'function') {
        return { ok: false, code: 'NO_SERVICE', message: 'agentDefaultModel unavailable' };
      }
      try {
        const sel = adm.currentSelection();
        if (!sel || typeof sel.provider !== 'string' || typeof sel.model !== 'string' || !sel.provider || !sel.model) {
          return { ok: false, code: 'EMPTY', message: 'no current selection' };
        }
        return {
          ok: true,
          provider: sel.provider,
          model: sel.model,
          ...(typeof sel.reasoningEffort === 'string' && sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}),
        };
      } catch (e) {
        herr('[enhance] models/current failed', e);
        return { ok: false, code: 'CURRENT_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    // v19：暴露自适应解析出的默认兜底链（供 client 首装继承 / 恢复默认使用，不再硬编码 provider）
    harness.handle('models/autochain', async () => {
      const llmSvc = ctx.get('llm');
      const adm = ctx.get('agentDefaultModel');
      try {
        const chain = await resolveAdaptiveChain(llmSvc, adm);
        return { ok: true, chain };
      } catch (e) {
        herr('[enhance] models/autochain failed', e);
        return { ok: false, code: 'AUTOCHAIN_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('models/test', async (args) => {
      const provider = args && typeof args.provider === 'string' ? args.provider : '';
      const model = args && typeof args.model === 'string' ? args.model : '';
      const reasoningEffort = args && typeof args.reasoningEffort === 'string' && args.reasoningEffort !== '' ? args.reasoningEffort : undefined;
      const llmService = ctx.get('llm');
      if (!llmService || typeof llmService.stream !== 'function') {
        return { ok: false, code: 'NO_LLM', message: 'llm service unavailable' };
      }
      if (!provider || !model) return { ok: false, code: 'BAD_ARGS', message: 'provider and model required' };
      const entry = { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
      // 预校验：失败不阻断（目录 advisory，端点最终裁决；结果附 precheck 供展示）
      let precheck = null;
      if (llmService.resolveCallConfig) {
        try {
          await llmService.resolveCallConfig({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}), maxTokens: 1 });
        } catch (e) {
          precheck = { code: e && e.code ? String(e.code) : 'PRECHECK_FAILED', message: String(e && e.message ? e.message : e) };
        }
      }
      const ref = { current: null };
      let timedOut = false;
      const timer = ctx.timer.timeout(() => {
        timedOut = true;
        if (ref.current && typeof ref.current.return === 'function') {
          try { ref.current.return(); } catch (e) { /* 忽略 */ }
        }
      }, 15000);
      let r;
      try {
        r = await pingStream(llmService, entry, ref);
      } finally {
        timer();
      }
      if (timedOut) {
        hlog('[enhance] test provider=' + provider + ' model=' + model + (reasoningEffort ? ' effort=' + reasoningEffort : '') + ' → timeout');
        return { ok: false, code: 'TIMEOUT', message: friendlyMessage({ code: 'TIMEOUT' }) };
      }
      hlog('[enhance] test provider=' + provider + ' model=' + model + (reasoningEffort ? ' effort=' + reasoningEffort : '') + ' → ' + (r.ok ? 'ok ' + r.latencyMs + 'ms' : r.code));
      return { ...r, ...(precheck && r.ok ? { precheck } : {}) };
    });

// @dsh-plugins-inject

    harness.handle('logs/last', async () => ({ ok: true, lines: LOG_RING.slice() }));

    // v2.4.7（每模式独立自定义模板）：返回各模式默认提示词——client 首次切换
    // 「自定义模板」且当前模式无内容时预填用（client 侧无内置模板文本，须 host 提供）。
    // v2.8.0（实测修正）：补 publish 键 = SYSTEM_PUBLISH_PROMPT——此前只返回 4 模式，
    // publish 切自定义模板预填拿到 undefined → 内容为空（用户实测反馈）。
    // 当前 5 模式 base/lite/standard/smart 同值 = SYSTEM_PROMPT；若未来内置按模式拆分
    // （prompts/system-<mode>.md），此 RPC 返回随生成区自动变化，client 无需改动。
    harness.handle('template/default', async () => ({
      ok: true,
      defaults: {
        base: SYSTEM_PROMPT,
        lite: SYSTEM_PROMPT,
        standard: SYSTEM_PROMPT,
        smart: SYSTEM_PROMPT,
        publish: SYSTEM_PUBLISH_PROMPT,
      },
    }));

    // ================= v2.4.0 版本检测与一键更新 RPC =================
    // 方案「插件版本检测与一键更新方案.md」§3：检测（update/check）→ 一键拉取（update/pull）。
    // v2.4.1（实测回填 §9-T5/T6）架构：**host 不再出网**——本部署 web.fetch 无可用 provider
    // （实机抛 WEB_PROVIDER_UNAVAILABLE）；改由 client 浏览器直连 GitHub API（CORS 实测 200），
    // host 只做解析/校验/比较/写入（能力均已实机验证可用）。
    const updateCache = new Map();      // repo → { at, value }（TTL UPDATE_CACHE_TTL_MS）
    const pullInFlight = new Set();     // repo → 拉取中（防重入 PULL_BUSY）

    // v2.4.1（实测回填 §9-T5）：策略必须**带会话解析**——无会话时 workspaceRoot 回退到 DSH
    // 安装目录且写工作区返回 FS_SANDBOX_DENIED（实机验证）；带 session 后 mode=会话预设
    // （如 danger-full-access）、root=会话工作区（实机验证写 ok）。
    function resolveSessionPolicy(sessionId) {
      const sp = ctx.get('sandboxPolicy');
      if (!sp || typeof sp.resolve !== 'function') return null;
      let session;
      try {
        const ss = ctx.get('sessions');
        if (ss && typeof ss.get === 'function' && typeof sessionId === 'string' && sessionId) {
          session = ss.get(sessionId) || undefined;
        }
      } catch (e) { /* 会话解析失败 → 回退无会话策略 */ }
      try {
        return sp.resolve(session ? { session } : undefined);
      } catch (e) {
        return null;
      }
    }

    harness.handle('update/check', async (args) => {
      const repo = normalizeRepo(args && args.repo);
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
      const tagsPayload = args && typeof args.tagsPayload === 'string' ? args.tagsPayload : '';
      const releasePayload = args && typeof args.releasePayload === 'string' ? args.releasePayload : '';
      if (!repo) return { ok: false, code: 'BAD_REPO', message: 'repo must be "owner/name" (letters, digits, . _ -)' };
      if (tagsPayload === '') {
        return { ok: false, code: 'BAD_ARGS', message: 'tagsPayload required (client fetches GitHub tags, host evaluates)' };
      }
      const hit = updateCache.get(repo);
      if (hit && Date.now() - hit.at < UPDATE_CACHE_TTL_MS) {
        return { ...hit.value, cached: true };
      }
      try {
        // 主路径：tags 载荷（客户端已校验 HTTP 200）取最大可解析版本（§1.2-1）
        const tags = parseTagsPayload(tagsPayload);
        if (!tags) return { ok: false, code: 'BAD_ARGS', message: 'tagsPayload is not a valid JSON array' };
        const best = pickMaxTag(tags);
        if (!best) return { ok: false, code: 'NO_REMOTE_VERSION', message: 'no version-like tags found' };
        const status = versionStatus(PLUGIN_VERSION, best.version);
        // v2.4.1：默认目录基于**会话策略**的 workspaceRoot（无会话回退配置根）
        const policy = resolveSessionPolicy(sessionId);
        const defaultDir = defaultDirFor(policy && policy.workspaceRoot, best.raw);
        // 附加展示元数据：仅当 release 的 tag 与最大 tag 同名（§1.2-2；缺失/失败不阻断）
        let releaseMeta = null;
        if (releasePayload !== '') {
          try {
            const rel = JSON.parse(releasePayload);
            if (rel && typeof rel === 'object' && rel.tag_name === best.raw) {
              releaseMeta = {
                releaseName: typeof rel.name === 'string' ? rel.name : '',
                publishedAt: typeof rel.published_at === 'string' ? rel.published_at : '',
                body: typeof rel.body === 'string' ? rel.body.slice(0, 500) : '',
              };
            }
          } catch (e) { /* release 元数据失败不阻断检测 */ }
        }
        const value = {
          ok: true,
          repo,
          local: PLUGIN_VERSION,
          remote: best.version,
          remoteTag: best.raw,
          status,
          ahead: status === 'current' && compareVersions(PLUGIN_VERSION, best.version) > 0,
          defaultDir,
          source: 'tag',
          ...(releaseMeta ? releaseMeta : {}),
          checkedAt: Date.now(),
        };
        updateCache.set(repo, { at: Date.now(), value });
        hlog('[enhance] update/check repo=' + repo + ' local=' + PLUGIN_VERSION + ' remote=' + best.version + ' tag=' + best.raw + ' status=' + status + ' dir=' + defaultDir);
        return value;
      } catch (e) {
        herr('[enhance] update/check failed', e);
        return { ok: false, code: 'CHECK_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    harness.handle('update/pull', async (args) => {
      const repo = normalizeRepo(args && args.repo);
      const tag = args && typeof args.tag === 'string' ? args.tag.trim() : '';
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
      let dir = args && typeof args.dir === 'string' ? args.dir.trim() : '';
      if (!repo) return { ok: false, code: 'BAD_REPO', message: 'repo must be "owner/name"' };
      if (!isValidTag(tag)) return { ok: false, code: 'BAD_TAG', message: 'invalid tag' };
      const manifestCheck = validateManifestFiles(args && args.files);
      if (!manifestCheck.ok) return { ok: false, code: 'BAD_FILES', message: manifestCheck.message };
      const fsSvc = ctx.get('fs');
      if (!fsSvc || typeof fsSvc.resolve !== 'function' || typeof fsSvc.writeText !== 'function') {
        return { ok: false, code: 'FS_UNAVAILABLE', message: 'fs service unavailable' };
      }
      if (pullInFlight.has(repo)) {
        return { ok: false, code: 'PULL_BUSY', message: 'a pull is already in progress' };
      }
      pullInFlight.add(repo);
      try {
        // v2.4.1：会话策略（写入边界 = 会话工作区；无会话回退配置根）
        const policy = resolveSessionPolicy(sessionId);
        // dir 空串 → 默认目录（§3.2-0/4）
        if (dir === '') {
          dir = defaultDirFor(policy && policy.workspaceRoot, tag);
        }
        if (dir === '') return { ok: false, code: 'NO_DIR', message: 'target directory required' };
        // 逐文件写入（文件内容由客户端经浏览器直连 contents API 获取并解码——§9-T6；
        // 本侧仅校验清单完整性 + 会话策略写入；失败返回已写清单）
        const sandboxPolicy = policy;
        const written = [];
        for (const f of manifestCheck.files) {
          try {
            const fileTarget = await fsSvc.resolve(f.name, { cwd: dir });
            await fsSvc.writeText(fileTarget, f.content, undefined, undefined, sandboxPolicy);
            written.push({ name: f.name, bytes: new TextEncoder().encode(f.content).length });
          } catch (e) {
            herr('[enhance] update/pull write failed', f.name, e);
            const code = e && typeof e.code === 'string' && e.code ? e.code : 'PULL_WRITE_FAILED';
            return { ok: false, code, file: f.name, written: written.map((w) => w.name), message: String(e && e.message ? e.message : e) };
          }
        }
        hlog('[enhance] update/pull ok repo=' + repo + ' tag=' + tag + ' dir=' + dir + ' files=' + written.length);
        return { ok: true, repo, tag, dir, files: written };
      } finally {
        pullInFlight.delete(repo);
      }
    });

    // v2.5.0（方案「一键更新并重启方案.md」）：环境检测——只读探测 7 项，
    // 探测执行在 lib/index.cjs（probeEnv，bundle 形态注入）；本侧仅转发 + 合并展示元数据。
    harness.handle('update/envcheck', async (args) => {
      if (!harness.probeEnv) {
        return { ok: false, code: 'UNSUPPORTED', message: '动态安装不支持环境检测，请用 bundle 安装' };
      }
      try {
        const serviceName = args && typeof args.serviceName === 'string' && /^[A-Za-z0-9_-]+$/.test(args.serviceName)
          ? args.serviceName : 'dsh-web';
        // v2.7.0：透传执行器端口（client updater.executorPort，缺省 3081）供 exec-port 检查
        const executorPort = args && Number.isInteger(args.executorPort) ? args.executorPort : undefined;
        const items = await harness.probeEnv(serviceName, executorPort);
        const meta = new Map(ENV_PROBE_KEYS.map((e) => [e.key, e]));
        const out = items.map((it) => ({
          key: it.key,
          ok: it.ok === true,
          warn: it.warn === true,
          detail: typeof it.detail === 'string' ? it.detail : '',
          // v2.7.1：probeEnv 可携带 item 级 level 覆盖（工具不可达降级 warn / svc-bin no-service）
          level: it.level || (meta.has(it.key) ? meta.get(it.key).level : 'warn'),
        }));
        const blockMissing = out.filter((it) => it.level === 'block' && !it.ok).map((it) => it.key);
        hlog('[enhance] update/envcheck ok svc=' + serviceName + ' items=' + out.length + ' blockMissing=' + (blockMissing.join(',') || '-'));
        return { ok: true, items: out, blockMissing, checkedAt: Date.now() };
      } catch (e) {
        herr('[enhance] update/envcheck failed', e);
        return { ok: false, code: 'ENVCHECK_FAILED', message: String(e && e.message ? e.message : e) };
      }
    });

    // v2.6.0：update/apply 与 update/restart 已移除——更新执行迁至独立执行器
    // （lib/updater-host.cjs，127.0.0.1:EXECUTOR_PORT；client 经 update/executorEnsure
    // 获取执行器地址后直连）。原因：重启/重试必须脱离 dsh-web 进程（服务停 = host 死，
    // 依赖 host 的重试必然无法送达——v2.5.5 out.log 无 update/restart 日志为证）。

    // v2.3（§7.3）：优化进度轮询 RPC——从 pending Map 读 stage（纯展示，失败静默降级）
    harness.handle('enhance/progress', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : '';
      const seq = args && typeof args.seq === 'number' ? args.seq : -1;
      const rec = pending.get(requestKey(sessionId, seq));
      if (!rec) return { ok: false, code: 'NO_RECORD' };
      return { ok: true, stage: rec.stage || STAGE_PREPARE };
    });

    harness.handle('enhance', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : 'unknown';
      const seq = args && typeof args.seq === 'number' ? args.seq : -1;
      const text = args && typeof args.text === 'string' ? args.text : '';
      const key = requestKey(sessionId, seq);
      if (text.trim() === '' || text.startsWith('/')) {
        return { ok: false, code: 'GUARD', message: friendlyMessage({ code: 'GUARD' }) };
      }
      if (llm === undefined) {
        return { ok: false, code: 'NO_LLM', message: friendlyMessage({ code: 'NO_LLM' }) };
      }

      // v2.3（§7.3）：记录提前创建（入参校验后）——stage 从 prepare 起可被 progress RPC 轮询
      const rec = { cancelled: false, timedOut: false, iterator: null, stage: STAGE_PREPARE };
      pending.set(key, rec);

      const cfg = validateConfig(args && args.config);
      // v2.1（§2.2）：client 已判定实际模式（显式/auto/seed），请求 mode 覆盖解析值
      if (args && typeof args.mode === 'string' && MODE_KEYS.includes(args.mode)) cfg.mode = args.mode;
      // v2.8.2（用户需求）：一键发布模式记忆强制开启——args.mode 覆盖后仍需兜底
      if (cfg.mode === 'publish') cfg.memory = true;
      // v23（D6）：模型链 = cfg.fallback 按序（每条独立 reasoningEffort）；
      // 链为空 → 自适应解析当前环境默认链（不再区分 main/fallback）
      const chain = buildTryChain(cfg.fallback, await resolveAdaptiveChain(ctx.get('llm'), ctx.get('agentDefaultModel')));
      // v2.2（§6.5）：入口条件——模式注入或记忆叠加（记忆开 + 有记忆时 base/lite 也进入管道）
      let v2Block = '';
      let v2Log = 'none';
      // v2.4.7（每模式独立自定义模板）：custom 且当前模式 texts 非空 → 用该模式文本；
      // 当前模式未写自定义（空串）→ 回退该模式内置（publish → SYSTEM_PUBLISH_PROMPT，其余 → SYSTEM_PROMPT）
      // v2.7.0（一键发布）：publish 模式内置专用九章规格 system（custom 模板仍可覆盖）
      let system = cfg.mode === 'publish' ? SYSTEM_PUBLISH_PROMPT : SYSTEM_PROMPT;
      if (cfg.templateMode === 'custom') {
        const perMode = cfg.templateTexts && typeof cfg.templateTexts === 'object' ? cfg.templateTexts[cfg.mode] : '';
        const custom = typeof perMode === 'string' && perMode.trim() !== '' ? perMode.trim() : '';
        if (custom !== '') system = custom;
      }
      // v2.4.4（lite 规则引擎落地）：lite 模式对输入做 prompt 工程要素检查（目标/约束/格式/示例），
      // 缺失项的强化指令附加到 system——零 LLM 成本、零外部上下文（与「轻量」定位一致）。
      // v2.4.5：建议文案保守化（analyzeInputRules 内），拼接措辞同步——「遵循」而非「补全」。
      if (cfg.mode === 'lite') {
        const rules = analyzeInputRules(text);
        if (rules.suggestions.length > 0) {
          system = system + '\n\n【轻量规则提示】输入要素检查（本地规则，非外部上下文）——优化时请遵循以下原则：\n' + rules.suggestions.map((s) => '- ' + s).join('\n');
          hlog('[enhance] lite rules missing=' + rules.missing.map((m) => m.key).join(','));
        }
      }
      // v2.6.1（记忆链）：rounds 数组（时间序 [{input,output}]，≤MEMORY_ROUNDS_MAX 轮）→
      // 真多轮消息注入；hasMemory = rounds 非空；开关关 / 预算 0 → 不注入（行为不变）。
      const memRounds = args && args.memory && Array.isArray(args.memory.rounds)
        ? args.memory.rounds.filter((r) => r && (r.input || r.output)).slice(-MEMORY_ROUNDS_MAX)
        : [];
      const hasMemory = memRounds.length > 0;
      const memoryActive = shouldInjectMemory(cfg.memory, hasMemory, cfg.context.budgetChars);
      // v2.7.0（一键发布 · 改动方向代入检索）：delta 提前计算（记忆链轮次时），
      // 供 publish 网络检索词构造（buildWebQuery）使用；无记忆链 → null（检索词仅主题词）
      // v2.8.0（实测修正）：publish 的 removed 侧清零（补充式输入下 removed=上一轮规格，
      // 污染检索词并误导模型——见 filterDeltaForPublish）；hint 与检索词均用过滤后 delta
      let memDelta = null;
      if (memoryActive) {
        const lastOutput = memRounds[memRounds.length - 1].output;
        memDelta = filterDeltaForPublish(computeEditDelta(lastOutput, text), cfg.mode);
      }
      // v2.8.0（一键发布 · 场景路由）：publish 场景判定——会话级缓存固定（首轮判定写入、
      // 后续轮读取不重判）。判定源：缓存 miss 且记忆链非空 → 最早轮输入（进程重启续作兜底，
      // 判定源与注入轮次同源，避免增量文本导致场景翻转）；无记忆链 → 当轮 text。
      // 判定+写入在 system 注入前完成，与 LLM 调用成败无关（scenario 仅依赖判定源）。
      let scenario = 'generic';
      if (cfg.mode === 'publish') {
        const cached = publishScenarioCache.get(sessionId);
        if (cached) {
          scenario = cached;
        } else {
          const src = memRounds.length > 0 ? memRounds[0].input : text;
          scenario = detectScenario(src);
          publishScenarioCache.set(sessionId, scenario);
        }
        if (scenario !== 'generic') {
          system = system + '\n\n【场景判定】本次场景判定：' + scenario + '（依据用户输入自动判定；章节适配要求见「场景适配」段；请勿复述本判定行）';
        }
        hlog('[enhance] scenario=' + scenario + (cached ? ' cached' : ' judged src=' + (memRounds.length > 0 ? 'rounds[0]' : 'text')));
      }
      if (shouldInjectV2(cfg.mode, cfg.context.budgetChars) || memoryActive) {
        const v2 = await buildV2ContextBlock({
          llm: ctx.get('llm'),
          sessionQuery: ctx.get('sessionQuery'),
          sandboxPolicy: ctx.get('sandboxPolicy'),
          fs: ctx.get('fs'),
          timer: ctx.timer,
          chain,
          web: ctx.get('web'),
          delta: memDelta,
          scenario,
        }, sessionId, text, cfg, (st) => { rec.stage = st; });
        v2Block = v2.block;
        v2Log = v2.log;
      }
      // v2.6.1：记忆链注入同样需要防回显护栏（base/lite + 记忆时 v2Block 为空）
      if (v2Block !== '' || memoryActive) system = system + '\n\n' + CONTEXT_GUARD;
      // v2.7.0（publish 一键发布）：规格长文生成不设限制——maxTokens 省略（provider 默认上限）、
      // outputLimit=0（collectStream 不截断）、超时放宽至 ≥120s（长文生成耗时）
      // v2.8.0（实测修正）：120s → 240s——带记忆链 rounds 的多轮规格生成（重负载路径）
      // 实测 120s 超时（round-2 完整九章 + 融入补充 + 自评），240s 覆盖 4 轮链最坏情况
      const isPublish = cfg.mode === 'publish';
      const timeoutMs = isPublish ? Math.max(cfg.timeoutMs, 240000) : cfg.timeoutMs;
      const maxTokens = isPublish ? 0 : cfg.maxTokens;
      const outputLimit = isPublish ? 0 : cfg.outputLimit;
      // v2.6.1：消息组装——记忆链经 buildChatMessages 成为真多轮 user/assistant 消息，
      // 最终 user 消息 = 本轮修改摘要 + 模式块 + 原文包裹；无记忆 → 单 user 消息（旧行为）。
      let memoryLog = '';
      // v2.8.0（一键发布 · 实测修正）：publish 用中性用户包装（wrapPublishText），
      // 其余模式沿用「请优化以下提示词」包装（行为不变）
      const wrappedText = isPublish ? wrapPublishText(text) : wrapUserText(text);
      let finalText = v2Block !== '' ? v2Block + '\n\n' + wrappedText : wrappedText;
      let messages;
      if (memoryActive) {
        const hint = buildMemoryDeltaHint(memDelta);
        if (hint !== '') finalText = hint + '\n\n' + finalText;
        const built = buildChatMessages(memRounds, finalText, 'enhance-' + sessionId + '-' + seq, cfg.context.budgetChars);
        messages = built.messages;
        memoryLog = 'memory rounds=' + memRounds.length + ' chars=' + built.memChars + ' delta=' + (hint !== '' ? 'yes' : 'none');
      } else {
        messages = [{ id: 'enhance-' + sessionId + '-' + seq, role: 'user', content: [{ type: 'text', text: finalText }], source: { kind: 'user' } }];
      }
      const modeTag = args && args.seed === true ? cfg.mode + '(seed)' : cfg.mode;
      const ctxLog = [v2Log === 'none' ? '' : v2Log, memoryLog].filter((s) => s !== '').join('+') || 'none';
      hlog('[enhance] cfg session=' + sessionId + ' mode=' + modeTag + ' ctx=' + ctxLog + ' chain=' + (chain.length > 0 ? chain.map((f) => f.provider + '/' + f.model).join(',') : '-') + ' timeout=' + timeoutMs + ' maxTokens=' + maxTokens + ' outputLimit=' + outputLimit + ' template=' + (system === SYSTEM_PROMPT ? 'builtin' : (system.indexOf(CONTEXT_GUARD) !== -1 ? 'custom+v2guard' : 'custom')));

      const timeoutDisposer = ctx.timer.timeout(() => {
        markAndAbort(key, 'timedOut');
      }, timeoutMs);

      try {
        let lastFailure = null;
        for (let i = 0; i < chain.length; i++) {
          const entry = chain[i];
          if (rec.cancelled || rec.timedOut) {
            return { ok: false, code: rec.timedOut ? 'TIMEOUT' : 'ABORTED', message: friendlyMessage({ code: rec.timedOut ? 'TIMEOUT' : 'ABORTED' }) };
          }
          hlog('[enhance] try session=' + sessionId + ' provider=' + entry.provider + ' model=' + entry.model + (entry.reasoningEffort ? ' effort=' + entry.reasoningEffort : '') + ' seq=' + seq);
          rec.stage = STAGE_LLM;
          const stream = llm.stream({
            provider: entry.provider,
            model: entry.model,
            ...(entry.reasoningEffort ? { reasoningEffort: entry.reasoningEffort } : {}),
            system,
            // v2.7.0（publish）：maxTokens<=0 省略字段 → provider 默认上限（不设限制）
            ...(maxTokens > 0 ? { maxTokens } : {}),
            messages,
          });
          const iterator = stream[Symbol.asyncIterator]();
          rec.iterator = iterator;
          let result;
          try {
            result = await collectStream(iterator, outputLimit);
          } finally {
            rec.iterator = null;
          }
          if (result.kind === 'ok') {
            // v2.8.0（实测修正）：publish 剥离输出首部【场景判定】回显行（确定性，不依赖模型遵从）
            const cleaned = isPublish ? stripScenarioEcho(cleanOutput(result.text)) : cleanOutput(result.text);
            if (cleaned === '') {
              lastFailure = { code: 'EMPTY_RESPONSE', message: 'model returned empty text' };
              continue;
            }
            hlog('[enhance] ok session=' + sessionId + ' via ' + entry.model);
            return { ok: true, text: cleaned, model: entry.model };
          }
          if (result.kind === 'toolong') {
            lastFailure = { code: 'OUTPUT_TOO_LONG', message: 'output exceeded limit' };
            continue;
          }
          if (result.kind === 'cancelled' || result.kind === 'aborted') {
            return { ok: false, code: rec.timedOut ? 'TIMEOUT' : 'ABORTED', message: friendlyMessage({ code: rec.timedOut ? 'TIMEOUT' : 'ABORTED' }) };
          }
          hlog('[enhance] fail session=' + sessionId + ' model=' + entry.model + ' code=' + (result.failure ? result.failure.code : '?'));
          lastFailure = result.failure || { code: 'LLM_FAILED', message: 'unknown failure' };
        }
        hlog('[enhance] chain exhausted session=' + sessionId + ' last code=' + (lastFailure ? lastFailure.code : '?'));
        return { ok: false, code: lastFailure.code || 'LLM_FAILED', message: friendlyMessage(lastFailure) };
      } catch (e) {
        herr('[enhance] unexpected error session=' + sessionId + ' seq=' + seq, e);
        return { ok: false, code: 'LLM_FAILED', message: friendlyMessage({ code: 'LLM_FAILED' }) };
      } finally {
        timeoutDisposer();
        pending.delete(key);
      }
    });

    harness.handle('cancel', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : 'unknown';
      const seq = args && typeof args.seq === 'number' ? args.seq : -1;
      markAndAbort(requestKey(sessionId, seq), 'cancelled');
      return { ok: true };
    });

    ctx.effect(() => () => {
      for (const key of [...pending.keys()]) {
        const rec = pending.get(key);
        if (rec && rec.iterator && typeof rec.iterator.return === 'function') {
          try { rec.iterator.return(); } catch (e) { /* 忽略 */ }
        }
      }
    });
  },
};