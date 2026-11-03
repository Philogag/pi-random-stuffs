import { buildContinuationPrompt } from "./prompts.js";

/**
 * Tools that block the current turn on an external actor (a human or a
 * background job). They never settle while blocked, so they only need in-flight
 * tracking: once the call returns, the turn continues with the answer/result.
 */
export const BLOCKING_WAIT_TOOLS: ReadonlySet<string> = new Set([
  "ask_user_question", // @juicesharp/rpiv-ask-user-question
  "bg_wait", // pi-subagents
  "acp_delegate_wait",
]);

/**
 * Tools that hand work to a future native wake-up and return immediately. The
 * turn settles right after dispatching, so these latch the wait state until an
 * external event (completion wake, user input, goal lifecycle command) releases it.
 */
export const ASYNC_DISPATCH_TOOLS: ReadonlySet<string> = new Set(["subagent", "acp_delegate"]);

/** Emitted by @juicesharp/rpiv-ask-user-question while a questionnaire awaits input. */
export const ASK_BLOCKED_EVENT = "rpiv:ask-user:blocked";

export type WaitKind = "blocking" | "dispatch";

export interface WaitState {
  /** Tool name that first put the loop into the waiting posture. */
  source: string;
  since: number;
  /** Tool call ids (or tool names) that are still running right now. */
  inFlight: Set<string>;
  /** True once work was handed to a native wake-up that has not arrived yet. */
  latched: boolean;
}

export interface GoalState {
  goal: string | null;
  wait: WaitState | null;
}

export type BoundaryOutcome = "completed" | "aborted" | "error";

export type BoundaryAction = { kind: "none" } | { kind: "continue"; prompt: string };

export interface WaitObservation {
  source: string;
  kind: WaitKind;
  /** Absent for observations that cannot name a call (e.g. an anonymous blocked event). */
  toolCallId?: string;
  now?: number;
}

export function createGoalState(): GoalState {
  return { goal: null, wait: null };
}

export function getGoal(state: GoalState): string | null {
  return state.goal;
}

export function getWait(state: GoalState): WaitState | null {
  return state.wait;
}

export function isWaiting(state: GoalState): boolean {
  const wait = state.wait;
  return wait !== null && (wait.latched || wait.inFlight.size > 0);
}

export function startGoal(state: GoalState, text: string): void {
  releaseWait(state);
  state.goal = text;
}

export function clearGoal(state: GoalState): void {
  releaseWait(state);
  state.goal = null;
}

export function stopGoal(state: GoalState): void {
  clearGoal(state);
}

export function finishGoal(state: GoalState): void {
  clearGoal(state);
}

/** Idempotent: releasing twice (or without any wait state) never throws. */
export function releaseWait(state: GoalState): void {
  state.wait = null;
}

export function enterWait(state: GoalState, observation: WaitObservation): WaitState {
  const now = observation.now ?? Date.now();
  const wait: WaitState = state.wait ?? {
    source: observation.source,
    since: now,
    inFlight: new Set<string>(),
    latched: false,
  };
  state.wait = wait;

  if (observation.kind === "dispatch") wait.latched = true;
  wait.inFlight.add(observation.toolCallId ?? observation.source);
  return wait;
}

/** Drops one in-flight call. The latch (if any) is untouched: it waits for an external event. */
export function endWaitCall(state: GoalState, toolCallId: string | undefined): void {
  const wait = state.wait;
  if (wait === null) return;
  if (toolCallId === undefined) wait.inFlight.clear();
  else wait.inFlight.delete(toolCallId);
}

/**
 * Decides whether a tool call is a wait source. Management calls
 * (`subagent({ action: "status" })`) and synchronous dispatches (`async: false`)
 * are not: the callee returns its result in this turn.
 */
export function classifyToolCall(toolName: string, args: unknown): WaitKind | null {
  if (BLOCKING_WAIT_TOOLS.has(toolName)) return "blocking";
  if (!ASYNC_DISPATCH_TOOLS.has(toolName)) return null;
  const params = (args ?? {}) as { action?: unknown; async?: unknown };
  if (params.action !== undefined && params.action !== null) return null;
  if (params.async === false) return null;
  return "dispatch";
}

export function onShutdown(state: GoalState): void {
  releaseWait(state);
}

export function onBoundary(state: GoalState, outcome: BoundaryOutcome): BoundaryAction {
  const goal = state.goal;
  if (goal === null) return { kind: "none" };
  if (outcome !== "completed") return { kind: "none" };
  if (isWaiting(state)) return { kind: "none" };
  return { kind: "continue", prompt: buildContinuationPrompt(goal) };
}
