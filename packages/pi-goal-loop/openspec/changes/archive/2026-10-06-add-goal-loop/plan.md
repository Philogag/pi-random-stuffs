# pi-goal-loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---
change: add-goal-loop
design-doc: openspec/changes/add-goal-loop/design.md
base-ref: f5158bb7e231d1ec796eb5bd1475f69372ff2e30
---

**Goal:** 新增 pi 扩展包 `pi-goal-loop`：用户用 `/goal` 声明活动目标，扩展在 `agent_before_settle` 上自动注入一轮续跑提示，直到 agent 调用 `goal_finish` 或用户执行 `/goal-stop`；agent 可用 `goal_sleep` 推迟续跑。

**Architecture:** 决策逻辑与 pi 接线彻底分离。`src/goal-state.ts` 是一个**纯状态机**（无 pi 依赖，定时器通过注入的 `Scheduler` 抽象），承载 D3–D8 的全部规则：`completed` 守卫、一次性抑制、恢复计数、定时器跳过注入、超时兜底、幂等清理。`src/index.ts` 只把 `onBoundary` 的返回值翻译成 `agent_before_settle` 的 `entries` / `continue`，并在定时器 `wake` 时用 `pi.sendMessage(..., { triggerTurn: true })` 开启新一轮。状态只存内存（D2）。

**Tech Stack:** TypeScript 5.6（`"type": "module"`）、`typebox`（工具参数 schema）、vitest 4（`vi.useFakeTimers()`）、peer 依赖 `@earendil-works/pi-coding-agent`。

**Spec:** `openspec/changes/add-goal-loop/specs/goal-lifecycle/spec.md`、`openspec/changes/add-goal-loop/specs/goal-deferral/spec.md`

## Global Constraints

- 包路径 `packages/pi-goal-loop/`；除**在根 `tsconfig.json` 的 `references` 中追加一行** `{ "path": "./packages/pi-goal-loop" }`（本仓「每包一个 tsconfig、根做 solution」的既有约定，根 `pnpm typecheck`/`tsc -b` 依赖它发现新包）以外，不修改仓库内任何既有文件。
- 包管理器是 **pnpm 11.1.0**（`pnpm-workspace.yaml` 的 `packages/*`），不要用 npm；`pnpm-lock.yaml` 由 `pnpm install` 自动更新。
- `package.json` 必须含 `"type": "module"` 与 `"pi": { "extensions": ["dist/index.js"] }`。
- `peerDependencies`: `@earendil-works/pi-coding-agent: ">=0.87.0"`, `typebox: "*"`；`devDependencies`: `typescript: "^5.6.3"`, `vitest: "^4.1.11"`, `@earendil-works/pi-coding-agent: "^0.87.1"`, `typebox: "^1.3.19"`。
- **扩展事件版本下限（实现期修正）**：`agent_before_settle` 自 **pi 0.87.0** 起提供；0.84.4 / 0.85.x / 0.86.x 均无 `BoundaryState` / `BoundaryResult`。因此 peer 下限收紧为 `>=0.87.0`，devDependency 取 `^0.87.1`（原先的 `^0.84.3` 无法通过 typecheck）。
- 常量：`MIN_SLEEP_SECONDS = 1`、`MAX_SLEEP_SECONDS = 900`、`DEFAULT_SLEEP_SECONDS = 60`、`MAX_SLEEP_MS = 900_000`。
- 续跑仅当 `state.goal !== null && outcome === "completed"`。
- 清除目标只能经 `goal_finish`（agent）与 `/goal-stop`（用户）。
- `customType` 统一使用字符串 `"goal-loop"`。
- 不得在扩展工厂内启动定时器/进程/socket；定时器只能由 `goal_sleep` 工具创建，并由 `session_shutdown` 幂等清理。
- **提示词表面**：`goal_finish` / `goal_sleep` 不得设置 `promptSnippet` 与 `promptGuidelines`（两者会写入默认系统提示词，破坏前缀缓存）；两个工具在工具工厂里**一开始就注册**（工具列表稳定），工具用法只由续跑提示词条目传达。
- 所有命令与工具在所有模式下都必须可用（不得依赖 TUI；只用 `ctx.ui.notify`，且用 `ctx.hasUI` 守卫）。

## Review Focus

1. **`seconds` 缺失或非数值**：`goal_sleep` 被调用但未给时长 → 必须被拒绝（不建立延迟状态），而不是退化成默认值或 NaN 定时器。
2. **`seconds` 为 0 / 负数 / 极大值**：期望截断到 `[1, 900]`，而不是 0ms 定时器（会立刻唤醒，等于没抑制）或数天定时器。
3. **过期的定时器回调**：延迟状态已被 `/goal-stop`、`/goal`、`goal_finish` 或 `session_shutdown` 清除后旧回调才触发 → 必须**无副作用**（不注入提示、不开启新一轮）。
4. **目标已被替换后又收到旧目标的续跑**：`/goal a` → 延迟 → `/goal b` → 旧定时器到点 → 必须不推进、也不得引用旧目标文本。
5. **内存态在 `/reload` 后**：扩展 runtime 重建后必须报告「无活动目标」，不得尝试从会话条目重建（本设计明确不持久化）。
6. **系统提示词表面**：`goal_finish` 与 `goal_sleep` 的注册定义不得带 `promptSnippet` / `promptGuidelines`——它们会改变默认系统提示词的 `Available tools` / `Guidelines` 区段，破坏 prompt 前缀缓存；工具用法只能靠续跑提示词传达。

---

## Task 1: 包骨架与工程配置

**Files:**
- Create: `packages/pi-goal-loop/package.json`
- Create: `packages/pi-goal-loop/tsconfig.json`
- Create: `packages/pi-goal-loop/src/index.ts`
- Create: `packages/pi-goal-loop/.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: 一个可被 `tsc -b` 与 `vitest` 处理的 workspace 包；`src/index.ts` 导出默认扩展工厂 `export default function goalLoop(pi: ExtensionAPI): void`

- [x] **Step 1: 写 `package.json`**

```json
{
  "name": "@philogag/pi-goal-loop",
  "version": "0.1.0",
  "description": "pi extension: run a user-declared goal across turns until the agent or the user ends it",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "pi": {
    "extensions": ["dist/index.js"]
  },
  "files": ["dist"],
  "keywords": ["pi", "extension", "goal", "loop", "autonomous"],
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "lint": "echo \"no linter configured\""
  },
  "dependencies": {},
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.84.3",
    "typebox": "^1.3.19",
    "typescript": "^5.6.3",
    "vitest": "^4.1.11"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/Philogag/pi-random-stuffs"
  }
}
```

- [x] **Step 2: 写 `tsconfig.json`（并登记到根 solution）**

`packages/pi-goal-loop/tsconfig.json` 与既有包（`packages/pi-tool-presistant-bash/tsconfig.json`）逐字同构，编译选项全部继承 `tsconfig.base.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

再在根 `tsconfig.json` 的 `references` 末尾追加新条目（这是本变更唯一改动的既有文件）：

```json
    { "path": "./packages/pi-goal-loop" }
```

注意 `tsconfig.base.json` 的关键约束：`verbatimModuleSyntax: true`（类型导入必须写 `import type`）、`noUncheckedIndexedAccess: true`（下标访问带 `undefined`）、`module/moduleResolution: NodeNext`（相对导入需 `.js` 后缀）、`composite: true`。

- [x] **Step 3: 写最小工厂 `src/index.ts`**

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function goalLoop(_pi: ExtensionAPI): void {
  // wiring is added in Tasks 7 and 8
}
```

- [x] **Step 4: 写 `.gitignore`**

```
dist/
node_modules/
```

- [x] **Step 5: 安装依赖并验证类型检查通过**

```bash
cd /home/philogag/workspace/pi-exts/pi-random-stuffs
pnpm install
pnpm --filter @philogag/pi-goal-loop typecheck
# 验证根 solution 已能发现新包
pnpm typecheck
```

Expected: 无输出、退出码 0。包管理器是 **pnpm 11.1.0**（工作区声明在 `pnpm-workspace.yaml`），不要用 npm。若新包未被识别，检查 `pnpm-workspace.yaml` 的 `packages/*` glob。

- [x] **Step 6: Commit**

```bash
git add packages/pi-goal-loop/package.json packages/pi-goal-loop/tsconfig.json packages/pi-goal-loop/.gitignore packages/pi-goal-loop/src/index.ts tsconfig.json
git commit -m "chore(pi-goal-loop): scaffold package"
```

---

## Task 2: 状态机类型、常量与目标生命周期

**Files:**
- Create: `packages/pi-goal-loop/src/goal-state.ts`
- Test: `packages/pi-goal-loop/test/goal-state.test.ts`

**Interfaces:**
- Consumes: 无（纯模块，不得 import pi 的任何东西）
- Produces:
  - `MIN_SLEEP_SECONDS = 1`、`MAX_SLEEP_SECONDS = 900`、`DEFAULT_SLEEP_SECONDS = 60`、`MAX_SLEEP_MS = 900_000`
  - `interface TimerHandle { readonly id: unknown }`
  - `interface Scheduler { schedule(delayMs: number, cb: () => void): TimerHandle; cancel(handle: TimerHandle): void }`
  - `const systemScheduler: Scheduler`（基于 `setTimeout` / `clearTimeout`）
  - `interface SleepState { startedAt: number; until: number; seconds: number; timer: TimerHandle | null; suppressNextSettle: boolean; settlesDuringSleep: number }`
  - `interface GoalStateDeps { scheduler: Scheduler; wake: () => void }`
  - `interface GoalState { goal: string | null; sleep: SleepState | null; readonly deps: GoalStateDeps }`
  - `type BoundaryOutcome = "completed" | "aborted" | "error"`
  - `type BoundaryAction = { kind: "none" } | { kind: "continue"; prompt: string }`
  - `createGoalState(deps: GoalStateDeps): GoalState`
  - `startGoal(state: GoalState, text: string): void`
  - `stopGoal(state: GoalState): void` / `finishGoal(state: GoalState): void`
  - `getGoal(state: GoalState): string | null`

- [x] **Step 1: 写失败的测试 `test/goal-state.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  createGoalState,
  finishGoal,
  getGoal,
  startGoal,
  stopGoal,
  systemScheduler,
  type GoalStateDeps,
} from "../src/goal-state.js";

function makeState(wake: () => void = () => {}): {
  state: ReturnType<typeof createGoalState>;
  wake: ReturnType<typeof vi.fn>;
} {
  const wakeSpy = vi.fn(wake);
  const deps: GoalStateDeps = { scheduler: systemScheduler, wake: wakeSpy };
  return { state: createGoalState(deps), wake: wakeSpy };
}

describe("goal lifecycle", () => {
  it("starts with no goal", () => {
    const { state } = makeState();
    expect(getGoal(state)).toBeNull();
    expect(state.sleep).toBeNull();
  });

  it("startGoal registers the goal text", () => {
    const { state } = makeState();
    startGoal(state, "重构 X 模块");
    expect(getGoal(state)).toBe("重构 X 模块");
  });

  it("startGoal replaces an existing goal", () => {
    const { state } = makeState();
    startGoal(state, "旧目标");
    startGoal(state, "新目标");
    expect(getGoal(state)).toBe("新目标");
  });

  it("stopGoal clears the goal", () => {
    const { state } = makeState();
    startGoal(state, "某个目标");
    stopGoal(state);
    expect(getGoal(state)).toBeNull();
  });

  it("finishGoal clears the goal", () => {
    const { state } = makeState();
    startGoal(state, "某个目标");
    finishGoal(state);
    expect(getGoal(state)).toBeNull();
  });

  it("stopGoal and finishGoal are idempotent without a goal", () => {
    const { state } = makeState();
    expect(() => {
      stopGoal(state);
      finishGoal(state);
    }).not.toThrow();
  });
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state
```

Expected: FAIL，报错形如 `Failed to resolve import "../src/goal-state.js"`。

- [x] **Step 3: 写 `src/goal-state.ts` 的类型、常量与生命周期函数**

```typescript
export const MIN_SLEEP_SECONDS = 1;
export const MAX_SLEEP_SECONDS = 900;
export const DEFAULT_SLEEP_SECONDS = 60;
export const MAX_SLEEP_MS = MAX_SLEEP_SECONDS * 1000;

export interface TimerHandle {
  readonly id: unknown;
}

export interface Scheduler {
  schedule(delayMs: number, cb: () => void): TimerHandle;
  cancel(handle: TimerHandle): void;
}

export const systemScheduler: Scheduler = {
  schedule(delayMs, cb) {
    return { id: setTimeout(cb, delayMs) };
  },
  cancel(handle) {
    clearTimeout(handle.id as ReturnType<typeof setTimeout>);
  },
};

export interface SleepState {
  startedAt: number;
  until: number;
  seconds: number;
  timer: TimerHandle | null;
  suppressNextSettle: boolean;
  settlesDuringSleep: number;
}

export interface GoalStateDeps {
  scheduler: Scheduler;
  /** Called when the sleep timer decides the loop should be woken. */
  wake: () => void;
}

export interface GoalState {
  goal: string | null;
  sleep: SleepState | null;
  readonly deps: GoalStateDeps;
}

export type BoundaryOutcome = "completed" | "aborted" | "error";

export type BoundaryAction = { kind: "none" } | { kind: "continue"; prompt: string };

export function createGoalState(deps: GoalStateDeps): GoalState {
  return { goal: null, sleep: null, deps };
}

export function getGoal(state: GoalState): string | null {
  return state.goal;
}

export function startGoal(state: GoalState, text: string): void {
  clearSleep(state);
  state.goal = text;
}

export function clearGoal(state: GoalState): void {
  clearSleep(state);
  state.goal = null;
}

export function stopGoal(state: GoalState): void {
  clearGoal(state);
}

export function finishGoal(state: GoalState): void {
  clearGoal(state);
}

export function clearSleep(state: GoalState): void {
  const sleep = state.sleep;
  if (sleep === null) return;
  state.sleep = null;
  if (sleep.timer !== null) state.deps.scheduler.cancel(sleep.timer);
}
```

- [x] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state
```

Expected: PASS（6 个用例）。`clearSleep` 已在本步实现，Task 3 与 Task 5 会补它自己的测试。

- [x] **Step 5: Commit**

```bash
git add packages/pi-goal-loop/src/goal-state.ts packages/pi-goal-loop/test/goal-state.test.ts
git commit -m "feat(pi-goal-loop): goal state machine lifecycle"
```

---

## Task 3: 建立延迟状态与时长边界

**Files:**
- Modify: `packages/pi-goal-loop/src/goal-state.ts`
- Test: `packages/pi-goal-loop/test/goal-state.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `GoalState`、`SleepState`、`Scheduler`、`TimerHandle`、`clearSleep`、`MAX_SLEEP_MS`
- Produces:
  - `function clampSleepSeconds(seconds: number): number`
  - `function beginSleep(state: GoalState, seconds: number, now: number): SleepState | null`
    （无活动目标时返回 `null`，且**不**建立延迟状态；否则返回新建的 `SleepState`）
  - `function onTimer(state: GoalState, sleep: SleepState): "wake" | "none"`（本任务只实现过期校验与清除，返回 `"none"` 恒成立；Task 5 补齐判定）
  - `function onShutdown(state: GoalState): void`

- [x] **Step 1: 追加失败的测试**

```typescript
import {
  MAX_SLEEP_MS,
  beginSleep,
  clampSleepSeconds,
  onShutdown,
  onTimer,
} from "../src/goal-state.js";

describe("goal_sleep scheduling", () => {
  it("clamps out-of-range durations", () => {
    expect(clampSleepSeconds(0)).toBe(1);
    expect(clampSleepSeconds(-5)).toBe(1);
    expect(clampSleepSeconds(1)).toBe(1);
    expect(clampSleepSeconds(60)).toBe(60);
    expect(clampSleepSeconds(900)).toBe(900);
    expect(clampSleepSeconds(100000)).toBe(900);
    expect(clampSleepSeconds(Number.NaN)).toBe(1);
  });

  it("refuses to sleep without an active goal", () => {
    const { state } = makeState();
    expect(beginSleep(state, 60, 1_000)).toBeNull();
    expect(state.sleep).toBeNull();
  });

  it("registers a sleep state with the requested delay", () => {
    const { state } = makeState();
    startGoal(state, "目标 A");
    const sleep = beginSleep(state, 60, 1_000);
    expect(sleep).not.toBeNull();
    expect(state.sleep).toBe(sleep);
    expect(sleep?.startedAt).toBe(1_000);
    expect(sleep?.until).toBe(1_000 + 60_000);
    expect(sleep?.seconds).toBe(60);
    expect(sleep?.suppressNextSettle).toBe(true);
    expect(sleep?.settlesDuringSleep).toBe(0);
  });

  it("cancels the previous timer when sleeping again", () => {
    const cancel = vi.fn();
    const state = createGoalState({
      scheduler: { schedule: () => ({ id: 1 }), cancel },
      wake: () => {},
    });
    startGoal(state, "目标 A");
    const first = beginSleep(state, 60, 1_000);
    beginSleep(state, 30, 2_000);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(first?.timer);
  });

  it("clears sleep when the goal is replaced or ended", () => {
    const cancel = vi.fn();
    const state = createGoalState({
      scheduler: { schedule: () => ({ id: 1 }), cancel },
      wake: () => {},
    });
    startGoal(state, "目标 A");
    beginSleep(state, 60, 1_000);
    startGoal(state, "目标 B");
    expect(state.sleep).toBeNull();
    beginSleep(state, 60, 2_000);
    stopGoal(state);
    expect(state.sleep).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale timer callback", () => {
    const { state } = makeState();
    startGoal(state, "目标 A");
    const stale = beginSleep(state, 60, 1_000);
    clearSleep(state);
    expect(stale).not.toBeNull();
    expect(onTimer(state, stale!)).toBe("none");
  });

  it("onShutdown is idempotent and cancels the timer", () => {
    const cancel = vi.fn();
    const state = createGoalState({
      scheduler: { schedule: () => ({ id: 1 }), cancel },
      wake: () => {},
    });
    startGoal(state, "目标 A");
    beginSleep(state, 60, 1_000);
    onShutdown(state);
    expect(state.sleep).toBeNull();
    expect(() => onShutdown(state)).not.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
```

同时把 Task 2 的 import 列表补上 `clearSleep`、`startGoal`、`stopGoal`。

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state
```

Expected: FAIL，`beginSleep is not a function` 类似的 `TypeError`。

- [x] **Step 3: 实现 `clampSleepSeconds`、`beginSleep`、`onTimer`、`onShutdown`**

追加到 `src/goal-state.ts`：

```typescript
export function clampSleepSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_SLEEP_SECONDS;
  return Math.min(MAX_SLEEP_SECONDS, Math.max(MIN_SLEEP_SECONDS, Math.floor(seconds)));
}

export function beginSleep(state: GoalState, seconds: number, now: number): SleepState | null {
  if (state.goal === null) return null;
  clearSleep(state);

  const clamped = clampSleepSeconds(seconds);
  const delayMs = clamped * 1000;
  const sleep: SleepState = {
    startedAt: now,
    until: now + delayMs,
    seconds: clamped,
    timer: null,
    suppressNextSettle: true,
    settlesDuringSleep: 0,
  };

  sleep.timer = state.deps.scheduler.schedule(delayMs, () => {
    if (onTimer(state, sleep) === "wake") state.deps.wake();
  });

  state.sleep = sleep;
  return sleep;
}

export function onTimer(state: GoalState, sleep: SleepState): "wake" | "none" {
  if (state.sleep !== sleep) return "none";
  clearSleep(state);
  return "none";
}

export function onShutdown(state: GoalState): void {
  clearSleep(state);
}
```

- [x] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state
```

Expected: PASS。注意 `clampSleepSeconds(Number.NaN)` 必须返回 `1`——`Number.isFinite` 守卫就是为此存在。

- [x] **Step 5: Commit**

```bash
git add packages/pi-goal-loop/src/goal-state.ts packages/pi-goal-loop/test/goal-state.test.ts
git commit -m "feat(pi-goal-loop): sleep scheduling with duration clamp"
```

---

## Task 4: 边界守卫（`onBoundary`）

**Files:**
- Modify: `packages/pi-goal-loop/src/goal-state.ts`
- Create: `packages/pi-goal-loop/src/prompts.ts`（本任务先放一个可用的 `buildContinuationPrompt`，Task 6 完善文案）
- Test: `packages/pi-goal-loop/test/goal-state.test.ts`

**Interfaces:**
- Consumes: Task 2/3 的 `GoalState`、`SleepState`、`clearSleep`、`MAX_SLEEP_MS`
- Produces:
  - `function onBoundary(state: GoalState, outcome: BoundaryOutcome, now: number): BoundaryAction`
  - `function buildContinuationPrompt(goal: string): string`（`src/prompts.ts` 导出）

- [x] **Step 1: 写 `src/prompts.ts` 的续跑提示词**

```typescript
export function buildContinuationPrompt(goal: string): string {
  return [
    "[goal-loop] 活动目标仍在进行中：",
    goal,
    "",
    "请继续推进该目标。",
    "- 目标已完全达成时，调用 goal_finish 结束目标。",
    "- 需要等待异步任务（例如 subagent）时，调用 goal_sleep({ seconds }) 推迟下一次自动续跑。",
    "- 用户可用 /goal-stop 随时结束目标。",
  ].join("\n");
}
```

- [x] **Step 2: 追加失败的测试**

```typescript
import { onBoundary } from "../src/goal-state.js";
import { buildContinuationPrompt } from "../src/prompts.js";

describe("onBoundary guard", () => {
  it("does nothing without an active goal", () => {
    const { state } = makeState();
    expect(onBoundary(state, "completed", 1_000)).toEqual({ kind: "none" });
  });

  it("continues on a completed turn when a goal is active", () => {
    const { state } = makeState();
    startGoal(state, "重构 X 模块");
    expect(onBoundary(state, "completed", 1_000)).toEqual({
      kind: "continue",
      prompt: buildContinuationPrompt("重构 X 模块"),
    });
  });

  it("pauses on aborted and keeps the goal", () => {
    const { state } = makeState();
    startGoal(state, "重构 X 模块");
    expect(onBoundary(state, "aborted", 1_000)).toEqual({ kind: "none" });
    expect(getGoal(state)).toBe("重构 X 模块");
  });

  it("pauses on error and keeps the goal", () => {
    const { state } = makeState();
    startGoal(state, "重构 X 模块");
    expect(onBoundary(state, "error", 1_000)).toEqual({ kind: "none" });
    expect(getGoal(state)).toBe("重构 X 模块");
  });

  it("resumes continuing after the pause", () => {
    const { state } = makeState();
    startGoal(state, "重构 X 模块");
    expect(onBoundary(state, "aborted", 1_000).kind).toBe("none");
    expect(onBoundary(state, "completed", 2_000).kind).toBe("continue");
  });

  it("does not clear the goal on aborted or error", () => {
    const { state } = makeState();
    startGoal(state, "重构 X 模块");
    onBoundary(state, "aborted", 1_000);
    onBoundary(state, "error", 2_000);
    expect(getGoal(state)).toBe("重构 X 模块");
  });
});
```

- [x] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state
```

Expected: FAIL，`onBoundary is not a function`。

- [x] **Step 4: 实现 `onBoundary`（本任务先不含延迟分支）**

追加到 `src/goal-state.ts`（并把 `import { buildContinuationPrompt } from "./prompts.js";` 放到文件顶部）：

```typescript
export function onBoundary(state: GoalState, outcome: BoundaryOutcome, now: number): BoundaryAction {
  const goal = state.goal;
  if (goal === null) return { kind: "none" };
  if (outcome !== "completed") return { kind: "none" };

  const sleep = state.sleep;
  if (sleep !== null && now - sleep.startedAt > MAX_SLEEP_MS) {
    clearSleep(state);
    return { kind: "continue", prompt: buildContinuationPrompt(goal) };
  }
  if (sleep !== null) return { kind: "none" };

  return { kind: "continue", prompt: buildContinuationPrompt(goal) };
}
```

- [x] **Step 5: 运行测试确认通过**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state
```

Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add packages/pi-goal-loop/src/goal-state.ts packages/pi-goal-loop/src/prompts.ts packages/pi-goal-loop/test/goal-state.test.ts
git commit -m "feat(pi-goal-loop): continuation guard on boundary"
```

---

## Task 5: 一次性抑制、恢复计数与定时器跳过注入

**Files:**
- Modify: `packages/pi-goal-loop/src/goal-state.ts`
- Test: `packages/pi-goal-loop/test/goal-state.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `onBoundary`、Task 3 的 `beginSleep` / `onTimer`
- Produces: `onBoundary` 的延迟分支（消费 `suppressNextSettle` 或累加 `settlesDuringSleep`）；`onTimer` 的 `"wake"` 判定

- [x] **Step 1: 追加失败的测试**

```typescript
import { onBoundary, onTimer } from "../src/goal-state.js";

describe("sleep suppression and timer wake-up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses exactly the first completed settle", () => {
    const { state, wake } = makeState();
    startGoal(state, "目标 A");
    const sleep = beginSleep(state, 60, 1_000)!;

    expect(onBoundary(state, "completed", 1_100)).toEqual({ kind: "none" });
    expect(sleep.suppressNextSettle).toBe(false);
    expect(sleep.settlesDuringSleep).toBe(0);

    expect(onBoundary(state, "completed", 1_200)).toEqual({ kind: "none" });
    expect(sleep.settlesDuringSleep).toBe(1);
    expect(wake).not.toHaveBeenCalled();
  });

  it("does not count non-completed outcomes during sleep", () => {
    const { state } = makeState();
    startGoal(state, "目标 A");
    const sleep = beginSleep(state, 60, 1_000)!;
    onBoundary(state, "aborted", 1_100);
    expect(sleep.suppressNextSettle).toBe(true);
    expect(sleep.settlesDuringSleep).toBe(0);
  });

  it("wakes at the timer when nothing resumed the loop", () => {
    const { state, wake } = makeState();
    startGoal(state, "目标 A");
    beginSleep(state, 60, 1_000);
    onBoundary(state, "completed", 1_100);

    vi.advanceTimersByTime(60_000);

    expect(wake).toHaveBeenCalledTimes(1);
    expect(state.sleep).toBeNull();
  });

  it("skips the wake-up when the loop was already resumed", () => {
    const { state, wake } = makeState();
    startGoal(state, "目标 A");
    beginSleep(state, 60, 1_000);
    onBoundary(state, "completed", 1_100);  // consumes the suppression
    onBoundary(state, "completed", 20_000); // subagent wake-up already resumed the loop

    vi.advanceTimersByTime(60_000);

    expect(wake).not.toHaveBeenCalled();
    expect(state.sleep).toBeNull();
  });

  it("does not wake when the goal ended before the timer fired", () => {
    const { state, wake } = makeState();
    startGoal(state, "目标 A");
    beginSleep(state, 60, 1_000);
    stopGoal(state);

    vi.advanceTimersByTime(60_000);

    expect(wake).not.toHaveBeenCalled();
  });

  it("clears sleep and continues once the sleep has outlived MAX_SLEEP_MS", () => {
    const { state } = makeState();
    startGoal(state, "目标 A");
    const sleep = beginSleep(state, 60, 1_000);
    expect(sleep).not.toBeNull();

    const late = 1_000 + MAX_SLEEP_MS + 1;
    expect(onBoundary(state, "completed", late).kind).toBe("continue");
    expect(state.sleep).toBeNull();
  });

  it("onTimer returns none for a stale reference", () => {
    const { state } = makeState();
    startGoal(state, "目标 A");
    const first = beginSleep(state, 60, 1_000)!;
    const second = beginSleep(state, 60, 2_000)!;
    expect(second).not.toBe(first);
    expect(onTimer(state, first)).toBe("none");
  });
});
```

同时补上 vitest 的 import：`import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";`

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state
```

Expected: FAIL —— `suppresses exactly the first completed settle` 报 `settlesDuringSleep` 仍为 0（因为当前 `onBoundary` 遇到 `sleep !== null` 直接返回 `none`，从不计数），且 `wakes at the timer` 报 `wake` 未被调用。

- [x] **Step 3: 实现延迟分支**

把 `src/goal-state.ts` 中 `onBoundary` 的 `if (sleep !== null) return { kind: "none" };` 替换为：

```typescript
  if (sleep !== null) {
    if (sleep.suppressNextSettle) {
      sleep.suppressNextSettle = false;
      return { kind: "none" };
    }
    sleep.settlesDuringSleep += 1;
    return { kind: "none" };
  }
```

把 `onTimer` 的 `clearSleep(state); return "none";` 替换为：

```typescript
  const shouldWake = state.goal !== null && sleep.settlesDuringSleep === 0;
  clearSleep(state);
  return shouldWake ? "wake" : "none";
```

- [x] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state
```

Expected: PASS（全部用例）。

- [x] **Step 5: 单独验证跳过注入的判定**

```bash
pnpm --filter @philogag/pi-goal-loop test -- goal-state -t "skips the wake-up"
```

Expected: PASS，1 个用例。

- [x] **Step 6: Commit**

```bash
git add packages/pi-goal-loop/src/goal-state.ts packages/pi-goal-loop/test/goal-state.test.ts
git commit -m "feat(pi-goal-loop): sleep suppression, resume counting, wake-up dedupe"
```

---

## Task 6: 文案与命令/工具结果（`src/prompts.ts`）

**Files:**
- Modify: `packages/pi-goal-loop/src/prompts.ts`
- Test: `packages/pi-goal-loop/test/prompts.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `buildContinuationPrompt(goal: string): string`
  - `goalStartedNotice(goal: string): string`
  - `goalReplacedNotice(goal: string): string`
  - `goalStatusNotice(goal: string): string`
  - `noGoalNotice(): string`
  - `goalStoppedNotice(): string`
  - `finishSuccess(): string` / `finishFailure(): string`
  - `sleepScheduledNotice(seconds: number, resumeAtIso: string): string`
  - `sleepFailure(): string`
  - `GOAL_LOOP_CUSTOM_TYPE = "goal-loop"`

- [x] **Step 1: 写失败的测试 `test/prompts.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import {
  GOAL_LOOP_CUSTOM_TYPE,
  buildContinuationPrompt,
  finishFailure,
  finishSuccess,
  goalReplacedNotice,
  goalStartedNotice,
  goalStatusNotice,
  goalStoppedNotice,
  noGoalNotice,
  sleepFailure,
  sleepScheduledNotice,
} from "../src/prompts.js";

describe("prompts", () => {
  it("uses the shared custom type", () => {
    expect(GOAL_LOOP_CUSTOM_TYPE).toBe("goal-loop");
  });

  it("continuation prompt carries the goal and all three exits", () => {
    const text = buildContinuationPrompt("重构 X 模块");
    expect(text).toContain("重构 X 模块");
    expect(text).toContain("goal_finish");
    expect(text).toContain("goal_sleep");
    expect(text).toContain("/goal-stop");
  });

  it("started notice mentions the in-memory limitation and /goal-stop", () => {
    const text = goalStartedNotice("重构 X 模块");
    expect(text).toContain("重构 X 模块");
    expect(text).toContain("/goal-stop");
    expect(text).toContain("内存");
  });

  it("replaced notice names the new goal", () => {
    expect(goalReplacedNotice("新目标")).toContain("新目标");
    expect(goalReplacedNotice("新目标")).toContain("替换");
  });

  it("status notice shows the goal and the in-memory limitation", () => {
    const text = goalStatusNotice("重构 X 模块");
    expect(text).toContain("重构 X 模块");
    expect(text).toContain("内存");
  });

  it("no-goal notices exist for command, tool and sleep paths", () => {
    expect(noGoalNotice()).toContain("没有活动目标");
    expect(goalStoppedNotice()).toContain("已停止");
    expect(finishSuccess()).toContain("goal_finish");
    expect(finishFailure()).toContain("没有活动目标");
    expect(sleepFailure()).toContain("没有活动目标");
  });

  it("sleep notice reports the clamped duration and resume time", () => {
    const text = sleepScheduledNotice(900, "2026-01-01T00:15:00.000Z");
    expect(text).toContain("900");
    expect(text).toContain("2026-01-01T00:15:00.000Z");
  });
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @philogag/pi-goal-loop test -- prompts
```

Expected: FAIL，未导出的函数为 `undefined`。

- [x] **Step 3: 实作文案**

```typescript
export const GOAL_LOOP_CUSTOM_TYPE = "goal-loop";

export function buildContinuationPrompt(goal: string): string {
  return [
    "[goal-loop] 活动目标仍在进行中：",
    goal,
    "",
    "请继续推进该目标。",
    "- 目标已完全达成时，调用 goal_finish 结束目标。",
    "- 需要等待异步任务（例如 subagent）时，调用 goal_sleep({ seconds }) 推迟下一次自动续跑。",
    "- 用户可用 /goal-stop 随时结束目标。",
  ].join("\n");
}

export function goalStartedNotice(goal: string): string {
  return [
    `已设置活动目标：${goal}`,
    "pi 会在每轮结束时自动续跑，直到 agent 调用 goal_finish 或你执行 /goal-stop。",
    "注意：活动目标仅存于内存，/reload 或重启 pi 后会丢失。",
  ].join("\n");
}

export function goalReplacedNotice(goal: string): string {
  return `活动目标已被替换为：${goal}（旧目标与任何进行中的延迟已清除）`;
}

export function goalStatusNotice(goal: string): string {
  return `当前活动目标：${goal}\n（仅存于内存，/reload 或重启后会丢失；用 /goal-stop 结束）`;
}

export function noGoalNotice(): string {
  return "当前没有活动目标。用 /goal <目标描述> 发起一个。";
}

export function goalStoppedNotice(): string {
  return "已停止活动目标，不再自动续跑。";
}

export function finishSuccess(): string {
  return "目标已结束（goal_finish），不再自动续跑。";
}

export function finishFailure(): string {
  return "当前没有活动目标，goal_finish 无效。";
}

export function sleepScheduledNotice(seconds: number, resumeAtIso: string): string {
  return `已推迟下一次自动续跑 ${seconds} 秒（预计 ${resumeAtIso} 恢复）；本次 settle 不会被推进。`;
}

export function sleepFailure(): string {
  return "当前没有活动目标，goal_sleep 无效。";
}
```

- [x] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @philogag/pi-goal-loop test
```

Expected: PASS（`goal-state` 与 `prompts` 两个文件全部通过）。

- [x] **Step 5: Commit**

```bash
git add packages/pi-goal-loop/src/prompts.ts packages/pi-goal-loop/test/prompts.test.ts
git commit -m "feat(pi-goal-loop): user-facing copy and notices"
```

---

## Task 7: pi 接线 —— 命令与工具

**Files:**
- Modify: `packages/pi-goal-loop/src/index.ts`
- Test: `packages/pi-goal-loop/test/index.test.ts`

**Interfaces:**
- Consumes: Task 2–6 的全部导出
- Produces: 工厂内注册 `goal`、`goal-stop` 命令与 `goal_finish`、`goal_sleep` 工具；导出 `export function createRegistrationCapture(): { pi: ExtensionAPI; commands: Map<string, RegisteredCmd>; tools: Map<string, RegisteredTool> }` 作为测试替身（生产代码不使用它）

- [x] **Step 1: 写失败的测试 `test/index.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";
import goalLoop from "../src/index.js";

type AnyArgs = any[];

function makeFakePi() {
  const commands = new Map<string, { handler: (args: string, ctx: AnyArgs) => Promise<void> }>();
  const tools = new Map<string, { execute: (...a: AnyArgs) => Promise<AnyArgs>; promptSnippet?: string; promptGuidelines?: string[] }>();
  const handlers = new Map<string, (event: AnyArgs, ctx: AnyArgs) => AnyArgs>();
  const sent: AnyArgs[] = [];

  const pi = {
    registerCommand: (name: string, options: AnyArgs) => commands.set(name, options),
    registerTool: (tool: AnyArgs) => tools.set(tool.name, tool),
    on: (event: string, handler: AnyArgs) => {
      handlers.set(event, handler);
      return () => {};
    },
    sendMessage: (...args: AnyArgs) => sent.push(args),
    appendEntry: vi.fn(),
  };

  return { pi: pi as never, commands, tools, handlers, sent };
}

function makeCtx() {
  const notify = vi.fn();
  return { ctx: { hasUI: true, ui: { notify } } as never, notify };
}

describe("pi-goal-loop wiring", () => {
  it("registers the two commands and two tools", () => {
    const { pi, commands, tools } = makeFakePi();
    goalLoop(pi);
    expect([...commands.keys()].sort()).toEqual(["goal", "goal-stop"]);
    expect([...tools.keys()].sort()).toEqual(["goal_finish", "goal_sleep"]);
  });

  it("registers the boundary and shutdown handlers", () => {
    const { pi, handlers } = makeFakePi();
    goalLoop(pi);
    expect(handlers.has("agent_before_settle")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
  });

  it("registers the tools without system-prompt guidance", () => {
    const { pi, tools } = makeFakePi();
    goalLoop(pi);
    for (const tool of tools.values()) {
      expect(tool.promptSnippet).toBeUndefined();
      expect(tool.promptGuidelines).toBeUndefined();
    }
  });

  it("does not persist goal state to session entries", async () => {
    const { pi, commands, appendEntry } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("continues at the boundary while a goal is active", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    const result = handlers.get("agent_before_settle")!(
      { type: "agent_before_settle", outcome: "completed" },
      ctx,
    );

    expect(result).toEqual({
      entries: [
        expect.objectContaining({
          type: "custom_message",
          customType: "goal-loop",
          display: true,
        }),
      ],
      continue: true,
    });
  });

  it("stops continuing after goal_finish", async () => {
    const { pi, commands, tools, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await tools.get("goal_finish")!.execute("id", {}, undefined, undefined, ctx);

    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx),
    ).toBeUndefined();
  });

  it("stops continuing after /goal-stop", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await commands.get("goal-stop")!.handler("", ctx);

    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx),
    ).toBeUndefined();
  });

  it("pauses (without clearing the goal) on aborted", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "aborted" }, ctx),
    ).toBeUndefined();
    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx),
    ).toEqual(expect.objectContaining({ continue: true }));
  });

  it("fails goal_finish and goal_sleep without an active goal", async () => {
    const { pi, tools } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await expect(tools.get("goal_finish")!.execute("id", {}, undefined, undefined, ctx)).rejects.toThrow();
    await expect(
      tools.get("goal_sleep")!.execute("id", { seconds: 60 }, undefined, undefined, ctx),
    ).rejects.toThrow();
  });

  it("goal_sleep defers the boundary and reports the clamped duration", async () => {
    const { pi, commands, tools, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    const result = await tools.get("goal_sleep")!.execute("id", { seconds: 99999 }, undefined, undefined, ctx);

    expect(JSON.stringify(result)).toContain("900");
    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx),
    ).toBeUndefined();
  });
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @philogag/pi-goal-loop test -- index
```

Expected: FAIL，`expected [] to deeply equal [ 'goal', 'goal-stop' ]`。

- [x] **Step 3: 实现命令与工具接线**

把 `src/index.ts` 重写为（本任务只加命令与工具，事件在 Task 8 接）：

```typescript
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  beginSleep,
  createGoalState,
  finishGoal,
  getGoal,
  onShutdown,
  startGoal,
  stopGoal,
  systemScheduler,
  type GoalState,
} from "./goal-state.js";
import {
  GOAL_LOOP_CUSTOM_TYPE,
  buildContinuationPrompt,
  finishFailure,
  finishSuccess,
  goalReplacedNotice,
  goalStartedNotice,
  goalStatusNotice,
  goalStoppedNotice,
  noGoalNotice,
  sleepFailure,
  sleepScheduledNotice,
} from "./prompts.js";

const SleepParams = Type.Object({
  seconds: Type.Number({
    description: "How long to defer the next automatic goal continuation, in seconds (1-900).",
  }),
});

function notify(ctx: ExtensionCommandContext | ExtensionContext, message: string): void {
  if (ctx.hasUI) ctx.ui.notify(message, "info");
}

export default function goalLoop(pi: ExtensionAPI): void {
  let state: GoalState;
  state = createGoalState({
    scheduler: systemScheduler,
    wake: () => {
      const goal = getGoal(state);
      if (goal === null) return;
      pi.sendMessage(
        { customType: GOAL_LOOP_CUSTOM_TYPE, content: buildContinuationPrompt(goal), display: true },
        { triggerTurn: true },
      );
    },
  });

  pi.registerCommand("goal", {
    description: "Declare an active goal; pi keeps auto-continuing until goal_finish or /goal-stop",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (text.length === 0) {
        const goal = getGoal(state);
        notify(ctx, goal === null ? noGoalNotice() : goalStatusNotice(goal));
        return;
      }
      const previous = getGoal(state);
      startGoal(state, text);
      notify(ctx, previous === null ? goalStartedNotice(text) : goalReplacedNotice(text));
    },
  });

  pi.registerCommand("goal-stop", {
    description: "End the active goal and stop auto-continuing",
    handler: async (_args, ctx) => {
      if (getGoal(state) === null) {
        notify(ctx, noGoalNotice());
        return;
      }
      stopGoal(state);
      notify(ctx, goalStoppedNotice());
    },
  });

  pi.registerTool({
    name: "goal_finish",
    label: "Goal Finish",
    description:
      "Declare the active goal fully achieved. This ends the goal and stops automatic continuation. Fails when no goal is active.",
    parameters: Type.Object({}),
    execute: async () => {
      if (getGoal(state) === null) throw new Error(finishFailure());
      finishGoal(state);
      return { content: [{ type: "text" as const, text: finishSuccess() }], details: undefined };
    },
  });

  pi.registerTool({
    name: "goal_sleep",
    label: "Goal Sleep",
    description:
      "Defer the next automatic goal continuation while waiting for asynchronous work (for example a subagent). The next settle is suppressed and a timer wakes the loop after the requested seconds. Fails when no goal is active.",
    parameters: SleepParams,
    execute: async (_toolCallId, params) => {
      if (getGoal(state) === null) throw new Error(sleepFailure());
      const now = Date.now();
      const sleep = beginSleep(state, params.seconds, now);
      if (sleep === null) throw new Error(sleepFailure());
      return {
        content: [
          { type: "text" as const, text: sleepScheduledNotice(sleep.seconds, new Date(sleep.until).toISOString()) },
        ],
        details: undefined,
      };
    },
  });

  pi.on("session_shutdown", async () => {
    onShutdown(state);
  });
}
```

注意：`pi.on(...)` 必须出现在 `state` 初始化之后；`pi.on("agent_before_settle", ...)` 在 Task 8 添加。`sleepScheduledNotice` 用到 `sleep.until`，因此 Task 3 的 `SleepState.until` 字段不可重命名。

- [x] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @philogag/pi-goal-loop test -- index
```

Expected: PASS。若 `SleepParams` 参数校验失败，检查 `Type.Object({ seconds: Type.Number(...) })` 是否导出为 `SleepParams` 且带 `description`。同时确认注册定义里**没有** `promptSnippet` / `promptGuidelines`——它们会改变默认系统提示词、破坏 prompt 前缀缓存，工具用法改由续跑提示词传达。

- [x] **Step 5: 类型检查**

```bash
pnpm --filter @philogag/pi-goal-loop typecheck
```

Expected: 无输出、退出码 0。若 `ctx.ui.notify` 的第二个参数签名不匹配，改为只传消息。

- [x] **Step 6: Commit**

```bash
git add packages/pi-goal-loop/src/index.ts packages/pi-goal-loop/test/index.test.ts
git commit -m "feat(pi-goal-loop): register goal commands and tools"
```

---

## Task 8: pi 接线 —— 边界续跑与定时器唤醒

**Files:**
- Modify: `packages/pi-goal-loop/src/index.ts`
- Test: `packages/pi-goal-loop/test/index.test.ts`

**Interfaces:**
- Consumes: Task 4/5 的 `onBoundary`，Task 6 的 `buildContinuationPrompt` / `GOAL_LOOP_CUSTOM_TYPE`
- Produces: `agent_before_settle` handler（返回 `{ entries, continue: true }` 或 `undefined`）；定时器 `wake` 走 `pi.sendMessage(..., { triggerTurn: true })`

- [x] **Step 1: 追加失败的测试**

```typescript
it("wakes with a triggered turn when the sleep timer fires", async () => {
  vi.useFakeTimers();
  try {
    const { pi, commands, tools, sent } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await tools.get("goal_sleep")!.execute("id", { seconds: 60 }, undefined, undefined, ctx);

    vi.advanceTimersByTime(60_000);

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toEqual(
      expect.objectContaining({ customType: "goal-loop", display: true }),
    );
    expect(sent[0][1]).toEqual({ triggerTurn: true });
  } finally {
    vi.useRealTimers();
  }
});

it("skips the triggered turn when the loop already resumed", async () => {
  vi.useFakeTimers();
  try {
    const { pi, commands, tools, handlers, sent } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await tools.get("goal_sleep")!.execute("id", { seconds: 60 }, undefined, undefined, ctx);
    handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx);
    vi.advanceTimersByTime(10_000);
    handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx);

    vi.advanceTimersByTime(60_000);

    expect(sent).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

it("cancels the timer on session shutdown", async () => {
  vi.useFakeTimers();
  try {
    const { pi, commands, tools, handlers, sent } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await tools.get("goal_sleep")!.execute("id", { seconds: 60 }, undefined, undefined, ctx);
    handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);

    vi.advanceTimersByTime(120_000);

    expect(sent).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @philogag/pi-goal-loop test -- index
```

Expected: FAIL —— `wakes with a triggered turn...` 报 `expected [] to have a length of 1`。

- [x] **Step 3: 接上 `agent_before_settle`**

在 `src/index.ts` 的 `session_shutdown` 注册之前插入：

```typescript
  pi.on("agent_before_settle", (event) => {
    const action = onBoundary(state, event.outcome, Date.now());
    if (action.kind !== "continue") return undefined;
    return {
      entries: [
        {
          type: "custom_message" as const,
          customType: GOAL_LOOP_CUSTOM_TYPE,
          content: action.prompt,
          display: true,
        },
      ],
      continue: true,
    };
  });
```

并把 `onBoundary` 加入 `./goal-state.js` 的 import 列表。

> **实现期修正**：该 handler 必须**同步**返回，不能写成 `async`——Task 7 的测试直接断言同步返回值，
> 且 `ExtensionHandler<E, R> = (event, ctx) => Promise<R | void> | R | void` 明确允许同步返回。

- [x] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @philogag/pi-goal-loop test
```

Expected: PASS（`goal-state`、`prompts`、`index` 三个文件全绿）。

- [x] **Step 5: 构建并类型检查**

```bash
pnpm --filter @philogag/pi-goal-loop typecheck
pnpm --filter @philogag/pi-goal-loop build
```

Expected: 两者都退出码 0，且 `packages/pi-goal-loop/dist/index.js` 存在。

- [x] **Step 6: Commit**

```bash
git add packages/pi-goal-loop/src/index.ts packages/pi-goal-loop/test/index.test.ts
git commit -m "feat(pi-goal-loop): auto-continue on boundary and timer wake-up"
```

---

## Task 9: README 与端到端验证

**Files:**
- Create: `packages/pi-goal-loop/README.md`
- Modify: `packages/pi-goal-loop/openspec/changes/add-goal-loop/tasks.md`（勾选完成项）

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 可发布的包说明与验收证据

- [ ] **Step 1: 写 `README.md`**

必须覆盖：`/goal`（发起/查询/替换）、`/goal-stop`、`goal_finish`、`goal_sleep({ seconds })` 的用法与语义；
「只有 `goal_finish` 与 `/goal-stop` 能结束目标」；`aborted`/`error` 只暂停本轮；
**活动目标仅存于内存，`/reload` 或重启后需重新 `/goal`**；停止出口与自动续跑可能带来的 token 消耗；
已手动验证的 pi 版本（写出 `npm ls @earendil-works/pi-coding-agent` 的实际版本号）。

- [ ] **Step 2: 全量验证**

```bash
cd /home/philogag/workspace/pi-exts/pi-random-stuffs
pnpm --filter @philogag/pi-goal-loop typecheck
pnpm --filter @philogag/pi-goal-loop test
pnpm --filter @philogag/pi-goal-loop build
cd packages/pi-goal-loop && openspec validate add-goal-loop --strict
```

Expected: 全部通过；`openspec validate` 输出 `Change 'add-goal-loop' is valid`。

- [ ] **Step 3: 手动验收（在真实 pi 会话里）**

```bash
cd /home/philogag/workspace/pi-exts/pi-random-stuffs/packages/pi-goal-loop
pi --extension ./src/index.ts
```

逐项确认并记录证据：

1. `/goal 在当前目录创建一个 hello.txt 并写入一行文字` → agent 完成后**自动续跑**（可见 `[goal-loop]` 提示），随后 agent 调用 `goal_finish` → 循环停止。
2. 再 `/goal <另一个目标>`，按 **Esc** 中断 → 不自动续跑；再发一条普通消息 → 循环恢复。
3. 再 `/goal <另一个目标>`，agent 派发异步 subagent 并调用 `goal_sleep({ seconds: 120 })` → 当轮不续跑；若 subagent 在 120 秒内返回并推进了工作，120 秒到点**不**注入；否则到点后注入并开启新一轮。
4. `/goal` 无参数 → 显示当前目标与「仅存于内存」说明；`/goal-stop` → 停止。
5. `/reload` → 目标丢失（预期行为，与 README 一致）。

- [ ] **Step 4: Commit**

```bash
git add packages/pi-goal-loop/README.md packages/pi-goal-loop/openspec/changes/add-goal-loop/tasks.md
git commit -m "docs(pi-goal-loop): usage, in-memory limitation and verified pi version"
```

---

## Self-Review

**Spec coverage**（逐一对照 `specs/*/spec.md`）：

| Requirement | 覆盖任务 |
| --- | --- |
| 目标登记命令（`/goal`） | Task 7（Step 1/3）+ Task 6（notices） |
| 目标终止命令（`/goal-stop`） | Task 7 |
| 目标完成工具（`goal_finish`） | Task 7 |
| 自动续跑边界 | Task 4 + Task 8 |
| 中断与错误时暂停续跑 | Task 4（`aborted`/`error` 用例）+ Task 8（`aborted` 用例） |
| 目标生命周期的唯一出口 | Task 2 + Task 4（`does not clear the goal on aborted or error`） |
| 续跑提示词内容 | Task 4/6（`continuation prompt carries the goal and all three exits`） |
| 目标状态仅存于内存 | Task 7（`does not persist goal state to session entries`）+ Task 9（`/reload` 手动验收） |
| 工具引导不经过系统提示词 | Task 7（`registers the tools without system-prompt guidance` + 加载时注册的 `registers the two commands and two tools`） |
| 延迟续跑工具（`goal_sleep`） | Task 7（含缺参、无目标、clamp 三例） |
| 一次性抑制第一次 settle | Task 5 |
| 定时器唤醒与「已恢复则跳过注入」 | Task 5 + Task 8 |
| 时长边界与超时兜底 | Task 3（clamp）+ Task 5（`MAX_SLEEP_MS` 用例） |
| 延迟状态的清理 | Task 3（`clears sleep when the goal is replaced or ended`、`ignores a stale timer callback`、`onShutdown is idempotent`）+ Task 8 |
| 唤醒来源仅为定时器与超时兜底 | Task 5（`does not count non-completed outcomes during sleep` 等）+ Task 8 |

无遗漏。**Review Focus 的五项**分别落在：① ② Task 7（缺参由 TypeBox schema 拒绝、clamp 用例）、③ Task 3（`ignores a stale timer callback`）+ Task 8（`cancels the timer on session shutdown`）、④ Task 3（`clears sleep when the goal is replaced`）+ Task 5（`onTimer returns none for a stale reference`）、⑤ Task 7 + Task 9。

**Placeholder scan:** 无 TBD / 「add validation」类占位；所有代码步骤都给出了可粘贴的实际代码。

**Type consistency:** `SleepState.until`、`suppressNextSettle`、`settlesDuringSleep`、`startedAt`、`seconds`、`timer` 在 Task 3/5/7 中名称一致；`onBoundary` 返回 `{ kind, prompt? }` 判别联合，Task 8 用 `action.kind !== "continue"` 收窄；`GOAL_LOOP_CUSTOM_TYPE` 在 Task 6 定义、Task 7/8 使用。
