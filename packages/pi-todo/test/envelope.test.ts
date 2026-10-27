import { beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { registerTodoTool } from "../src/todo.js";
import { __resetState, getState, setActiveRenderSession } from "../src/state/store.js";
import type { TaskDetails } from "../src/tool/types.js";

const SESSION = "session-1";

/** Identity theme: the assertions read the literal text, not ANSI output. */
const theme = {
	fg: (_color: string, s: string) => s,
	bold: (s: string) => s,
	strikethrough: (s: string) => s,
} as unknown as Theme;

interface Registered {
	// Biome-free structural stand-in for Pi's ToolDefinition.
	execute: (...args: never[]) => Promise<{ content: Array<{ type: string; text: string }>; details: TaskDetails }>;
	renderCall: (args: never, theme: Theme, ctx: unknown) => unknown;
	renderResult: (result: never, opts: unknown, theme: Theme, ctx: unknown) => unknown;
}

interface Harness {
	tool: Registered;
	entries: Array<{ customType: string; data: TaskDetails }>;
}

function harness(): Harness {
	const h = { entries: [] as Harness["entries"] } as Harness;
	const pi = {
		registerTool: (tool: unknown) => {
			h.tool = tool as Registered;
		},
		registerCommand: () => {},
		appendEntry: (customType: string, data: TaskDetails) => h.entries.push({ customType, data }),
	} as unknown as ExtensionAPI;
	registerTodoTool(pi);
	return h;
}

const ctx = {
	hasUI: false,
	ui: { notify: () => {} },
	sessionManager: { getSessionId: () => SESSION },
} as never;

let h: Harness;

beforeEach(() => {
	__resetState();
	h = harness();
});

function call(params: Record<string, unknown>) {
	return h.tool.execute("call-1" as never, params as never, undefined as never, undefined as never, ctx);
}

/** Body text of the envelope, one string per line. */
async function lines(params: Record<string, unknown>): Promise<string[]> {
	const result = await call(params);
	return result.content.map((c) => c.text).join("\n").split("\n");
}

async function body(params: Record<string, unknown>): Promise<string> {
	return (await lines(params)).join("\n");
}

describe("envelope — spec: todo-task-graph / 结果信封", () => {
	it("announces a create with subject and status", async () => {
		expect(await body({ action: "create", subject: "Write spec" })).toBe("Created #1: Write spec (pending)");
	});

	it("announces a status change with both ends", async () => {
		await call({ action: "create", subject: "Implement" });
		expect(await body({ action: "update", id: 1, status: "in_progress" })).toBe("Updated #1 (pending → in_progress)");
	});

	it("omits the arrow when only a non-status field changed", async () => {
		await call({ action: "create", subject: "Implement" });
		expect(await body({ action: "update", id: 1, subject: "Implement it" })).toBe("Updated #1");
	});

	it("reports a no-effect update as No change, with the status it settled on", async () => {
		await call({ action: "create", subject: "Deploy" });
		expect(await body({ action: "update", id: 1, subject: "Deploy" })).toBe(
			"No change: #1 already matches the requested values (status: pending)",
		);
	});

	it("surfaces a validation error and leaves state untouched", async () => {
		await call({ action: "create", subject: "A" });
		expect(await body({ action: "update", id: 1, status: "waiting" })).toBe(
			"Error: status: waiting requires waitReason (what external event are you waiting for?)",
		);
		expect(getState(SESSION).tasks[0]?.status).toBe("pending");
		expect(getState(SESSION).tasks[0]?.waitReason).toBeUndefined();
	});

	it("reports well-formed failures for missing ids", async () => {
		expect(await body({ action: "get", id: 42 })).toBe("Error: #42 not found");
		expect(await body({ action: "delete", id: 42 })).toBe("Error: #42 not found");
	});

	it("carries the waiting reason inside the transition line", async () => {
		await call({ action: "create", subject: "Deploy" });
		expect(await body({ action: "update", id: 1, status: "waiting", waitReason: "CI run" })).toBe(
			"Updated #1 (pending → waiting)",
		);
		expect(getState(SESSION).tasks[0]?.waitReason).toBe("CI run");
	});

	it("renders one line per visible task, tombstones hidden", async () => {
		await call({ action: "create", subject: "a" });
		await call({ action: "create", subject: "b" });
		await call({ action: "update", id: 2, status: "in_progress", activeForm: "doing b" });
		await call({ action: "create", subject: "c" });
		await call({ action: "delete", id: 3 });
		expect(await lines({ action: "list" })).toEqual(["[pending] #1 a", "[in_progress] #2 b (doing b)"]);
	});

	it("shows tombstones only on request", async () => {
		await call({ action: "create", subject: "a" });
		await call({ action: "delete", id: 1 });
		expect(await lines({ action: "list", includeDeleted: true })).toEqual(["[deleted] #1 a"]);
	});

	it("filters list by status", async () => {
		await call({ action: "create", subject: "a" });
		await call({ action: "create", subject: "b" });
		await call({ action: "update", id: 1, status: "completed" });
		expect(await lines({ action: "list", status: "completed" })).toEqual(["[completed] #1 a"]);
	});

	it("renders an empty list without a count header", async () => {
		expect(await body({ action: "list" })).toBe("No tasks");
	});

	it("renders a dependency suffix on list lines", async () => {
		await call({ action: "create", subject: "base" });
		await call({ action: "create", subject: "top", blockedBy: [1] });
		expect(await lines({ action: "list" })).toEqual(["[pending] #1 base", "[pending] #2 top ⛓ #1"]);
	});

	it("renders get with description, activeForm, blockers and dependents", async () => {
		await call({ action: "create", subject: "base", description: "the base" });
		await call({ action: "create", subject: "top", blockedBy: [1] });
		expect(await lines({ action: "get", id: 1 })).toEqual([
			"#1 [pending] base",
			"  description: the base",
			"  blocks: #2",
		]);
		expect(await lines({ action: "get", id: 2 })).toEqual(["#2 [pending] top", "  blockedBy: #1"]);
	});

	it("renders delete and clear counts", async () => {
		await call({ action: "create", subject: "a" });
		await call({ action: "create", subject: "b" });
		expect(await body({ action: "delete", id: 1 })).toBe("Deleted #1: a");
		// clear removes tombstones too, so the count is every task on the branch.
		expect(await body({ action: "clear" })).toBe("Cleared 2 tasks");
		expect(await body({ action: "clear" })).toBe("Cleared 0 tasks");
	});

	it("strips terminal control characters from model-authored text", async () => {
		await call({ action: "create", subject: "a\u001b[31mb\nc" });
		// CSI sequence dropped whole, newline flattened to a space.
		expect(await body({ action: "list" })).toBe("[pending] #1 ab c");
	});
});

describe("persistence — spec: todo-task-graph / 权威快照", () => {
	it("appends the full snapshot after every state-changing call", async () => {
		await call({ action: "create", subject: "a" });
		await call({ action: "create", subject: "b" });
		expect(h.entries).toHaveLength(2);
		expect(h.entries[1]).toEqual({
			customType: "pi-todo-state",
			data: {
				action: "create",
				params: { action: "create", subject: "b" },
				tasks: [
					{ id: 1, status: "pending", subject: "a" },
					{ id: 2, status: "pending", subject: "b" },
				],
				nextId: 3,
			},
		});
	});

	it("does not append for reads, rejections, or no-effect updates", async () => {
		await call({ action: "create", subject: "a" });
		await call({ action: "list" });
		await call({ action: "get", id: 1 });
		await call({ action: "update", id: 9, status: "completed" });
		await call({ action: "update", id: 1, subject: "a" });
		expect(h.entries).toHaveLength(1);
	});

	it("records the error in details while appending nothing", async () => {
		const result = await call({ action: "update", id: 7, status: "completed" });
		expect(result.details.error).toBe("#7 not found");
		expect(result.details.tasks).toEqual([]);
	});

	it("appends the cleared snapshot and resets nextId", async () => {
		await call({ action: "create", subject: "a" });
		await call({ action: "clear" });
		expect(h.entries.at(-1)?.data).toEqual({ action: "clear", params: { action: "clear" }, tasks: [], nextId: 1 });
	});

	it("keeps sessions isolated", async () => {
		await call({ action: "create", subject: "a" });
		const otherCtx = { ...(ctx as object), sessionManager: { getSessionId: () => "session-2" } } as never;
		const result = await h.tool.execute("c2" as never, { action: "list" } as never, undefined as never, undefined as never, otherCtx);
		expect(result.content[0]?.text).toBe("No tasks");
		expect(getState("session-2").tasks).toEqual([]);
	});
});

describe("render hooks — spec: todo-task-graph / 渲染钩子回退", () => {
	function rendered(node: unknown): string {
		// Text.render pads every line out to the requested width.
		return (node as { render(w: number): string[] })
			.render(200)
			.map((line) => line.trimEnd())
			.join("\n");
	}

	it("renders the call as 'todo <actionGlyph> <target>'", async () => {
		await call({ action: "create", subject: "Ship it" });
		expect(rendered(h.tool.renderCall({ action: "create", subject: "Ship it" } as never, theme, {}))).toBe("todo + Ship it");
		expect(rendered(h.tool.renderCall({ action: "list" } as never, theme, {}))).toBe("todo ☰");
		// renderCall reads the FOREGROUND render slot, not the calling session's.
		expect(rendered(h.tool.renderCall({ action: "update", id: 1 } as never, theme, {}))).toBe("todo → #1");
		setActiveRenderSession(SESSION);
		expect(rendered(h.tool.renderCall({ action: "update", id: 1 } as never, theme, {}))).toBe("todo → Ship it");
	});

	it("falls back to #id when the subject is unknown", () => {
		expect(rendered(h.tool.renderCall({ action: "get", id: 5 } as never, theme, {}))).toBe("todo › #5");
	});

	it("echoes the resulting status for create/update/delete", async () => {
		const created = await call({ action: "create", subject: "a" });
		expect(rendered(h.tool.renderResult(created as never, {}, theme, {}))).toBe("○ pending");
		const done = await call({ action: "update", id: 1, status: "completed" });
		expect(rendered(h.tool.renderResult(done as never, {}, theme, {}))).toBe("● completed");
	});

	it("falls back to a plain check for list/get/clear", async () => {
		expect(rendered(h.tool.renderResult((await call({ action: "list" })) as never, {}, theme, {}))).toBe("✓");
		expect(rendered(h.tool.renderResult((await call({ action: "clear" })) as never, {}, theme, {}))).toBe("✓");
	});
});
