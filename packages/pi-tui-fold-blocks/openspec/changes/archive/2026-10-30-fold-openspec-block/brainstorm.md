# Brainstorm — 让 pi-tui-fold-blocks 兼容 pi-openspec-bridge（折叠 openspec 工具）

本文件是对 brainstorming 会话产出的原样捕获：背景 → 探索发现 → 决策链。

## 背景 / 目标

用户目标（m00594）：**pi-tui-fold-blocks 对 pi-openspec-bridge 进行兼容，使其折叠为单行，仅保留 `subcommand args change` 显示。**

即：当 `openspec` 工具（由 pi-openspec-bridge 注册）在终端渲染时，不再展开成一整块（标题 + args JSON + 全量输出），而是像 read/write/edit/bash 一样折叠成一行——只显示子命令、位置参数与 `--change`，右侧带执行状态。

pi-tui-fold-blocks 现状：基于 `overrideTool()` 折叠 4 个内置工具（read/write/edit/bash），默认导出工厂经 `markFoldBlocksActive()` 门控激活；`renderOwnedBlock()` 原子折叠行组件 + 背景 `bgFor()`；`compat.ts` 提供激活订阅/配置订阅库面供外部扩展接入。0.2.0 新增单块单击展开（`expandedBody`/`renderNativeExpanded`），并修复了展开/折叠背景一致。

## 探索发现（look before you ask）

- **openspec 工具形态**（packages/pi-openspec-bridge/src/tool.ts）：`name: "openspec"`、`label: "OpenSpec"`；参数由 `buildOpenspecParameters()` 生成：首参 `subcommand`（枚举，含 `status`/`validate`/"new change"/"change show"…）、`args`（位置参数数组，如 `["add-dark-mode"]`）、`change`（`--change <name>` 布尔/字符串 flag，供 status/instructions）、`root`、`json` 及大量 flag。该工具未设 `renderShell/renderCall/renderResult` → 走 pi 默认渲染器（整块标题+输出）。
- **pi 扩展引擎机制**（SDK 1.4.0 `ExtensionAPI`）：存在 `pi.registerToolRenderer(resolver: ToolRendererResolver)`，其中
  `ToolRendererResolver = (toolName, next:()=>ToolRenderers|undefined) => ToolRenderers|undefined`，
  `ToolRenderers = Pick<ToolDefinition,"renderShell"|"renderCall"|"renderResult">`。
  → 可按工具名覆盖**仅渲染器**，完全不动 `execute`。这正为"折叠另一扩展注册的工具"而生。
- **既有跨扩展集成范式**：pi-tool-presistant-bash 用 fold-blocks 的 compat（`renderOwnedBlock`/`subscribeFoldBlocksActive`/`getFoldConfig`）自挂折叠（重注册自身 exec 工具、renderShell:"self"）。但那是"工具拥有方"接入；对本需求，fold-blocks 才是修补方。
- **展开态委托原生**：设计的 `renderNativeExpanded`/`renderExpandedFold` 已能通过 `next()` 拿到底层原生渲染器做单块展开。

## 决策链

- **Q1 折叠单行显示什么？**
  用户选定：`openspec - <subcommand> <args...> [--change X]`，右侧 `SUCCESS` / `FAILED[n]`。
  与现有 read/bash 折叠行同构（"工具名 - 内容"）。示例：
  `★ openspec - status --change add-x           SUCCESS`
  `★ openspec - new change add-dark-mode         SUCCESS`
  `★ openspec - validate --specs                 FAILED(1)`
  （备选曾考虑：省略 "openspec -" 前缀 / 用空格分隔，用户选择保留前缀，求一致性。）
- **Q2 是否支持单击展开？**
  用户选定：**支持**。展开时经 `next()` 委托原生 openspec 渲染器显示完整输出，与现有四工具一致；原生失败时回退折叠摘要。
- **Q3 构建方案（how it gets made）？**
  用户选定：**方案 A — `pi.registerToolRenderer`**（见 trade-off 对比）。fold-blocks 注册一个按 `toolName==="openspec"` 返回自选渲染器的 resolver；非 openspec 返回 `next()` 让链路继续。不依赖 openspec-bridge 的注册产物，单包改动，零耦合。

## 备选方案 trade-off（针对 Q3）

| 方案 | 做法 | 取舍 | 结论 |
|---|---|---|---|
| A. registerToolRenderer | 覆盖仅渲染器 | 不动 execute；SDK 原生支持；解耦；展开可委托 next() | ✅ 采用 |
| B. 重新 registerTool | fold-blocks 重建 openspec 定义 | 无 openspec 的 execute 闭包，重注册会覆盖其执行逻辑 | ❌ 不可行 |
| C. openspec-bridge 经 compat 自挂 | openspec-bridge 用 fold-blocks 渲染核心自挂（镜像 presistant-bash） | 动两个包、加依赖，功能劈两半；违背"fold-blocks 兼容"本意 | ❌ 弃用 |

## 其他约束 / 待定

- 遵循全局 fold/hide/native 模式：fold → 折叠行；hide → 空；native → 交给 `next()`/底层原样渲染（用户选 A 时展开=原生）。
- openspec 的行内容只读 `args.subcommand` / `args.args` / `args.change` 三个稳定字段名（openspec-bridge 文档化参数），不 import openspec-bridge，避免包间依赖。
- 仅当 `openspec` 工具存在时 resolver 生效；swelse `next()` 无副作用。