import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SLEEP_MS,
  beginSleep,
  clampSleepSeconds,
  clearSleep,
  createGoalState,
  finishGoal,
  getGoal,
  onShutdown,
  onBoundary,
  onTimer,
  startGoal,
  stopGoal,
  systemScheduler,
  type GoalStateDeps,
} from "../src/goal-state.js";
import { buildContinuationPrompt } from "../src/prompts.js";

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
