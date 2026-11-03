import { describe, expect, it } from "vitest";
import {
  classifyToolCall,
  createGoalState,
  endWaitCall,
  enterWait,
  finishGoal,
  getGoal,
  getWait,
  isWaiting,
  onBoundary,
  onShutdown,
  releaseWait,
  startGoal,
  stopGoal,
} from "../src/goal-state.js";
import { buildContinuationPrompt } from "../src/prompts.js";

describe("goal lifecycle", () => {
  it("starts with no goal and no wait", () => {
    const state = createGoalState();
    expect(getGoal(state)).toBeNull();
    expect(getWait(state)).toBeNull();
    expect(isWaiting(state)).toBe(false);
  });

  it("startGoal registers the goal text", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    expect(getGoal(state)).toBe("重构 X 模块");
  });

  it("startGoal replaces an existing goal", () => {
    const state = createGoalState();
    startGoal(state, "旧目标");
    startGoal(state, "新目标");
    expect(getGoal(state)).toBe("新目标");
  });

  it("stopGoal clears the goal", () => {
    const state = createGoalState();
    startGoal(state, "某个目标");
    stopGoal(state);
    expect(getGoal(state)).toBeNull();
  });

  it("finishGoal clears the goal", () => {
    const state = createGoalState();
    startGoal(state, "某个目标");
    finishGoal(state);
    expect(getGoal(state)).toBeNull();
  });

  it("stopGoal and finishGoal are idempotent without a goal", () => {
    const state = createGoalState();
    expect(() => {
      stopGoal(state);
      finishGoal(state);
    }).not.toThrow();
  });
});

describe("wait state", () => {
  it("tracks a blocking call while it is in flight", () => {
    const state = createGoalState();
    enterWait(state, { source: "bg_wait", kind: "blocking", toolCallId: "w1", now: 1_000 });

    expect(isWaiting(state)).toBe(true);
    expect(getWait(state)?.source).toBe("bg_wait");
    expect(getWait(state)?.since).toBe(1_000);
    expect(getWait(state)?.latched).toBe(false);
    expect([...(getWait(state)?.inFlight ?? [])]).toEqual(["w1"]);
  });

  it("stops waiting once the blocking call ends", () => {
    const state = createGoalState();
    enterWait(state, { source: "bg_wait", kind: "blocking", toolCallId: "w1" });
    endWaitCall(state, "w1");
    expect(isWaiting(state)).toBe(false);
  });

  it("keeps the latch after a dispatch call ends", () => {
    const state = createGoalState();
    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s1" });
    endWaitCall(state, "s1");

    expect(getWait(state)?.latched).toBe(true);
    expect(isWaiting(state)).toBe(true);
  });

  it("re-uses one wait record for several sources", () => {
    const state = createGoalState();
    enterWait(state, { source: "ask_user_question", kind: "blocking", toolCallId: "ask-1", now: 5 });
    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s1", now: 9 });

    expect(getWait(state)?.source).toBe("ask_user_question");
    expect(getWait(state)?.since).toBe(5);
    expect(getWait(state)?.latched).toBe(true);
    expect([...(getWait(state)?.inFlight ?? [])].sort()).toEqual(["ask-1", "s1"]);
  });

  it("uses the source name when the observation has no call id", () => {
    const state = createGoalState();
    enterWait(state, { source: "ask_user_question", kind: "blocking" });

    expect([...(getWait(state)?.inFlight ?? [])]).toEqual(["ask_user_question"]);
    endWaitCall(state, undefined);
    expect(isWaiting(state)).toBe(false);
  });

  it("ignores an end for an unknown call", () => {
    const state = createGoalState();
    expect(() => endWaitCall(state, "nope")).not.toThrow();

    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s1" });
    endWaitCall(state, "other");
    expect(isWaiting(state)).toBe(true);
  });

  it("releaseWait is idempotent and clears the latch", () => {
    const state = createGoalState();
    expect(() => releaseWait(state)).not.toThrow();

    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s1" });
    releaseWait(state);
    expect(isWaiting(state)).toBe(false);
    expect(() => releaseWait(state)).not.toThrow();
  });

  it("start/stop/finish/shutdown clear the wait state", () => {
    const state = createGoalState();
    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s1" });
    startGoal(state, "目标 A");
    expect(isWaiting(state)).toBe(false);

    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s2" });
    stopGoal(state);
    expect(isWaiting(state)).toBe(false);

    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s3" });
    finishGoal(state);
    expect(isWaiting(state)).toBe(false);

    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s4" });
    onShutdown(state);
    expect(isWaiting(state)).toBe(false);
    expect(() => onShutdown(state)).not.toThrow();
  });
});

describe("classifyToolCall", () => {
  it("recognises blocking wait tools", () => {
    expect(classifyToolCall("ask_user_question", {})).toBe("blocking");
    expect(classifyToolCall("bg_wait", { id: "run-1" })).toBe("blocking");
    expect(classifyToolCall("acp_delegate_wait", {})).toBe("blocking");
  });

  it("recognises async dispatches", () => {
    expect(classifyToolCall("subagent", { agent: "worker", task: "x" })).toBe("dispatch");
    expect(classifyToolCall("subagent", { agent: "worker", task: "x", async: true })).toBe("dispatch");
    expect(classifyToolCall("acp_delegate", { agent: "reviewer", task: "x" })).toBe("dispatch");
  });

  it("ignores management and synchronous calls", () => {
    expect(classifyToolCall("subagent", { action: "status", id: "run-1" })).toBeNull();
    expect(classifyToolCall("subagent", { agent: "worker", task: "x", async: false })).toBeNull();
    expect(classifyToolCall("acp_delegate", { action: "cancel", id: "run-1" })).toBeNull();
  });

  it("ignores unrelated tools", () => {
    expect(classifyToolCall("read", { path: "a.ts" })).toBeNull();
    expect(classifyToolCall("goal_finish", {})).toBeNull();
  });
});

describe("onBoundary", () => {
  it("does nothing without an active goal", () => {
    const state = createGoalState();
    expect(onBoundary(state, "completed")).toEqual({ kind: "none" });
  });

  it("continues on a completed turn when a goal is active", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    expect(onBoundary(state, "completed")).toEqual({
      kind: "continue",
      prompt: buildContinuationPrompt("重构 X 模块"),
    });
  });

  it("pauses on aborted and keeps the goal", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    expect(onBoundary(state, "aborted")).toEqual({ kind: "none" });
    expect(getGoal(state)).toBe("重构 X 模块");
  });

  it("pauses on error and keeps the goal", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    expect(onBoundary(state, "error")).toEqual({ kind: "none" });
    expect(getGoal(state)).toBe("重构 X 模块");
  });

  it("resumes continuing after the pause", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    expect(onBoundary(state, "aborted").kind).toBe("none");
    expect(onBoundary(state, "completed").kind).toBe("continue");
  });

  it("does not clear the goal on aborted or error", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    onBoundary(state, "aborted");
    onBoundary(state, "error");
    expect(getGoal(state)).toBe("重构 X 模块");
  });

  it("suppresses while a blocking wait is in flight", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    enterWait(state, { source: "ask_user_question", kind: "blocking", toolCallId: "ask-1" });

    expect(onBoundary(state, "completed")).toEqual({ kind: "none" });
    expect(getGoal(state)).toBe("重构 X 模块");
  });

  it("suppresses every settle while the dispatch latch is set", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s1" });
    endWaitCall(state, "s1");

    expect(onBoundary(state, "completed")).toEqual({ kind: "none" });
    expect(onBoundary(state, "completed")).toEqual({ kind: "none" });
    expect(isWaiting(state)).toBe(true);
  });

  it("continues again once the latch is released", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    enterWait(state, { source: "subagent", kind: "dispatch", toolCallId: "s1" });
    releaseWait(state);

    expect(onBoundary(state, "completed").kind).toBe("continue");
  });

  it("continues after the blocking call returns", () => {
    const state = createGoalState();
    startGoal(state, "重构 X 模块");
    enterWait(state, { source: "bg_wait", kind: "blocking", toolCallId: "w1" });
    endWaitCall(state, "w1");

    expect(onBoundary(state, "completed").kind).toBe("continue");
  });
});
