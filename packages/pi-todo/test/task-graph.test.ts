import { describe, expect, it } from "vitest";
import { applyTaskMutation, changesState } from "../src/state/state-reducer.js";
import { deriveBlocks, detectCycle } from "../src/state/task-graph.js";
import type { TaskState } from "../src/state/state.js";
import type { Task, TaskMutationParams, TaskStatus } from "../src/tool/types.js";

const EMPTY: TaskState = { tasks: [], nextId: 1 };

function stateWith(...tasks: Task[]): TaskState {
	return { tasks, nextId: Math.max(0, ...tasks.map((t) => t.id)) + 1 };
}

function task(id: number, status: TaskStatus, subject = `task ${id}`, extra: Partial<Task> = {}): Task {
	return { id, status, subject, ...extra };
}

function update(id: number, patch: Omit<TaskMutationParams, "action" | "id">): TaskMutationParams {
	return { action: "update", id, ...patch };
}

describe("status transitions — spec: todo-task-graph / 五状态迁移表", () => {
	it("rejects completed → in_progress and keeps the task completed", () => {
		const before = stateWith(task(1, "completed"));
		const { state, op } = applyTaskMutation(before, "update", update(1, { status: "in_progress" }));
		expect(op).toEqual({ kind: "error", message: "illegal transition completed → in_progress" });
		expect(state.tasks[0]?.status).toBe("completed");
	});

	it("treats deleted as terminal", () => {
		const { op } = applyTaskMutation(stateWith(task(1, "deleted")), "update", update(1, { status: "pending" }));
		expect(op).toEqual({ kind: "error", message: "illegal transition deleted → pending" });
	});

	it("accepts a same-status update as a no-op", () => {
		const { op, state } = applyTaskMutation(
			stateWith(task(1, "in_progress")),
			"update",
			update(1, { status: "in_progress" }),
		);
		expect(op).toMatchObject({ kind: "update", fromStatus: "in_progress", toStatus: "in_progress", changed: false });
		expect(changesState(op)).toBe(false);
		expect(state.tasks[0]?.status).toBe("in_progress");
	});
});

describe("waiting — spec: todo-task-graph / waiting 是可逆的停泊状态", () => {
	it("rejects a park with no reason and leaves the task untouched", () => {
		const before = stateWith(task(1, "in_progress"));
		const { state, op } = applyTaskMutation(before, "update", update(1, { status: "waiting" }));
		expect(op).toEqual({
			kind: "error",
			message: "status: waiting requires waitReason (what external event are you waiting for?)",
		});
		expect(state.tasks[0]?.status).toBe("in_progress");
		expect(state.tasks[0]?.waitReason).toBeUndefined();
	});

	it("rejects a whitespace-only reason", () => {
		const { op } = applyTaskMutation(
			stateWith(task(1, "pending")),
			"update",
			update(1, { status: "waiting", waitReason: "   " }),
		);
		expect(op.kind).toBe("error");
	});

	it("persists a trimmed reason on the task", () => {
		const { state } = applyTaskMutation(
			stateWith(task(1, "pending")),
			"update",
			update(1, { status: "waiting", waitReason: "  CI run  " }),
		);
		expect(state.tasks[0]).toMatchObject({ status: "waiting", waitReason: "CI run" });
	});

	it("drops the reason when the task moves on", () => {
		const parked = stateWith(task(1, "waiting", "task 1", { waitReason: "CI run" }));
		const { state } = applyTaskMutation(parked, "update", update(1, { status: "in_progress" }));
		expect(state.tasks[0]?.status).toBe("in_progress");
		expect(state.tasks[0]?.waitReason).toBeUndefined();
	});

	it("is reversible into pending as well", () => {
		const parked = stateWith(task(1, "waiting", "task 1", { waitReason: "user decision" }));
		const { state } = applyTaskMutation(parked, "update", update(1, { status: "pending" }));
		expect(state.tasks[0]).toMatchObject({ status: "pending" });
		expect(state.tasks[0]?.waitReason).toBeUndefined();
	});
});

describe("create — spec: todo-task-graph / create 的语义", () => {
	it("creates pending at nextId and advances the counter", () => {
		const { state, op } = applyTaskMutation(EMPTY, "create", { action: "create", subject: "Write tests" });
		expect(op).toEqual({ kind: "create", taskId: 1 });
		expect(state.tasks).toHaveLength(1);
		expect(state.tasks[0]).toMatchObject({ id: 1, subject: "Write tests", status: "pending" });
		expect(state.nextId).toBe(2);
	});

	it("rejects a blank subject without creating anything", () => {
		const { state, op } = applyTaskMutation(EMPTY, "create", { action: "create", subject: "   " });
		expect(op).toEqual({ kind: "error", message: "subject required for create" });
		expect(state.tasks).toHaveLength(0);
	});

	it("rejects a dangling dependency", () => {
		const { op } = applyTaskMutation(EMPTY, "create", { action: "create", subject: "x", blockedBy: [9] });
		expect(op).toEqual({ kind: "error", message: "blockedBy: #9 not found" });
	});

	it("rejects a deleted dependency", () => {
		const { op } = applyTaskMutation(stateWith(task(1, "deleted")), "create", {
			action: "create",
			subject: "x",
			blockedBy: [1],
		});
		expect(op).toEqual({ kind: "error", message: "blockedBy: #1 is deleted" });
	});
});

describe("update — spec: todo-task-graph / 可变字段与空更新拒绝", () => {
	it("rejects an id-only update", () => {
		const { op } = applyTaskMutation(stateWith(task(3, "pending")), "update", { action: "update", id: 3 });
		expect(op.kind).toBe("error");
		expect(op.kind === "error" && op.message).toMatch(/^update requires at least one mutable field:/);
		expect(op.kind === "error" && op.message).toContain("addBlockedBy");
	});

	it("reports an unknown id", () => {
		const { op } = applyTaskMutation(EMPTY, "update", update(99, { status: "completed" }));
		expect(op).toEqual({ kind: "error", message: "#99 not found" });
	});

	it("reports a real status change as changed", () => {
		const { state, op } = applyTaskMutation(
			stateWith(task(2, "pending")),
			"update",
			update(2, { status: "in_progress" }),
		);
		expect(op).toMatchObject({ kind: "update", fromStatus: "pending", toStatus: "in_progress", changed: true });
		expect(changesState(op)).toBe(true);
		expect(state.tasks[0]?.status).toBe("in_progress");
	});

	it("re-sending the same values is not a change", () => {
		const { op } = applyTaskMutation(stateWith(task(2, "pending", "Deploy")), "update", update(2, { subject: "Deploy" }));
		expect(op).toMatchObject({ kind: "update", changed: false });
		expect(changesState(op)).toBe(false);
	});
});

describe("blockedBy — spec: todo-task-graph / 依赖图是增量合并且无环", () => {
	const base = () => stateWith(task(1, "pending"), task(2, "pending"), task(3, "pending", "task 3", { blockedBy: [1] }));

	it("appends incrementally and keeps insertion order", () => {
		const { state } = applyTaskMutation(base(), "update", update(3, { addBlockedBy: [2] }));
		expect(state.tasks[2]?.blockedBy).toEqual([1, 2]);
	});

	it("does not duplicate an existing dependency", () => {
		const { state } = applyTaskMutation(base(), "update", update(3, { addBlockedBy: [1] }));
		expect(state.tasks[2]?.blockedBy).toEqual([1]);
	});

	it("removes incrementally", () => {
		const { state } = applyTaskMutation(base(), "update", update(3, { removeBlockedBy: [1] }));
		expect(state.tasks[2]?.blockedBy).toBeUndefined();
	});

	it("rejects self-blocking", () => {
		const { op } = applyTaskMutation(base(), "update", update(3, { addBlockedBy: [3] }));
		expect(op).toEqual({ kind: "error", message: "cannot block #3 on itself" });
	});

	it("reports a missing target before the dependency checks", () => {
		const { op } = applyTaskMutation(base(), "update", update(9, { addBlockedBy: [9] }));
		expect(op).toEqual({ kind: "error", message: "#9 not found" });
	});

	it("rejects a dangling dependency", () => {
		const { op } = applyTaskMutation(base(), "update", update(3, { addBlockedBy: [42] }));
		expect(op).toEqual({ kind: "error", message: "addBlockedBy: #42 not found" });
	});

	it("rejects a deleted dependency", () => {
		const { op } = applyTaskMutation(base(), "update", update(3, { addBlockedBy: [2] }));
		// #2 is live here — flip it first to assert the deleted branch specifically.
		expect(op.kind).toBe("update");
		const withDeleted = stateWith(task(1, "pending"), task(2, "deleted"));
		const { op: deletedOp } = applyTaskMutation(withDeleted, "update", update(1, { addBlockedBy: [2] }));
		expect(deletedOp).toEqual({ kind: "error", message: "addBlockedBy: #2 is deleted" });
	});

	it("rejects a cycle and mutates nothing", () => {
		const cyclic = stateWith(task(1, "pending", "task 1", { blockedBy: [2] }), task(2, "pending"));
		const { state, op } = applyTaskMutation(cyclic, "update", update(2, { addBlockedBy: [1] }));
		expect(op).toEqual({ kind: "error", message: "addBlockedBy would create a cycle in the blockedBy graph" });
		expect(state).toEqual(cyclic);
	});
});

describe("detectCycle / deriveBlocks — pure graph helpers", () => {
	it("finds a direct cycle", () => {
		const tasks = [task(1, "pending", "a", { blockedBy: [2] }), task(2, "pending", "b", { blockedBy: [1] })];
		expect(detectCycle(tasks, 1, [2])).toBe(true);
	});

	it("finds an indirect cycle", () => {
		const tasks = [
			task(1, "pending", "a", { blockedBy: [2] }),
			task(2, "pending", "b", { blockedBy: [3] }),
			task(3, "pending", "c"),
		];
		expect(detectCycle(tasks, 3, [1])).toBe(true);
		expect(detectCycle(tasks, 3, [])).toBe(false);
	});

	it("derives the inverse adjacency map", () => {
		const tasks = [task(1, "pending"), task(2, "pending", "b", { blockedBy: [1] }), task(3, "pending", "c", { blockedBy: [1] })];
		expect(deriveBlocks(tasks).get(1)).toEqual([2, 3]);
		expect(deriveBlocks(tasks).get(2)).toBeUndefined();
	});
});

describe("metadata — spec: todo-task-graph / metadata 的合并语义", () => {
	it("merges keys", () => {
		const { state } = applyTaskMutation(
			stateWith(task(1, "pending", "task 1", { metadata: { a: 1, b: 2 } })),
			"update",
			update(1, { metadata: { b: 3, c: 4 } }),
		);
		expect(state.tasks[0]?.metadata).toEqual({ a: 1, b: 3, c: 4 });
	});

	it("deletes a key on null", () => {
		const { state } = applyTaskMutation(
			stateWith(task(1, "pending", "task 1", { metadata: { a: 1, b: 2 } })),
			"update",
			update(1, { metadata: { b: null } }),
		);
		expect(state.tasks[0]?.metadata).toEqual({ a: 1 });
	});

	it("normalizes an emptied bag away", () => {
		const { state } = applyTaskMutation(
			stateWith(task(1, "pending", "task 1", { metadata: { a: 1 } })),
			"update",
			update(1, { metadata: { a: null } }),
		);
		expect(state.tasks[0]?.metadata).toBeUndefined();
	});
});

describe("delete / clear — spec: todo-task-graph", () => {
	it("keeps a tombstone and refuses a second delete", () => {
		const { state } = applyTaskMutation(stateWith(task(1, "pending")), "delete", { action: "delete", id: 1 });
		expect(state.tasks[0]?.status).toBe("deleted");
		const { op } = applyTaskMutation(state, "delete", { action: "delete", id: 1 });
		expect(op).toEqual({ kind: "error", message: "#1 is already deleted" });
	});

	it("keeps tombstones resolvable for historic dependencies", () => {
		const tombstoned = stateWith(task(1, "deleted"), task(2, "pending", "task 2", { blockedBy: [1] }));
		const { op } = applyTaskMutation(tombstoned, "get", { action: "get", id: 2 });
		expect(op.kind === "get" && op.task.blockedBy).toEqual([1]);
	});

	it("resets the id counter on clear", () => {
		const { state, op } = applyTaskMutation(stateWith(task(1, "pending"), task(2, "pending"), task(3, "pending")), "clear", {
			action: "clear",
		});
		expect(op).toEqual({ kind: "clear", count: 3 });
		expect(state).toEqual({ tasks: [], nextId: 1 });
	});
});
