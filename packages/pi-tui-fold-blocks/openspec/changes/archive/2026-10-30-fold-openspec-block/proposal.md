## Why

pi-tui-fold-blocks 目前只折叠四个内置工具（read/write/edit/bash），而由 pi-openspec-bridge 注册的 `openspec` 工具仍以 pi 默认渲染器整块展示——标题、参数 JSON、全量输出占满屏幕，背景与折叠机制脱节。用户高频在终端跑 `openspec status --change X`，每次调用都刷一大块，阅读与滚动成本高。只需在折叠库里按工具名接管 `openspec` 的渲染，即可与其他块一致地折叠成单行并支持单击展开，代价小、收益直接。

## What Changes

新增：fold-blocks 通过 `pi.registerToolRenderer` 注册一个工具渲染 resolver，对 `openspec` 工具返回自选折叠渲染器，将其折叠为单行；非 `openspec` 工具委托链路继续。

**Tool rendering override（`openspec` 工具）**
- From: 只有内置工具走折叠；`openspec` 走 pi 默认整块渲染（无 renderShell/renderCall/renderResult）。
- To: `openspec` 在 fold 模式折叠为单行 `openspec - <subcommand> <args...> [--change X]`，右侧 `SUCCESS`/`FAILED[n]`；hide 模式空；native 模式与展开态委托 `next()` 原生渲染。
- Reason: 与现有四工具折叠行为一致，避免覆盖 openspec-bridge 的 execute 逻辑（只替换渲染器）。
- Impact: non-breaking；仅 TUI 渲染，不影响 LLM 上下文/工具执行。

**机制（新增能力）**
- 新增 `pi.registerToolRenderer` 用法：resolver 按 `toolName === "openspec"` 分发；返回 `{ renderShell: "self", renderCall, renderResult }`；非目标工具返回 `next()`。
- 折叠行内容只读 openspec 参数 `subcommand` / `args` / `change` 三个字段，不 import openspec-bridge，保持包间解耦。
- 复用现有 `renderOwnedBlock`/`bgFor` 折叠行组件并补充 openspec 行构造器；单击展开沿用 `next()` 形态。

**配置**
- 新增应遵循全局 fold/hide/native 模式与既有件配置，不单独出开关。

## Capabilities

### New Capabilities
- `openspec-tool-collapse`: 将 pi-openspec-bridge 注册的 `openspec` 工具渲染为可折叠单行（`openspec - <sub> <args> [--change X]` + 状态），遵循全局 fold/hide/native 模式，并支持单击展开委托原生渲染。

### Modified Capabilities
- `tui-tool-block-collapse`: 不修改既有 requirements；openspec 走新能力。此行留空即表示无 spec 级行为变化。

## Impact

- 代码：packages/pi-tui-fold-blocks（src/overrides.ts 或新增 src/openspec.ts）注册渲染 resolver；新增 openspec 行构造器；测试补充。
- API：依赖 SDK 1.4.0 `ExtensionAPI.registerToolRenderer`。
- 依赖：无新增外部依赖，不 import pi-openspec-bridge。
- 兼容：仅当 `openspec` 工具存在时生效；未安装 openspec-bridge 时 resolver 对任何工具返回 `next()`，无副作用。