# Wait-Aware Continuation Implementation Plan

> **给 agentic worker 使用：** 按任务顺序执行，先写失败测试再改实现。

---
change: wait-aware-continuation
design-doc: openspec/changes/wait-aware-continuation/design.md
base-ref: e5d281d1f8d41d82cfb472e281e0aceee5190fda
---

**Goal:** 让 `pi-goal-loop` 在「异步派发后等待原生唤醒」与「阻塞类等待（问卷 / `bg_wait`）」期间不注入续跑提示，
并彻底删除 `goal_sleep` 与其定时器。

**Architecture:** `src/goal-state.ts` 用 `WaitState { source, since, inFlight, latched }` 取代 `SleepState`；
`src/index.ts` 从 `pi.events` 与 `tool_execution_*`/`agent_start`/`input` 观测等待，并把释放挂到目标生命周期出口；
`onBoundary` 只看「目标 active + completed + 无等待」。

**Tech Stack:** TypeScript + typebox + vitest（fake timers 不再需要）。

---

## Task 1: 等待态状态机（`src/goal-state.ts`）

**Files:** `packages/pi-goal-loop/src/goal-state.ts`, `packages/pi-goal-loop/test/goal-state.test.ts`

- [ ] **Step 1:** 写失败测试：`enterWait` 在无目标时也登记（等待态独立于目标），`isWaiting` 反映
      `inFlight.size > 0 || latched`；`endWaitCall` 注销在途但不释放 latch；`releaseWait` 幂等。
- [ ] **Step 2:** 运行 `pnpm --filter @philogag/pi-goal-loop test`，确认因导出缺失而失败。
- [ ] **Step 3:** 实现：

```ts
export const BLOCKING_WAIT_TOOLS = ["ask_user_question", "bg_wait", "acp_delegate_wait"] as const;
export const ASYNC_DISPATCH_TOOLS = ["subagent", "acp_delegate"] as const;
export const ASK_BLOCKED_EVENT = "rpiv:ask-user:blocked";

export interface WaitState {
  source: string;
  since: number;
  inFlight: Set<string>;
  latched: boolean;
}
export interface GoalState { goal: string | null; wait: WaitState | null }
```

- [ ] **Step 4:** `classifyToolCall(toolName, args): "blocking" | "dispatch" | null`——
      阻塞类命中工具名即 `"blocking"`；派发类要求 `args?.action === undefined && args?.async !== false`。
- [ ] **Step 5:** `onBoundary(state, outcome)`：目标为 null 或 `outcome !== "completed"` → `none`；
      `isWaiting(state)` → `none`；否则 `{ kind: "continue", prompt: buildContinuationPrompt(goal) }`。
- [ ] **Step 6:** 删除 `Scheduler`/`systemScheduler`/`TimerHandle`/`SleepState`/`beginSleep`/`onTimer`/
      `clearSleep`/`clampSleepSeconds`/`MIN_SLEEP_SECONDS`/`MAX_SLEEP_SECONDS`/`MAX_SLEEP_MS`/
      `GoalStateDeps`/`createGoalState(deps)`。
- [ ] **Step 7:** 跑 `test/goal-state.test.ts`（此时 sleep 组已被 Step 1 重写），转绿。

## Task 2: 事件接线（`src/index.ts`）

**Files:** `packages/pi-goal-loop/src/index.ts`, `packages/pi-goal-loop/test/index.test.ts`

- [ ] **Step 1:** fake pi 扩展：`events: { on(event, handler) { bus.set(...) ; return () => {} }, emit }`，
      并支持 `handlers` 映射里存放 `tool_execution_start` / `tool_execution_end` / `agent_start` / `input`。
- [ ] **Step 2:** 失败测试（`test/index.test.ts`）：

```ts
// 异步派发 → 本轮 settle 不续跑
handlers.get("tool_execution_start")!({ tool_execution_start: true, toolCallId: "s1", toolName: "subagent", args: { agent: "worker", task: "x" } }, ctx);
expect(handlers.get("agent_before_settle")!({ outcome: "completed" }, ctx)).toBeUndefined();
// 新一轮开始后恢复
handlers.get("agent_start")!({ type: "agent_start" }, ctx);
expect(handlers.get("agent_before_settle")!({ outcome: "completed" }, ctx)).toEqual(expect.objectContaining({ continue: true }));
```

- [ ] **Step 3:** 再加失败测试：`subagent({ action: "status" })` 不抑制；`bg_wait` 在途抑制、
      `tool_execution_end` 后恢复；`rpiv:ask-user:blocked` `active:true` 抑制、`active:false` 后恢复；
      `input` 释放；`/goal-stop` 清等待态；工具面只有 `["goal_finish"]`。
- [ ] **Step 4:** 实现订阅：

```ts
pi.events.on(ASK_BLOCKED_EVENT, (payload) => {
  const data = payload as { active?: boolean; toolCallId?: string } | undefined;
  if (data?.active === true) enterWait(state, "ask_user_question", data.toolCallId, Date.now());
  else endWaitCall(state, data?.toolCallId);
});
pi.on("tool_execution_start", (event) => { const kind = classifyToolCall(event.toolName, event.args); if (kind) enterWait(state, event.toolName, event.toolCallId, Date.now(), kind === "dispatch"); });
pi.on("tool_execution_end", (event) => endWaitCall(state, event.toolCallId));
pi.on("agent_start", () => releaseWait(state));
pi.on("input", () => releaseWait(state));
```

- [ ] **Step 5:** 删掉 `goal_sleep` 注册与 `SleepParams`；`/goal` 带参、`/goal-stop`、`goal_finish` 调 `releaseWait`。
- [ ] **Step 6:** 跑 `test/index.test.ts` 转绿。

## Task 3: 文案（`src/prompts.ts` + `README.md` + `package.json`）

- [ ] **Step 1:** 失败测试（`test/prompts.test.ts`）：提示词含 `ask_user_question`、`bg_wait`、`goal_finish`，
      不含 `goal_sleep`；`goalReplacedNotice` 含「等待态」。
- [ ] **Step 2:** 删除 `sleepScheduledNotice` / `sleepFailure`；改写 `buildContinuationPrompt`。
- [ ] **Step 3:** README：工具表只剩 `goal_finish`；新增「等待感知」小节；`package.json` 版本 `0.1.2`。

## Task 4: 验证

- [ ] **Step 1:** `pnpm --filter @philogag/pi-goal-loop typecheck`
- [ ] **Step 2:** `pnpm --filter @philogag/pi-goal-loop test`
- [ ] **Step 3:** `pnpm --filter @philogag/pi-goal-loop build`
- [ ] **Step 4:** `openspec validate wait-aware-continuation --strict`
- [ ] **Step 5:** 写 `verify.md` + `retrospective.md`，`openspec archive wait-aware-continuation --yes`，
      然后 `rm -rf openspec/specs/goal-deferral`（能力改名），最后单次提交（含归档，仓库习惯）。

---

## 实现期偏差记录

（实现过程中追加）
