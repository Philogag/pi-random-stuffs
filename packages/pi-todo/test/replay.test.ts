import { describe, expect, it } from "vitest";
import { replayFromBranch } from "../src/state/replay.js";
import type { Task } from "../src/tool/types.js";

const base = () => ({ tasks: [], nextId: 1 });

function stateEntry(customType: string, tasks: Task[], nextId: number) {
	return {
		type: "custom",
		customType,
		data: { action: "create", params: { action: "create" }, tasks, nextId },
	};
}

function toolResultEntry(tasks: Task[], nextId: number, toolName = "todo") {
	return {
		type: "message",
		message: { role: "toolResult", toolName, details: { action: "create", params: {}, tasks, nextId } },
	};
}

function replay(branch: unknown[]) {
	return replayFromBranch({ sessionManager: { getBranch: () => branch } });
}

const T1: Task = { id: 1, status: "pending", subject: "a" };
const T2: Task = { id: 2, status: "in_progress", subject: "b" };

describe("replay — spec: todo-task-graph / 分支重放（最后写入者胜）", () => {
	it("returns empty state for a branch with no todo history", () => {
		expect(replay([])).toEqual(base());
		expect(replay([{ type: "message", message: { role: "user" } }])).toEqual(base());
	});

	it("takes the last state entry on the branch", () => {
		expect(replay([stateEntry("pi-todo-state", [T1], 2), stateEntry("pi-todo-state", [T1, T2], 3)])).toEqual({
			tasks: [T1, T2],
			nextId: 3,
		});
	});

	it("accepts the legacy entry type so pre-rename sessions still replay", () => {
		expect(replay([stateEntry("rpiv-todo-state", [T1], 2)]).tasks).toEqual([T1]);
	});

	it("prefers entries over toolResult snapshots even when the entry is older", () => {
		const branch = [stateEntry("pi-todo-state", [T1], 2), toolResultEntry([T1, T2], 3)];
		expect(replay(branch).tasks).toEqual([T1]);
	});

	it("falls back to toolResult details when no entry exists", () => {
		expect(replay([toolResultEntry([T1, T2], 3)])).toEqual({ tasks: [T1, T2], nextId: 3 });
	});

	it("ignores toolResults from other tools and malformed details", () => {
		expect(replay([toolResultEntry([T1], 2, "bash")]).tasks).toEqual([]);
		expect(
			replay([{ type: "message", message: { role: "toolResult", toolName: "todo", details: { tasks: [T1] } } }]).tasks,
		).toEqual([]);
		expect(replay([{ type: "custom", customType: "pi-todo-state", data: { tasks: "nope" } }]).tasks).toEqual([]);
	});

	it("copies the snapshot so replayed tasks never alias branch data", () => {
		const entry = stateEntry("pi-todo-state", [T1], 2);
		const snapshot = replay([entry]);
		expect(snapshot.tasks[0]).not.toBe(entry.data.tasks[0]);
		snapshot.tasks[0]!.subject = "mutated";
		expect(entry.data.tasks[0]?.subject).toBe("a");
	});

	it("keeps tombstones so historic blockedBy references still resolve", () => {
		const tombstone: Task = { id: 1, status: "deleted", subject: "gone" };
		expect(replay([stateEntry("pi-todo-state", [tombstone], 2)]).tasks[0]?.status).toBe("deleted");
	});

	it("returns a fresh empty-state copy rather than the shared constant", () => {
		const a = replay([]);
		a.tasks.push(T1);
		expect(replay([]).tasks).toEqual([]);
	});
});
