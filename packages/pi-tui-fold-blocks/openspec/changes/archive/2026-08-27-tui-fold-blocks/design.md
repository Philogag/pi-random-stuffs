## Context

在 pi 的 TUI 中，工具调用块总是以完整彩色外壳渲染（绿/红 "Tool execution box"），唯一的控制 `ctrl+o` 只切换输出详略度——对短输出不可见，且永远无法折叠/隐藏整块。用户希望拦截 TUI 绘制、重绘工具块，**只改界面、不改 session 内容**（LLM 上下文与存储历史原样保留），并提供可配置的折叠显示。

本 change 在刚初始化的空 Node monorepo（pnpm workspaces + TypeScript，`packages/*` 结构）中新增 pi 扩展包 `packages/pi-tui-fold-blocks/`（`@philogag/pi-tui-fold-blocks`）。约束：OpenSpec 是需求事实源（SDD 工作流要点）；不重写 proposal/spec 需求。

相关技术事实（brainstorm 已验证）：
- SDK `@earendil-works/pi-coding-agent` 导出全部 `createReadToolDefinition` / `createBashToolDefinition` / `createEditToolDefinition` / `createWriteToolDefinition` 等工厂；内置工具可用 `pi.registerTool` 同名覆盖（执行可委托原始定义）。
- 渲染钩子 `renderCall` / `renderResult` 返回 `@earendil-works/pi-tui` 的组件（Text/Box/Container），带 `context`（含 args/state/lastComponent/invalidate/toolCallId/isPartial/isError/expanded）。
- 参考实现 `pi-foldable-tools@0.1.0` 用 `renderShell:"self"` 取消内置色框、纯文本折叠；本需求同样用 `renderShell:"self"` 但**保留状态背景色**（组件内 `setCustomBgFn` 自绘：文件块恒绿、bash 随状态黄/绿/红）。
- 扩展加载：`pi -e` 快速测试、`/reload` 热重载、`.pi/extensions/*.ts` 项目级或 `~/.pi/agent/extensions/*.ts` 全局、发布 pi 包（runtime deps 放 `dependencies`）。
- SDK `ToolExecutionComponent` 每次 `updateDisplay` 会把 `renderCall` 与 `renderResult` 的返回值都 `addChild` 进容器 → 两者都非空会渲染两行；`addChild(null)` 会崩溃。因此：`renderCall` 返回空 `Text("",0,0)`(0 行)，`renderResult` 渲染单行概要+统计；hide 模式返回空 Text(0 行 → 块整体消失)。

## Goals / Non-Goals

**Goals:**
- 覆盖 read/bash/edit/write 四类工具块的自绘渲染，实现 原生/折叠/隐藏 三态（默认折叠）。
- 折叠块**单行左右对齐布局**：左侧概要 + 右侧统计（文件块：左 `工具名 文件名 (offset,limit)` 右 操作行数；bash：左 `exec 摘要` 右 输出行数/返回值）。
- 保留状态背景色：文件操作块**始终绿**；bash 块运行中黄/成功绿/失败红。
- nerd font 图标（默认开，可关）；文件块与 bash 各自折叠行为可配置。
- 配置存 `settings.json` 的 `<包名>` 块，注册 `/fold-blocks` 命令（用 pi 内置 TUI 组件进入配置）。
- 两个纯函数折叠器：`foldPath`（路径折叠）、`foldCommand`（bash 命令智能折叠）。
- 完全非侵入：不改 session/LLM 上下文/存储历史；未启用本扩展时行为不变。

**Non-Goals:**
- 不覆盖 grep/find/ls（YAGNI，保持内置渲染）。
- 不注册快捷键（避免按键冲突，仅 `/fold-blocks` 命令）。
- 不实现 bash 启发式命令识别的完整形态（先简单版：首 token + 基础包装剥离，后续迭代强化）。
- 不改动工具本身的执行逻辑（`execute` 委托原始定义，行为不变）。

## Decisions

### D1：渲染方式 — `renderShell:"self"` + 组件内自绘背景
- **选择**：覆盖定义统一设 `renderShell:"self"`(取消 SDK 固定状态 Box),在 `renderCall`/`renderResult` 返回的 `Text` 组件上用 `setCustomBgFn` 自绘背景:文件块恒绿, bash 按 `isPartial`(黄)/`isError`(红)/成功(绿)。
- **理由**：需求要求文件块「始终绿」(含运行中)。SDK 内置 Box 的背景固定为 `isPartial→toolPendingBg`(黄)/`isError→toolErrorBg`(红)/否则 `toolSuccessBg`(绿),**无法**让文件块运行中也绿;且折叠单行与 Box 的 padding/背景机制叠加易错。自绘背景可精确满足需求。
- **已考虑 alternative**：保留默认 Box(不设 self)——拒绝:背景由 SDK 固定,文件块运行中变黄,违反需求。
- **已考虑 alternative**：参考实现 `renderShell:"self"` 且纯文本无色——拒绝:丢失状态背景色。

### D2：覆盖范围 — 仅 read/bash/edit/write（4 工具）
- **选择**：覆盖 read（文件操作）、write/edit（文件操作）、bash（命令折叠）。grep/find/ls 不覆盖。
- **理由**：需求聚焦这四类；YAGNI，避免无谓复杂。
- **已考虑 alternative**：参考实现全覆 read/bash/edit/write/grep/find/ls（8 工具）——拒绝，超出需求范围。

### D3：文件块 vs bash 块的背景色策略
- **选择**：文件操作块（read/write/edit）背景**始终绿**（成功态）；bash 块背景跟随状态（运行中黄/成功绿/失败红）。
- **理由**：需求明确；文件块是「确定性操作」，bash 是「可变执行」。
- **已考虑 alternative**：所有块统一跟随状态——拒绝，不符合「文件块始终绿」的需求。

### D4：bash 命令折叠「智能识别」— 先简单版
- **选择**：`foldCommand` 取 command 首个 token（trim 后），剥离常见包装前缀（`cd X && <cmd>` / `source … && <cmd>` / `export … && <cmd>`）后取有效命令；识别复杂时先显示首 token。
- **理由**：快速获得可用版本，控制复杂度；后续按需强化。
- **已考虑 alternative**：启发式剥离重定向 + 管道（完整但复杂）——延期，纳入后续迭代。

### D5：交互入口 — 仅 `/fold-blocks` 命令
- **选择**：注册 `/fold-blocks` 命令：循环切换显示模式 + 打开设置子页面（pi 内置 TUI 组件：`select`/`confirm`/`input` 等）。不注册快捷键。
- **理由**：需求要求「注册命令进入 tui 配置」；避免按键冲突。
- **已考虑 alternative**：+`ctrl+q` 快捷键／`/tools` 别名——拒绝，少干扰、范围聚焦。

### D6：配置存储 — `settings.json` 的 `<包名>` 块
- **选择**：所有设置（模式/nerd font/文件块折叠/路径样式/路径折叠/git worktree 折叠/bash 折叠/智能识别/状态提示）写入 `settings.json` 的 `@philogag/pi-tui-fold-blocks` 块；读写模块负责校验与回退默认值。
- **理由**：持久化、跨会话恢复；契合 pi 的配置模型。
- **已考虑 alternative**：环境变量（参考实现方式）——拒绝，粒度不足、无法交互式编辑。

### D7：跨块重渲染
- **选择**：`Map<toolCallId, invalidate>` 收集每个渲染块的 `context.invalidate`；切换模式时 `rerenderAll()` 强制所有块重绘。
- **理由**：模式切换需立即重绘所有已渲染工具块；参考实现已验证此机制可行。
- **已考虑 alternative**：逐块惰性重绘——拒绝，模式切换无法及时生效。

### D8：委托渲染
- **选择**：`renderCall` 一律返回空 `Text("",0,0)`(0 行);`renderResult` 本地渲染单行概要+统计(统一 Text 型组件),复用 `context.lastComponent as Text` 避免 `lastComponent` 类型不匹配崩溃。native 模式委托原始渲染器,其余模式全部本地渲染。
- **理由**：SDK 每次 updateDisplay 会把 renderCall 与 renderResult 的返回值都 addChild 进容器 → 两者都非空会渲染两行;renderCall 返回空可保证最终单行。统一本地渲染规避 Container 型工具的 `lastComponent` 类型不匹配崩溃(参考实现同款验证)。
- **已考虑 alternative**：Text 型(read)委托原始渲染器 — 拒绝:原生 renderCall 与 renderResult 会叠加成两行,且委托内容无法注入统计/背景;统一本地渲染更可控。

## Risks / Trade-offs

- **[Risk] SDK 每次 updateDisplay 会把 renderCall 与 renderResult 的返回值都 addChild 进容器** → Mitigation: renderCall 返回空 `Text("",0,0)`(0 行,不占空间),renderResult 渲染单行概要+统计 → 最终仅一行。
- **[Risk] `addChild(null/undefined)` 崩溃** → Mitigation: hide 模式返回空 Text(0 行 → 块整体消失),绝不返回 null。
- **[Risk] Container 型工具本地渲染的 `lastComponent` 类型不匹配** → Mitigation: 一律复用 `context.lastComponent as Text`(参考实现 `asText` 模式);bash/edit/write 本地渲染紧凑组件,参考实现已验证可行;native 模式直接委托原始渲染器。
- **[Risk] 覆盖内置工具在交互模式可能告警** → Mitigation: `execute` 原样委托原始定义，行为不变，仅渲染层覆盖；必要时抑制告警（参考实现同款处理）。
- **[Risk] 折叠单行在窄终端可能溢出** → Mitigation: 概要裁剪（bash 命令截断）、路径用相对/文件名风格缩短；超长文本 `truncateHead/tail`。
- **[Trade-off] 保留背景色 vs 信息密度** → 折叠行信息密度略低于纯文本卡片，但保留状态背景色是核心需求，接受。
- **[Trade-off] 简单版命令识别 vs 完整版** → 首 token 可能不总是「真实命令」，接受并纳入后续迭代强化（smart 开关允许后续增强）。
- **[Risk] settings.json 缺失/损坏** → Mitigation: 读写模块校验 schema、损坏回退默认值，不阻塞渲染。

## Migration Plan

N/A — 本 change 不涉及部署变更（无 endpoint/DB；纯新增 TUI 显示扩展）。「部署」= 安装并启用扩展；回滚 = 卸载/禁用扩展（`.pi/extensions/` 移除或配置关闭），会话内容不受影响（渲染层隔离，非侵入）。

- 验收条件：`pi -e` 加载扩展后，/fold-blocks 循环三态；折叠块为单行左右对齐；文件块常绿；bash 运行黄/成功绿/失败红；settings.json 块可读写并有默认值回退。

## Open Questions

- 折叠块「右对齐统计」的实现方式（空格填充固定宽度 vs pi-tui 的 flex/对齐组件）——待渲染阶段用 pi-tui 组件能力确认后最终定稿。
- `native` 模式的精确语义（完全放手 vs 仍参与渲染但原样输出）——以「完全放手（不干预该模式）」为默认。
- bash 智能识别是否需要在首迭代即覆盖 `sudo`/`nohup`/命令别名等形态——留待后续迭代 + smart 开关。# 路径折叠器 foldPath 与命令折叠器 foldCommand 的详细签名在实现阶段在 specs/tasks 固化。