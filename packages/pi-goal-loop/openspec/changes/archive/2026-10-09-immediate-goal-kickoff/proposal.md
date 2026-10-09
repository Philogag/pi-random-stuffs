## Why

当前 `packages/pi-goal-loop` 中，用户执行 `/goal <content>` 只会把文本登记为活动目标并显示一条 UI 通知，**不会发起任何模型请求**。于是空闲会话里若用户执行 `/goal X` 后不再发别的消息，就没有「一轮」可供 `agent_before_settle` 触发，自动续跑永远不会启动——用户以为目标已经开始推进，实际上毫无动静。本变更让 `/goal <content>` 在 agent 空闲时**立刻**注入一轮续跑提示，把「声明目标」与「开始执行」合并在同一次交互内，消除这段静默期。

## What Changes

**`/goal <content>` 的即时启动（immediate kickoff）**
- From: `/goal <target>` 仅执行 `startGoal(state, text)` + `notify(...)`；自动续跑只能等下一次
  `agent_before_settle`（`outcome === "completed"`）才可能发生。
- To: `/goal <target>` 在完成登记与通知后，若宿主的 `ctx.isIdle()` 为 true，则立刻以
  `triggerTurn: true` 投递一轮既有续跑提示（`buildContinuationPrompt(goal)`），当场开启新一轮。
- Reason: 消除「声明目标后静默等待」的缺口，让首次执行与后续自动续跑一致。
- Impact: non-breaking。仅新增 `/goal` 命令处理器内的一个分支；`/goal` 无参查询、`/goal-stop`、
  `goal_finish`、`goal_sleep`、settle 边界行为均不变。

## Capabilities

### New Capabilities

（无新增能力。）

### Modified Capabilities

- `goal-lifecycle`: 「目标登记命令（`/goal`）」这一 Requirement 增加「带参数执行且 agent 空闲时立刻
  开启一轮」的行为要求与对应 Scenario；目标的清除出口、`/goal` 无参查询语义保持不变。

## Impact

- 代码：`packages/pi-goal-loop/src/index.ts`（`/goal` 命令处理器）。
- 依赖的宿主能力：`ExtensionContext.isIdle()`、`pi.sendMessage(msg, { triggerTurn: true })`
  —— 均已存在于 pi `>=0.87.0`（现有 peerDependency 下限无需调整）。
- 测试：`packages/pi-goal-loop/test/index.test.ts`（fake `pi` 与 fake `ctx.isIdle` 覆盖 idle /
  非 idle 两条分支）。
- 文档：`packages/pi-goal-loop/README.md` 的命令说明与设计要点。
- 不新增运行时依赖；不改变每轮固定上下文占用；不影响 `openspec/specs/goal-deferral`。
