## ADDED Requirements

### Requirement: 锁定 spec 解析

扩展 MUST 监听 pi 中的 bash 工具调用；当命令字符串中包含 `openspec` 子命令且该子命令**显式需要指定 change**（子命令集合至少包含 `new` / `status` / `apply` / `archive` / `verify` / `sync` / `instructions` / `show` / `validate` / `context` / `view`）时，扩展 MUST 从命令参数中提取 change 名作为"锁定 spec"：优先匹配 `--change <name>` 长选项；缺省时回退到子命令后的第一个非 flag 位置参数。

#### Scenario: 命令带 `--change` 参数
- **WHEN** bash 调用形如 `openspec status --change add-pi-tui-openspec-status --json`
- **THEN** 扩展提取 change 名 `add-pi-tui-openspec-status` 作为锁定 spec

#### Scenario: 命令带位置参数
- **WHEN** bash 调用形如 `openspec show add-pi-tui-openspec-status` 且无 `--change` 选项
- **THEN** 扩展从第一个位置参数提取 `add-pi-tui-openspec-status` 作为锁定 spec

#### Scenario: 浏览类子命令不锁定
- **WHEN** bash 调用形如 `openspec list --json` 或 `openspec doctor`
- **THEN** 扩展不更新锁定 spec，状态条保持上一次状态或清空

#### Scenario: 非 openspec 命令不锁定
- **WHEN** bash 调用与 openspec 完全无关（如 `ls`、`pnpm test`）
- **THEN** 扩展不更新锁定 spec

### Requirement: 单行 status 条渲染

扩展 MUST 通过 `ctx.ui.setStatus(extensionId, text)` 在 pi 底部状态栏渲染**恰好一行**文本。文本格式 MUST 严格遵循：

```
<spec-name> (<schema-name>) [<artifact-tokens>] Tasks: <bar> <done>/<total>
```

其中 `<bar>` 是由 `█` 与 `░` 字符组成的 10 格等宽进度条，`<done>/<total>` 是合并去重后的 tasks 完成计数。当无锁定 spec 时，扩展 MUST 调用 `setStatus(undefined)` 清空状态条。

#### Scenario: 渲染完整状态行
- **WHEN** 锁定 spec 为 `add-pi-tui-openspec-status`、schema 为 `superpowers-bridge-cn`、artifacts 完成状态为 `proposal=● design=● specs=○ tasks=○`、tasks 完成 2/7
- **THEN** 状态栏文本为 `add-pi-tui-openspec-status (superpowers-bridge-cn) [P● D● S○ T○] Tasks: ███░░░░░░░ 2/7`

#### Scenario: 无锁定 spec 清空
- **WHEN** 最近一次 openspec bash 命令未显式指定 change
- **THEN** 扩展调用 `setStatus("pi-tui-openspec-status", undefined)`，状态条不留残余

#### Scenario: 单行约束
- **WHEN** 状态条文本已写入
- **THEN** 文本 MUST 只包含一个换行（或不含换行），不得跨多行

### Requirement: artifact 首字母与状态符号

扩展 MUST 仅展示 schema 对外产物（`proposal.md` / `design.md` / `specs/**/*.md` / `tasks.md`）四类 artifact 的状态，首字母 MUST 分别为 `P` / `D` / `S` / `T`，状态符号 MUST 为 `●`（已完成）或 `○`（未完成）之一。首字母与状态符号 MUST 紧贴书写（如 `P●`），各 artifact token 之间 MUST 用单个空格分隔。planning-phase 内部产物（`brainstorm.md` / `verify.md` / `retrospective.md`）MUST 不出现在状态条上。

#### Scenario: 4 个 artifact token 拼接
- **WHEN** 当前 change 同时存在 `proposal.md` `design.md` `specs/**/spec.md` `tasks.md`
- **THEN** 状态条显示 `[P? D? S? T?]`（每个 `?` 为 `●` 或 `○`，按实际完成情况）

#### Scenario: 跳过 planning 内部产物
- **WHEN** change 目录同时存在 `brainstorm.md` 与 `proposal.md`
- **THEN** 状态条 MUST 不出现以 `B` 为首字母的 token；`brainstorm.md` 的存在不参与渲染

#### Scenario: 全 done
- **WHEN** 4 个 artifact 全部完成
- **THEN** 状态条显示 `[P● D● S● T●]`

### Requirement: worktree 自动检测与 cwd 解析

扩展 MUST 优先使用 pi bash tool 事件 `event.input.cwd` 字段；当其缺失或与 `ctx.cwd` 不一致时，扩展 MUST 解析 bash 命令字符串中的 `cd <path> && …` 重写链，取最后一个 `cd` 的目标目录作为 effective cwd。若 effective cwd 路径匹配 `/.worktrees/[^/]+/`，扩展 MUST 视为该 worktree 为当前工作现场。

#### Scenario: bash tool 提供 cwd
- **WHEN** `event.input.cwd = "/repo/.worktrees/feat/openspec-status"` 且命令中无 `cd` 重写
- **THEN** 扩展 effective cwd 为 `/repo/.worktrees/feat/openspec-status`

#### Scenario: 命令字符串 cd 重写
- **WHEN** `event.input.cwd` 为主仓但命令字符串为 `cd .worktrees/feat/x && openspec status --change foo --json`
- **THEN** 扩展解析 `cd` 链得到 effective cwd 为 `.worktrees/feat/x`，视为 worktree 场景

#### Scenario: 无 worktree 路径
- **WHEN** 命令直接在主仓根目录运行且路径不含 `.worktrees/`
- **THEN** 扩展 effective cwd 为主仓根目录，不进入 worktree 合并分支

### Requirement: worktree tasks 合并去重

当扩展识别当前命令在 worktree 中运行时，扩展 MUST 同时读取主仓 `openspec/changes/<change>/tasks.md` 与 worktree 中同名 `tasks.md`，按 task ID 去重合并：任一 source 中 task 标记为勾选（checked / `[x]` / `done`）即视为完成；总数 MUST 等于两侧 task ID 集合的并集大小；完成数 MUST 等于并集中至少一侧勾选的 task 数。其余 artifact 字段（proposal/specs/design 状态）扩展 MUST 优先采用 worktree 中的 `openspec status --change <name> --json` 输出，无 worktree 时回退到主仓。

#### Scenario: 两边都勾选同一 task
- **WHEN** task `1.` 在主仓与 worktree 中均已勾选
- **THEN** 该 task 视为完成，去重后只计 1 次

#### Scenario: 仅 worktree 勾选
- **WHEN** task `2.` 在主仓未勾选、在 worktree 中已勾选
- **THEN** 该 task 视为完成（不出现倒退）

#### Scenario: 仅主仓勾选（worktree 尚未 rebase）
- **WHEN** task `3.` 在主仓勾选、在 worktree 中未勾选
- **THEN** 该 task 视为完成（不遗漏）

#### Scenario: 任务集合合并
- **WHEN** 主仓 tasks.md 含 `1. 2. 3.`，worktree tasks.md 含 `1. 2. 4.`
- **THEN** 总任务数 MUST 为 `|{1, 2, 3, 4}| = 4`，去重而非简单相加

### Requirement: 刷新策略与去抖

扩展 MUST 在 `session_start` 时清空一次状态条以避免旧实例残留；MUST 监听 `tool_call`（仅 `type === "bash"`）与 `tool_result` 事件；MUST 解析后仅在候选 change 与上次锁定不同时才触发 `openspec status --change <name> --json` 调用，并 MUST 使用 ≥ 200ms 且 ≤ 1000ms 的去抖窗口合并连续触发。

#### Scenario: 去抖窗口内连续触发
- **WHEN** 用户在 500ms 内连续发出两条 `openspec` bash 命令
- **THEN** 扩展对第二条命令的解析与状态条更新 MUST 在第一条的去抖延迟结束前被合并

#### Scenario: 新 change 触发刷新
- **WHEN** 锁定 change 由 `change-a` 变为 `change-b`
- **THEN** 扩展 MUST 在去抖窗口结束后调用 `openspec status --change change-b --json` 并刷新状态条

#### Scenario: session_start 清空
- **WHEN** 新会话开始时旧实例残留了状态文本
- **THEN** 扩展 MUST 立即调用 `setStatus(undefined)` 清空

### Requirement: 错误处理与无副作用

扩展 MUST 将所有 openspec CLI 调用、文件读取、命令解析包裹在 try/catch 中；当 openspec CLI 缺失、命令无法解析、CLI 返回非零退出码、或 tasks.md 解析失败时，扩展 MUST 保留上一次状态（或空）并继续运行，**不得**抛错、**不得**弹窗、**不得**修改 session 内容或 LLM 上下文。

> 注：本条仅适用于 `ctx.mode === "tui"` 的激活场景；非 TUI 模式下扩展根本不注册处理器，因此本条不触发。

#### Scenario: openspec CLI 缺失
- **WHEN** PATH 中找不到 `openspec` 可执行文件
- **THEN** 状态条保持空，扩展不抛错、不阻塞其它工具调用

#### Scenario: bash 命令解析失败
- **WHEN** bash 命令为复杂 shell 片段且扩展无法可靠提取 change 名
- **THEN** 扩展 MUST 不更新锁定 spec，状态条保留上一次状态

#### Scenario: tasks.md 解析失败
- **WHEN** 主仓与 worktree 的 `tasks.md` 均无法解析为 task 列表
- **THEN** 进度条显示 `0/0` 而非抛错；其余 artifact 状态仍正常显示

### Requirement: TUI 模式独占激活

扩展 MUST 在工厂函数的最开始读取 `ctx.mode`；当 `ctx.mode !== "tui"`（即 pi 以 `print` / `json` / `rpc` 任一模式启动）时，扩展 MUST **完全不激活**，具体表现为：

1. 不得调用任何 `pi.on(...)` 注册事件处理器；
2. 不得启动任何后台资源（spawn 子进程、文件读取、计时器、chokidar 监听等）；
3. 不得维护或更新任何内部状态（锁定 change、effective cwd、候选 task 进度）；
4. 不得调用 `ctx.ui` 的任何方法。

判定 MUST 使用 `ctx.mode === "tui"` 而**非** `ctx.hasUI`，原因：`ctx.hasUI` 在 `tui` 与 `rpc` 两种模式下都为 `true`；若以 `ctx.hasUI` 为门，则 RPC 模式仍会激活——违反本条 "只在 TUI 下激活" 的语义。本条判定必须与 `pi.dev/docs/latest/extensions#ctx-mode` 一致。

#### Scenario: print 模式完全不激活
- **WHEN** pi 以 `pi -p ...` 启动（`ctx.mode === "print"`）且扩展被加载
- **THEN** 扩展不注册任何事件处理器；终端无任何状态条输出；不发生任何 spawn 或文件读取

#### Scenario: json 模式完全不激活
- **WHEN** pi 以 `pi --mode json ...` 启动（`ctx.mode === "json"`）且扩展被加载
- **THEN** 扩展不注册任何事件处理器；stdout 不包含任何额外输出；后续 bash 命令也不被监听

#### Scenario: rpc 模式完全不激活
- **WHEN** pi 以 `pi --mode rpc ...` 启动（`ctx.mode === "rpc"`，`ctx.hasUI === true`）且扩展被加载
- **THEN** 扩展不注册任何事件处理器；尽管 `ctx.hasUI === true`，扩展仍按非 TUI 模式处理；不调用 `setStatus` 也不维护内部状态

#### Scenario: tui 模式正常激活
- **WHEN** pi 以交互式 TUI 模式启动（`ctx.mode === "tui"`）
- **THEN** 扩展注册 `session_start` / `tool_call` / `tool_result` 三个事件处理器；后续锁定 spec 解析、单行 status 渲染、worktree 合并均按其它 Requirements 工作

### Requirement: 独立 extensionId

扩展 MUST 使用字符串 `"pi-tui-openspec-status"` 作为 extensionId 调用 `ctx.ui.setStatus`；该 id MUST 独立于其它可能使用 status 位的扩展，避免互相覆盖。

#### Scenario: 不覆盖其它扩展 status
- **WHEN** 同一会话中加载了另一个使用 `setStatus` 的扩展
- **THEN** 两扩展的 status 文本并存或互不干扰（具体行为由 pi 的 status 栏实现决定）；本扩展 MUST 不主动清空其它扩展写入的 status

---

## MODIFIED Requirements

（无 — 全新能力，无既有 requirement 变更。）

---

## REMOVED Requirements

（无 — 全新能力，无既有 requirement 移除。）

---

## RENAMED Requirements

（无 — 全新能力，无既有 requirement 更名。）
