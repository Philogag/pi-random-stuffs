## Context

`pi-tui-fold-blocks`(v0.1.1)把内置 read/write/edit/bash 工具块折叠成单行;`pi-tool-presistant-bash`
(v0.1.0)提供持久 bash 会话的 5 个工具。两扩展可同装,但 `presistant-bash-exec` 的输出块不受
fold-blocks 控制——它在 TUI 里走 pi 对"无渲染器的自定义工具"的默认渲染:工具名标题 + 结果内容
前 10 行预览 + "(N more lines) 展开"提示,与本地 bash 折叠行体验割裂。

SDK(pi-coding-agent 0.84.3)约束(运行时源码已验证):
- 同名工具跨扩展"先注册者胜";`getAllTools()` 不暴露别的扩展的 `execute`/渲染器;
  渲染回退 `def.renderCall ?? builtIn.renderCall` 只认内置工具表 → **fold-blocks 无法跨扩展
  只覆盖渲染**,折叠渲染必须挂在工具归属方(presistant-bash)注册的定义上。
- 渲染钩子随注册静态存在,config 是运行时值 → 折叠/原生/隐藏的切换只能在渲染回调内分派。
- 渲染回调签名:`renderCall(args, theme, ctx)`、`renderResult({content,details}, {expanded,isPartial}, theme, ctx)`;
  ctx 含 `args/toolCallId/invalidate/state/isPartial/isError/expanded` 等;`renderShell:"self"`
  让工具自绘(可自定义背景,折叠所需)。
- pi 默认渲染(无 renderCall/Result 的自定义工具):call 槽 = `Text(fg("toolTitle", bold(name)))`;
  result 槽 = 内容文本前 10 行(`fg("toolOutput")`)+ 溢出提示(fg muted + expand keycap);
  整块外包 pending/error/success 三态 Box。
- 内置 bash 失败(exit≠0)**throw** → `ctx.isError=true`;而 presistant-bash-exec 不 throw,
  exit code 放在 `result.details`(ExecResult{output,exitCode,cancelled})与文本尾部
  `\n[exit code: N]`(cancelled → `\n(command cancelled)`)。→ exec 折叠行的成败判定不能靠
  `ctx.isError`,必须解析 details。

brainstorm 决策(用户确认):可选依赖架构(presistant-bash ↔ fold-blocks 库面);
只折叠 exec 一个工具;行内容与 bash 折叠块完全同形(icon+`exec`+foldCommand 命令、
tips、三态背景、SUCCESS/FAILED[(N)]);与本地 bash 行同标签"exec"(接受同形不可辨)。

## Goals / Non-Goals

**Goals:**
- 安装并启用 fold-blocks 时,`presistant-bash-exec` 的 TUI 块按 fold-blocks 全局
  mode 渲染:fold → 与内置 bash 折叠行**同形同构**的单行块;hide → 整块隐藏;
  native → 呈现 pi 默认渲染观感(工具名 + 输出预览)。
- exec 行的成败态(黄/红/绿、FAILED(exitCode))来自 ExecResult details,准确反映
  非零退出码与 cancelled,而不依赖永远为 false 的 ctx.isError。
- fold-blocks 未安装/未作为扩展激活时,presistant-bash 渲染与行为零变化(静默回退)。
- 折叠/隐藏模式切换对已渲染的 exec 行**即时生效**(与 fold-blocks 自家工具一致)。
- 两包仍可各自独立安装使用;执行语义、会话语义、LLM 上下文、非 TUI 模式零变化。
- 行为契约以 OpenSpec delta spec 固化,测试覆盖文本构建/解析/装配纯函数。

**Non-Goals:**
- 不折叠 presistant-bash 的 create/create-container/list/destroy(输出 1–2 行)。
- 不给 exec 折叠行加 session 标识/区分图标(用户确认与 bash 同形)。
- 不改 presistant-bash 的执行/会话/超时语义;不做 streaming partial 输出。
- 不在 fold-blocks 中硬编码 presistant-bash 工具名/类型(解耦)。
- 不做第 4 个共享包、不动 fold-blocks 对内置 4 工具的行为。

## Decisions

### D1：归属方挂载——presistant-bash 可选依赖 fold-blocks 库面
- **选择**:fold-blocks 增加命名导出(默认导出不变)提供「折叠渲染复用件 + 激活/配置
  实时访问」;presistant-bash 注册 exec 工具时探测 fold-blocks 包并**仅在 fold-blocks
  作为扩展激活后**用折叠渲染器重新 `registerTool` 同一工具(`execute` 闭包不变)。
- **理由**:SDK 机制决定了必须由归属方挂渲染(见 Context);重新注册是同进程内
  fold-blocks 已用的模式(extension.tools.set + refreshTools),可覆盖原定义。
- **已考虑 alternative**:(a) 抽共享渲染包——多一个发布单元、迁移 fold-blocks 现有
  render/config/folders,爆炸半径大;(b) fold-blocks 侧同名覆盖——被"execute 闭包在
  对方包 + 先注册者胜"双重否决;(c) presistant-bash 复制渲染实现——无法像素级复用
  BgPaddedBox/HStack 布局与背景复位技巧,违背"完全同形"。

### D2：激活门控——fold-blocks 未激活不折叠
- **选择**:fold-blocks 模块级 `active` 状态:默认导出工厂首行置 active=true 并唤醒
  等待者;presistant-bash 订阅 `subscribeFoldBlocksActive`——已激活立即装配,否则等
  回调(两扩展任意加载顺序都正确)。渲染器读取 `getFoldConfig()` 实时分派三态。
- **理由**:optionalDependencies 意味着 `npm i presistant-bash` 会连带装进 fold-blocks
  包,但 pi 未必把它注册为扩展;若仅凭"包可 import"就折叠,会出现"exec 折叠而本地
  bash 不折叠"的错乱。激活门控让折叠语义严格跟随"fold-blocks 扩展真实生效"。
- **已考虑 alternative**:渲染时按 `loadConfig()` 磁盘值直接折叠——检测不到激活状态,
  错乱场景依旧;探测后立即判定(不等激活回调)——presistant-bash 先于 fold-blocks
  加载时误判。模块单例:同进程内两处 import 解析到同一文件 URL(Node ESM 缓存),
  激活可见。若 pi 加载器对不同来源产生双实例(风险 R5),fallback 用磁盘
  `loadConfig` 兜底分派。

### D3：fold-blocks 导出面(库面 API)
- **选择** `src/compat.ts`(index.ts 命名再导出;默认导出不变):
  - 激活:`isFoldBlocksActive()` / `subscribeFoldBlocksActive(cb): unsubscribe`
    (已激活 → 立即同步 cb 并返回 no-op);
  - 配置:`getFoldConfig()`(模块级当前配置,未激活时为 DEFAULT_CONFIG)/
    `subscribeFoldConfig(cb)`(每次配置保存/应用后通知)——index.ts 的 config 变更点
    (设置页保存回调、命令循环、setMode 路径)统一经 `publishConfig()` 更新模块单例并通知;
  - 渲染件:把 render.ts 的 `renderBlock` 泛化为
    `renderOwnedBlock(ctx, opts, lineBuilder)`(hide→空行、isPartial 单帧归属、空 Text
    退让、`buildBlockComponent`+三态 bgFor 全保留;现有 4 工具的 switch 收窄为对
    `renderOwnedBlock` 的委托,行为不变);
  - 类型/工具再导出:`FoldBlocksConfig`、`ToolRenderContext`、`LineContext`、
    `contentLineCount`、`foldCommand`(+FoldOptions)、`buildBlockComponent`、`renderOwnedBlock`。
- **理由**:presistant-bash 用同一批底层组件构造 exec 行,才能与 bash 行像素级同形;
  fold-blocks 不感知 ExecResult/工具名,职责边界干净。
- **已考虑 alternative**:fold-blocks 直接导出"presistant-bash-exec 专用渲染器"——
  反向耦合 presistant-bash 类型与名称;渲染代码双份——同形目标必然破功。

### D4：presistant-bash 侧装配(新 `src/fold-compat.ts` + index.ts 接线)
- **选择**:
  - `createTools` 逻辑不变;新增 `attachExecFoldCompat(pi, registry)`:
    动态 `import("@philogag/pi-tui-fold-blocks")` 失败(catch)→ 静默返回(现状);
    成功 → `subscribeFoldBlocksActive`;激活回调里找出 `presistant-bash-exec` 定义,
    以 `buildExecFoldRenderers()`(模块内,依赖 compat 渲染件)产出
    `{renderShell:"self", renderCall, renderResult}`,再 `pi.registerTool({...execDef, ...})`;
  - `renderCall`(fold/hide/native 分派):fold → `renderOwnedBlock`(call 阶段,args.command);
    hide → 空;native → 默认观感(工具名标题行);
  - `renderResult`:fold → 由 **details**(ExecResult)构建行——
    `icon \uf489(nerdFont 开)/无` + tool `exec` + foldCommand(args.command,{smart})
    + tips `[ ${timeoutS?}, ${N lines?}, exit ${M}? ]` + SUCCESS/FAILED[(M)];
    行数按 `details.output`(不含尾部 doneText 标记);`timeoutMs` 毫秒换算秒显示
    (整数去掉 .0);失败判定:`exitCode!==0 || cancelled || exitCode===undefined`
    → errorBg + FAILED(exitCode 定义时),0 → successBg + SUCCESS;hide → 空;
    native → 默认观感(输出前 10 行预览,`expanded` 时全量,行色 toolOutput,
    溢出提示 muted 文本,非像素级——已知偏差,见 R4);
  - 即时切换:presistant-bash 维护 `Map<toolCallId, invalidate>`(render 回调内登记,
    与 fold-blocks mode.ts 同款),`subscribeFoldConfig` 通知时逐个 invalidate →
    各 exec 行以最新 mode 重渲染;运行中的行本就随 partial 更新重读配置。
- **理由**:装配点单一、可注入(factory 的 options 注入 loader/挂载函数便于单测);
  details 解析让 FAILED/红态不依赖 isError。
- **已考虑 alternative**:fold 分支复用 fold-blocks `buildBashBlockText`——timeout 单位
  (s vs ms)与内容解析契约不同,复用反而引入隐式假设;native 模式直接返回空行——
  用户要求 native = "和没装折叠时一样",空行会吞掉输出。

### D5：行文本与 bash 同形但不共享实现
- **选择**:fold-blocks 内抽 `buildBashBlockText` 保持现状;exec 行文本在 presistant-bash
  侧用 compat 底层件构建,规则逐条对齐 bash:foldCommand({smart})、tips 段序
  `[ timeout, lines, exit ]`、空行不显示 [ 0 lines ]、非失败不显示 exit、result 段
  SUCCESS/FAILED[(N)]、左/中/右 HStack 布局与 grow/shrink 策略由 `buildBlockComponent`
  保证(窄终端只截 left)。
- **理由**:视觉契约(icon/tool/布局/着色)必须同源,数据契约(timeout/exit 来源)各异,
  各自表达最清晰。
- **已考虑 alternative**:让 bash 也改用 details/统一 builder——改动既有已验证行为,
  超出本 change。

### D6：依赖与加载形态
- **选择**:presistant-bash `package.json` 增 `optionalDependencies`:
  `@philogag/pi-tui-fold-blocks: workspace:*`(monorepo 内)并保证 dev/CI 环境可见
  (pnpm workspace 自动 link);发布时以 `optionalDependencies` 携带(消费者装 presistant-bash
  时若无 fold-blocks 也不报错,运行时 import 失败即回退)。fold-blocks 不加任何反向依赖。
- **理由**:可选依赖语义与"探测失败静默回退"目标一致;workspace link 让两包测试互见。
- **已考虑 alternative**:peerDependencies——npm 8+ 会硬装 peer 且版本冲突时警告/报错,
  违背"可不装 fold-blocks 单独用 presistant-bash"。

## Risks / Trade-offs

- [Risk] **双实例风险**:pi 若以不同于包名解析的方式(如打包/去 cache 的 URL)加载
  fold-blocks,presistant-bash 的 `import()` 得到第二个模块实例 → 激活/配置单例不可见。
  → Mitigation:装配与渲染对配置读取做成可退化——`getFoldConfig()` 为空态时回退
  `loadConfig()`(磁盘,与 fold-blocks 同 key 同文件);verify 阶段在 .pi/settings 同装两
  包做 dogfood(plan `[~]` 项)实证单实例假设。
- [Risk] **native 观感非像素级**:pi 默认渲染的 expand keycap(keyHint 内部组件)无法
  复刻。→ Mitigation:预览/展开行为对齐(前 10 行、expanded 全量),提示文案用 muted
  静态文本;document 为已知偏差;用户可在 spec 评审期提出更高保真需求。
- [Risk] **加载窗口**:装配为异步探测;在 fold-blocks 激活回调送达前若有 exec 渲染,
  仍是默认渲染。→ Mitigation:两扩展工厂在会话启动早期串行执行,exec 首次渲染几乎
  必在装配后;窗口内短暂默认观感可接受,不做轮询。
- [Risk] **注册覆盖副作用**:`registerTool` 二次注册同工具会刷新工具注册表。
  → Mitigation:execute 闭包原样保留;fold-blocks 自身已用同机制;装配仅在激活回调
  发生一次(订阅一次性)。
- [Trade-off] **exec 行与 bash 行同形(用户确认)**:无法从标签区分本地/会话命令。
  → 接受理由:字面"完全对齐",两行出现在不同上下文位置;如需区分属后续增量。
- [Trade-off] **隐藏模式吞掉 exec 输出**:hide 时整行消失(与 bash 一致)。
  → 接受理由:fold-blocks hide 语义即"不显示工具块",LLM 上下文不受影响。

## Migration Plan

N/A — 纯增量:无部署/存储迁移。兼容矩阵(发布文档 + 两包 README 增补):
- fold-blocks 单独装(无 presistant-bash):行为不变(新增导出面无副作用)。
- presistant-bash 单独装(无 fold-blocks):行为不变(import 失败 → 回退)。
- 同装且 fold-blocks 激活:exec 块按 mode 折叠/隐藏/原生;折叠开关即时生效。
- 同装但 fold-blocks 未激活:exec 保持默认渲染(激活门控)。
回滚:任一方降级/卸载即回到各自基线行为,无需数据迁移。
验收:本 change 全部单测 + typecheck 通过;dogfood 冒烟(两包同装,三态切换观察
exec 折叠行黄/红/绿与 FAILED(N),模式切换即时更新)。

## Open Questions

(无阻塞项。实现期若 pi 加载器行为与假设冲突,回 D6/R5 的退化路径核实。)
