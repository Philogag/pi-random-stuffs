# Brainstorm — `@philogag/pi-tui-openspec-status`

> Original capture from `superpowers:brainstorming`. Decision-log style.
> 设计探索保留自然组织；下游 `design.md` 将本文件重组成结构化章节。

## 背景 (Background)

`pi-ramdom-stuffs` 是个 monorepo，pi 扩展以独立包形式发布在
`packages/<name>/`（参考 `packages/pi-tui-fold-blocks` 的形态）。

参考实现 https://github.com/mattoopie/pi-openspec-status 把 openspec
当前 change 的状态用 `ctx.ui.setWidget` 渲染成 3 行卡片 + 可弹出的
overlay dialog。本次需求差异：

- 只输出 **一行** status，调用 `ctx.ui.setStatus`，嵌入 pi 底部状态栏；
- 状态条只在 **有"锁定 spec"** 时显示；
- 参考实现假设 tasks.md 总在主仓；本插件要兼容 **worktree** 场景——
  bash 命令把 openspec 跑在 `.worktrees/feat/xxx/` 下时，自动读
  worktree 中的 `tasks.md` 与主仓合并去重，更新进度条；
- 输出格式：`<spec-name> (<spec-driver>) [<ArtifactInitials+●/○>] Tasks: ████░░░░░░ 3/7`。

## 决策链 (Decision Log)

### Q1 — "锁定 spec" 怎么定义？

**决策**：参考实现是"当前 active change"（任何 active 都显示）。
本次改为 **"用户/agent 主动指定 change 的命令"**：
`openspec new|status|apply|archive|verify|sync|instructions|show`
等显式带 `--change <name>` 或位置参数形式的子命令，最近一次匹配
的 change 即为"锁定 spec"。

- 选中理由：避免在用户只想 `openspec list` 浏览时无意义闪烁状态条；
  匹配用户心智"我正在处理这个 change"的语义。
- 例外：`openspec list --json`（不指定 change）不锁定任何东西。

### Q2 — Worktree 合并策略

**决策**：合并并去重；状态条只更新进度条。

- 解析最近一次 openspec bash 命令，提取其 `cwd`（含 `cd` 重写）；
- 若 `cwd` 在 `.worktrees/<name>/` 下：
  - `tasks.md` 合并读取：
    - 主仓 `openspec/changes/<change>/tasks.md` 勾选项 ∪
      worktree 中同名 `tasks.md` 勾选项；
    - 去重规则：两个 source 都勾的视为完成；任一未勾视为未完成；
    - `total` 取两边并集（unique task IDs）。
  - 其余字段（proposal/specs/design/artifacts 状态）**优先
    worktree**（更近的现场），回退到主仓。
- 状态条渲染时把 `3/7` 这类分数按合并后的集合计算。

### Q3 — `setStatus` vs `setWidget`

**决策**：用 `ctx.ui.setStatus(extensionId, text)`。

- 状态栏固定 1 行，与用户给的格式直接对应；
- 多 change 场景不显示（与参考实现 widget 头不同，本插件宁缺毋滥）；
- 通过 `ctx.hasUI` 守卫，`-p` / `--json` / RPC 非交互模式无副作用。

### Q4 — 模板 artifact 首字母怎么算？

**决策**：用 schema 的"实际产物文件"的首字母大写。

- `spec-driven` / `superpowers-bridge-cn` 的 4 个产物：
  `proposal.md` (P) · `design.md` (D) · `specs/**` (S) · `tasks.md` (T) ·
  `plan.md` (Pl) — 实际配置过的输出目录。
- 拼成 `P● D○ S○ T○` 这种空格分隔的 token 串；● = done（文件存在
  且非空/有内容），○ = 不 done（ready/blocked）。
- 排除 `brainstorm.md` / `verify.md` / `retrospective.md`（这些是
  planning-phase 内部产物，不应出现在状态条上）。

### Q5 — Hook 触发与刷新

- `pi.on("session_start", ...)` 启动时清空/扫描一次；
- `pi.on("tool_call", ...)` 命中 `bash` + 命令中含 `openspec`
  子命令 → 把候选 change 入栈；
- `pi.on("tool_result", ...)` 拿到 bash 退出后，500ms debounce
  触发一次 `openspec status --change <name> --json` 抓数据；
- 状态条 = `ctx.ui.setStatus("pi-tui-openspec-status", line | undefined)`；
- `ctx.hasUI === false` 或无锁定 change → 传 `undefined` 清空。

### Q6 — 错误处理

- `openspec` CLI 缺失 → 静默，不显示；
- bash 命令中提取不到 change name → 不显示；
- 状态命令失败 → 保留上一次状态（或无），不刷屏。

## 候选方案 (Approaches)

### A. 完全照搬参考实现，改 setStatus（最小改动）
优点：实现最快。 缺点：不解决 worktree 合并，状态条信息密度低。
**未选**——直接被需求否。

### B. 自建微型 data layer + 复用 setStatus（推荐）
- `extension/openspec.ts`：CLI 包装（exec / list / status / show）
- `extension/parser.ts`：bash 命令 → change name + cwd + worktree
- `extension/merge.ts`：主仓/worktree tasks 合并去重
- `extension/render.ts`：单行文本拼装
- `extension/index.ts`：hooks 串起，debounce 刷新

优点：与参考相同的拆分；worktree 合并作为单独单元可测；
依赖最小（仅 `@earendil-works/pi-coding-agent` 的 SDK 类型与
`node:child_process`）。 **选中**。

### C. 引入 chokidar 监听 openspec/changes/
优点：实时。 缺点：worktree 场景要监听多目录，复杂度跳一档；
debounce + tool_call 已经足够实时。 **未选**（YAGNI）。

## 设计取舍 (Trade-offs)

- **debounce 500ms** 与参考实现一致——权衡 CLI 启动成本与视觉更新延迟。
- **不做 overlay dialog**——用户明确"我只要我自己定制的 status 条"；
  跳过 keyboard shortcut 与 setWidget。
- **不做多 change overview**——单行宽度放不下，且与"锁定"语义冲突。
- **不发 notify**——状态条本身就是持续可见，反馈已足够。
