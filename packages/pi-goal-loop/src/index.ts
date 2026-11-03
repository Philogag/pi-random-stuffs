import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  ASK_BLOCKED_EVENT,
  classifyToolCall,
  createGoalState,
  endWaitCall,
  enterWait,
  finishGoal,
  getGoal,
  onBoundary,
  onShutdown,
  releaseWait,
  startGoal,
  stopGoal,
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
} from "./prompts.js";

function notify(ctx: ExtensionCommandContext | ExtensionContext, message: string): void {
  if (ctx.hasUI) ctx.ui.notify(message, "info");
}

interface AskBlockedPayload {
  active?: boolean;
  toolCallId?: string;
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

  const state: GoalState = createGoalState();

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

  // 等待感知：问卷阻塞（@juicesharp/rpiv-ask-user-question 的公开事件）
  pi.events.on(ASK_BLOCKED_EVENT, (payload: unknown) => {
    const data = (payload ?? {}) as AskBlockedPayload;
    if (data.active === true) {
      enterWait(state, { source: "ask_user_question", kind: "blocking", toolCallId: data.toolCallId });
    } else {
      endWaitCall(state, data.toolCallId);
    }
  });

  // 等待感知：阻塞类工具在途 / 异步派发的 latch
  pi.on("tool_execution_start", (event) => {
    const kind = classifyToolCall(event.toolName, event.args);
    if (kind === null) return;
    enterWait(state, { source: event.toolName, kind, toolCallId: event.toolCallId });
  });

  pi.on("tool_execution_end", (event) => {
    endWaitCall(state, event.toolCallId);
  });

  // 外部事件把控制权交回循环：新一轮开始（含子 agent 完成通知的 triggerTurn 唤醒）或用户发言
  pi.on("agent_start", () => {
    releaseWait(state);
  });

  pi.on("input", () => {
    releaseWait(state);
  });

  pi.on("agent_before_settle", (event) => {
    const action = onBoundary(state, event.outcome);
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
