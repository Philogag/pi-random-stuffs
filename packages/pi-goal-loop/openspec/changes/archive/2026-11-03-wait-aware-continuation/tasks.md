## 1. 状态机：等待态取代延迟态

- [x] 1.1 `packages/pi-goal-loop/src/goal-state.ts`：删除 `Scheduler`/`systemScheduler`/`TimerHandle`/`SleepState`/`beginSleep`/`onTimer`/`clearSleep`/`clampSleepSeconds`/`MIN_SLEEP_SECONDS`/`MAX_SLEEP_SECONDS`/`MAX_SLEEP_MS`/`GoalStateDeps`，以及 `wake`/`scheduler` 依赖
- [x] 1.2 新增 `WaitState { source: string; since: number; inFlight: Set<string>; latched: boolean }` 与 `createGoalState()`（无参、无依赖）、`enterWait`/`endWaitCall`/`releaseWait`/`isWaiting`
- [x] 1.3 新增等待来源常量 `BLOCKING_WAIT_TOOLS`（`ask_user_question`/`bg_wait`/`acp_delegate_wait`）、`ASYNC_DISPATCH_TOOLS`（`subagent`/`acp_delegate`）、`ASK_BLOCKED_EVENT`（`rpiv:ask-user:blocked`），以及 `classifyToolCall(toolName, args)` 判定函数
- [x] 1.4 `onBoundary(state, outcome)` 去掉 `now` 参数：有活动目标 + `completed` + `isWaiting(state)` 时返回 `{ kind: "none" }`，否则 `{ kind: "continue", prompt }`；`startGoal`/`stopGoal`/`finishGoal`/`onShutdown` 释放等待态

## 2. 等待来源的观测接线（`src/index.ts`）

- [x] 2.1 删除 `goal_sleep` 工具注册、`SleepParams`、`sleepFailure`/`sleepScheduledNotice` 导入与 `systemScheduler` 依赖
- [x] 2.2 订阅 `pi.events.on(ASK_BLOCKED_EVENT, …)`：`active === true` → `enterWait(state, "ask_user_question", toolCallId)`；`active === false` → `endWaitCall`
- [x] 2.3 订阅 `tool_execution_start`（按 `classifyToolCall` 登记）与 `tool_execution_end`（按 `toolCallId` 注销）
- [x] 2.4 订阅 `agent_start` 与 `input` → `releaseWait(state)`；`/goal` 带参分支、`/goal-stop`、`goal_finish` 里调用 `releaseWait`

## 3. 提示词与通知文案（`src/prompts.ts`）

- [x] 3.1 `buildContinuationPrompt`：去掉 `goal_sleep`，加入 `ask_user_question` 与 `bg_wait`/原生唤醒的指引
- [x] 3.2 删除 `sleepScheduledNotice` 与 `sleepFailure`；`goalReplacedNotice` 的「延迟」改为「等待态」

## 4. 测试（`test/`）

- [x] 4.1 `test/goal-state.test.ts`：把 `goal_sleep scheduling` 与 `sleep suppression and timer wake-up` 两组改写为等待态测试（登记/注销在途、latch、释放、幂等），并删掉 fake timer 相关用例
- [x] 4.2 `test/index.test.ts`：fake pi 增加 `events`（on/emit）与事件 handler 映射；断言只注册 `goal_finish`；新增异步派发抑制、`subagent({action})` 不抑制、`bg_wait` 在途抑制、`agent_start`/`input` 释放、`/goal-stop` 清等待态等用例
- [x] 4.3 `test/prompts.test.ts`：把 `goal_sleep` 断言换成 `ask_user_question`/`bg_wait`，并断言提示词不含 `goal_sleep`

## 5. 文档

- [x] 5.1 `packages/pi-goal-loop/README.md`：命令/工具表删掉 `goal_sleep`，新增「等待感知」小节（来源、抑制、释放），设计要点改为「无定时器」
- [x] 5.2 `packages/pi-goal-loop/package.json`：版本升到 `0.1.2`（patch 号；工具消失的 breaking 影响在 README 明示）

## 6. 验证与收尾

- [x] 6.1 `pnpm --filter @philogag/pi-goal-loop typecheck && … test && … build` 全绿
- [x] 6.2 `openspec validate wait-aware-continuation --strict` 通过；写 `verify.md` 与 `retrospective.md`，归档 change 并删除 `openspec/specs/goal-deferral/`
