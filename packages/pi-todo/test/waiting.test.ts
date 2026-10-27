import { describe, expect, it } from "vitest";
import { applyTaskMutation } from "../src/state/state-reducer.js";
import { isTransitionValid, VALID_TRANSITIONS } from "../src/state/invariants.js";
import type { TaskState } from "../src/state/state.js";
import type { Task, TaskMutationParams, TaskStatus } from "../src/tool/types.js";

const EMPTY: TaskState = { tasks: [], nextId: 1 };

function stateWith(...tasks: Task[]): TaskState {
	return { tasks, nextId: Math.max(...tasks.map((t) => t.id)) + 1 };
}

function task(id: number, status: TaskStatus, subject = `task ${id}`): Task {
	return { id, status, subject };
}

function update(id: number, patch: TaskMutationParams): TaskMutationParams {
	return { action: "update", id, ...patch };
}

describe("isTransitionValid — waiting is reversible, completed is not", () => {
	it("allows entering waiting from every live status", () => {
		for (const from of ["pending", "in_progress"] as const) {
			expect(isTransitionValid(from, "waiting")).toBe(true);
		}
	});

	it("allows leaving waiting for pending or in_progress", () => {
		expect(isTransitionValid("waiting", "in_progress")).toBe(true);
		expect(isTransitionValid("waiting", "pending")).toBe(true);
	});

	it("keeps completed one-way and deleted terminal", () => {
		expect(isTransitionValid("completed", "in_progress")).toBe(false);
		expect(VALID_TRANSITIONS.deleted.size).toBe(0);
		expect(isTransitionValid("deleted", "pending")).toBe(false);
	});

	it("treats same→same as a no-op success", () => {
		expect(isTransitionValid("waiting", "waiting")).toBe(true);
	});
});

describe("applyTaskMutation — waiting requires a reason", () => {
	it("rejects a mute without a reason", () => {
		const result = applyTaskMutation(stateWith(task(1, "in_progress")), "update", update(1, { status: "waiting" }));
		expect(result.op).toMatchObject({ kind: "error" });
		expect(result.state.tasks[0]?.status).toBe("in_progress");
	});

	it("rejects a whitespace-only reason", () => {
		const result = applyTaskMutation(
			stateWith(task(1, "in_progress")),
			"update",
			update(1, { status: "waiting", waitReason: "   " }),
		);
		expect(result.op).toMatchObject({ kind: "error" });
	});

	it("persists the trimmed reason on the task", () => {
		const result = applyTaskMutation(
			stateWith(task(1, "in_progress")),
			"update",
			update(1, { status: "waiting", waitReason: "  CI run  " }),
		);
		expect(result.state.tasks[0]).toMatchObject({ status: "waiting", waitReason: "CI run" });
	});

	it("drops the reason when the task leaves waiting", () => {
		const parked = stateWith({ id: 1, status: "waiting", subject: "task 1", waitReason: "CI run" });
		const result = applyTaskMutation(parked, "update", update(1, { status: "in_progress" }));
		expect(result.state.tasks[0]?.status).toBe("in_progress");
		expect(result.state.tasks[0]?.waitReason).toBeUndefined();
	});

	it("only a waiting task carries a reason — other statuses clear it", () => {
		const parked = stateWith({ id: 1, status: "waiting", subject: "task 1", waitReason: "CI run" });
		const result = applyTaskMutation(parked, "update", update(1, { status: "completed" }));
		expect(result.state.tasks[0]?.waitReason).toBeUndefined();
	});

	it("a fresh task is pending — waiting is reachable only through update", () => {
		const created = applyTaskMutation(EMPTY, "create", { action: "create", subject: "new" });
		expect(created.state.tasks[0]?.status).toBe("pending");
	});
});

describe("applyTaskMutation — dependency bookkeeping", () => {
	it("merges addBlockedBy instead of replacing", () => {
		const state = stateWith(
			{ id: 1, status: "pending", subject: "a", blockedBy: [2] },
			task(2, "pending"),
			task(3, "pending"),
		);
		const result = applyTaskMutation(state, "update", update(1, { addBlockedBy: [3] }));
		expect(result.state.tasks[0]?.blockedBy).toEqual([2, 3]);
	});

	it("rejects a cycle", () => {
		const state = stateWith(
			{ id: 1, status: "pending", subject: "a", blockedBy: [2] },
			{ id: 2, status: "pending", subject: "b" },
		);
		const result = applyTaskMutation(state, "update", update(2, { addBlockedBy: [1] }));
		expect(result.op).toMatchObject({ kind: "error" });
	});
});
