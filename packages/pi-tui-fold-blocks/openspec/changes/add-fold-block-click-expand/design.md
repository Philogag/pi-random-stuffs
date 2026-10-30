## Context

`@philogag/pi-tui-fold-blocks` 用 `renderShell: "self"` 覆盖 read / write / edit / bash
四工具的渲染壳层，在 `fold` 模式下把每个工具块压成**恰好一行**（`src/render.ts:renderOwnedBlock`
→ `buildBlockComponent` → 自绘 `BgPaddedBox` + `BgTruncatedText`）。

pi 1.0.x 的 `ToolExecutionComponent` 已经内建了**单块**展开交互：

- `src/modes/interactive/components/tool-execution.ts:163-170` 把每个槽的渲染结果包进
  `MouseRegion`，左键单击 → `setExpanded(!expanded)` → `updateDisplay()` 重跑渲染器；
- `getRenderContext()`（同文件 124-142）把 `expanded`、`durationMs`、`outputPad` 放进渲染上下文；
- `interactive-mode.ts:4740-4746` 的 `app.tools.expand`（默认 ctrl+o）对所有已渲染块
  调 `setExpanded(...)`（全局）。

本包的渲染层**只读** `mode` / `isPartial` / `isError`，忽略 `expanded`，所以点击只会换来
一次无变化的重渲染。本次变更只做一件事：让 fold 模式响应 `expanded`。

既有不变式：不改变 session 内容、不改变 LLM 上下文、不改变工具执行（`execute` 原样委托）。

## Goals / Non-Goals

**Goals:**

- fold 模式下单击任意工具块 → **该块**按 `native` 观感展开（原生标题 + 全量内容，保留三态背景）；再次单击收起
- 未点击的块继续保持单行——展开是**单块**粒度，不是全局模式切换
- `renderOwnedBlock`（外部扩展走同一渲染核心）同样响应 `expanded`
- 全部改动集中在渲染层；无新增设置项、无状态持久化

**Non-Goals:**

- 不新增配置项（不提供"可展开"开关），不加折叠态展开提示（hint）
- 不持久化展开状态（沿用 SDK 内存态，会话重载即收起）
- 不改变 `native` 模式行为（该模式本来就由 SDK 自己处理单击展开）
- 不为 `hide` 模式提供展开兜底（hide 的语义就是不渲染）
- 不改动 `openSettings` 设置页、`config.ts` 配置结构与既有折叠单行布局

## Decisions

### D1：展开态整体委托原生渲染器（不含折叠摘要行）

- **选择**：`config.mode === "fold" && ctx.expanded` 时，`overrides.ts` 直接调用
  `original.renderCall(args, theme, ctx)` 与 `original.renderResult(result, { expanded: true, isPartial }, theme, ctx)`；
  折叠摘要行不再出现。
- **理由**：用户选定「纯原生展开体」——展开态就是"我要看原文"的意图，此时行号（read）、
  语法高亮、截断提示（`[Truncated: ...]`）、bash 的全量输出都由核心渲染器免费提供，
  与 `native` 模式 1:1 观感，维护成本为零。
- **已考虑 alternative**：
  - *摘要行 + 原生体*：要拼接两套布局（自绘单行 + 原生多行），且展开态里统计信息与
    原生头部的信息重复/冲突；
  - *摘要行 + `result.content` 原文*：观感最朴素，丢掉行号与着色，用户已否决。

### D2：self-shell 单盒组装——头与体由**同一个槽**产出

- **选择**：
  - result 槽（`!ctx.isPartial`，即已有最终结果）：返回
    `Container[ origRenderCall(...), origRenderResult(..., expanded: true) ]` 装进一个自绘盒子；
  - call 槽（`ctx.isPartial`，尚无结果）：只返回 `Container[ origRenderCall(...) ]` 装进同一个盒子。
  即沿用折叠路径既有的 **`isPartial` 槽归属规则**（`render.ts:renderOwnedBlock` 已有注释说明）。
- **理由**：原生默认壳层是 `Box(1,1,bgFn)` 把 call 头与 result 体装进**同一个**盒子；
  self-shell 下两个槽各自返回组件、由 SDK 顺序堆叠，若两槽都出可见行会得到
  **两个盒子**（中间多一条背景留白带，且展开/收起时高度抖动）。单槽产出头+体才能复现"一个盒子"。
- **已考虑 alternative**：
  - *两槽各出自绘盒子*：见上，观感与高度都有问题；
  - *用 `context.state` 跨槽拼装*：call 槽先于 result 槽执行，单帧内无法得知 result 槽是否存在，
    需要额外一轮 `invalidate()` → 会闪烁。

### D3：展开态的背景与留白仍自绘（不用 pi-tui 的 `Box`）

- **选择**：复用 `render.ts` 的 `BgPaddedBox`（`paddingX = ctx.outputPad ?? 1`、`paddingY = 1`），
  不再使用 `BgTruncatedText`（展开态不做单行截断，交给原生渲染器自己换行）。
- **理由**：self-shell 模式没有 SDK 的 `Box`；而 `Box.applyBg` 只在整行最外层包一次 bg，
  行内原生文本自带 `\x1b[0m` 会把 bg 清掉。`BgPaddedBox.reBg` 按 `\x1b[0m` 分片
  逐片重套 bg，这个解法已在折叠态验证过（`render.ts` 文件中 `BgPaddedBox` 注释有完整推导）。
- **已考虑 alternative**：*用 `pi-tui` 的 `Box` 包一层*——会把折叠态已修掉掉色 bug 重新引回来。

### D4：`renderOwnedBlock` 的展开支持（外部扩展）

- **选择**：
  - `RenderBlockOpts` 新增可选字段 `expandedBody?: (ctx, opts) => Component | undefined`；
  - `ctx.expanded === true` 时：保留**折叠摘要行作为头部**，下方追加展开体——
    调用方给了 `expandedBody` 就用它，否则用新增导出 `contentText(opts.result)`
    的原文按行渲染（`theme.fg("toolOutput", line)`）；
  - 新增导出 `contentText(result: unknown): string`（与既有 `contentLineCount` /
    `contentExitCode` 同风格：从 `AgentToolResult.content` 拼接文本）。
- **理由**：外部扩展（`pi-tool-presistant-bash` 的 exec 块）没有核心渲染器可委托，
  必须有一条自己的展开路径；保留摘要头是因为它们的 `LineContext` 只描述一行，
  丢掉头会失去工具名与统计。**这里与 D1 的差异是有意的**：内置四工具有权威的原生渲染可委托，
  外部工具没有，只能"摘要头 + 原文体"。
- **已考虑 alternative**：
  - *只支持内置四工具*：exec 块在 fold 模式下永远展不开，破坏折叠观感的一致性；
  - *要求外部扩展自己实现展开*：各自重新实现 bg/盒子/reBg 逻辑，重复劳动且易再次踩掉色坑。

### D5：无新增配置、无持久化、不改其它模式

- **选择**：展开能力在 fold 模式下常开；`hide` 模式忽略 `expanded`（继续不渲染）；
  `native` 模式代码路径不变；`settings.json` 结构不变（`config.ts` 的 `sanitize` 不动）。
- **理由**：这是"让既有交互生效"而非"新增可选功能"，加开关只会让行为矩阵翻倍。
  展开状态是 SDK 的内存态，持久化会让会话恢复后出现与用户预期不符的多行块。
- **已考虑 alternative**：*加 `expandable: boolean`*——用户未要求，且 fold 的唯一"关"选项
  已经是 `mode: hide` / `native`。

### D6：测试策略——组件级纯渲染断言

- **选择**：对 `buildBlockComponent` 之外的展开组件与 `renderOwnedBlock` 做纯组件单测：
  构造假 `ToolRenderContext`（含 `expanded`）→ 调渲染函数 → `component.render(width)`
  取行数组断言（行数、首行内容、bg 转义存在）。`overrides.ts` 的委托用 spy 断言
  `origRenderCall/renderResult` 被以 `expanded: true` 调用。
- **理由**：无需真实 TUI 即可覆盖模式矩阵与槽归属，符合包子既有测试风格
  （`test/render.test.ts`、`test/index.test.ts` 都是这类断言）。

## Risks / Trade-offs

- [Risk] 展开态高度可变，可能顶动当前滚动位置 → Mitigation: 仅在用户主动单击时发生，
  SDK 已在 `setExpanded` 内 `updateDisplay()`；本次不做自动展开。
- [Risk] 原生渲染器会复用并原地 mutate `ctx.lastComponent`，折叠态与展开态若共享同一槽的
  `lastComponent`，切换时可能拿到被另一布局写过的 `Text` → Mitigation: 展开态委托时
  不传 `lastComponent`（构造干净的 `Text`），避免跨布局复用实例。
- [Risk] `expanded` 是 SDK 的单一标志：ctrl+o（`app.tools.expand`）会同时展开**所有**块，
  超出"仅单击"的设计意图 → Mitigation: 无法区分（同一字段），在 spec 中显式声明为
  已知副作用而非缺陷；单击仍是唯一"单块"粒度交互。
- [Risk] 单击在结果就绪前不生效（`createResultRegion` 要求 `this.result` 存在）
  → Mitigation: 属 SDK 行为，本次不改；文档说明"结果出来后单击展开"。
- [Risk] `outputPad` 配置为 0 时展开态左右留白为 0 → Mitigation: 与原生 `Box(paddingX=outputPad)`
  行为一致，属预期。
- [Trade-off] 展开态没有折叠摘要行的统计信息 → 接受：用户选择原生观感优先；统计在收起态仍在。
- [Trade-off] 内置工具与外部扩展的展开体形态不同（原生体 vs 摘要头+原文） → 接受：
  由 D4 的"有无权威原生渲染"决定，spec 中分别写清。

## Migration Plan

N/A — 纯渲染层行为增量，非 breaking：

- `native` / `hide` 模式与折叠态输出不变；新增可选参数（`expandedBody`）默认不启用；
- 发布为 minor（changeset: patch/minor 由 `pnpm changeset` 决定）；
- 回滚：`git revert` 本次 commit 即恢复"忽略 `expanded`"的旧行为，无数据迁移、无配置清理。

## Open Questions

- （Closed）展开态是否显示 hint：用户已定为**不显示**，见 brainstorm.md Q3。
- （Open，非阻塞）`presistant-bash` 的 exec 块是否需要把展开体换成自绘（如保留 exec 前缀配色）：
  先用默认原文体观察，如不满意再由该包提供 `expandedBody`。
