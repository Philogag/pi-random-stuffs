import { buildContinuationPrompt } from "./prompts.js";
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
  const shouldWake = state.goal !== null && sleep.settlesDuringSleep === 0;
  clearSleep(state);
  return shouldWake ? "wake" : "none";
}

export function onShutdown(state: GoalState): void {
  clearSleep(state);
}

export function onBoundary(
  state: GoalState,
  outcome: BoundaryOutcome,
  now: number,
): BoundaryAction {
  const goal = state.goal;
  if (goal === null) return { kind: "none" };
  if (outcome !== "completed") return { kind: "none" };

  const sleep = state.sleep;
  if (sleep !== null && now - sleep.startedAt > MAX_SLEEP_MS) {
    clearSleep(state);
    return { kind: "continue", prompt: buildContinuationPrompt(goal) };
  }
  if (sleep !== null) {
    if (sleep.suppressNextSettle) {
      sleep.suppressNextSettle = false;
      return { kind: "none" };
    }
    sleep.settlesDuringSleep += 1;
    return { kind: "none" };
  }

  return { kind: "continue", prompt: buildContinuationPrompt(goal) };
}
