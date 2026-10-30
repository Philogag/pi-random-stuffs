## Why

`pi` agent 在执行 openspec apply / status / instructions 等子命令时，用户需要在 TUI 底部一眼看到**当前锁定 change 的进度**（artifact 完成状态 + tasks 进度条），而不是打开 overlay 或另开终端跑 `openspec status --json`。参考实现 `mattoopie/pi-openspec-status` 用 `setWidget` 渲染 3 行卡片 + Ctrl+Alt+O 弹窗——信息量大、占垂直空间，且未考虑 **worktree** 场景：agent 在 `superpowers-bridge-cn` 工作流下经常在 `.worktrees/feat/<branch>/` 中跑 openspec 命令，此时 tasks 可能在 worktree 更新而主仓仍是旧版，参考实现直接读主仓会出现进度"倒退"。我们需要一个**单行 status 条**版本，仅在有锁定 spec 时显示，自动合并 worktree 的 tasks 状态，把"我现在在哪个 change、做到哪一步"压缩成一格底部状态栏。

## What Changes

**新增 pi 扩展** `@philogag/pi-tui-openspec-status`（monorepo 下 `packages/pi-tui-openspec-status/`），与参考实现同样读 `openspec status --change <name> --json`，但渲染面缩成 1 行 `ctx.ui.setStatus`：

**<锁定 spec 语义>**
- From: 参考实现任意 active change 都显示
- To: 仅当最近 bash 命令显式指定了某个 change 时锁定（即 `openspec new|status|apply|archive|verify|sync|instructions|show` 等带 `--change <name>` 或位置参数 `change-name` 的子命令）；无锁定时状态条清空
- Reason: 避免 `openspec list` / `openspec doctor` 等"浏览类"命令无意义地刷状态条
- Impact: 非破坏性；多数场景下状态条根本不会亮起

**<单行 status 输出>**
- From: 参考实现 3 行 widget（header + artifacts + 进度条）+ overlay dialog
- To: 仅一行 `<spec-name> (<spec-driver>) [<artifact initials+●/○>] Tasks: ████░░░░░░ 3/7`；无 dialog、无键盘快捷键
- Reason: 用户明确"我只要我自己定制的 status 条"
- Impact: 状态栏占用 1 行；status 条只在锁定时出现

**<worktree 合并>**
- From: 参考实现只读 `ctx.cwd` + 主仓 `openspec/changes/`
- To: 解析最近一次 openspec bash 命令的真实 cwd（含 `cd … &&` 重写）；若 cwd 落在 `.worktrees/<name>/` 下，tasks 进度按 **主仓 ∪ worktree tasks.md 合并去重** 计算（任一勾选 = 完成；总任务数取两边 unique task ID 并集），其余字段优先 worktree
- Reason: apply 阶段常跑在 worktree；不合并会出现进度倒退
- Impact: 状态条进度数字更接近用户的"实际体感"

**<artifact 首字母>**
- 派生自 schema 实际产物文件：`proposal.md` (P) · `design.md` (D) · `specs/**` (S) · `tasks.md` (T)；`brainstorm.md` / `verify.md` / `retrospective.md` 等 planning-phase 内部产物不计入
- 状态符号：● done / ○ ready（与参考实现一致）

## Capabilities

### New Capabilities
- `tui-openspec-status`: pi 扩展 `@philogag/pi-tui-openspec-status`，基于 `ctx.ui.setStatus` 渲染当前锁定 openspec change 的单行状态——含 spec 名、schema 名、各 artifact 首字母+状态符号、tasks 进度条；锁定语义为"最近一次 bash 命令显式指定 change"；自动检测 worktree 并合并主仓/worktree 的 tasks 状态。仅在锁定时显示；非交互模式（`-p`/`--json`）无副作用。

### Modified Capabilities
- 无（全新能力）。

## Impact

- **新增**：`packages/pi-tui-openspec-status/`（包名 `@philogag/pi-tui-openspec-status`）；依赖 `@earendil-works/pi-coding-agent` SDK（hooks、`ctx.ui`、`ctx.hasUI`、`ctx.cwd`）；运行时调外部 `openspec` CLI。
- **加载**：作为扩展发布（`pi install` 或 `.pi/extensions/*.ts`）；`pi -e ./packages/pi-tui-openspec-status/src/index.ts` 本地调试，`/reload` 热重载。
- **不改动**：session 内容、LLM 上下文、openspec 文件本体、其它扩展的 setStatus（使用独立的 extension id）。
- **影响面**：仅影响安装并启用本扩展用户的 TUI 状态栏；不引入 setWidget / 不弹 dialog / 不改 toolbar。
