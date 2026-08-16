// ============================================================================
// DSH「提示词优化」插件 · Client 半部（v2.4.7：自定义模板每模式独立 + 默认预填）
// v2.6.2（继续优化·未发布迭代）：新增 s.optimized 标记（成功应用 ≥1 轮置 true、撤回重置
// false）——空闲态非空且已优化过 → 按钮纯文字「继续优化」（无 ✨ 图标，hover titleContinue）；
// 首次优化 → ✨ + 模式短标签；优化中 / 完成撤回 / 空输入记忆开关 / 守卫禁用等状态不变。
// v2.6.1（记忆链·未发布迭代）：记忆由单轮对升级为 rounds 链（s.memoryRounds，最多
// MEMORY_ROUNDS_MAX 轮）——每次结果应用后追加 {input, output} 并截断；req.memory 传
// { rounds }，host 以真多轮消息注入并感知本轮修改方向；撤回只弹出最后一轮（更早轮次
// 仍有效）；首次 seed / reload 标记 / R1 写入条件语义不变。
// v2.4.7：① config.template 新增 texts（base/lite/standard/smart 各一份）；旧 text
//         （v2）与 templateText（v1）迁移到全部 4 模式；text 字段保留兼容；
//         ② ParamsTab 自定义模板区：切「自定义」且当前模式无内容 → host
//         template/default 预填默认（非空白）；模式切换时 textarea 跟随当前模式；
//         编辑只写当前模式（互不干扰）；label 带当前模式名（cfgTemplateTextFor）；
//         ③ 新增 i18n cfgTemplateTextFor/cfgTemplateNote（ZH/EN）。
// v2.4.6：① ParamsTab 顶部「优化模式」与「模板」两个下拉合并为同一行双字段
//         （.dsh-plg-row-duo + .dsh-plg-field，各占一半、窄屏自动换行；
//          label 不再强制 96px 以免挤占 select）；自定义模板内容区仍独占一行；
//         ② 模式 hint 文案位置不变（紧随同行行下方）。
// v2.4.5：① MODE_OPTIONS lite hint 与 cfgModeHintLite 文案改「缺失项保守提示明确化」
//         （原「缺失自动补全强化」与 host v2.4.5 analyzeInputRules 保守化措辞冲突，
//         会误导用户以为 lite 会臆造补全内容；行为无变化，仅文案对齐）；
//         ② 头部版本注释同步 v2.4.5。
// v2.4.3：① CollapsibleSection 默认展开（useState(true)）——模型配置栏打开即见完整内容；
//         ② PluginsSection 版本选择——受控 select（缺省=当前版本），选中非当前版本显示
//            「当前 → 目标」核对行（pluginsSwitch 确认后 plugins/run update，取消还原）。
// v2.4.1-fix（2026-08-14 实测修复）：动态 client 沙箱将全局 fetch 替换为教学 trap
// （抛错重定向到 host.call）——doCheck/doPull 的 3 处 fetch() 改为 window.fetch()，
// 绕过参数遮蔽直达页面主 realm（CORS 直连 GitHub API 实测 200）。
// v2.4.1-fix2（2026-08-14）：locale.register 在 update 场景抛 duplicate（旧实例残留、
// single occupant）导致 client-half-failed——safeRegister 吞冲突，字典未变沿用旧注册。
// v2.4.1（方案「插件版本检测与一键更新方案.md」§9-T5/T6 实测回填）：
// ① 数据获取移至浏览器：host 无出网能力（web.fetch 无 provider）——本半部直连
//    api.github.com（CORS 实测 200）取 tags/release 载荷与 contents API 文件
//    （base64 → atob 解码），host 只做解析/校验/写入；新增 updRepoNotFound 错误文案；
// ② RPC 携带 sessionId——host 经会话策略解析沙箱边界（写入限定会话工作区）；
// ③ UPDATER_MANIFEST 与 host PURE 区段同步（validateManifestFiles 为权威校验）。
// v2.4.0（方案「插件版本检测与一键更新方案.md」）：
// ① 插件管理 tab 顶部新增「版本检测与更新」卡片（UpdaterCard）——repo 输入 + 检测版本按钮 →
//    本地/远端版本与状态徽标（outdated 显示「一键拉取更新」）→ 目标目录（默认 host 计算的
//    defaultDir）→ 拉取结果 + 应用指引；repo 变更清空陈旧结果（方案 §4/§10）；
// ② config v2 新增 updater: { repo, targetDir }（sanitizeV2 白名单校验，旧配置兼容）；
// ③ 字体对齐（方案 §10.2）：.dsh-enh-btn-text 显式声明 13px/500/20px 三态共用锚点，
//    移除 .dsh-enh-mode 独立字号声明（继承锚点），杜绝继承链失效。
// v2.3（方案「提示词优化方案.md」§7）：
// ① EnhanceButton idle = emoji ✨ + 模式短标签（MODE_OPTIONS.short / i18n modeShort* 键），
//    订阅 configState——模式切换即时同步；
// ② enhancing = spinner + 步骤进度文案（500ms 轮询 enhance/progress，stage→i18n 文案，
//    轮询失败静默降级「优化中…」）+ hover 切「取消」（错误红）；
// ③ 记忆状态（v2.3.2 §7.9）：移除输入区记忆开关模块；记忆开/关只影响 ✨ 图标饱和度
//    （开=正常彩色 / 关=低饱和 dsh-enh-icon-dim），文字（模式短标签）饱和度不变；
//    空输入时按钮不再降低饱和度（disabled 仅保留点击无效与 cursor）。
// v2.3.3（§7.10）：① font-weight:500 对齐 DSH ModelSelect trigger（按钮与短标签）；
//    ② 空输入时按钮 = 记忆开关（disabled=false，点击 toggle config.memory，title 提示当前状态）；
//    ③ busy hover 闪烁修复——progress 文档流占位（宽度恒定）+ cancel absolute 覆盖 + opacity 切换。
// v2.3.1：动态 client 半部无浏览器 timer 全局（setInterval 不可用）——声明 inject:['timer']，
//    轮询改经 timerSvc.interval(callback, 500)，disposer 由 effect cleanup 调用；
//    timer 服务不可用时静默降级默认「优化中…」文案。
// v2.2（方案「提示词优化方案.md」§0.2/§2/§6）：
// ① 模式体系收敛 4 模式（base/lite/standard/smart）——记忆模式删除；
// ② 记忆功能改为所有模式可开/关的独立开关（config.memory，缺省 false）；
// ③ 配置迁移：mode='memory' → mode='lite' + memory=true；autoMemory → memory；
// ④ 实际模式由 resolveActualMode 判定（记忆开+有记忆→当前模式+记忆对；首次→lite 兜底 seed；
//    reload 有标记→当前模式原样），随请求传 host；dirty 标志删除；
// ⑤ 记忆写入条件（R1）：仅结果已应用且记忆开关开启时写入 + 打标；撤回清除记忆。
// v16：整合「模型与插件」单入口（三区 tab + 折叠区块）+ 斜杠命令守卫修复
// v17：思考开关/等级 + 连通性测试
// v18：① config 升级 v2（键 dsh.enhance.config.v2；v1 自动迁移写回并清理）：
//      main{provider,model,reasoning} / fallback[]（独立配置项，每条可设 reasoning）/
//      customModels[]（添加即连通性测试）/ order[]（仅展示顺序）/ params / template
//      ② 兜底链区块：增删改序 + 恢复默认 + 每行思考开关/等级（懒加载 efforts）
//      ③ 自定义模型区块：表单添加即测试；加载顺序区块：全量模型上移/下移
//      ④ fresh install：models/current 继承当前使用模型（含推理等级）初始化兜底链
// v19：fresh install / 恢复默认的链补足改经 host models/autochain（自适应解析）
// v20：内置兜底链（BUILTIN_CHAIN）硬编码指向 DeepSeek 官方模型（deepseek-official），
//      供「恢复默认」与 autochain 失败兜底使用；host 侧 autochain 亦返回 DeepSeek 官方链。
// v21：P1-3 修复 sessionStores 内存泄漏——组件卸载且状态空闲时 releaseStoreIfIdle 释放条目
// v22：① 移除「自定义模型」「加载顺序」模块（config 字段保留兼容）；
//      ② 兜底链并入主模型区块（子分区，不再独立折叠）；
//      ③ FallbackRow 按厂家区分：provider/model 双联动下拉；
//      ④ 每条兜底末尾加测试连通性小图标（行内结果）；
//      ⑤ 优化按钮不可选中（tabIndex=-1，无焦点环），仅点击触发。
// v23：① 主模型与兜底链整合为单一「模型配置」链——所有行同构，无主/兜之分；
//      ② 移除独立主模型表单区（厂家/模型/思考/等级/主测试按钮）；
//      ③ 测试结果块内固定单点集中显示（链列表下方、操作按钮上方），行结构测试前后不变；
//      ④ 单行元素宽度合理分配（厂家弹性 / 模型主体 / 思考等级固定 / 图标固定）；
//      ⑤ 老 v2 main 配置首次加载迁移为链首条（migrateMainIntoChain），此后忽略 main。
// v23.1：UI 视觉协调——厂家/模型下拉加宽（厂家 130–220px、模型保底 120px，箭头完全可见）；
//      行 gap 8→6px、思考开关 64px/等级 56px、图标按钮 22px 收紧，让位主下拉。
// v23.2：布局再分配——思考开关宽 2/3（43px）、厂家减 1/5（136px）、模型吃满整行剩余；
//      字体与字号恢复默认设置（移除 font-family:inherit 强制统一）。
// v2.0.0（v24）：V1/V2 引擎共存——config 新增 engine（v1 默认）/context{mode,budgetChars}；
//      优化参数栏新增「优化引擎」切换（V2 选中显示上下文理解/预算子配置）；
//      恢复默认只重置模型链，不动 engine/context。
// ============================================================================

// @dsh-client-constants-inject

// @dsh-client-state-inject

// @dsh-client-i18n-inject

// @dsh-client-helpers-inject// @dsh-client-comp-enhance-button-inject
// @dsh-client-comp-enhance-bar-inject
// @dsh-client-comp-updater-card-inject
// @dsh-client-comp-plugins-section-inject
// @dsh-client-comp-collapsible-section-inject
// @dsh-client-comp-model-main-section-inject
// @dsh-client-comp-fallback-row-inject
// @dsh-client-comp-model-config-tab-inject
// @dsh-client-comp-params-tab-inject
// @dsh-client-comp-model-plugins-section-inject
const CSS = [
  // v2.3.3（§7.10）：font-weight:500 对齐 DSH ModelSelect trigger 样式
  // v2.4.3-c（统一样式）：容器对齐模型 trigger——无边框、24px 胶囊、label-secondary 灰字、
  // hover 更深色椭圆背景 rgba(38,49,72,.06)（trigger 实测同值）、padding 0 8px 0 4px（左4右8，用户指定）；
  // busy/result 保留状态色（追加淡色背景表达）；emoji ✨ 与字重 600 保留（用户确认项）
  '.dsh-enh-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px 0 4px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px;cursor:pointer;transition:background-color .15s ease;white-space:nowrap}',
  '.dsh-enh-btn:hover:not(:disabled){background:rgba(38,49,72,.06)}',
  // v2.3.2（§7.2）：空输入不再降低按钮饱和度——disabled 仅保留点击无效提示，无 opacity 变暗
  '.dsh-enh-btn:disabled{cursor:not-allowed}',
  // v2.4.0（方案 §10.2）：三态文字显式字体锚点——13px/500/20px 与模型 trigger 对齐（实机实测），
  // idle/busy/result 均携带 dsh-enh-btn-text 类；子文本继承，不再依赖隐式继承链
  // v2.4.3（等线）：font-family 从 inherit 改为显式系统栈，并在 Microsoft YaHei 前插入 DengXian
  // （等线 = 微软官方屏显中文字体，笔画细、与 Segoe UI 视觉统一；中文不再回退到粗体雅黑）
  // v2.4.3-b（等线加粗）：font-weight 500→600——等线笔画细，600 下视觉更清晰（用户要求）
  // v2.4.3-c（统一样式）：文字锚点不再声明 padding（曾以 padding:0 覆盖容器 0 8px 0 4px，
  // 导致 hover 椭圆背景零留白贴文字）——padding 由容器统一承载（左4右8，用户指定）
  '.dsh-enh-btn-text{font-size:13px;font-weight:600;line-height:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","DengXian","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif}',
  // v2.3（§7.2）：idle 态 = emoji ✨ + 模式短标签（emoji 系统彩色，不承担状态色）
  // v2.3.2（§7.2）：记忆状态 → 图标饱和度——开=正常（无 dim）/ 关=低饱和（saturate(.2)，文字不受影响）
  '.dsh-enh-icon{font-size:14px;line-height:20px}',
  '.dsh-enh-icon-dim{filter:saturate(.2)}',
  // v2.4.0（方案 §10.2）：模式短标签不再独立声明字号——继承 .dsh-enh-btn-text 锚点（13px/500/20px）
  // v2.4.3-c（统一样式）：busy/result 去边框后以状态文字色 + 淡色背景表达（hover 时统一为深灰蓝椭圆反馈）
  '.dsh-enh-btn-busy{color:var(--dsw-alias-state-warn-primary);background:rgba(245,158,11,.06)}',
  '.dsh-enh-btn-result{color:var(--dsw-alias-state-success-primary);background:rgba(34,197,94,.06)}',
  // v2.3.3（§7.10）：busy hover 闪烁修复——progress 文档流占位（宽度恒定），
  // cancel absolute 覆盖其上，hover 只切 opacity（无尺寸抖动，hover 判定区不变）
  '.dsh-enh-btn-busy .dsh-enh-status{position:relative;display:inline-block;text-align:center}',
  '.dsh-enh-btn-busy .dsh-enh-progress{transition:opacity .12s ease}',
  '.dsh-enh-btn-busy .dsh-enh-cancel{position:absolute;inset:0;display:block;white-space:nowrap;opacity:0;color:var(--dsw-alias-state-error-primary);transition:opacity .12s ease}',
  '.dsh-enh-btn-busy:hover .dsh-enh-progress{opacity:0}',
  '.dsh-enh-btn-busy:hover .dsh-enh-cancel{opacity:1}',
  '.dsh-enh-spin{width:11px;height:11px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-warn-primary);display:inline-block;animation:dsh-enh-rotate .8s linear infinite}',
  '@keyframes dsh-enh-rotate{to{transform:rotate(360deg)}}',
  '@media (prefers-reduced-motion: reduce){.dsh-enh-spin{animation:none}}',
  '.dsh-enh-bar{display:flex;align-items:center;gap:10px;padding:5px 14px;font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary)}',
  '.dsh-enh-bar-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:2px 8px;cursor:pointer}',
  '.dsh-enh-bar-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
  '.dsh-enh-bar-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-plg-root{display:flex;flex-direction:column;gap:10px;padding:2px 0}',
  '.dsh-plg-note{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:0}',
  '.dsh-plg-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}',
  '.dsh-plg-toolbar{display:flex;justify-content:flex-end}',
  '.dsh-plg-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
  '.dsh-plg-head{display:flex;align-items:center;gap:8px;justify-content:space-between}',
  '.dsh-plg-name{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-plg-state{font-size:12px;line-height:16px;color:var(--dsw-alias-state-success-primary);flex:none}',
  '.dsh-plg-row{display:flex;align-items:center;gap:6px}',
  // v2.4.6（布局）：同行双字段——优化模式 + 模板合并一行；field 各占一半，
  // 窄屏自动换行（flex-wrap）；label 不再强制 96px 以免挤占 select 空间
  '.dsh-plg-row-duo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
  '.dsh-plg-field{display:flex;align-items:center;gap:6px;flex:1 1 200px;min-width:0}',
  '.dsh-plg-field .dsh-plg-label{min-width:0;flex:none}',
  '.dsh-plg-col{display:flex;flex-direction:column;gap:6px}',
  '.dsh-plg-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);flex:none;min-width:96px}',
  '.dsh-plg-muted{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  '.dsh-plg-select{flex:1;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:4px 6px}',
  '.dsh-plg-textarea{flex:1;min-width:0;min-height:180px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:6px 8px;resize:vertical;font-family:inherit}',
  '.dsh-plg-approval{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:16px;flex-wrap:wrap}',
  '.dsh-plg-actions{display:flex;gap:8px;justify-content:flex-end}',
  // v2.4.3：切换确认行——目标版本高亮便于核对
  '.dsh-plg-switch{flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-plg-switch-target{color:var(--dsw-alias-brand-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:3px 10px;cursor:pointer}',
  '.dsh-plg-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
  '.dsh-plg-btn:disabled{opacity:.45;cursor:not-allowed}',
  '.dsh-plg-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
  '.dsh-plg-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0}',
  '.dsh-plg-saved{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px}',
  // v2.7.0：保存状态机样式（转圈复用 dsh-enh-spin；saved/failed 状态色）
  '.dsh-plg-save{display:flex;align-items:center;gap:6px;font-size:12px;line-height:16px;margin-top:8px}',
  '.dsh-plg-save-ok{color:var(--dsw-alias-state-success-primary)}',
  '.dsh-plg-save-fail{color:var(--dsw-alias-state-error-primary)}',
  '.dsh-plg-logs{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-plg-logs-head{display:flex;align-items:center;gap:8px;justify-content:space-between}',
  '.dsh-plg-logs-pre{margin:0;max-height:220px;overflow:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-all}',
  // v16：页内 tab 条（对齐 Harness：14px、选中下划线）
  '.dsh-cfg-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1);padding:0 4px}',
  '.dsh-cfg-tab{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:20px;padding:8px 12px;cursor:pointer;border-radius:8px 8px 0 0;transition:background-color .15s ease-out,color .15s ease-out}',
  '.dsh-cfg-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
  '.dsh-cfg-tab-active{color:var(--dsw-alias-label-primary);font-weight:500;border-bottom-color:var(--dsw-alias-brand-primary)}',
  '.dsh-cfg-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
  // v16：可折叠区块（标题行 36px、hover 反馈、chevron 旋转）
  '.dsh-cfg-sec{border-radius:8px}',
  '.dsh-cfg-sec-head{display:flex;align-items:center;gap:8px;width:100%;background:transparent;border:none;border-radius:8px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px;font-weight:500;padding:8px 12px;cursor:pointer;text-align:left;transition:background-color .15s ease-out}',
  '.dsh-cfg-sec-head:hover{background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-cfg-sec-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-cfg-chev{font-size:11px;color:var(--dsw-alias-label-tertiary);transition:transform .2s cubic-bezier(.2,0,0,1);flex:none}',
  '.dsh-cfg-chev-open{transform:rotate(90deg)}',
  '.dsh-cfg-sec-title{flex:none}',
  '.dsh-cfg-sec-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;text-align:right}',
  '.dsh-cfg-sec-body{padding:4px 12px 8px;display:flex;flex-direction:column;gap:8px}',
  // v17：思考控件与测试结果（窄下拉 + 状态色强调）
  '.dsh-plg-select-narrow{flex:0 0 auto;min-width:96px}',
  '.dsh-plg-test-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-test-fail{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;font-weight:600}',
  // v18：输入框、图标按钮、继承提示
  '.dsh-plg-input{flex:1;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:4px 6px}',
  '.dsh-plg-btn-icononly{min-width:22px;padding:2px 3px}',
  '.dsh-plg-inherit{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px}',
  // v22（C5）：行内测试连通性小图标（与整体一致：无背景 + token 边框/圆角 + hover 反馈）
  '.dsh-plg-testicon{min-width:22px;padding:2px 3px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
  '.dsh-plg-testicon:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
  // v23.2：布局再分配——思考开关宽 2/3（43px）、厂家减 1/5（136px）、
  // 模型框 flex:1 1 0 吃满整行全部剩余空间；字体字号恢复默认（移除 font-family:inherit 强制统一）
  '.dsh-plg-num{width:18px;text-align:right;flex:none}',
  '.dsh-plg-select-provider{flex:0 1 136px;min-width:104px;max-width:176px}',
  '.dsh-plg-select-model{flex:1 1 0;min-width:120px}',
  '.dsh-plg-select-thinking{flex:0 0 auto;width:43px}',
  '.dsh-plg-select-level{flex:0 0 auto;width:56px}',
  // v23.1（D4）：测试结果集中单点区（链列表下方、操作按钮上方；空态隐藏）
  '.dsh-plg-testarea{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;background:var(--dsw-alias-bg-layer-1)}',
  // v2.4.0（方案 §4）：版本检测与更新卡片样式
  '.dsh-plg-upd-outdated{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:16px;font-weight:600}',
  // v2.7.0：更新未重启提醒横幅（警告黄底 + 命令 code）
  '.dsh-plg-restart-notice{display:flex;flex-direction:column;gap:4px;margin:8px 0;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:8px 10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-restart-cmd{font-family:Consolas,Menlo,monospace;font-size:12px;line-height:16px;color:var(--dsw-alias-state-warn-primary);word-break:break-all}',
  '.dsh-plg-upd-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-upd-body{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;max-height:64px;overflow:auto;white-space:pre-wrap;word-break:break-all}',
  '.dsh-plg-upd-done{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-upd-apply{display:flex;flex-direction:column;gap:2px}',
  // v2.5.0：环境检测结果区 + 一键更新危险态
  '.dsh-plg-env{display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-plg-env-list{display:flex;flex-direction:column;gap:3px}',
  '.dsh-plg-env-item{display:flex;align-items:baseline;gap:6px;font-size:12px;line-height:16px}',
  '.dsh-plg-env-mark{flex:none;width:14px;text-align:center}',
  '.dsh-plg-env-label{flex:none;color:var(--dsw-alias-label-primary);min-width:88px}',
  '.dsh-plg-env-detail{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
  '.dsh-plg-env-ok .dsh-plg-env-mark{color:var(--dsw-alias-state-success-primary)}',
  '.dsh-plg-env-warn .dsh-plg-env-mark{color:var(--dsw-alias-state-warn-primary)}',
  '.dsh-plg-env-fail .dsh-plg-env-mark{color:var(--dsw-alias-state-error-primary)}',
  '.dsh-plg-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
].join('\n');

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    styles.insert(CSS);
    timerSvc = ctx.get('timer') || null;
    const locale = ctx.get('locale');
    if (locale !== undefined && typeof locale.register === 'function') {
      // v2.4.1-fix2（2026-08-14）：update 场景页面残留旧实例的 locale 命名空间
      // （single occupant 硬约束抛 duplicate 导致 client-half-failed）——
      // 字典未变时沿用旧注册即可：吞掉冲突、正常路径保留 disposer（卸载不误删他人）。
      const safeRegister = (ns, lang, dict) => {
        try {
          return locale.register(ns, lang, dict);
        } catch (e) {
          return null;
        }
      };
      ctx.effect(() => safeRegister('enhance', 'zh', ZH));
      ctx.effect(() => safeRegister('enhance', 'en', EN));
    }
    dynFace = ctx.get('dynamicCordisRunner') || null;
    // v16：整合「插件管理」+「优化配置」为单一入口「模型与插件」（页内三区 tab）
    slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: 'model-plugins',
        order: 25,
        label: () => (locale && typeof locale.bind === 'function' ? locale.bind('enhance')('navModelPlugins') : ZH.navModelPlugins),
        locale: 'enhance',
      },
      ModelPluginsSection,
    ));
    // 注册幂等/唯一 id：本插件在 sidebar.footer.action 仅需占位（不渲染任何内容），
    // id 改用插件语义唯一值 cordis-panel-enh，回避与基座 dsh-client-ui-cordis 的
    // CordisPanel（id: 'cordis-panel'）冲突——同槽位同 id 触发 single-occupant duplicate，
    // 导致 update/重挂时 "Failed to load plugins"。历史 v2.4.1-fix2 同类问题即由此来。
    // （v2.4.5 曾无记录回退为 cordis-panel；v2.4.8 恢复本修复，见 CHANGELOG。）
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'cordis-panel-enh', order: 0 },
      CordisBadgePlaceholder,
    ));
    slots.inject('conversation.input.right', () => slots.register(
      { name: 'conversation.input.right', id: 'prompt-enhance', order: 10, label: '提示词优化', locale: 'enhance' },
      EnhanceButton,
    ));
    slots.inject('conversation.input.dock', () => slots.register(
      { name: 'conversation.input.dock', id: 'prompt-enhance-status', order: 30, label: '优化错误提示', locale: 'enhance' },
      EnhanceBar,
    ));
  },
};