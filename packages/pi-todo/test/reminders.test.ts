import { describe, expect, it } from "vitest";
import type { ReminderSettings } from "../src/config.js";
import {
	buildReminderPrompt,
	createReminderState,
	looksLikeQuestion,
	onToolResult,
	onUserPrompt,
	planReminder,
	selectOpenTasks,
	TRAIL_LIMIT,
	type ReminderInput,
	type ReminderState,
} from "../src/reminders.js";
import type { Task } from "../src/tool/types.js";

const SETTINGS: ReminderSettings = { enabled: true, max: 3, skipWhenAwaitingUser: true };

function task(id: number, status: Task["status"], subject = `task ${id}`): Task {
	return { id, status, subject };
}

function input(over: Partial<ReminderInput> = {}): ReminderInput {
	return {
		state: createReminderState(),
		settings: SETTINGS,
		outcome: "completed",
		tasks: [task(1, "in_progress")],
		canContinue: true,
		now: 1_000,
		...over,
	};
}

/** Drive `count` reminders, releasing the latch between them like a real tool result would. */
function burn(state: ReminderState, count: number, settings: ReminderSettings = SETTINGS): ReminderState {
	let current = state;
	for (let i = 0; i < count; i++) {
		const plan = planReminder({ ...input(), state: current, settings });
		expect(plan.kind).toBe("remind");
		current = onToolResult(plan.state);
	}
	return current;
}

describe("planReminder — budget", () => {
	it("fires on the first settle with open tasks and consumes one attempt", () => {
		const plan = planReminder(input());
		expect(plan.kind).toBe("remind");
		if (plan.kind !== "remind") throw new Error("unreachable");
		expect(plan.attempt).toBe(1);
		expect(plan.state.attempt).toBe(1);
		expect(plan.state.awaitingProgress).toBe(true);
		expect(plan.prompt).toContain("#1 [in_progress] task 1");
	});

	it("stops at max and reports budget-exhausted", () => {
		const after = burn(createReminderState(), SETTINGS.max);
		expect(after.attempt).toBe(SETTINGS.max);
		const plan = planReminder({ ...input(), state: after });
		expect(plan).toMatchObject({ kind: "skip", reason: "budget-exhausted" });
	});

	it("only a new user prompt resets the budget", () => {
		const after = burn(createReminderState(), SETTINGS.max);
		expect(planReminder({ ...input(), state: after })).toMatchObject({ reason: "budget-exhausted" });
		const reset = onUserPrompt(after);
		expect(reset.attempt).toBe(0);
		expect(reset.awaitingProgress).toBe(false);
		expect(planReminder({ ...input(), state: reset }).kind).toBe("remind");
	});

	it("a tool result does NOT reset the budget — it only releases the latch", () => {
		const after = burn(createReminderState(), 1);
		expect(after.attempt).toBe(1);
		expect(after.awaitingProgress).toBe(false);
	});
});

describe("planReminder — single-flight latch", () => {
	it("stays quiet until any tool result arrives", () => {
		const plan = planReminder(input());
		if (plan.kind !== "remind") throw new Error("unreachable");
		const second = planReminder({ ...input(), state: plan.state });
		expect(second).toMatchObject({ kind: "skip", reason: "awaiting-progress" });
	});

	it("the latch is released by a tool result for ANY tool", () => {
		const fired = planReminder(input());
		if (fired.kind !== "remind") throw new Error("unreachable");
		expect(onToolResult(fired.state).awaitingProgress).toBe(false);
		// Idempotent: a second result with no pending latch returns the same object.
		const cleared = onToolResult(fired.state);
		expect(onToolResult(cleared)).toBe(cleared);
	});

	it("does not spend budget while latched", () => {
		const fired = planReminder(input());
		if (fired.kind !== "remind") throw new Error("unreachable");
		const skipped = planReminder({ ...input(), state: fired.state });
		if (skipped.kind !== "skip") throw new Error("unreachable");
		expect(skipped.state.attempt).toBe(1);
	});
});

describe("planReminder — standing guards", () => {
	it("never nags into an aborted or errored turn", () => {
		for (const outcome of ["aborted", "error"] as const) {
			expect(planReminder(input({ outcome }))).toMatchObject({ kind: "skip", reason: "not-completed" });
		}
	});

	it("respects the disabled switch", () => {
		expect(planReminder(input({ settings: { ...SETTINGS, enabled: false } }))).toMatchObject({ reason: "disabled" });
	});

	it("skips when pi cannot continue", () => {
		expect(planReminder(input({ canContinue: false }))).toMatchObject({ reason: "no-continuation" });
	});

	it("skips when the turn ends by asking the user something", () => {
		const plan = planReminder(input({ lastAssistantText: "Which of the two do you prefer?" }));
		expect(plan).toMatchObject({ kind: "skip", reason: "awaiting-user" });
		const off = planReminder(input({ lastAssistantText: "Which one?", settings: { ...SETTINGS, skipWhenAwaitingUser: false } }));
		expect(off.kind).toBe("remind");
	});

	it("skips when nothing is open", () => {
		expect(planReminder(input({ tasks: [] }))).toMatchObject({ reason: "no-open-tasks" });
		expect(planReminder(input({ tasks: [task(1, "completed"), task(2, "deleted")] }))).toMatchObject({
			reason: "no-open-tasks",
		});
	});
});

describe("waiting status — the structural escape hatch", () => {
	it("is excluded from the open set, unlike pending/in_progress", () => {
		const tasks = [task(1, "pending"), task(2, "in_progress"), task(3, "waiting"), task(4, "completed")];
		expect(selectOpenTasks(tasks).map((t) => t.id)).toEqual([1, 2]);
	});

	it("a list of only waiting tasks produces no reminder at all", () => {
		expect(planReminder(input({ tasks: [task(1, "waiting")] }))).toMatchObject({
			kind: "skip",
			reason: "no-open-tasks",
		});
	});

	it("advertises itself as a remedy inside the reminder prompt", () => {
		const prompt = buildReminderPrompt({ open: [task(1, "in_progress")], attempt: 1, max: 3 });
		expect(prompt).toContain("waiting");
		expect(prompt).toContain("waitReason");
	});
});

describe("buildReminderPrompt", () => {
	it("caps the listed tasks and counts the rest", () => {
		const open = Array.from({ length: 9 }, (_, i) => task(i + 1, "pending"));
		const prompt = buildReminderPrompt({ open, attempt: 2, max: 3 });
		expect(prompt).toContain("2/3 reminder");
		expect(prompt).toContain("9 task(s) are still open");
		expect(prompt).toContain("… and 3 more");
	});

	it("shows the activeForm label when present", () => {
		const prompt = buildReminderPrompt({
			open: [{ id: 7, status: "in_progress", subject: "wire reminders", activeForm: "wiring reminders" }],
			attempt: 1,
			max: 3,
		});
		expect(prompt).toContain("#7 [in_progress] wire reminders — wiring reminders");
	});
});

describe("looksLikeQuestion", () => {
	it("only looks at the last non-empty line", () => {
		expect(looksLikeQuestion("Did lots of things.\n\nShould I continue?")).toBe(true);
		expect(looksLikeQuestion("Should I continue?\nDone anyway.")).toBe(false);
		expect(looksLikeQuestion("准备好了吗？")).toBe(true);
		expect(looksLikeQuestion("Let me know which one you prefer")).toBe(true);
		expect(looksLikeQuestion(undefined)).toBe(false);
		expect(looksLikeQuestion("   ")).toBe(false);
	});
});

describe("trail", () => {
	it("is bounded", () => {
		let state = createReminderState();
		for (let i = 0; i < TRAIL_LIMIT + 5; i++) {
			state = planReminder({ ...input(), state, outcome: "aborted" }).state;
		}
		expect(state.trail).toHaveLength(TRAIL_LIMIT);
		expect(state.trail.every((d) => d.kind === "skip" && d.reason === "not-completed")).toBe(true);
	});

	it("records the fired reminder with an output-token estimate", () => {
		const plan = planReminder(input());
		if (plan.kind !== "remind") throw new Error("unreachable");
		expect(plan.state.trail.at(-1)).toMatchObject({ kind: "remind", attempt: 1 });
		expect(plan.state.trail.at(-1)?.outputTokensHint).toBeGreaterThan(0);
	});
});
