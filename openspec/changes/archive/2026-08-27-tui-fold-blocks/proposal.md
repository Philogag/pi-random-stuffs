## Why

pi 的 TUI 中，工具调用块总是以完整彩色外壳渲染（绿/红 "Tool execution box"）。唯一的控制 `ctrl+o` 只切换输出**详略度**，对短输出不可见，且永远无法折叠/隐藏**整块**。大量工具调用（尤其 bash 长输出）持续淹没对话、干扰阅读。我们希望拦截 TUI 绘制、重绘工具块——**只改界面、不改 session 内容**——提供 原生/折叠/隐藏 三态（默认折叠），保留状态背景色，支持 nerd font 图标与路径/命令折叠，并可配置（settings.json）+ 命令入口。收益：界面更清爽、状态一目了然。

## What Changes

**新增 pi 扩展** `@philogag/pi-tui-fold-blocks`（monorepo 下 `packages/pi-tui-fold-blocks/`），覆盖 read/bash/edit/write 四类工具块的自绘渲染：

**<全局工作模式>**
- From: 工具块始终完整渲染，无法折叠/隐藏
- To: 三种模式 原生/折叠/隐藏（默认**折叠**；隐藏=不渲染任何工具块；折叠=折叠为一行）
- Reason: 用户可在阅读与完整信息间自由切换
- Impact: 非破坏性；session/LLM 上下文原样保留，仅改 TUI 显示

**<配置体系>**
- From: 无配置（参考实现用环境变量，粒度粗）
- To: 配置存 `settings.json` 的 `<包名>` 块（模式、nerd font 开关、文件块/bus bash 各自折叠开关、路径样式、git worktree 折叠、bash 智能识别与状态提示）；注册 `/fold-blocks` 命令进入 TUI（用 pi 内置组件）
- Reason: 需求明确要求可配置 + 命令入口 + 持久化
- Impact: 非破坏性；跨会话恢复

**<统一折叠块布局——单行>**
- To: 折叠后的块信息**仅一行**，左侧概要 + 右侧统计（左右对齐）：
  - 文件操作块（read/write/edit）：左 `工具名 文件名 (offset, limit 等)`；右：操作的行数
  - Bash 块：左 `exec 摘要`（智能识别命令）；右：输出行数、返回值等
- Reason: 用户确立的统一设计语言
- Impact: 替代参考实现的纯左对齐两行卡片

**<背景色>**
- To: 运行中-黄、成功-绿、失败-红；**文件操作块背景始终为成功(绿)**；bash 块运行中背景与状态关联
- Reason: 需求明确；保留默认 Box 状态着色（与参考 `renderShell:"self"` 取向相反）
- Impact: 折叠/展开均保持状态视觉

**<nerd font>**
- To: 工具图标（默认开），可关
- Impact: 非破坏性

**新增两个核心折叠函数**：①路径折叠器 ②Bash 命令折叠器（智能识别剥离 cd/export 等包装，取有效命令）。

## Capabilities

### New Capabilities
- `tui-tool-block-collapse`: 覆盖 pi TUI 中 read/bash/edit/write 工具块的自绘显示 —— 三态模式（原生/折叠/隐藏）、单行左右对齐布局、状态背景色（文件块常绿、bash 状态着色）、nerd font 图标、路径折叠与 bash 命令折叠、可配置（settings.json 块）并有 `/fold-blocks` 命令入口。仅影响 TUI 显示，不改 session/LLM 内容。

### Modified Capabilities
- 无（全新能力）。

## Impact

- **新增**：`packages/pi-tui-fold-blocks/`（包名 `@philogag/pi-tui-fold-blocks`）；依赖 `@earendil-works/pi-coding-agent`（SDK）、`@earendil-works/pi-tui`（Text/Box 组件）、`typebox`、`@earendil-works/pi-ai`（StringEnum）。
- **加载**：作为扩展发布（`pi install` 或 `.pi/extensions/*.ts`）；可用 `pi -e` 快速测试、`/reload` 热重载。
- **不改动**：session 内容、LLM 上下文、存储历史；grep/find/ls 保持内置渲染（YAGNI）。
- **影响面**：仅影响安装并启用本扩展用户的 TUI 工具块显示；未覆盖的三态切换通过 `/fold-blocks` 命令触发。