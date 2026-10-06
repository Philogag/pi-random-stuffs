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
