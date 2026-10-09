import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  beginSleep,
  createGoalState,
  finishGoal,
  getGoal,
  onBoundary,
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
  function wakeNow(): void {
    const goal = getGoal(state);
    if (goal === null) return;
    pi.sendMessage(
      { customType: GOAL_LOOP_CUSTOM_TYPE, content: buildContinuationPrompt(goal), display: true },
      { triggerTurn: true },
    );
  }

  const state: GoalState = createGoalState({ scheduler: systemScheduler, wake: wakeNow });

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
      // 空闲时立刻开启一轮（streaming 中交给 agent_before_settle 边界续跑，不插队）
      if (typeof ctx.isIdle === "function" && ctx.isIdle()) wakeNow();
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
          {
            type: "text" as const,
            text: sleepScheduledNotice(sleep.seconds, new Date(sleep.until).toISOString()),
          },
        ],
        details: undefined,
      };
    },
  });

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

  pi.on("session_shutdown", async () => {
    onShutdown(state);
  });
}
