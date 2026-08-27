# brainstorm — tui-fold-blocks (superpowers:brainstorming 原始捕获)

> 本文是 brainstorming 的原始产出（decision log 格式），原样捕捉探索过程，不强加模板。
> design.md 是独立重组产物，从本文萃取为结构化文档，两者互补不重叠。

---

## 背景（Why）

在 pi 的 TUI 中，工具调用块（tool block）总是以完整的彩色外壳渲染（绿/红 "Tool execution box"）。
唯一的控制是 `ctrl+o`（`app.tools.expand`）切换输出**详略度**——它对短输出不可见，
且永远不能折叠/隐藏**整块**。用户希望：

- 拦截 TUI 绘制行为，重绘工具调用块——**只改界面，不改 session 内容**（LLM 上下文、存储的原样保留）。
- 全局三种工作模式：**原生 / 折叠 / 隐藏**，默认**折叠**。
  - \u200b隐藏 = 不渲染任何 tool block；折叠 = 工具调用块折叠到一行。
- 可配置（配置存 `settings.json` 的 `<包名>` 块），并**注册命令进入 TUI 配置**（用 pi 内置组件）。
- 两类核心折叠函数：①**路径折叠器** ②**Bash 命令折叠器**。
- **背景色**：运行中-黄、成功-绿、失败-红；**文件操作块背景始终是成功(绿)**；bash 块运行时背景与状态关联。
- nerd font 图标开关（默认开）；文件工具与 bash 各自的折叠行为管理。

---

## 项目上下文探索

- 本仓库是刚初始化的空 Node.js monorepo（pnpm workspaces + TypeScript），`packages/*` 结构，尚未有 package。
  本插件将作为新 package `@philogag/pi-tui-fold-blocks` 落地。
- OpenSpec 工作流已就绪（schema: superpowers-bridge-cn），走 brainstorm → proposal → design → specs → tasks → plan → verify → retrospective。
- 可用的 pi 扩展 SDK：`@earendil-works/pi-coding-agent@0.84.3`（ExtensionAPI/ExtensionContext/事件/`create*ToolDefinition` 工厂/`isToolCallEventType`/`isBashToolResult`/`CONFIG_DIR_NAME`），`@earendil-works/pi-tui`（`Text`/`Box`/`Container` 组件），`typebox`（`Type`），`@earendil-works/pi-ai`（`StringEnum`）。
- 扩展加载方式：`pi -e ./path` 快速测试；`/reload` 热重载；`.pi/extensions/*.ts` 项目级或 `~/.pi/agent/extensions/*.ts` 全局；发布为 pi 包（`pi install`，runtime deps 必须放 `dependencies`）。
- 扩展结构：`export default function (pi: ExtensionAPI)`，可 async。事件可 `pi.on(...)`；render 通过工具定义的 `renderCall`/`renderResult`/`renderShell` 挂钩。

## 参考实现发现（pi-foldable-tools@0.1.0）

用户提供的参考 npm 包 `pi-foldable-tools`（已解压源码研读）的核心机制：

- **覆盖内置工具**：用 `createReadToolDefinition(cwd)` / `createBashToolDefinition(cwd)` 等工厂重建内置工具定义，再 `pi.registerTool({...orig, renderShell:"self", renderCall, renderResult})` 覆盖同名工具（内置工具可被覆盖，交互模式会警告）。`execute` 委托给原始定义，行为不变。
- **`renderShell:"self"`**：取消内置彩色外壳，让工具自绘框架/背景。
- **3 态视图模型**：`folded`（默认）紧凑 2 行卡片（调用头 + 一行状态 `✓ N lines` / `✗ exit N` / `+A -R`）；`expanded` 完整原输出；`hidden` 完全移除（0 行）。
- **跨块重渲染**：`Map<toolCallId, invalidate>` 收集每个渲染块的 `context.invalidate`，切换模式时 `rerenderAll()` 强制所有块重绘。
- **委托渲染**：对 Text 型工具（read/grep/find/ls）委托原始 `renderResult`（保留语法高亮/diff）；对 Container 型工具（bash/edit/write）本地渲染避免 `lastComponent` 类型不匹配崩溃。
- 控制：`ctrl+q` 循环模式 + `/tools [mode]` 命令；环境变量 `PI_TOOL_FOLD_MODE` 设启动默认。
- `formatCall`：每种工具一行紧凑调用头（read 显示 path；bash 显示 `$ cmd`+timeout；edit 显示 path；write 显示 path 行数；grep 显示 pattern+path；find 显示 path+pattern；ls 显示 path）。

**与本需求的差异（重要）**：
- 参考实现用 `renderShell:"self"` **取消内置色框**、输出纯文本折叠行。
- 本需求明确要**保留状态背景色**（文件块常绿；bash 运行黄/成功绿/失败红）。
  → 不可直接照搬 `renderShell:"self"`，需保留默认 `Box` 背景或自绘带背景的组件。
- 本需求面向 **read/bash/edit/write** 四类（参考实现全覆盖 read/bash/edit/write/grep/find/ls）。
- 本需求**配置存 settings.json 块** + nerd font + 路径折叠函数 + bash 命令智能折叠函数（参考实现用环境变量，无这些配置粒度）。

---

## 决策链（Q1-Qn）

### Q1 — 折叠/渲染模式如何保留状态背景色？
- 选项A：**保留内置 Box 背景**（默认），通过 renderCall/renderResult 定制**内容**，背景色由 pi 的状态渲染（成功绿/失败红）驱动。
- 选项B：`renderShell:"self"` 自绘（参考实现方式），但自绘需要手动带背景。
- 选项C：混合（折叠无框、展开着色）。
**决策 → A（保留状态背景色，需求优先）**。文件块常绿；bash 块背景与状态关联（运行黄/成功绿/失败红）。与参考实现取向相反，这是本需求的核心亮点。

### Q2 — 覆盖哪些工具块？
- 选项A：read/bash/edit/write（需求核心）。
- 选项B：read/bash/edit/write/grep/find/ls（参考实现全覆）。
- 选项C：read/bash/edit/write 再精简。
**决策 → A**。read——读文件（文件操作）；write/edit——写/编辑文件（文件操作）；bash——shell 执行（命令折叠）。grep/find/ls 暂不覆盖（YAGNI）。

### Q3 — bash 命令折叠的「智能识别」规则？
- 选项A：截首词 + 去包装（command.trim 后取首 token，剥离 cd/export/echo 等包装）。
- 选项B：仅首个 token。
- 选项C：启发式剥离重定向 + 管道包装（最智能、最复杂）。
**决策 → A（简化版，先实现，后续强化）**。本迭代实现简单函数：取 command 首个 token 作为显示命令名，剥离常见包装前缀（如 `cd X && <cmd>` / `source … && <cmd>`）；识别复杂时先显示首 token，后续迭代强化。

### Q4 — 交互入口？
- 选项A：/fold-blocks 命令 + ctrl+q 快捷键。
- 选项B：仅 /fold-blocks 命令。
- 选项C：/fold-blocks + /tools 别名命令。
**决策 → B（仅 /fold-blocks 命令）**。命令注册进 TUI，用于切换模式 +（结合内置组件）进入设置。不注册快捷键（减少与用户既有按键冲突的干扰）。

### Q5 —（承接需求）配置入口形态
- 需求要求：**注册命令进入 tui 配置**（用 pi 内置组件），配置存 `settings.json` 的 `<包名>` 块。
- 采用 pi 内置 TUI 组件（`ctx.ui`：select/confirm/input 等，或 SettingsList / 自定义 custom()）提供配置子页面；所有设置写回 `<包名>` 的 settings.json 块，供会话恢复时读取。

---

### Q6 — 折叠块统一布局（统一设计语言）
用户明确：**折叠后的块信息文本仅一行**。
- **文件操作块**（read/write/edit）：
  - 左对齐：`工具名 文件名 (offset, limit 等参数)`
  - 右对齐：操作的行数（read 返回行数；write 写入行数；edit 应用的行数/diff 摘要）
- **Bash 块**：
  - 左对齐：`exec 摘要`（智能识别的命令摘要）
  - 右对齐：输出行数、返回值等
- 即：一行 = 左侧概要 + 右侧统计，左右对齐。
**约束**：所有折叠块统一为这一行式左右对齐布局（替代参考实现的纯左对齐两行卡片）。

---

## 设计取舍（trade-offs 汇总）

1. **保留背景色 vs 纯文本折叠**：选保留背景色（需求明确、视觉状态更佳）。代价：不能复用参考实现的 `renderShell:"self"` 纯文本路径，需适配默认 Box 背景的渲染方式；折叠态信息密度略低于纯文本。
2. **覆盖范围 4 工具 vs 8 工具**：选 4（read/bash/edit/write），YAGNI。grep/find/ls 保留内置渲染。
3. **bash 智能识别简单版 vs 启发式版**：先简单版（首 token + 基础包装剥离），后续按需强化。控制复杂度，快速获得可用版本。
4. **仅 /fold-blocks 命令 vs +快捷键**：仅命令，少按键冲突。用户可用 `/fold-blocks` 循环模式与进入设置。
5. **配置存 settings.json `<包名>` 块**：持久化、跨会话恢复；契合 pi 的配置模型（config.yaml/settings.json）。

---

## 设计章节（呈报待审批）

- **架构**：单扩展文件（`packages/pi-tui-fold-blocks/src/index.ts`）+ 配置读写模块。
- **模块划分**：
  - 配置层：读写 `settings.json` 的 `<包名>` 块（含版本/模式/图标/折叠各项）。
  - 折叠函数：`foldPath(path, style)` 路径折叠器；`foldCommand(cmd)` bash 命令折叠器。
  - 渲染层：覆盖 read/bash/edit/write 的 renderCall/renderResult，实现 原生/折叠/隐藏 三态；文件块常绿、bash 块状态着色；nerd font 图标。
  - 命令层：`/fold-blocks` 命令——循环模式 + 进入设置（pi 内置组件）。
- **数据流**：命令/内置组件改设置 → 写回 settings.json → 更新全局模式；渲染时按模式 + 工具类型 + 状态组合决定显示。
- **错误处理**：settings.json 缺失/损坏 → 回退默认值；渲染异常 → fallback 到内置渲染。
- **测试**：路径折叠器、bash 命令折叠器单元测试（纯函数）；配置读写；渲染委托行为。

（各模块详细内容见 design.md——本文件仅捕获协商结论与取舍。）

---

## 验证通过的结论（探索阶段）

- SDK 导出全部 `create*ToolDefinition` 工厂（read/bash/edit/write/grep/find/ls/powershell）✓
- 内置工具可被 `pi.registerTool` 同名覆盖，执行可委托原始定义 ✓
- renderCall/renderResult 返回 `Component`（`@earendil-works/pi-tui` 的 Text/Box/Container），带 `context`（含 args/state/lastComponent/invalidate/toolCallId/isPartial/isError/expanded）✓
- 跨块重渲染用 `Map<toolCallId, invalidate>` + `rerenderAll()`（参考实现验证）✓