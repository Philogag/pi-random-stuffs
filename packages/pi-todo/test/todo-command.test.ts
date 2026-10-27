import { beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTodosCommand } from "../src/todo.js";
import { __resetState, commitState } from "../src/state/store.js";
import type { Task } from "../src/tool/types.js";

const SESSION = "session-1";
const NO_TODOS = "No todos yet. Ask the agent to add some!";
const NO_UI = "/todos requires interactive mode";

interface Notice {
	text: string;
	level: string;
}

interface Harness {
	handler: (args: string, ctx: unknown) => Promise<void>;
	notices: Notice[];
}

function harness(): Harness {
	const h = { notices: [] as Notice[] } as Harness;
	const pi = {
		registerTool: () => {},
		registerCommand: (name: string, spec: { handler: Harness["handler"] }) => {
			expect(name).toBe("todos");
			h.handler = spec.handler;
		},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;
	registerTodosCommand(pi);
	return h;
}

function seed(...tasks: Task[]): void {
	commitState(SESSION, { tasks, nextId: Math.max(0, ...tasks.map((t) => t.id)) + 1 });
}

function uiCtx(hasUI = true): unknown {
	return {
		hasUI,
		ui: {
			notify: (text: string, level: string) => {
				notices.push({ text, level });
			},
		},
		sessionManager: { getSessionId: () => SESSION },
	};
}

let h: Harness;
let notices: Notice[];

beforeEach(() => {
	__resetState();
	h = harness();
	notices = h.notices;
});

describe("/todos — spec: todo-overlay / 分组与段序", () => {
	it("renders a header part per non-empty group, in completed → in progress → waiting → pending order", async () => {
		seed(
			{ id: 1, status: "pending", subject: "p" },
			{ id: 2, status: "in_progress", subject: "ip", activeForm: "doing" },
			{ id: 3, status: "waiting", subject: "w", waitReason: "ci" },
			{ id: 4, status: "completed", subject: "c" },
		);
		await h.handler("", uiCtx());
		expect(notices).toEqual([
			{
				text: [
					"1/4 completed · 1 in progress · 1 waiting · 1 pending",
					"── Pending ──",
					"  ○ #1 p",
					"── In Progress ──",
					"  ◐ #2 ip (doing)",
					"── Waiting ──",
					"  ◍ #3 w    ⏸ ci",
					"── Completed ──",
					"  ✓ #4 c",
				].join("\n"),
				level: "info",
			},
		]);
	});

	it("omits empty groups from both the header and the body", async () => {
		seed({ id: 1, status: "pending", subject: "only" });
		await h.handler("", uiCtx());
		expect(notices[0]?.text).toBe(["1 pending", "── Pending ──", "  ○ #1 only"].join("\n"));
	});

	it("does not render deleted tombstones", async () => {
		seed({ id: 1, status: "deleted", subject: "gone" }, { id: 2, status: "pending", subject: "live" });
		await h.handler("", uiCtx());
		expect(notices[0]?.text).toContain("#2 live");
		expect(notices[0]?.text).not.toContain("gone");
	});

	it("reports an empty list rather than an empty panel", async () => {
		await h.handler("", uiCtx());
		expect(notices).toEqual([{ text: NO_TODOS, level: "info" }]);
	});

	it("refuses to run without UI", async () => {
		seed({ id: 1, status: "pending", subject: "a" });
		await h.handler("", uiCtx(false));
		expect(notices).toEqual([{ text: NO_UI, level: "error" }]);
	});
});
