## Why

`pi-goal-loop` 现在用 `goal_sleep({ seconds })` 表达「这一轮别续跑」：抑制只消费一次，加一个 900s
上限的定时器，到点主动 `triggerTurn`。这套机制与两个实际存在的等待机制正面冲突：

- **pi-subagents 的异步派发已经有原生完成唤醒**。它自己的工具结果里就写着
  「Detached. Return control now: native completion wakes you, so do not sleep, poll, or call
  bg_wait for it.」——goal-loop 却让 agent 调 `goal_sleep` 再等一个定时器，纯属多一层。
- **rpiv-ask-user-question 在等用户回答**（`rpiv:ask-user:blocked`）。定时器到点时会往正在等
  答案的会话里插一条续跑提示，白烧一轮 token，也干扰问卷。

而且 `goal_sleep` 把「该等多久」的判断推给模型，猜错就空转。本次删除该工具，改为**观测**这两类
等待机制：等待期抑制续跑，恢复交给原生唤醒。

## What Changes

**删除 `goal_sleep` 及其定时器机制**
- From: `goal_sleep({ seconds })` 工具 + `SleepState` + 调度器 + clamp(1–900s) + 超时兜底 +
  「抑制只消费一次」+ 到点 `triggerTurn`。
- To: 不注册 `goal_sleep`；扩展内不再有任何定时器或延迟状态。
- Reason: 定时器与原生唤醒竞争，且把时长判断推给模型。
- Impact: **breaking**（对使用者而言工具消失）。`goal_finish`、`/goal`、`/goal-stop` 均不变。

**新增等待感知（goal-wait）**
- 订阅 `pi.events` 的 `rpiv:ask-user:blocked`；监听 `tool_execution_start` / `tool_execution_end`。
- 阻塞类等待（`ask_user_question` / `bg_wait` / `acp_delegate_wait`）：调用未结束时视为在途。
- 异步派发类（`subagent` / `acp_delegate`，无 `action` 且 `async !== false`）：进入 latch，
  持续抑制到外部事件。
- `agent_before_settle` 在「有活动目标 + `completed` + 等待生效」时不注入续跑提示、不 `continue`；
  否则照常续跑。
- 释放信号：用户 `input`、新一轮 `agent_start`、带参 `/goal`、`/goal-stop`、`goal_finish`、
  `session_shutdown`。

**续跑提示词改写**
- From: 「需要等待异步任务（例如 subagent）时，调用 `goal_sleep({ seconds })`…」
- To: 「需要用户决策时调用 `ask_user_question`；需要等后台/子 agent 时用 `bg_wait`（或让异步派发
  完成后原生唤醒你），不要 sleep/poll。」

## Capabilities

### New Capabilities

- `goal-wait`: 等待感知的续跑抑制。定义等待来源的观测、抑制条件、latch 的释放信号、
  无等待时的正常续跑，以及「不注册任何延迟/定时器工具」。

### Modified Capabilities

- `goal-lifecycle`: `/goal`、`/goal-stop`、`goal_finish` 的清理对象由「延迟状态」改为「等待态」；
  「自动续跑边界」的抑制条件改为「等待生效」；「续跑提示词内容」把 `goal_sleep` 换成
  `ask_user_question` / `bg_wait`；「工具引导不经过系统提示词」与「目标状态仅存于内存」同步改为
  只剩 `goal_finish` 与等待态。
- `goal-deferral`: **整体 REMOVED**（6 条 Requirement 全部废止，由 `goal-wait` 取代）。
  归档时删除 `openspec/specs/goal-deferral/`。

## Impact

- 代码：`packages/pi-goal-loop/src/goal-state.ts`（等待态取代延迟态、删除调度器）、
  `src/index.ts`（删除 `goal_sleep`，新增 4 个事件订阅）、`src/prompts.ts`（提示词与通知文案）。
- 测试：`test/goal-state.test.ts`、`test/index.test.ts`、`test/prompts.test.ts`。
- 文档：`packages/pi-goal-loop/README.md`（命令/工具表、等待语义、设计要点）。
- 依赖：无新增运行时依赖。可选依赖的兄弟扩展为 `@juicesharp/rpiv-ask-user-question`（>=2.15.0 才有
  `rpiv:ask-user:blocked`）与 `pi-subagents`（`bg_wait` / 异步派发）；两者缺失时行为等价于纯续跑。
- 宿主能力：`pi.events`（`EventBus`）、`tool_execution_start` / `tool_execution_end` /
  `agent_start` / `input` 事件（均已在 `peerDependencies` 的 `>=0.87.0` 范围内）。
