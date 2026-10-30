## Context

pi-tui-fold-blocks（packages/pi-tui-fold-blocks，ESM，SDK peer `@earendil-works/pi-coding-agent@1.4.0`）当前通过 `registerOverrides()` → `overrideTool(pi, name, cwd, createXxxToolDefinition, cfgGetter)` 折叠四个内置工具 read/write/edit/bash。`overrideTool` 会用工厂重建定义并 `pi.registerTool({ …, renderShell:"self", renderCall, renderResult })` 替换渲染器，保留 execute。渲染核心 `renderOwnedBlock(opts, ctx, lineBuilder)` 产出折叠单行 + `bgFor()` 背景 + 单击展开（展开委托原生渲染器）。

`openspec` 工具由独立的 pi-openspec-bridge 扩展注册（`name:"openspec"`、`label:"OpenSpec"`），未设渲染器 → 走 pi 默认整块渲染（标题 + args + 输出）。fold-blocks 没有 openspec 的 execute 闭包，无法用 `overrideTool` 的"重建定义"路线，否则会覆盖 openspec-bridge 的执行逻辑。

SDK 1.4.0 的 `ExtensionAPI` 提供 `registerToolRenderer(resolver)`：
`ToolRendererResolver = (toolName, next:()=>ToolRenderers|undefined) => ToolRenderers|undefined`，
`ToolRenderers = Pick<ToolDefinition,"renderShell"|"renderCall"|"renderResult">`，resolver 按扩展加载序运行。这是为"覆盖已注册工具的仅渲染器"而设计，可拿 `next()` 到底层渲染器用于 native/展开委托。

用户已确认：折叠单行 `openspec - <subcommand> <args...> [--change X]` + 右侧状态；支持单击展开（委托原生）。

## Goals / Non-Goals

**Goals:**
- `openspec` 工具在 fold 模式折叠为单行，内容仅含 `subcommand`、`args`、`--change`，右侧 `SUCCESS`/`FAILED[n]`。
- 遵循全局 fold/hide/native 模式；hide 空渲染，native 与展开态委托 `next()` 原生渲染。
- 只通过 `registerToolRenderer` 覆盖渲染器，不动 openspec 的 execute。
- 单包改动（fold-blocks），不 import pi-openspec-bridge，保持解耦。
- 无头可测：四工具/覆盖/背景断言扩展覆盖 openspec 行。

**Non-Goals:**
- 非折叠 openspec 输出处理或 LLM 上下文格式（execute 返回内容不变）。
- 为 openspec 新建独立开关/配置项（沿用全局 mode；builder 可加提示性 padding 配置但不承诺）。
- 泛化折叠任意自定义工具（机制可复用，但本 change 只接 openspec）。
- 不修改 tui-tool-block-collapse 既有 requirements。

## Decisions

### D1：机制 — 用 `pi.registerToolRenderer` 覆盖渲染器
- **选择**：新增 `registerOpenspecRenderer(pi, cfgGetter)`，在 `registerOverrides` 里随其他工具一起注册一个 resolver：
  ```
  pi.registerToolRenderer((toolName, next) =>
    toolName === "openspec" ? openspecRenderers(next, cfgGetter) : next()
  );
  ```
  其中 `openspecRenderers` 返回 `{ renderShell:"self", renderCall, renderResult }`。
- **理由**：SDK 原生按工具名只换渲染器；不需要 openspec 的 execute/定义；解析 `next()` 可得底层默认渲染器，恰好支持 native 与展开委托；fold-blocks 单包完成，不依赖 openspec-bridge 的注册产物与时机。
- **已考虑 alternative**：
  - 重建定义 `pi.registerTool({ name:"openspec", … })`（同 overrideTool）→ 无 openspec execute 闭包，覆盖其执行逻辑，❌。
  - openspec-bridge 经 fold-blocks compat 自挂（presistant-bash 范式）→ 动两包、加依赖、功能劈两半，❌。

### D2：折叠单行内容
- **选择**：左侧 `openspec - <shown>`，`shown` = `[subcommand, ...args, change ? "--change " + change : ""].filter(Boolean).join(" ")`；右侧由 result 字符串解析状态：`formatRunForModel` 输出含 `[exit code N]` → `FAILED(N)`，否则 `SUCCESS`（可复用 `contentExitCode`/`contentText`）。图标沿用折叠行图标。
- **理由**：与 read/bash 折叠行同构（"工具名 - 内容"），用户选定；`change` 是 status/instructions 的 `--change <name>` 参数名，稳定。
- **已考虑 alternative**：省略 "openspec -" 前缀 / 空格分隔 → 用户选带前缀求一致性，❌。

### D3：模式与展开路由
- **选择**：renderCall/renderResult 运行时读 `cfgGetter()` 与 `ctx.expanded`：
  - `native` → 返回 `next()` 的原生渲染器结果（不动）。
  - `fold && expanded` → 用 `next()` 渲染原生 call+result，聚合成单盒（沿用 `renderExpandedFold` 思路 + Box 解壳 `unwrapBoxChildren`）。
  - `fold && !expanded` → `renderOwnedBlock` 产折叠单行（新 openspec lineBuilder）。
  - `hide` → 空。
- **理由**：与现有四工具模式路由一致；`next()` 提供唯一可信的原生渲染来源，保证展开/原生观感不漂移。
- **已考虑 alternative**：展开时手工拼装原生组件 → 与 `next()` 能拿到的原生渲染不一致、易回归，❌。

### D4：不 import openspec-bridge，零包间耦合
- **选择**：只读 openspec 参数对象上的 `subcommand`/`args`/`change` 字段名（openspec-bridge 文档化的稳定字段），不 `import "@philogag/pi-openspec-bridge"`。
- **理由**：fold-blocks 不新增依赖；resolver 仅在 `toolName==="openspec"` 且该工具存在时返回渲染器，未装 openspec-bridge 时对一切返回 `next()`，无副作用。
- **已考虑 alternative**：从 openspec-bridge 引入行构造 → 引入依赖与环形风险，❌。

## Risks / Trade-offs

- [Risk] openspec 参数**字段名**（subcommand/args/change）若未来改名则行内容失效 → Mitigation: resolver 对参数做防御性读取（缺失则该字段跳过），测试覆盖缺失字段。
- [Risk] `next()` 返回 undefined（默认渲染器路径差异）→ Mitigation: 展开/native 分支处理 `next()` undefined，folding 分支正常。
- [Risk] SDK 版本 <1.4.0 无 `registerToolRenderer` → Mitigation: 仅运行时在 TUI/工具存在的场景使用；本仓库 SDK 锁 1.4.0。
- [Trade-off] 复用 overrideTool 渲染核心，但 openspec 走独立 resolver 路径 → 接受：各取所长，机制不同但最终都进 `renderOwnedBlock`。
- [Trade-off] 不单独出开关 → 接受：全局 mode 已足够，减少配置面。

## Migration Plan

N/A — 纯渲染扩展升级，无 endpoint/DB/CLI 变更。发布 fold-blocks 新版本后，已安装 openspec-bridge 的环境自动获得折叠；未安装不受影响。回滚 = 降级 fold-blocks（或移除 resolver）。

## Open Questions

- 折叠行的 tips/padding 是否要进配置（镜像 bashBlocks 的 `openspecBlocks` 组）？倾向不加，待 apply 时按现状决定。
- 右侧状态的文案/背景是否要与 bash 的 `SUCCESS`/`FAILED` 完全一致？默认复用。