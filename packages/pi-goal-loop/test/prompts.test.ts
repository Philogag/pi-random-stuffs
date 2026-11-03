import { describe, expect, it } from "vitest";
import {
  buildContinuationPrompt,
  finishFailure,
  finishSuccess,
  goalReplacedNotice,
  goalStartedNotice,
  goalStatusNotice,
  goalStoppedNotice,
  noGoalNotice,
  GOAL_LOOP_CUSTOM_TYPE,
} from "../src/prompts.js";

describe("prompts", () => {
  it("uses a stable custom message type", () => {
    expect(GOAL_LOOP_CUSTOM_TYPE).toBe("goal-loop");
  });

  it("continuation prompt carries the goal and the finish tool", () => {
    const text = buildContinuationPrompt("重构 X 模块");
    expect(text).toContain("重构 X 模块");
    expect(text).toContain("goal_finish");
    expect(text).toContain("直到目标完全完成");
    expect(text).not.toContain("/goal-stop");
  });

  it("continuation prompt no longer mentions the removed sleep tool", () => {
    expect(buildContinuationPrompt("重构 X 模块")).not.toContain("goal_sleep");
  });

  it("continuation prompt only points at goal_finish", () => {
    const text = buildContinuationPrompt("重构 X 模块");
    expect(text).toContain("goal_finish");
    expect(text).not.toContain("ask_user_question");
    expect(text).not.toContain("bg_wait");
    expect(text).not.toContain("sleep");
    expect(text).not.toContain("轮询");
  });

  it("started notice names the goal and the ways out", () => {
    const text = goalStartedNotice("重构 X 模块");
    expect(text).toContain("重构 X 模块");
    expect(text).toContain("goal_finish");
    expect(text).toContain("/goal-stop");
    expect(text).toContain("内存");
  });

  it("replaced notice names the new goal and the cleared wait state", () => {
    const text = goalReplacedNotice("给 Y 补集成测试");
    expect(text).toContain("给 Y 补集成测试");
    expect(text).toContain("已被替换");
    expect(text).toContain("等待态");
  });

  it("status notice reports the active goal", () => {
    const text = goalStatusNotice("重构 X 模块");
    expect(text).toContain("当前活动目标");
    expect(text).toContain("重构 X 模块");
    expect(text).toContain("/goal-stop");
  });

  it("no-goal notices exist for command and tool paths", () => {
    expect(noGoalNotice()).toContain("没有活动目标");
    expect(finishFailure()).toContain("没有活动目标");
  });

  it("stop and finish notices explain that continuation ends", () => {
    expect(goalStoppedNotice()).toContain("不再自动续跑");
    expect(finishSuccess()).toContain("goal_finish");
  });
});
