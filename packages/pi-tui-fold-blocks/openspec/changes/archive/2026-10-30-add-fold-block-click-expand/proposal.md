## Why

`fold` 模式把工具块压成一行后，**全量输出就彻底看不见了**：`src/render.ts:renderOwnedBlock`
只读 `mode` / `isPartial` / `isError`，忽略 SDK 传来的 `expanded`，因此左键单击该块
（`tool-execution.ts:163-170` 的 MouseRegion 已在切 `expanded`）只会触发一次重渲染，
视觉上零变化。用户要么退回 `native` 模式（所有块一起变多行、还丢掉折叠行的统计），
要么完全看不到内容。SDK 的单击展开能力已经现成，只差渲染层响应它。

## What Changes

**fold 模式的块展开行为**
- From: `fold` 模式下所有块恒为一行，`expanded` 标志被忽略，单击/ctrl+o 无任何视觉反馈
- To: `fold` 模式下单击某个块 → 该块单独按 `native` 观感展开（原生标题 + 全量内容、
  保留三态背景）；再单击收起回单行；未点击的块保持单行
- Reason: 单击是 SDK 已内建的单块粒度交互，缺的只是渲染层响应；这样既保住折叠的密度，
  又让「想看原文」不必牺牲全局布局
- Impact: non-breaking。`native` / `hide` 模式行为不变；不新增设置项；不持久化展开状态

**兼容 API `renderOwnedBlock` 的展开支持**
- From: 外部扩展（`pi-tool-presistant-bash` 的 exec 块）经该 API 渲染时同样无法展开
- To: 该 API 响应 `expanded`，默认在头部下追加 `result.content` 原文，并提供可选回调供调用方自绘展开体
- Reason: 折叠渲染的一致性不能只覆盖内置四工具，否则 exec 块在 fold 模式下永远展不开
- Impact: non-breaking（新增可选参数，默认行为向后兼容）

## Capabilities

### New Capabilities

（无——本次不引入新能力，全部为既有能力的增量/改写）

### Modified Capabilities

- `tui-tool-block-collapse`: 新增「单块展开」需求；改写「折叠块单行左右对齐布局」
  （单行不变式补上 collapsed 前提）与「对外折叠渲染兼容 API」（增加展开支持）

## Impact

- `packages/pi-tui-fold-blocks/src/overrides.ts`：展开态委托原生渲染器、组装 self-shell 单盒
- `packages/pi-tui-fold-blocks/src/render.ts`：`renderOwnedBlock` 增加展开分支与新布局容器
- `packages/pi-tui-fold-blocks/src/index.ts`：库面导出（如新增展开体相关类型/助手）
- `packages/pi-tui-fold-blocks/test/*.test.ts`：新增展开态渲染用例
- `packages/pi-tui-fold-blocks/README.md`：记录单击展开行为与外部扩展的展开体回调
- 依赖 SDK 语义：`ToolRenderContext.expanded`、`renderResult(result, { expanded })`、
  MouseRegion 单击切换（pi 1.0.x 已具备）
