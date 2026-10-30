// test/tool.test.ts
//
// End-to-end: drive the real `openspec` TOOL against the bundled binary in a
// throwaway spec root. This is the test that proves the bridge actually
// replaces the shell: init → new change → list --json → status, all through
// `execute()` with structured params and an explicit `root`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { registerOpenspecTool, formatRunForModel, TOOL_NAME } from "../src/tool.js";
import type { OpenspecToolParams } from "../src/cli/schema.js";

const roots: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-openspec-bridge-e2e-"));
  roots.push(dir);
  return dir;
}

interface CapturedTool {
  name: string;
  parameters: unknown;
  execute: (
    id: string,
    params: unknown,
    signal: undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
}

function captureTool(options: Parameters<typeof registerOpenspecTool>[1] = {}): CapturedTool {
  let captured: CapturedTool | undefined;
  const pi = {
    registerTool(tool: CapturedTool) {
      captured = tool;
    },
  };
  registerOpenspecTool(pi as never, options);
  if (!captured) throw new Error("tool was not registered");
  return captured;
}

/** Fake ExtensionContext: only `cwd` is read by the tool. */
function ctxFor(cwd: string): unknown {
  return { cwd, mode: "print" };
}

function text(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((c) => c.text).join("\n");
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe("openspec tool — registration", () => {
  it("registers with the documented name and a schema carrying the subcommand enum", () => {
    const tool = captureTool();
    expect(tool.name).toBe(TOOL_NAME);
    const schema = tool.parameters as { properties: Record<string, { enum?: string[] }> };
    expect(schema.properties["subcommand"]?.enum).toContain("new change");
    expect(schema.properties["subcommand"]?.enum).toContain("store register");
    // `root` is a first-class bridge param, not a plain flag.
    expect(schema.properties["root"]).toBeDefined();
  });
});

describe("openspec tool — end to end against the bundled CLI", () => {
  it("creates a change in an explicit spec root and lists it as JSON", async () => {
    const tool = captureTool();
    const root = makeRoot();

    const created = await tool.execute(
      "call-1",
      { subcommand: "new change", args: ["add-dark-mode"], description: "Add dark mode", root } satisfies OpenspecToolParams,
      undefined,
      undefined,
      ctxFor(makeRoot()), // session cwd deliberately differs from `root`
    );
    expect(created.details["ok"]).toBe(true);
    expect(created.details["cwd"]).toBe(root);
    expect(text(created)).toContain("add-dark-mode");

    const listed = await tool.execute(
      "call-2",
      { subcommand: "list", json: true, root } satisfies OpenspecToolParams,
      undefined,
      undefined,
      ctxFor(makeRoot()),
    );
    const body = text(listed).split("\n\n").slice(1).join("\n\n");
    const parsed = JSON.parse(body) as { changes: Array<{ name: string }>; root?: { path: string } };
    expect(parsed.changes.map((c) => c.name)).toContain("add-dark-mode");
    expect(parsed.root?.path).toBe(root);
  }, 60_000);

  it("reports a non-zero exit as data (details.ok=false) while keeping stdout", async () => {
    const tool = captureTool();
    const root = makeRoot();

    const result = await tool.execute(
      "call-3",
      { subcommand: "status", change: "does-not-exist", json: true, root } satisfies OpenspecToolParams,
      undefined,
      undefined,
      ctxFor(root),
    );
    expect(result.details["ok"]).toBe(false);
    expect(result.details["exitCode"]).not.toBe(0);
    // The CLI's JSON failure payload survives — the model can read the code.
    expect(text(result)).toContain("status");
  }, 60_000);

  it("resolves a relative root against the session cwd", async () => {
    const tool = captureTool();
    const root = makeRoot();

    const result = await tool.execute(
      "call-4",
      { subcommand: "list", json: true, root: "." } satisfies OpenspecToolParams,
      undefined,
      undefined,
      ctxFor(root),
    );
    expect(result.details["cwd"]).toBe(root);
  }, 60_000);

  it("surfaces the tracking hook with the structured params", async () => {
    const seen: OpenspecToolParams[] = [];
    const tool = captureTool({ onRun: (params) => seen.push(params) });
    const root = makeRoot();

    await tool.execute(
      "call-5",
      { subcommand: "new change", args: ["tracked-change"], root } satisfies OpenspecToolParams,
      undefined,
      undefined,
      ctxFor(root),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.subcommand).toBe("new change");
  }, 60_000);
});

describe("formatRunForModel", () => {
  it("prints the effective command, cwd and exit summary", () => {
    const out = formatRunForModel({
      argv: ["list", "--json"],
      command: "node",
      cwd: "/specs",
      exitCode: 1,
      signal: null,
      stdout: "{}",
      stderr: "boom",
      timedOut: false,
      durationMs: 12,
      binary: { command: "node", prefixArgs: [], source: "bundled", label: "bundled" },
    });
    expect(out).toContain("$ openspec list --json");
    expect(out).toContain("# cwd: /specs");
    expect(out).toContain("[stderr]\nboom");
    expect(out).toContain("[exit code 1]");
  });

  it("says so when there is no output at all", () => {
    const out = formatRunForModel({
      argv: ["version"],
      command: "node",
      cwd: "/specs",
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 3,
      binary: { command: "node", prefixArgs: [], source: "bundled", label: "bundled" },
    });
    expect(out).toContain("(no output)");
  });
});
