# add-tui-openspec-select

## Why

`pi-tui-openspec-status` 扩展的状态栏锁定 spec 完全依赖 bash tool_call 解析：只有 LLM 执行 `openspec status --change <name>` 等命令时，扩展才会提取并锁定 change 名。用户无法直接控制状态栏跟踪哪个 spec——当 LLM 尚未执行任何 openspec 命令、或用户想固定跟踪某个与当前 bash 操作无关的 change 时，状态栏要么为空、要么随 bash 命令跳变。现在增加手动指令能力，让用户能亲自指定状态栏跟踪的 spec，补全"自动解析"之外的"人工控制"路径。

## What Changes

**新增 `/tui-openspec-select` TUI 斜杠命令（扩展新增能力）**

- From: 状态栏锁定 spec 只能由 bash 中 openspec 命令自动触发，用户无手动入口。
- To: 用户输入 `/tui-openspec-select` 打开交互选择器，列出 `openspec/changes/*/` 下所有活动 change（排除 `archive/`）加一个 `None` 选项；选择某 change 即手动锁定，选择 `None` 清空并恢复自动监听，取消则无操作。
- Reason: 手动指令补充自动解析的盲区，选择器形式让"选哪个 spec"显式可见。
- Impact: non-breaking；新增命令入口，不改动既有 bash 自动锁定路径。

**手动锁定优先级（手动覆盖自动）**

- From: bash 中出现 openspec 命令即切换锁定 spec。
- To: 手动锁定生效期间（`manualLock = true`），bash 自动锁定不再改变 change 名；worktree 检测仍生效（继续更新 `effectiveCwd`，保持主仓+worktree 合并渲染）；手动重选或选 `None` 后恢复自动行为。
- Reason: 手动选择的语义是"我要稳定跟踪这个 spec，别被其它命令带走"。
- Impact: non-breaking；仅当用户主动手动选择后行为才变化。

**归档自动解锁保持**

- From: 所有 source 的 `openspec/changes/<name>/` 消失即解锁。
- To: 手动锁定的 change 被归档后同样自动清空，并重置 `manualLock`。
- Reason: 与现有解锁语义一致，change 已不存在则无跟踪意义。
- Impact: non-breaking。

## Capabilities

### New Capabilities

无独立新能力——命令属于既有 `pi-tui-openspec-status` 扩展的同一能力域。

### Modified Capabilities

- `tui-openspec-status`: 新增"手动选择 spec 命令"需求（`/tui-openspec-select` 交互选择器 + 手动覆盖自动的锁定语义），并扩展既有"锁定 spec 解析"需求的锁定来源（自动 + 手动两路）。

## Impact

- 代码: `packages/pi-tui-openspec-status/src/index.ts`（注册命令、`manualLock` 标志、清空/锁定逻辑）、新增 `packages/pi-tui-openspec-status/src/discover.ts`（列出活动 change）、新增 `packages/pi-tui-openspec-status/src/select.test.ts`（mock `ctx.ui.select` 集成测试）。
- API: 依赖 pi 扩展 API `pi.registerCommand` 与 `ctx.ui.select`（已有，无新依赖）。
- 文档: `packages/pi-tui-openspec-status/README.md` 增加命令用法说明。
