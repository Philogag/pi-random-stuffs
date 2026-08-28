# Design — add-tui-openspec-select

## Context

`pi-tui-openspec-status` 是一个 pi 扩展（`packages/pi-tui-openspec-status/`），在 TUI 模式（`ctx.mode === "tui"`）下把当前 openspec change 的进度渲染为单行状态栏：
`<name> (<schema>) [P● D● S○ T○] Tasks: ███░░░░░░░ 2/7`。

现状：锁定 spec 完全依赖 bash `tool_call` 事件解析——LLM 执行 `openspec status --change <name>` 等命令时，扩展从命令字符串提取 change 名锁定显示（含 worktree 检测与主仓+worktree 合并渲染）。用户无手动入口，状态栏跟踪哪个 spec 完全由 LLM 的 bash 命令决定。

约束：
- 扩展遵循 TUI 模式独占激活（`ctx.mode !== "tui"` 完全不注册处理器）。
- 现有解锁语义：所有扫描 source 的 `openspec/changes/<name>/` 文件夹消失即解锁清空。
- 依赖 pi 扩展 API：`pi.registerCommand(name, { description, handler })`（handler 接收 `(args, ctx)`，ctx 为 `ExtensionCommandContext`，含 `ctx.ui.select(prompt, items)` 交互选择器——返回选中项，取消/超时返回 `undefined`）。这两者均已存在，无新依赖。
- 干系人：扩展使用者（在 TUI 中手动挑选跟踪的 spec）。

## Goals / Non-Goals

**Goals:**
- 提供 `/tui-openspec-select` TUI 斜杠命令，打开交互选择器，列出 `openspec/changes/*/` 下所有活动 change（排除 `archive/`）加一个 `None` 选项。
- 选中某 change → 手动锁定并立即渲染（复用现有 `lockedChange` + `render()` 路径）。
- 选 `None` → 清空手动锁定，恢复自动监听。
- 手动锁定覆盖自动锁定：`manualLock === true` 时 bash 自动锁定不再改变 change 名；worktree 检测（`effectiveCwd`）仍生效。
- 归档自动解锁保持：所有 source 文件夹消失时清空锁定与 `manualLock`。

**Non-Goals:**
- 不做 bash 命令字符串形式的 `tui-openspec-select` 解析入口（用户已选 TUI 斜杠命令；避免双入口优先级混乱）。
- 不支持 `/tui-openspec-select <name>` 直接参数形式（无参打开选择器；暂不注册 `getArgumentCompletions`）。
- 不改变自动锁定路径的既有行为（无 manualLock 时一切照旧）。
- 不修改状态栏渲染格式、worktree 合并、debounce、错误处理逻辑。

## Decisions

### D1：命令入口 — TUI 斜杠命令
- **选择**：`pi.registerCommand("tui-openspec-select", { description, handler })`，仅在 TUI 激活分支内注册。
- **理由**：命令面向"用户手动指定"，天然属于 TUI 交互层；bash 解析路径是给 LLM 用的，两者职责分离。
- **已考虑 alternative**：
  - bash 命令字符串解析 → 拒绝：用户无法直接触发，且与自动锁定路径耦合。
  - 两者都要 → 拒绝（用户确认单选 A）：双入口带来优先级混乱与测试面膨胀。

### D2：手动锁定优先级 — 手动覆盖自动
- **选择**：新增 `manualLock: boolean` 状态。`manualLock === true` 时 `tool_call` 处理器跳过 `lockedChange = parsed.changeName` 更新；手动重选或选 `None` 后 `manualLock = false` 恢复自动。
- **理由**：手动选择的语义是"稳定跟踪这个 spec，别被其它命令带走"。
- **已考虑 alternative**：
  - 自动覆盖手动 → 拒绝：手动选择失去稳定性，选择无意义。
  - 最近一次优先 → 拒绝（用户确认单选 A）：行为随命令顺序抖动，不可预期。

### D3：worktree 检测在 manualLock 下仍生效
- **选择**：`manualLock` 只冻结 change 名；`effectiveCwd` 跟随（`cd <worktree> && ...` 解析）照常。
- **理由**：`effectiveCwd` 影响渲染扫描路径（主仓+worktree 合并），与"锁定哪个 change"正交；用户在 worktree 中仍应看到合并进度。
- **已考虑 alternative**：manualLock 时冻结 effectiveCwd → 拒绝：worktree 合并渲染退化为主仓单源，丢失 D 的多源信息。

### D4：清空方式 — 交互选择器 + None 选项
- **选择**：命令无参执行 → `ctx.ui.select("Select spec:", [...activeChanges, "None"])`。选 `None` → `lockedChange = undefined; manualLock = false;` 并按现有规则清空状态栏（仅当 `lastRendered !== ""` 时 `setStatus(undefined)`）。`select` 返回 `undefined`（取消/超时）→ 无任何副作用。
- **理由**（用户自定义答案）：交互选择器比记忆命令参数更符合"手动选择"心智模型；`None` 使清空动作显式可见。
- **已考虑 alternative**：
  - 无参调用即清空 → 拒绝：误触即丢锁定，且无法主动选择。
  - `--clear` 标志 → 拒绝：增加记忆负担，交互选择器已含清空入口。

### D5：活动 change 发现 — 文件系统扫描
- **选择**：新增 `discover.ts`，`readdir(ctx.cwd/openspec/changes/)` 过滤目录且排除 `archive`，返回目录名列表（排序稳定）。
- **理由**：`openspec/changes/` 是 change 存在的权威位置（与现有 `render()` 的 `access()` 探针一致），无需调用 CLI。
- **已考虑 alternative**：`openspec list --json` CLI → 拒绝：额外子进程开销；且依赖 CLI 可用性，与"错误处理与无副作用"约束相悖。

### D6：归档自动解锁
- **选择**：`render()` 中所有 source 文件夹消失时，现有解锁分支同时重置 `manualLock = false`。
- **理由**：change 归档即不存在，继续跟踪无意义；与现有解锁语义保持一致。
- **已考虑 alternative**：手动锁定后归档也不清空，必须手动选 None → 拒绝（用户确认设计稿保留自动解锁）：两条解锁路径行为分裂，且跟踪不存在的 spec 产生误导性状态。

## Risks / Trade-offs

- [Risk] `ctx.ui.select` 在用户按 Esc 与超时两种情况下都返回 `undefined`，无法区分 → Mitigation: 两者统一按"无操作"处理，不修改任何状态；该语义可接受（D4 已记录）。
- [Risk] 选择器打开期间 LLM 恰巧执行 openspec bash 命令 → Mitigation: 选择是同步交互（await select），命令在用户确认前不会改变锁定；即使发生，manualLock 语义保证手动选择覆盖。
- [Trade-off] 手动锁定冻结 change 名导致 bash 自动锁定暂时失效 → 接受理由：这正是"手动覆盖自动"的预期行为，用户可通过选 `None` 恢复。
- [Trade-off] 不注册 `getArgumentCompletions` → 接受理由：无参交互设计下补全无意义；若后续支持直接参数形式再补。

## Migration Plan

N/A — 本 change 不涉及部署变更：纯扩展内部新增命令与状态标志，无 endpoint / DB / 配置变更。发布即生效（重新加载扩展）。

验收条件：
1. TUI 下输入 `/tui-openspec-select` 弹出选择器，列出活动 change + None。
2. 选择某 change 后状态栏立即显示该 change 进度；随后 bash 中 openspec 命令不改变锁定。
3. 选 None 后状态栏清空，bash 自动锁定恢复生效。
4. 手动锁定的 change 被归档后状态栏自动清空，`manualLock` 重置。

## Open Questions

- 无待解决决策。D4 的"取消/超时不可区分"已作为接受的取舍记录。
