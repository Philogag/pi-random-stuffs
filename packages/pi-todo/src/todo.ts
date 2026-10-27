/**
 * todo tool + /todos command — thin registration shell.
 *
 * Tool/command identity, schema, types, reducer, store, replay, response
 * envelope, selectors, and view formatters live in the layered modules under
 * `tool/`, `state/`, and `view/`. This file is the package-root registration
 * surface — it mirrors `packages/rpiv-ask-user-question/ask-user-question.ts`
 * which keeps the tool registration at the package root.
 *
 * Public re-exports below preserve the package-root import surface so that
 * `index.ts`, `todo-overlay.ts`, and the global `test/setup.ts` `beforeEach`
 * continue to import from `./todo.js`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, validateGuidanceFields } from "./config.js";
import { formatStatusLabel, t } from "./state/i18n-bridge.js";
import { selectTasksByStatus, selectTodoCounts, selectVisibleTasks } from "./state/selectors.js";
import { applyTaskMutation, changesState } from "./state/state-reducer.js";
import { commitState, getRenderState, getState, sid } from "./state/store.js";
import { buildToolResult } from "./tool/response-envelope.js";
import {
	COMMAND_NAME,
	ERR_REQUIRES_INTERACTIVE,
	MSG_NO_TODOS,
	STATE_ENTRY_TYPE,
	type TaskMutationParams,
	TOOL_LABEL,
	TOOL_NAME,
	TOOL_DESCRIPTION,
	TodoParamsSchema,
} from "./tool/types.js";
import { formatCommandTaskLine, renderTodoCall, renderTodoResult } from "./view/format.js";

// English fallbacks for localized /todos section headers — the box-drawing
// decoration is part of the localized string so translators can adjust spacing.
const SECTION_PENDING = "── Pending ──";
const SECTION_IN_PROGRESS = "── In Progress ──";
const SECTION_WAITING = "── Waiting ──";
const SECTION_COMPLETED = "── Completed ──";

// ---------------------------------------------------------------------------
// Public re-exports — existing consumers (overlay, tests, index.ts) keep
// importing from `./todo.js`. New code may opt into deeper imports.
// ---------------------------------------------------------------------------

export { isTransitionValid } from "./state/invariants.js";
export { applyTaskMutation } from "./state/state-reducer.js";
export { __resetState, getNextId, getTodos, setActiveRenderSession, sid } from "./state/store.js";
export { deriveBlocks, detectCycle } from "./state/task-graph.js";
export type { Task, TaskAction, TaskDetails, TaskStatus } from "./tool/types.js";
export { TOOL_NAME } from "./tool/types.js";

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Model-facing prompt injection — the second half of the tool contract.
//
// These strings are the plugin's whole opinion about HOW the list is used, and
// they are injected verbatim by pi core: `promptSnippet` into the `<tools>`
// block, `promptGuidelines` into `<rules>`. Kept to six lines on purpose —
// every line here is paid on every request, and a long list dilutes the two
// rules that actually get violated (single in_progress, no premature complete).
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPT_SNIPPET = "Plan and track multi-step work in a task list the user can see";

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Maintain the list as a plan you can be held to: create tasks before starting multi-step work (3+ steps, a user-supplied list, or any request with a definition of done). Skip it for single trivial tasks and purely conversational requests.",
	"Exactly one task is in_progress at a time, and you set it to in_progress BEFORE the work starts, not after. Pass activeForm — the present-continuous label the user watches while you work.",
	"Mark a task completed only when the result is verified (tests pass, build is green, the artifact exists). Partial work stays in_progress; a blocker becomes a new task, never a premature completion.",
	"If you cannot make progress because you are waiting on something external — a CI run, a subagent, a user decision — move the task to waiting with a waitReason. waiting is visible in the overlay, reversible with status: in_progress, and exempt from the stop-time reminder; idling with the task still in_progress is not.",
	'status is the field that moves a task: {"action":"update","id":3,"status":"completed"}. An update with no mutable field is rejected. list hides deleted tombstones unless includeDeleted:true.',
	"Express ordering with blockedBy (A blocked by B): set it on create, or use addBlockedBy / removeBlockedBy on update — additive merge, never resend the whole array. Cycles are rejected.",
];

export function registerTodoTool(pi: ExtensionAPI): void {
	const guidance = validateGuidanceFields(loadConfig().guidance);
	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_LABEL,
		description: TOOL_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
		parameters: TodoParamsSchema,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = applyTaskMutation(getState(sid(ctx)), params.action, params as TaskMutationParams);
			commitState(sid(ctx), result.state);
			const toolResult = buildToolResult(params.action, params as TaskMutationParams, result.state, result.op);
			// Persist the snapshot as a custom entry on the calling session's branch, however the
			// tool was reached: a call made through another tool (`ctx.executeTool`, e.g. codemode)
			// never lands as a standalone `toolResult`, so its `details` alone would not survive
			// replay. Pi's own codemode persists its `store()` the same way.
			if (changesState(result.op)) pi.appendEntry(STATE_ENTRY_TYPE, toolResult.details);
			return toolResult;
		},

		// renderCall reflects the FOREGROUND slot, not the calling session's. Pi's
		// `ToolRenderContext` carries no session identity (no sessionManager/sessionId),
		// so this ctx-less hook cannot re-key by caller. For the foreground session's
		// own transcript that is exactly right. A detached/child call rendered in the
		// lane-transcript viewer whose task lives only in the child's slot misses the
		// foreground lookup and falls back to `#<id>` (see renderTodoCall). That is the
		// safe outcome: per-session ids restart at 1, so searching sibling slots could
		// surface the WRONG subject — the `#<id>` fallback is intentional, not a gap.
		renderCall(args, theme, _context) {
			return renderTodoCall(args as never, theme, getRenderState());
		},

		renderResult(result, _opts, theme, _context) {
			return renderTodoResult(result, theme);
		},
	});
}

// ---------------------------------------------------------------------------
// /todos slash command
// ---------------------------------------------------------------------------

export function registerTodosCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Show all todos on the current branch, grouped by status",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(t("command.requires_interactive", ERR_REQUIRES_INTERACTIVE), "error");
				return;
			}
			const state = getState(sid(ctx));
			const visible = selectVisibleTasks(state);
			if (visible.length === 0) {
				ctx.ui.notify(t("command.no_todos", MSG_NO_TODOS), "info");
				return;
			}
			const groups = selectTasksByStatus(state);
			const counts = selectTodoCounts(state);

			const header: string[] = [];
			if (counts.completed > 0) header.push(`${counts.completed}/${counts.total} ${formatStatusLabel("completed")}`);
			if (counts.inProgress > 0) header.push(`${counts.inProgress} ${formatStatusLabel("in_progress")}`);
			if (counts.waiting > 0) header.push(`${counts.waiting} ${formatStatusLabel("waiting")}`);
			if (counts.pending > 0) header.push(`${counts.pending} ${formatStatusLabel("pending")}`);

			const lines: string[] = [header.join(" · ")];
			if (groups.pending.length > 0) {
				lines.push(t("command.section.pending", SECTION_PENDING));
				for (const task of groups.pending) lines.push(formatCommandTaskLine(task, "○"));
			}
			if (groups.inProgress.length > 0) {
				lines.push(t("command.section.in_progress", SECTION_IN_PROGRESS));
				for (const task of groups.inProgress) lines.push(formatCommandTaskLine(task, "◐"));
			}
			if (groups.waiting.length > 0) {
				lines.push(t("command.section.waiting", SECTION_WAITING));
				for (const task of groups.waiting) lines.push(formatCommandTaskLine(task, "◍"));
			}
			if (groups.completed.length > 0) {
				lines.push(t("command.section.completed", SECTION_COMPLETED));
				for (const task of groups.completed) lines.push(formatCommandTaskLine(task, "✓"));
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
