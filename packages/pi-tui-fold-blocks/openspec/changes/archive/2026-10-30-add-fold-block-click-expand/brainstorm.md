# Brainstorm — fold-blocks 单块可展开（单击）

原始捕获：决策日志（背景 → 代码现状 → 决策链 Q1–Q4 → 取舍 → 由我拍板的调用）。

## 背景

`@philogag/pi-tui-fold-blocks` 目前在 `fold` 模式下把 read / write / edit / bash
四类工具块压成**恰好一行**。用户诉求一句话：

> pi-tui-fold-blocks 单机可展开

即：折叠块应当能**按块**展开看全量输出，而不是只能靠切换全局模式（`native`）——
后者会让**所有**块一起变回多行，且丢掉折叠行的统计信息。

## 代码现状（读源得到的既有事实）

pi SDK（`@earendil-works/pi-coding-agent` 1.0.0）：

- `src/modes/interactive/components/tool-execution.ts:163-170`
  `createResultRegion(component)` 把 `renderCall` / `renderResult` 的返回值包进
  `MouseRegion`，**左键单击** 即 `this.setExpanded(!this.expanded)`，粒度是
  **单个 tool call**（需 `this.result` 已存在才响应）。
- `tool-execution.ts:124-142` `getRenderContext()` 把 `expanded`、`durationMs`、
  `outputPad` 交给渲染器；`renderResult(result, { expanded, isPartial }, theme, ctx)`
  的 `options.expanded` 与 `ctx.expanded` 同源。
- `interactive-mode.ts:4740-4746` `/ctrl+o`（keybinding `app.tools.expand`）走
  `setToolsExpanded`，对所有已渲染组件 `setExpanded(...)`（全局）。
- 原生展开观感：`renderers/bash.ts` 中 `options.expanded` 为真时输出全量
  styled output；为假时给 `VisualLinePreview`（尾 5 行）+ `keyHint` 提示。
  原生默认 shell 是 `Box(1,1,bgFn)`，把 call 头 + result 体装进**同一个** Box。

本包现状：

- `src/overrides.ts` 用 `renderShell: "self"` 覆盖四工具，`execute` 原样委托。
- `src/render.ts:renderOwnedBlock` 只读 `mode` / `isPartial` / `isError`，
  **完全忽略 `expanded`** → 单击或 ctrl+o 只会触发一次重渲染，视觉上零变化。
  这就是「不可展开」的根因。
- 折叠态的背景/留白由自绘 `BgPaddedBox` + `BgTruncatedText` 提供（按 `\x1b[0m`
  分片重新套 bg，解决 HStack 段间 reset 掉色）。
- `src/compat.ts` 给外部扩展（`pi-tool-presistant-bash`）暴露
  `renderOwnedBlock` 等库面，`exec` 块的折叠渲染走同一条路径。

## 决策链

### Q1 展开用什么交互？

- A. **单击该块**（SDK 已有 MouseRegion，天然单块粒度）✅ 选中
- B. ctrl+o 全局切换（`app.tools.expand`）
- C. 新命令/新快捷键自绘交互

用户只选了 **A（单击该块）**。B 不做单独设计——但它无法被排除：`expanded` 是
SDK 的单一标志，ctrl+o 与单击写的是同一个字段，渲染层一旦响应 `expanded`，
ctrl+o 就自动生效。这条作为**已知副作用**记录，不作为本次的驱动需求。

### Q2 展开后渲染什么？

- A. 摘要行 + 原生渲染体（保留 `exec npm test [42 lines] SUCCESS` 头）
- B. **纯原生展开体**（丢弃摘要行，整块交给内置渲染器）✅ 选中
- C. 摘要行 + `result.content` 原文（无行号 / 无语法着色，一致性最好）

用户选 **B**：展开态完全等于 `native` 观感。理由（对齐用户选择的取舍）：
展开态是「我要看原文」的意图，此时原生渲染器的行号、语法着色、截断提示都比
自绘摘要更有价值；也就避免了把两种布局拼在一块的额外对齐工作。

### Q3 折叠（收起）态要不要提示「可展开」？

- A. **不显示提示** ✅ 选中
- B. 极简标记（dim 的 `›` / `[+]`）
- C. `keyHint("app.tools.expand")` 全按键提示

用户选 **A**：单行密度是这包的核心价值，任何提示都会挤压路径与统计。

### Q4 落在哪个 openspec 工作目录？

仓库里有 5 个包各自带 `openspec/`。选 **`packages/pi-tui-fold-blocks`**（本包，
schema 已是 `superpowers-bridge-cn`，与既有 3 个归档变更同处一地）。

## 取舍与风险

- **「恰好一行」这条既有需求必须改写**：折叠态的旧不变式在展开态不成立。
  不是删需求，而是补上前提（collapsed 时恰好一行；expanded 时按原生多行）。
- **self-shell 没有 SDK 的 Box**：原生默认 shell 是一个 Box 同时装 call 头和
  result 体；self-shell 下两个槽各自返回组件、由 SDK 顺序堆叠。要在展开态复现
  「一个盒子」观感，必须让**一个槽**同时产出头与体（详见 design）。
- **槽归属**：折叠路径已有 `isPartial` 归属规则（call 槽 `isPartial` 时拥有行）。
  展开路径沿用同一规则，避免展开瞬间出现两条头。
- **外部扩展一致性**：`renderOwnedBlock` 也必须响应 `expanded`，否则
  `presistant-bash` 的 exec 块在 fold 模式下永远展不开。
- **不做的事**：不新增设置项（展开能力常开）；不持久化展开状态（SDK 内存态，
  会话重载即收起，符合「只改渲染」）；不给 `hide` 模式的展开兜底（hide 就是
  不渲染）。

## 由我拍板的调用（用户未表态，可推翻）

1. `native` 模式维持现状（本来就由 SDK 自己处理单击展开，无需改动）。
2. `hide` 模式下 `expanded` 被忽略：块依旧不渲染。
3. 不新增 `settings.json` 配置项；展开能力不提供开关。
4. 外部扩展的展开体默认用 `result.content` 原文（它们没有核心渲染器可用），
   并提供可选回调让调用方自绘（design 中给出签名）。
