'use strict';

// 客户端样式事实源（普通 CommonJS，构建期由共享运行时内联）。
// 迁移只改变代码载体：选择器、属性与值保持逐字不变。
const CSS = [
  // v2.3.3（§7.10）：font-weight:500 对齐 DSH ModelSelect trigger 样式
  // v2.4.3-c（统一样式）：容器对齐模型 trigger——无边框、24px 胶囊、label-secondary 灰字、
  // hover 更深色椭圆背景 rgba(38,49,72,.06)（trigger 实测同值）、padding 0 8px 0 4px（左4右8，用户指定）；
  // busy/result 保留状态色（追加淡色背景表达）；emoji ✨ 与字重 600 保留（用户确认项）
  '.dsh-enh-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px 0 4px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px;cursor:pointer;transition:background-color .15s ease;white-space:nowrap}',
  '.dsh-enh-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
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
  '.dsh-enh-btn-busy{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 6%,transparent)}',
  '.dsh-enh-btn-result{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 6%,transparent)}',
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
  '.dsh-enh-bar-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;padding:2px 8px;cursor:pointer}',
  '.dsh-enh-bar-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
  '.dsh-enh-bar-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-plg-root{display:flex;flex-direction:column;gap:12px;padding:2px 0;max-width:760px}',
  '.dsh-plg-root [role="tabpanel"] > * + *{margin-top:12px}',
  '.dsh-plg-root [role="tabpanel"] > .dsh-plg-hint{margin-top:4px}',
  '.dsh-plg-root [role="tabpanel"] > .dsh-plg-hint + .dsh-plg-hint{margin-top:4px}',
  '.dsh-plg-note{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:0}',
  '.dsh-plg-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}',
  '.dsh-plg-toolbar{display:flex;justify-content:flex-end}',
  '.dsh-plg-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:14px 16px;display:flex;flex-direction:column;gap:10px;transition:border-color .16s,background .16s}',
  '.dsh-plg-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
  '.dsh-plg-head{display:flex;align-items:center;gap:8px;justify-content:space-between}',
  '.dsh-plg-name{font-size:15px;line-height:21px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-plg-state{font-size:12px;line-height:16px;color:var(--dsw-alias-state-success-primary);flex:none}',
  '.dsh-plg-row{display:flex;align-items:center;gap:8px}',
  // v2.4.6（布局）：同行双字段——优化模式 + 模板合并一行；field 各占一半，
  // 窄屏自动换行（flex-wrap）；label 不再强制 96px 以免挤占 select 空间
  '.dsh-plg-row-duo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
  '.dsh-plg-field{display:flex;align-items:center;gap:8px;flex:1 1 200px;min-width:0}',
  // 2026-10-17（挤压根治）：field 里的 label 由 flex:none（内容宽、不可收缩）改为**可收缩**，
  //   并去掉 nowrap —— 否则 EN 下 Output character limit（137.8px）会把下拉压掉约 40px（实测 9 处）。
  //   ⚠ 正常文案下不收缩（内容宽小于可用宽），视觉无变化。
  // 2026-10-17（同上）：duo 行里的 label 同样是固定宽列（不再随文案变）。
  '.dsh-plg-field .dsh-plg-label{flex:none;width:120px;min-width:120px}',
  '.dsh-plg-col{display:flex;flex-direction:column;gap:4px}',
  // 2026-10-17：**堆叠容器里**的 label 不是固定列（它独占一行，如自定义模板编辑区的
  //   「自定义模板内容（当前模式：标准）」）⇒ 恢复自动宽 + 可换行，不套用列宽/省略号规则。
  '.dsh-plg-col > .dsh-plg-label{width:auto;min-width:0;white-space:normal;overflow:visible;text-overflow:clip}',
  // 2026-10-17（挤压根治 · 模式级）：label 是一列**固定宽的设计令牌**（120px），不再由文案内容定宽。
  //   病历：改前 flex:none + min-width:96 ⇒ 宽度 = 内容宽 ⇒ EN 下 Output character limit 撑到
  //   130.3px，把同行下拉从 608px 压到 560.17px（实测 63 处同类）。
  //   ⚠ 长文案由 nowrap + ellipsis 兜底（不折断列宽），文档长度上限见 EN 侧同批改短。
  '.dsh-plg-label{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary);flex:none;width:120px;min-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dsh-plg-muted{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  // 2026-10-17（设置文案审查批 · 挤压根治）：读数类文本 = **不参与挤压**的固定列。
  //   病历：静音行三件 <开关><滑块><读数> 都是 flex 兄弟，读数取 flex-basis:auto 内容宽
  //   ⇒ 关闭态读数（长句）把滑块从 591.64px 压到 301px（本批实测，报告 §3）。
  //   nowrap 是必要的：读数短（3 秒）且必须可读，折断它反而不如让它占位。
  // 2026-10-17（挤压根治 · 构造保证）：读数除了「不参与再分配」（flex:none），还要有**上限**——
  //   否则文本本身无界（理论上可以任意长）⇒ 仍能把同行控件挤到下限。max-width 40% + 省略号
  //   ⇒ 任取读数长度，控件宽度都不低于其 min-width（这就是「任取文案长度都不挤压」的构造证明）。
  '.dsh-plg-row > .dsh-plg-muted{flex:none;white-space:nowrap;max-width:40%;overflow:hidden;text-overflow:ellipsis}',
  // 2026-10-17：flex 行里的**文本兄弟**（note/status/hint）一律允许收缩到 0 并换行
  //   ⇒ 文案变长时被牺牲的是**自己**，而不是同行控件（控件宽度不得由兄弟文本决定）。
  '.dsh-plg-row > .dsh-plg-note,.dsh-plg-row > .dsh-plg-status,.dsh-plg-row > .dsh-plg-hint{flex:0 1 auto;min-width:0}',
  // 2026-10-17：flex 行里的**按钮**同理不得被挤压 —— 按钮按自身文字定宽，不参与再分配
  //   （实测：EN 下热键「清除」按钮从 92px 被压到 68.91px）。
  '.dsh-plg-row > .dsh-plg-btn{flex:none}',
  // v2.8.4（下拉箭头占位预算）：所有下拉框右侧预留 28px 箭头位；固定宽度窄下拉同步加宽，保持原内容宽度不变
  // 2026-10-17（挤压根治）：同上，flex:1 改为 flex:1 1 0。
  // 2026-10-17（挤压根治 · 下限）：min-width 由 0 改为 96px（下拉内容可省略号，宽度须可用）。
  '.dsh-plg-select{flex:1 1 0;min-width:96px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;padding:5px 28px 5px 12px}',
  'select.dsh-plg-select{-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2212%22%20height=%2212%22%20viewBox=%220%200%2012%2012%22%3E%3Ctext%20x=%220%22%20y=%2210%22%20font-size=%2211%22%20fill=%22%238a8a8a%22%3E%E2%96%BE%3C/text%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}',
  '.dsh-plg-select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}',
  // v2.8.4（下拉选项溢出动效）：闭合态与打开态悬停选项超长时均自动滚动
  // v3.1.7（用户反馈·双击选中内容）：下拉框与弹窗内容禁止文本选中——root user-select:none
  // 继承到 trigger 显示文字与弹窗选项（含 -webkit- 前缀兼容 WebView2/Chromium）
  '.dsh-plg-mselect{position:relative;display:inline-flex;align-items:center;cursor:pointer;box-sizing:border-box;user-select:none;-webkit-user-select:none}',
  '.dsh-plg-mselect:focus-within{border-color:var(--dsw-alias-brand-primary)}',
  '.dsh-plg-mselect[data-disabled="true"]{opacity:.6;cursor:default}',
  '.dsh-plg-mselect-trigger{display:flex;align-items:center;width:100%;min-width:0;min-height:20px;padding:0;border:0;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer;box-sizing:border-box}',
  '.dsh-plg-mselect[data-disabled="true"] .dsh-plg-mselect-trigger{cursor:default}',
  '.dsh-plg-mselect-visual{display:block;flex:1;min-width:0;overflow:hidden;pointer-events:none;line-height:20px}',
  '.dsh-plg-mselect-text{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-mselect-text-inner{display:inline-block;width:max-content;max-width:none;white-space:nowrap;vertical-align:top}',
  '.dsh-plg-mselect-text-marquee .dsh-plg-mselect-text-inner{animation:dsh-mselect-marquee 6s linear infinite}',
  '@keyframes dsh-mselect-marquee{0%,8%{transform:translateX(0)}46%{transform:translateX(calc(-1 * var(--dsh-mselect-distance)))}54%{transform:translateX(calc(-1 * var(--dsh-mselect-distance)))}92%,100%{transform:translateX(0)}}',
  // v3.1.7（用户反馈·下拉箭头点击不弹出·双保险）：pointer-events 从 none 改 auto + cursor:pointer——
  // 箭头自身可接收点击（事件冒泡到 trigger），不依赖 pointer-events:none 的穿透行为（无痕/新加载下更可靠）
  '.dsh-plg-mselect-arrow{position:absolute;right:12px;top:50%;width:12px;height:12px;transform:translateY(-50%);pointer-events:auto;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:12px;text-align:center}',
  '.dsh-plg-mselect-arrow::before{content:"▾"}',
  '.dsh-plg-mselect-list{position:absolute;top:calc(100% + 4px);left:0;z-index:100;min-width:100%;max-width:min(92vw,420px);max-height:240px;overflow-y:auto;margin:0;padding:4px;list-style:none;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12)}',
  '.dsh-plg-mselect-list li{display:block;min-height:24px;padding:3px 8px;border-radius:6px;font-size:13px;line-height:20px;overflow:hidden;cursor:pointer;box-sizing:border-box}',
  '.dsh-plg-mselect-list li[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-plg-mselect-list li[aria-disabled="true"]{opacity:.4;cursor:default}',
  '.dsh-plg-mselect-option-text{display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:top}',
  '.dsh-plg-mselect-option-text-inner{display:inline-block;width:max-content;max-width:none;white-space:nowrap;vertical-align:top}',
  '.dsh-plg-mselect-option-text-marquee .dsh-plg-mselect-option-text-inner{animation:dsh-mselect-marquee 6s linear infinite}',
  '.dsh-plg-textarea{flex:1;min-width:0;min-height:180px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;padding:8px 12px;resize:vertical;font-family:inherit}',
  '.dsh-plg-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}',
  '.dsh-plg-approval{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:16px;flex-wrap:wrap}',
  '.dsh-plg-actions{display:flex;gap:8px;justify-content:flex-end}',
  // v2.4.3：切换确认行——目标版本高亮便于核对
  '.dsh-plg-switch{flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-plg-switch-target{color:var(--dsw-alias-brand-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;padding:5px 14px;cursor:pointer}',
  '.dsh-plg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-plg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-label-dimmed)}',
  '.dsh-plg-btn:disabled{opacity:.4;cursor:default}',
  '.dsh-plg-btn-primary{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
  '.dsh-plg-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}',
  '.dsh-plg-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}',
  // 2026-08-18（用户需求）：项目地址跳转链接（版本检测与更新下方）
  '.dsh-plg-project-link{margin-top:4px;font-size:12px;line-height:18px}',
  '.dsh-plg-project-link a{color:var(--dsw-alias-brand-primary);text-decoration:underline;cursor:pointer;word-break:break-all}',
  '.dsh-plg-project-link a:hover{opacity:.85}',
  '.dsh-plg-saved{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px}',
  // 2026-08-18（用户需求）：开启思考的耗时提醒（模型配置栏底部，红色警示）
  '.dsh-plg-reasoning-warn{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:4px 0 0;font-weight:600}',
  // v2.7.0：保存状态机样式（转圈复用 dsh-enh-spin；saved/failed 状态色）
  '.dsh-plg-save{display:flex;align-items:center;gap:6px;font-size:12px;line-height:16px;margin-top:8px}',
  '.dsh-plg-save-ok{color:var(--dsw-alias-state-success-primary)}',
  '.dsh-plg-save-fail{color:var(--dsw-alias-state-error-primary)}',
  '.dsh-plg-logs{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-plg-logs-head{display:flex;align-items:center;gap:8px;justify-content:space-between}',
  '.dsh-plg-logs-pre{margin:0;max-height:220px;overflow:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-all}',
  // v16：页内 tab 条（对齐 Harness：14px、选中下划线）
  '.dsh-cfg-tabs{display:flex;align-items:flex-end;gap:22px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:0;margin-top:2px}',
  '.dsh-cfg-tab{position:relative;border:none;padding:7px 1px 9px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;cursor:pointer;transition:color .15s ease-out}',
  '.dsh-cfg-tab:hover{color:var(--dsw-alias-label-primary)}',
  '.dsh-cfg-tab-active{color:var(--dsw-alias-label-primary)}',
  '.dsh-cfg-tab-active::after,.dsh-cfg-tab:focus-visible::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary);content:""}',
  '.dsh-cfg-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:2px;color:var(--dsw-alias-label-primary)}',
  // v16：可折叠区块（标题行 36px、hover 反馈、chevron 旋转）
  // 2026-10-18（UI 回退修复批 · 用户点名层级）：「提示词增强」页内的两块（模型配置 / 语音识别）**必须是并列板块**，
  //   不是从属关系。病历：两块在 DOM 里**本就是兄弟**（同层、同字号同字重），但**没有任何视觉边界** ⇒
  //   语音识别紧贴在模型配置的正文之后，读起来像「模型配置」的子标题（用户原话「不是从属的级别」）。
  //   ⇒ 给每块一个**同款卡片边界**：两块各自成块、视觉等重 ⇒ 层级上并列。
  //   ⚠ 只加边界与等距，不改字号/字重（那是「两块同级」的语义本身，不能靠放大其中一块来区分）。
  '.dsh-cfg-sec{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:2px;background:var(--dsw-alias-bg-layer-3)}',
  '.dsh-cfg-sec-head{display:flex;align-items:center;gap:8px;width:100%;background:transparent;border:none;border-radius:8px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px;font-weight:500;padding:10px 12px;cursor:pointer;text-align:left;transition:background-color .15s ease-out}',
  '.dsh-cfg-sec-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  // 2026-10-18（同上）：卡片内边距 2px ⇒ 把 head/body 的圆角对齐卡片，避免 hover 背景溢出圆角。
  '.dsh-cfg-sec > .dsh-cfg-sec-head{border-radius:8px}',
  '.dsh-cfg-sec > .dsh-cfg-sec-body{border-radius:0 0 8px 8px}',
  '.dsh-cfg-sec-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsh-cfg-chev{font-size:11px;color:var(--dsw-alias-label-tertiary);transition:transform .2s cubic-bezier(.2,0,0,1);flex:none}',
  '.dsh-cfg-chev-open{transform:rotate(90deg)}',
  // 2026-10-17：标题由 flex:none 改为**可收缩**（min-width:0）—— 长标题下不得把 summary 挤成 0；
  //   正常文案下不收缩（内容宽 < 可用宽），视觉不变。
  '.dsh-cfg-sec-title{flex:0 1 auto;min-width:0}',
  '.dsh-cfg-sec-head > .dsh-cfg-sec-summary{flex:1 1 0;min-width:0}',
  '.dsh-cfg-sec-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;text-align:right}',
  '.dsh-cfg-sec-body{padding:2px 12px 10px;display:flex;flex-direction:column;gap:10px}',
  // v17：思考控件与测试结果（状态色强调）
  // ⚠ 2026-10-17（残项收口批）：原 `.dsh-plg-select-narrow` 定义已删 —— 唯一使用处（语音段第二行的
  //   静音时长下拉）已随布局调整批移除 ⇒ 该类**全仓零真实引用**（详见该批报告 §②）。
  '.dsh-plg-test-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-test-fail{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;font-weight:600}',
  // v18：输入框、图标按钮、继承提示
  // 2026-10-17（挤压根治）：flex:1（= flex-basis:auto）改为 flex:1 1 0 —— 输入框宽度 = 剩余空间，
  //   与同行 label 文本长度无关（实测：EN 下 label 变长曾把输入框从 273px 压到 131.39px）。
  // 2026-10-17（挤压根治 · 下限）：min-width 由 0 改为 120px —— 输入框有**与文案无关的下限**，
  //   文案再长也只压缩同行文本，不会把输入框压到不可用（配合 flex:1 1 0）。
  '.dsh-plg-input{flex:1 1 0;min-width:120px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;padding:5px 12px}',
  '.dsh-plg-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}',
  '.dsh-plg-btn-icononly{min-width:22px;padding:2px 4px;font-size:12px;line-height:16px}',
  '.dsh-plg-inherit{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px}',
  // v22（C5）：行内测试连通性小图标（与整体一致：无背景 + token 边框/圆角 + hover 反馈）
  '.dsh-plg-testicon{min-width:22px;padding:2px 4px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
  '.dsh-plg-testicon:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
  // v23.2：布局再分配——思考开关宽 2/3（43px）、厂家减 1/5（136px）、
  // 模型框 flex:1 1 0 吃满整行全部剩余空间；字体字号恢复默认（移除 font-family:inherit 强制统一）
  '.dsh-plg-num{width:18px;text-align:right;flex:none}',
  // 2026-10-18（模型行超限批）：厂家选择器让出 24px（104 ⇒ 80）：它取自 providers 表，无数字约束，
  //   且玩家名有 title 可看全（见 fallback-row 的 title 承载，本轮已核实仍在）。
  '.dsh-plg-select-provider{flex:0 1 136px;min-width:80px;max-width:176px}',
  // ⚠ 2026-10-18（模型行超限批 · 可辨识尾部）：模型名选择器 = 行内**唯一的弹性项** ⇒ 溢出时它先让出。
  //   但「让出」不等于「让到看不清」：真机 534px 实测模型名可用宽度 = 选择器宽 − padding 40px；
  //   95px 只够画 5 个字（实测 vis=78 / need=116，用户看到的正是「eek-v4-flash」这种缺头的残串）。
  //   ⇒ 下限抬到 135px（可用 95px 首尾都露）——它本身仍是弹性项，宽裕时照样吃掉全部剩余。
  '.dsh-plg-select-model{flex:1 1 0;min-width:135px}',
  // 2026-10-18（模型行超限批）：思考开关 96 ⇒ 56。实测该控件内容仅「开/关」13px，96px 全是空白；
  //   ⛔ 不从 padding/整卡缩——让出的是**这一项自己的多余宽度**（见报告 §⑤ 因果）。
  '.dsh-plg-select-thinking{flex:0 0 auto;width:56px;min-width:56px}'
  ,'.dsh-plg-mselect.dsh-plg-ms-fill{flex:1 1 auto;width:auto}'
  ,'.dsh-plg-mselect.dsh-plg-ms-content{flex:0 0 auto;width:auto}'
  ,'.dsh-plg-mselect.dsh-plg-ms-fill .dsh-plg-mselect-trigger{width:100%}',
  // 2026-10-18（模型行超限批）：思考等级 72 ⇒ 62（实测内容「低/Low」≈26px；仍留 36px 余量给 Medium/High）。
  '.dsh-plg-select-level{flex:0 0 auto;width:62px;min-width:62px}',
  // v23.1（D4）：测试结果集中单点区（链列表下方、操作按钮上方；空态隐藏）
  // v3.1.5（双模式参考）：纵向布局——头部行独占一行，实测/历史结果逐行显示，字号与标题对齐（12px）。
  // v3.1.8（布局）：✓ 可用/✗ 失败状态移入头部行（与「测试 #N」同行）；标题靠左、✕ 靠右。
  '.dsh-plg-testarea{display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-plg-testarea-head{display:flex;align-items:center;gap:8px}',
  '.dsh-plg-testarea-title{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-plg-testarea-head .dsh-plg-test-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;flex:none}',
  '.dsh-plg-testarea-head .dsh-plg-test-fail{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;flex:none}',
  '.dsh-plg-testarea-head .dsh-plg-btn-icononly{margin-left:auto;flex:none}',
  '.dsh-plg-testresults{display:flex;flex-direction:column;gap:2px}',
  '.dsh-plg-test-live{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
  '.dsh-plg-test-hist{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  // v2.4.0（方案 §4）：版本检测与更新卡片样式
  '.dsh-plg-upd-outdated{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:16px;font-weight:600}',
  // v2.7.0：更新未重启提醒横幅（警告黄底 + 命令 code）
  '.dsh-plg-restart-notice{display:flex;flex-direction:column;gap:4px;margin:8px 0;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:8px 10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-restart-cmd{font-family:Consolas,Menlo,monospace;font-size:12px;line-height:16px;color:var(--dsw-alias-state-warn-primary);word-break:break-all}',
  '.dsh-plg-upd-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:16px;font-weight:600}',
  '.dsh-plg-upd-body{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;max-height:64px;overflow:auto;white-space:pre-wrap;word-break:break-all}',
  '.dsh-plg-upd-done{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-upd-apply{display:flex;flex-direction:column;gap:2px}',
  // v2.5.0：环境检测结果区 + 一键更新危险态
  '.dsh-plg-env{display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-plg-env-list{display:flex;flex-direction:column;gap:3px}',
  '.dsh-plg-env-item{display:flex;align-items:baseline;gap:6px;font-size:12px;line-height:16px}',
  '.dsh-plg-env-mark{flex:none;width:14px;text-align:center}',
  '.dsh-plg-env-label{flex:none;color:var(--dsw-alias-label-primary);min-width:88px}',
  '.dsh-plg-env-detail{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
  '.dsh-plg-env-ok .dsh-plg-env-mark{color:var(--dsw-alias-state-success-primary)}',
  '.dsh-plg-env-warn .dsh-plg-env-mark{color:var(--dsw-alias-state-warn-primary)}',
  '.dsh-plg-env-fail .dsh-plg-env-mark{color:var(--dsw-alias-state-error-primary)}',
  '.dsh-plg-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
  '.dsh-plg-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
  '.dsh-plg-title{font-size:18px;line-height:26px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-intro{font-size:13px;line-height:20px;margin:0;color:var(--dsw-alias-label-tertiary)}',
  // v3.2.1：无服务化引导弹窗样式（遮罩 + 卡片 + 标题/正文/按钮行）
  '.dsh-plg-modal-mask{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}',
  '.dsh-plg-modal{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:18px 20px;max-width:440px;width:90%;box-shadow:0 12px 40px rgba(0,0,0,.25)}',
  '.dsh-plg-modal-title{font-size:15px;line-height:21px;font-weight:600;margin:0 0 10px;color:var(--dsw-alias-label-primary)}',
  '.dsh-plg-modal-body{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);margin:0 0 14px}',
  '.dsh-plg-modal-actions{display:flex;gap:10px;justify-content:flex-end}',
  // v3.2.5（语音识别模块）：voice UI（dsh-vi-* 前缀）
  // 2026-08-20（用户需求）：🎤 按钮样式对齐优化按钮（dsh-enh-btn）——28px 无边框胶囊、label-secondary、600 字重；
  // 状态色保留（recording/error 红色 + 淡背景，对齐 enh busy/result 风格）
  '.dsh-vi-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px 0 4px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px;cursor:pointer;transition:background-color .15s ease;white-space:nowrap;user-select:none}'
  ,'.dsh-vi-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}'
  ,'.dsh-vi-btn.dsh-vi-rec{color:#e5484d;background:color-mix(in srgb,#e5484d 6%,transparent)}'
  ,'.dsh-vi-btn.dsh-vi-busy{opacity:.7;cursor:default}'
  ,'.dsh-vi-btn.dsh-vi-err{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent)}'
  // 2026-08-20（用户需求）：🎤 与 ✨ 按钮间距最小（紧邻时 -8px 收近，留 4px 视觉间隔）
  ,'.dsh-enh-btn + .dsh-vi-btn{}'
  ,'.dsh-vi-label{font-weight:500}'
  ,'.dsh-vi-err-msg{font-size:12px;margin-left:4px}'
  ,'.dsh-vi-section{display:flex;flex-direction:column;gap:6px}'
  ,'.dsh-vi-cloud{display:flex;flex-direction:column;gap:8px}'
  ,'.dsh-vi-wave{display:inline-flex;align-items:flex-end;gap:1.5px;height:14px}'
  ,'.dsh-vi-wave-bar{width:2px;background:currentColor;border-radius:1px;opacity:.8;transform-origin:50% 100%}'
  ,'.dsh-vi-wave-bar:nth-child(1){height:5px}'
  ,'.dsh-vi-wave-bar:nth-child(2){height:9px}'
  ,'.dsh-vi-wave-bar:nth-child(3){height:12px}'
  ,'.dsh-vi-wave-bar:nth-child(4){height:7px}'
  ,'.dsh-vi-wave-bar:nth-child(5){height:11px}'
  ,'.dsh-vi-wave-bar:nth-child(6){height:6px}'
  ,'.dsh-vi-btn.dsh-vi-rec .dsh-vi-wave-bar{animation:dsh-vi-wave 1s ease-in-out infinite}'
  ,'.dsh-vi-btn.dsh-vi-rec .dsh-vi-wave-bar:nth-child(1){animation-delay:0s}'
  ,'.dsh-vi-btn.dsh-vi-rec .dsh-vi-wave-bar:nth-child(2){animation-delay:.1s}'
  ,'.dsh-vi-btn.dsh-vi-rec .dsh-vi-wave-bar:nth-child(3){animation-delay:.2s}'
  ,'.dsh-vi-btn.dsh-vi-rec .dsh-vi-wave-bar:nth-child(4){animation-delay:.3s}'
  ,'.dsh-vi-btn.dsh-vi-rec .dsh-vi-wave-bar:nth-child(5){animation-delay:.4s}'
  ,'.dsh-vi-btn.dsh-vi-rec .dsh-vi-wave-bar:nth-child(6){animation-delay:.5s}'
  ,'@keyframes dsh-vi-wave{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1.2)}}'
  ,'.dsh-vi-spin{width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;display:inline-block;animation:dsh-vi-spin .8s linear infinite}'
  ,'@keyframes dsh-vi-spin{to{transform:rotate(360deg)}}'
  ,'@media (prefers-reduced-motion: reduce){.dsh-vi-btn.dsh-vi-rec .dsh-vi-wave-bar,.dsh-vi-spin{animation:none}}'
  ,'.dsh-vi-privacy{color:rgba(128,128,128,.8);font-size:11px;margin:0}',
  // P2-补做（2026-10-13 · PROJECT §7.4）：静音时长滑块**自绘**（项目与官方 primitives 均无现成滑块）——
  // 用原生 input[type=range] + 自绘样式（轨道/握手），颜色走主题 token 以随主题；
  // 两浏览器前缀均写（WebKit / Firefox 各一套）。
  // 2026-10-18（UI 回退修复批）：flex:1 1 0 ⇒ flex:1 1 auto。
  //   病历（本批实测）：flex-basis 0 只有在本行**还有可分配剩余空间**时才等价于「吃满剩余」；
  //   而本行的三个兄弟是 开关(flex:0 0 auto) + 滑块 + 读数(flex:none) ⇒ 一旦外层给本行的宽度
  //   不足以让「开关 + 读数 + 滑块 min-width」都住下，basis 0 的滑块就只剩下 min-width(96px) 那一小段，
  //   右端读数与滑块之间出现大段空白（实测 640px 容器：滑块 482.23px，行宽 616px）。
  //   ⇒ basis 改 auto：滑块以自身内容宽为起点参与「吃满剩余」，不再依赖父级先给出富余空间。
  //   ⚠ 关/开两态等宽的成果不得回退：读数在 0 档为空、1–5 档为「N 秒」，两态下它的宽度差
  //     由 flex:0 0 auto + 空串（宽 0）吸收 —— 实测两态滑块宽度一致（读数见报告 §⑤B）。
  // 2026-10-18（UI 回退修复批 · 两态等宽）：静音行的读数为**预留槽**——0 档留空（宽 0）与 1–5 档「N 秒」
  //   会让滑块在这两态相差一个读数的宽度（本批实测 HEAD 上是 610 vs 588.64 = 21.36px 差，
  //   ⚠ 即『两态等宽』在上一批**从未真正达成**）。给读数一个**em 计的下限槽**，两态占位相同 ⇒ 滑块等宽。
  //   ⚠ 这不是给开关加固定像素：约束的是**读数槽**，且用 em 而非 px（随字号缩放）；
  //     文案本身仍是「0 档无文本」，没有把长句塞回行内。
  '.dsh-vi-silence-row > .dsh-plg-muted{flex:none;min-width:2.4em;text-align:right}',
  '.dsh-vi-slider{flex:1 1 auto;min-width:96px;height:20px;margin:0;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer}',
  '.dsh-vi-slider::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2)}',
  '.dsh-vi-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:var(--dsw-alias-label-primary);border:none}',
  '.dsh-vi-slider::-moz-range-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2)}',
  '.dsh-vi-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);border:none}',
  '.dsh-vi-slider:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}',
  '.dsh-plg-tgl{text-align:center}',
  '.dsh-plg-tgl-on{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
  '.dsh-enh-btn{margin-right:-12px}',
  '.dsh-vi-btn{margin-right:-12px}',
  '.dsh-vi-wave{transform:translateY(-1px)}'
].join('\n');


module.exports = { CSS };
