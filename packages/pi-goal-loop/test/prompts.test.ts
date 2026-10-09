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

  it("continuation prompt carries the goal and the two agent exits", () => {
    const text = buildContinuationPrompt("重构 X 模块");
    expect(text).toContain("重构 X 模块");
    expect(text).toContain("goal_finish");
    expect(text).toContain("goal_sleep");
    expect(text).toContain("直到目标完全完成");
    expect(text).not.toContain("/goal-stop");
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
