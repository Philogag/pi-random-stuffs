import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_KEY, getReminderSettings } from "../src/config.js";
import todoExtension from "../src/index.js";
import { DEFAULT_REMINDER_MODES, isPiMode, parseModes, resolveMode } from "../src/mode.js";
import { __resetState, commitState, getState } from "../src/state/store.js";
import type { TodoOverlay as RealTodoOverlay } from "../src/todo-overlay.js";

const SESSION = "session-mode";
const REMINDER_TYPE = "pi-todo-reminder";

// ---------------------------------------------------------------------------
// Harness — a fake pi that records handlers and a fake overlay module
// ---------------------------------------------------------------------------

type Handler = (event: unknown, ctx: unknown) => unknown;

interface FakePi {
	pi: ExtensionAPI;
	handlers: Map<string, Handler[]>;
	fire: (event: string, payload: unknown, ctx: unknown) => Promise<unknown>;
	overlayImports: () => number;
	overlayInstances: FakeOverlay[];
}

interface FakeOverlay {
	setUICtx(ctx: unknown): void;
	update(): void;
	dispose(): void;
	resetCompletedDisplayState(): void;
	hideCompletedTasksFromPreviousTurn(): void;
	toggleCollapse(): void;
	isRegistered(): boolean;
}

function fakeOverlay(): FakeOverlay {
	return {
		setUICtx: () => {},
		update: () => {},
		dispose: () => {},
		resetCompletedDisplayState: () => {},
		hideCompletedTasksFromPreviousTurn: () => {},
		toggleCollapse: () => {},
		isRegistered: () => true,
	};
}

function harness(): FakePi {
	const handlers = new Map<string, Handler[]>();
	const overlayInstances: FakeOverlay[] = [];
	let imports = 0;
	const pi = {
		on: (event: string, handler: Handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerTool: () => {},
		registerCommand: () => {},
		registerShortcut: () => {},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;

	const importer = async () => {
		imports += 1;
		return {
			TodoOverlay: class {
				constructor() {
					overlayInstances.push(fakeOverlay());
				}
			} as unknown as typeof RealTodoOverlay,
		};
	};

	todoExtension(pi, importer);

	return {
		pi,
		handlers,
		overlayImports: () => imports,
		overlayInstances,
		async fire(event, payload, ctx) {
			const results: unknown[] = [];
			for (const handler of handlers.get(event) ?? []) results.push(await handler(payload, ctx));
			return results[0];
		},
	};
}

function ctxFor(mode: string, hasUI = mode === "tui" || mode === "rpc") {
	return {
		mode,
		hasUI,
		ui: {
			notify: () => {},
			setWidget: () => {},
			getToolsExpanded: () => false,
			theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s, strikethrough: (s: string) => s },
		},
		sessionManager: { getSessionId: () => SESSION, getBranch: () => [] },
	} as unknown as { mode: string; hasUI: boolean };
}

function openTask(): void {
	commitState(SESSION, { tasks: [{ id: 1, status: "pending", subject: "Unfinished" }], nextId: 2 });
}

function settleEvent() {
	return { outcome: "completed", context: { canContinue: true, llmMessages: [] } };
}

let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "pi-todo-modes-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	__resetState();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

function writeSettings(body: unknown): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Pure policy
// ---------------------------------------------------------------------------

describe("resolveMode — spec: prompt-contract / 运行模式", () => {
	it("trusts ctx.mode when it is a known mode", () => {
		for (const mode of ["tui", "rpc", "json", "print"]) {
			expect(resolveMode({ mode, hasUI: true })).toBe(mode);
		}
	});

	it("falls back to hasUI for hosts that predate ctx.mode", () => {
		expect(resolveMode({ hasUI: true })).toBe("tui");
		expect(resolveMode({ hasUI: false })).toBe("print");
		expect(resolveMode({ mode: "web", hasUI: false })).toBe("print");
		expect(resolveMode({ mode: "web", hasUI: true })).toBe("tui");
		expect(resolveMode(undefined)).toBe("print");
	});

	it("recognises only the four documented modes", () => {
		expect(isPiMode("rpc")).toBe(true);
		expect(isPiMode("interactive")).toBe(false);
		expect(isPiMode(undefined)).toBe(false);
	});
});

describe("parseModes — spec: todo-reminder / 运行模式策略", () => {
	it("keeps known modes in canonical order and drops the rest", () => {
		expect(parseModes(["json", "nope", "tui"])).toEqual(["tui", "json"]);
		expect(parseModes(["rpc", "rpc"])).toEqual(["rpc"]);
	});

	it("returns undefined when nothing usable survives, so the default applies", () => {
		expect(parseModes([])).toBeUndefined();
		expect(parseModes(["typo"])).toBeUndefined();
		expect(parseModes("tui")).toBeUndefined();
		expect(parseModes(undefined)).toBeUndefined();
	});
});

describe("reminder mode defaults — spec: todo-reminder / 运行模式策略", () => {
	it("defaults to tui + rpc", () => {
		expect(getReminderSettings().modes).toEqual(DEFAULT_REMINDER_MODES);
		expect(DEFAULT_REMINDER_MODES).toEqual(["tui", "rpc"]);
	});

	it("reads an override from settings", () => {
		writeSettings({ [PACKAGE_KEY]: { reminders: { modes: ["json", "print"] } } });
		expect(getReminderSettings().modes).toEqual(["json", "print"]);
	});

	it("falls back to the default on an unusable override", () => {
		writeSettings({ [PACKAGE_KEY]: { reminders: { modes: ["web"] } } });
		expect(getReminderSettings().modes).toEqual(DEFAULT_REMINDER_MODES);
	});
});

// ---------------------------------------------------------------------------
// Extension-level behaviour per mode
// ---------------------------------------------------------------------------

describe("overlay binding — spec: todo-overlay / widget 只在 TUI 注册", () => {
	it("never imports the overlay module in rpc, json or print", async () => {
		vi.useFakeTimers();
		for (const mode of ["rpc", "json", "print"]) {
			const h = harness();
			await h.fire("session_start", {}, ctxFor(mode));
			vi.advanceTimersByTime(60_000);
			expect(h.overlayImports()).toBe(0);
			expect(h.overlayInstances).toHaveLength(0);
		}
	});

	it("pre-warms the overlay module only for a TUI session", async () => {
		vi.useFakeTimers();
		const h = harness();
		await h.fire("session_start", {}, ctxFor("tui"));
		expect(h.overlayImports()).toBe(0);
		vi.advanceTimersByTime(2_000);
		await vi.runAllTicks();
		expect(h.overlayImports()).toBe(1);
	});

	it("still replays the session's tasks in a non-TUI mode", async () => {
		const h = harness();
		await h.fire(
			"session_start",
			{},
			{
				...ctxFor("rpc"),
				sessionManager: {
					getSessionId: () => SESSION,
					getBranch: () => [
						{
							type: "custom",
							customType: "pi-todo-state",
							data: { action: "create", params: {}, tasks: [{ id: 7, status: "pending", subject: "replayed" }], nextId: 8 },
						},
					],
				},
			},
		);
		expect(getState(SESSION).tasks).toHaveLength(1);
		expect(h.overlayInstances).toHaveLength(0);
	});

	it("exposes no UI context, so a todo mutation cannot touch a widget", async () => {
		const h = harness();
		await h.fire("session_start", {}, ctxFor("json"));
		await h.fire("tool_execution_end", { toolName: "todo", isError: false }, ctxFor("json"));
		expect(h.overlayImports()).toBe(0);
	});
});

describe("reminder gating — spec: todo-reminder / 运行模式策略", () => {
	async function settleIn(mode: string) {
		const h = harness();
		await h.fire("session_start", {}, ctxFor(mode));
		// Seed AFTER session_start: that handler replaces the slot with the replayed
		// branch, so seeding first would be wiped.
		openTask();
		await h.fire("before_agent_start", {}, ctxFor(mode));
		return h.fire("agent_before_settle", settleEvent(), ctxFor(mode));
	}

	it("fires in TUI mode", async () => {
		const result = (await settleIn("tui")) as { entries: Array<{ customType: string; display: boolean }>; continue: boolean };
		expect(result.continue).toBe(true);
		expect(result.entries[0]?.customType).toBe(REMINDER_TYPE);
		expect(result.entries[0]?.display).toBe(true);
	});

	it("fires in RPC mode, reading this session's own slot", async () => {
		const result = await settleIn("rpc");
		expect(result).toMatchObject({ continue: true });
	});

	it("never fires in json mode", async () => {
		expect(await settleIn("json")).toBeUndefined();
	});

	it("never fires in print mode", async () => {
		expect(await settleIn("print")).toBeUndefined();
	});

	it("honours a modes override in both directions", async () => {
		writeSettings({ [PACKAGE_KEY]: { reminders: { modes: ["json"] } } });
		expect(await settleIn("json")).toMatchObject({ continue: true });
		expect(await settleIn("tui")).toBeUndefined();
	});

	it("keeps reminders silent when disabled, whatever the mode set says", async () => {
		writeSettings({ [PACKAGE_KEY]: { reminders: { enabled: false, modes: ["tui"] } } });
		expect(await settleIn("tui")).toBeUndefined();
	});
});
