/**
 * Stop-time reminder policy — the bounded nag that fires at `agent_before_settle`
 * while open tasks remain.
 *
 * Design (deliberate, and the reason this is a separate pure module): reminders
 * are BUDGETED per user prompt, not open-ended. Every reminder costs one full
 * provider request, so an unconditional `continue: true` is the documented
 * infinite-loop anti-pattern. The budget is the ceiling; the guards below are
 * what keep the ceiling from being spent on legitimate stops.
 *
 * The escape hatch is structural, not a mute button: a task blocked on an
 * external event is moved to `waiting` (with a required reason), which removes
 * it from {@link OPEN_STATUSES} and therefore from the nag — visible in the
 * overlay and in `/todos`, and reversed by moving the task back to
 * `in_progress`. There is deliberately NO `pause reminders` operation: a mute
 * with no visible residue is cheaper than finishing the work.
 *
 * Everything here is pure (now injected, no I/O, no pi imports) so the state
 * machine is unit-testable without an agent runtime.
 */

import { OPEN_STATUSES, type ReminderSettings } from "./config.js";
import type { Task } from "./tool/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkipReason =
	| "disabled"
	| "not-completed"
	| "awaiting-progress"
	| "budget-exhausted"
	| "no-open-tasks"
	| "awaiting-user"
	| "no-continuation";

/** Audit trail entry — one line per settle we evaluated, for `debugReminders`. */
export interface ReminderDecision {
	kind: "remind" | "skip";
	attempt: number;
	outputTokensHint: number;
	reason?: SkipReason;
	at: number;
}

export interface ReminderState {
	/** Reminders already fired for the CURRENT user prompt. Reset on a new prompt only. */
	attempt: number;
	/** Single-flight latch: true from fire until ANY tool result arrives. */
	awaitingProgress: boolean;
	/** Bounded ring of recent decisions (newest last). */
	trail: ReminderDecision[];
}

export interface ReminderInput {
	state: ReminderState;
	settings: ReminderSettings;
	/** `agent_before_settle` outcome: only a completed turn may be extended. */
	outcome: "completed" | "aborted" | "error";
	tasks: readonly Task[];
	/** pi's own gate — a continuation without runnable context throws. */
	canContinue: boolean;
	/** Last assistant text of the settling turn, for the "asked the user" guard. */
	lastAssistantText?: string;
	now: number;
}

export type ReminderPlan =
	| { kind: "skip"; reason: SkipReason; state: ReminderState }
	| { kind: "remind"; prompt: string; attempt: number; state: ReminderState };

/** How many decisions the trail retains. Small on purpose: it is a debugging aid. */
export const TRAIL_LIMIT = 12;

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export function createReminderState(): ReminderState {
	return { attempt: 0, awaitingProgress: false, trail: [] };
}

/** New user prompt → new budget. This is the ONLY reset of `attempt`; internal
 *  continuations, tool results and compaction must never widen the budget. */
export function onUserPrompt(state: ReminderState): ReminderState {
	return { attempt: 0, awaitingProgress: false, trail: state.trail };
}

/** Any tool result counts as progress and releases the single-flight latch —
 *  regardless of whether the todo list changed. */
export function onToolResult(state: ReminderState): ReminderState {
	return state.awaitingProgress ? { ...state, awaitingProgress: false } : state;
}

function pushTrail(state: ReminderState, decision: ReminderDecision): ReminderDecision[] {
	const trail = [...state.trail, decision];
	return trail.length > TRAIL_LIMIT ? trail.slice(trail.length - TRAIL_LIMIT) : trail;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/** Open = pending or in_progress. `waiting` is excluded by construction. */
export function selectOpenTasks(tasks: readonly Task[]): readonly Task[] {
	return tasks.filter((task) => OPEN_STATUSES.has(task.status));
}

/**
 * Heuristic: does the turn end by asking the user something? Deliberately
 * narrow (last non-empty line only) — a false positive silences one reminder,
 * a false negative spends one request nagging a question that was already asked.
 */
export function looksLikeQuestion(text: string | undefined): boolean {
	if (!text) return false;
	const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	const last = lines[lines.length - 1] ?? "";
	if (last.length === 0) return false;
	if (last.endsWith("?")) return true;
	if (last.endsWith("？")) return true;
	return /(^|\s)(would you like|do you want|shall i|should i|which (one|option)|let me know)\b/i.test(last);
}

/**
 * Decide one settle. Guard order matters only for which reason is recorded;
 * every guard is a hard skip.
 */
export function planReminder(input: ReminderInput): ReminderPlan {
	const { state, settings } = input;
	const skip = (reason: SkipReason): ReminderPlan => {
		const decision: ReminderDecision = { kind: "skip", attempt: state.attempt, outputTokensHint: 0, reason, at: input.now };
		return { kind: "skip", reason, state: { ...state, trail: pushTrail(state, decision) } };
	};

	if (!settings.enabled) return skip("disabled");
	// Aborted/errored turns are the user's own interrupt or a real failure — never nag into them.
	if (input.outcome !== "completed") return skip("not-completed");
	// Single-flight: no progress since the last reminder → stay quiet instead of stacking.
	if (state.awaitingProgress) return skip("awaiting-progress");
	if (state.attempt >= settings.max) return skip("budget-exhausted");

	const open = selectOpenTasks(input.tasks);
	if (open.length === 0) return skip("no-open-tasks");

	if (settings.skipWhenAwaitingUser && looksLikeQuestion(input.lastAssistantText)) return skip("awaiting-user");
	if (!input.canContinue) return skip("no-continuation");

	const attempt = state.attempt + 1;
	const prompt = buildReminderPrompt({ open, attempt, max: settings.max });
	const decision: ReminderDecision = {
		kind: "remind",
		attempt,
		outputTokensHint: Math.ceil(prompt.length / 4),
		at: input.now,
	};
	return {
		kind: "remind",
		prompt,
		attempt,
		state: { attempt, awaitingProgress: true, trail: pushTrail(state, decision) },
	};
}

// ---------------------------------------------------------------------------
// Prompt text — the in-context half of the contract
// ---------------------------------------------------------------------------

const MAX_LISTED = 6;

function renderOpenTasks(open: readonly Task[]): string[] {
	const shown = open.slice(0, MAX_LISTED).map((task) => {
		const active = task.activeForm ? ` — ${task.activeForm}` : "";
		return `- #${task.id} [${task.status}] ${task.subject}${active}`;
	});
	if (open.length > shown.length) shown.push(`- … and ${open.length - shown.length} more`);
	return shown;
}

/** Exported for tests and for docs that quote the exact wording. */
export function buildReminderPrompt(args: { open: readonly Task[]; attempt: number; max: number }): string {
	const { open, attempt, max } = args;
	return [
		`[todo] ${attempt}/${max} reminder for this prompt: ${open.length} task(s) are still open, but the turn is ending.`,
		...renderOpenTasks(open),
		"",
		"Pick exactly one and act on it now:",
		"1. Continue the work, then update the task.",
		"2. Mark it completed — only if it is genuinely done and verified.",
		"3. Move it to waiting with a `waitReason` (e.g. CI run, user decision, upstream subagent). Waiting tasks do not trigger reminders and are reversible with status: in_progress.",
		"4. Delete it if it is no longer wanted.",
		"",
		`Staying silent is a real option when you are actually blocked: say what you are waiting for, in the reply. This reminder costs one extra model request, and it will not fire again once the budget (${max}) is spent.`,
	].join("\n");
}
