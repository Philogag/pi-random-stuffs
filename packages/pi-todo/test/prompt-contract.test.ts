import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_KEY } from "../src/config.js";
import { DEFAULT_PROMPT_GUIDELINES, DEFAULT_PROMPT_SNIPPET, registerTodoTool } from "../src/todo.js";

type Registration = Parameters<ExtensionAPI["registerTool"]>[0];

/** Capture the registration without spinning up a pi runtime. */
function captureRegistration(): Registration {
	const captured: Registration[] = [];
	const pi = {
		registerTool: (tool: Registration) => {
			captured.push(tool);
			return () => undefined;
		},
	} as unknown as ExtensionAPI;
	registerTodoTool(pi);
	const [tool] = captured;
	if (!tool) throw new Error("registerTodoTool registered nothing");
	return tool;
}

function writeSettings(dir: string, body: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "settings.json"), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "pi-todo-contract-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("tool registration — the model-facing contract", () => {
	it("keeps the fork's tool name and label so session history still replays", () => {
		const tool = captureRegistration();
		expect(tool.name).toBe("todo");
		expect(tool.label).toBe("Todo");
	});

	it("ships a description that advertises the 5-state machine", () => {
		const description = captureRegistration().description ?? "";
		for (const status of ["pending", "in_progress", "waiting", "completed", "deleted"]) {
			expect(description).toContain(status);
		}
		expect(description).toContain("blockedBy");
	});

	it("injects the default snippet and guidelines when config is absent", () => {
		const tool = captureRegistration();
		expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
		expect(tool.promptGuidelines).toEqual(DEFAULT_PROMPT_GUIDELINES);
	});

	it("exposes `waiting` and `waitReason` in the parameter schema", () => {
		const schema = JSON.stringify(captureRegistration().parameters);
		expect(schema).toContain('"waiting"');
		expect(schema).toContain("waitReason");
	});

	it("lets settings override the injected prompt copy", () => {
		writeSettings(agentDir, {
			[PACKAGE_KEY]: { guidance: { promptSnippet: "custom snippet", promptGuidelines: ["custom rule"] } },
		});
		const tool = captureRegistration();
		expect(tool.promptSnippet).toBe("custom snippet");
		expect(tool.promptGuidelines).toEqual(["custom rule"]);
	});

	it("falls back to the defaults when the override is malformed", () => {
		writeSettings(agentDir, { [PACKAGE_KEY]: { guidance: { promptGuidelines: "not-an-array" } } });
		const tool = captureRegistration();
		expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
		expect(tool.promptGuidelines).toEqual(DEFAULT_PROMPT_GUIDELINES);
	});
});

describe("default prompt copy", () => {
	it("stays short enough to pay on every request", () => {
		expect(DEFAULT_PROMPT_SNIPPET.length).toBeLessThanOrEqual(90);
		expect(DEFAULT_PROMPT_GUIDELINES).toHaveLength(6);
		expect(DEFAULT_PROMPT_GUIDELINES.every((line) => line.length <= 400)).toBe(true);
	});

	it("covers the rules that actually get violated", () => {
		const rules = DEFAULT_PROMPT_GUIDELINES.join("\n");
		expect(rules).toContain("Exactly one task is in_progress");
		expect(rules).toContain("verified");
		expect(rules).toContain("waiting");
		expect(rules).toContain("waitReason");
		expect(rules).toContain("addBlockedBy");
		expect(rules).toContain("includeDeleted:true");
	});

	it("has no duplicate lines", () => {
		expect(new Set(DEFAULT_PROMPT_GUIDELINES).size).toBe(DEFAULT_PROMPT_GUIDELINES.length);
	});
});
