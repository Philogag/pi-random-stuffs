// src/select.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

vi.mock("./openspec.js", () => ({ runOpenspecStatus: vi.fn() }));
vi.mock("./discover.js", () => ({ listActiveChanges: vi.fn() }));

import piTuiOpenspecStatus from "./index.js";
import { runOpenspecStatus } from "./openspec.js";
import { listActiveChanges } from "./discover.js";

const mockedRunOpenspecStatus = vi.mocked(runOpenspecStatus);
const mockedListActiveChanges = vi.mocked(listActiveChanges);

type CommandHandler = (
  args: string,
  ctx: { cwd: string; ui: { select: (p: string, i: string[]) => Promise<string | undefined> } },
) => Promise<void> | void;

function makePi() {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  let command: CommandHandler | undefined;
  return {
    on(event: string, h: (...a: unknown[]) => void) {
      (listeners[event] ??= []).push(h);
    },
    fire(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((h) => h(...args));
    },
    registerCommand(_name: string, opts: { handler: CommandHandler }) {
      command = opts.handler;
    },
    runCommand(args: string, ctx: Parameters<CommandHandler>[1]) {
      return command?.(args, ctx);
    },
  };
}

async function tick() {
  // 50ms headroom: the render chain does real fs ops (access/readFile),
  // which can exceed a tiny window under parallel suite load.
  await new Promise<void>((r) => setTimeout(r, 50));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("piTuiOpenspecStatus — /tui-openspec-select", () => {
  let tmpRoot: string;
  let pi: ReturnType<typeof makePi>;
  let statuses: Array<string | undefined>;

  const ctxFor = (cwd: string, select: (p: string, i: string[]) => Promise<string | undefined>) => ({
    mode: "tui" as const,
    hasUI: true,
    cwd,
    ui: { select, setStatus: (_id: string, text: string | undefined) => statuses.push(text) },
  });

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-select-"));
    pi = makePi();
    statuses = [];
    piTuiOpenspecStatus(pi as never, ctxFor(tmpRoot, () => Promise.resolve("x")), { debounceMs: 0 });
    mockedRunOpenspecStatus.mockReset();
    mockedListActiveChanges.mockReset();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("selecting a change locks it and renders", async () => {
    mockedListActiveChanges.mockResolvedValue(["alpha", "beta"]);
    mockedRunOpenspecStatus.mockResolvedValue({
      schemaName: "spec-driven", applied: false, artifacts: [],
    } as never);
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "alpha"), { recursive: true });

    const select = vi.fn().mockResolvedValue("alpha");
    await pi.runCommand("", ctxFor(tmpRoot, select));

    expect(select).toHaveBeenCalledWith(expect.stringContaining("Select"), ["alpha", "beta", "None"]);
    await tick();
    expect(statuses.some((s) => s?.startsWith("alpha"))).toBe(true);
  });

  it("choosing None clears the lock", async () => {
    mockedListActiveChanges.mockResolvedValue(["alpha"]);
    mockedRunOpenspecStatus.mockResolvedValue({
      schemaName: "spec-driven", applied: false, artifacts: [],
    } as never);
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "alpha"), { recursive: true });

    await pi.runCommand("", ctxFor(tmpRoot, () => Promise.resolve("alpha")));
    await tick();
    expect(statuses[statuses.length - 1]).toMatch(/^alpha\b/);

    await pi.runCommand("", ctxFor(tmpRoot, () => Promise.resolve("None")));
    await tick();
    expect(statuses[statuses.length - 1]).toBeUndefined();
  });

  it("cancelling select has no side effects", async () => {
    mockedListActiveChanges.mockResolvedValue(["alpha"]);
    const select = vi.fn().mockResolvedValue(undefined);
    await pi.runCommand("", ctxFor(tmpRoot, select));
    await tick();
    expect(statuses.length).toBe(0);
    expect(mockedRunOpenspecStatus).not.toHaveBeenCalled();
  });

  it("manual lock overrides bash auto-lock", async () => {
    mockedListActiveChanges.mockResolvedValue(["alpha"]);
    mockedRunOpenspecStatus.mockResolvedValue({
      schemaName: "spec-driven", applied: false, artifacts: [],
    } as never);
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "alpha"), { recursive: true });
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "beta"), { recursive: true });

    await pi.runCommand("", ctxFor(tmpRoot, () => Promise.resolve("alpha")));
    await tick();

    pi.fire("tool_call", { input: { type: "bash", command: "openspec status --change beta --json" } });
    await tick();

    const last = statuses[statuses.length - 1]!;
    expect(last).toMatch(/^alpha\b/);
    expect(last).not.toMatch(/^beta\b/);
  });

  it("worktree detection still updates effectiveCwd while manualLock is on", async () => {
    mockedListActiveChanges.mockResolvedValue(["alpha"]);
    mockedRunOpenspecStatus.mockResolvedValue({
      schemaName: "spec-driven", applied: false, artifacts: [],
    } as never);
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "alpha"), { recursive: true });
    const wtRoot = path.join(tmpRoot, ".worktrees", "wt-a");
    mkdirSync(path.join(wtRoot, "openspec", "changes", "alpha"), { recursive: true });

    await pi.runCommand("", ctxFor(tmpRoot, () => Promise.resolve("alpha")));
    await tick();

    pi.fire("tool_call", {
      input: { type: "bash", command: `cd ${wtRoot} && openspec status --change alpha --json` },
    });
    await tick();

    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith("alpha", tmpRoot);
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith("alpha", wtRoot);
  });

  it("archiving the manually locked change unlocks and resets manualLock", async () => {
    mockedListActiveChanges.mockResolvedValue(["alpha"]);
    mockedRunOpenspecStatus.mockResolvedValue({
      schemaName: "spec-driven", applied: false, artifacts: [],
    } as never);
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "alpha"), { recursive: true });

    await pi.runCommand("", ctxFor(tmpRoot, () => Promise.resolve("alpha")));
    await tick();
    expect(statuses[statuses.length - 1]).toMatch(/^alpha\b/);

    rmSync(path.join(tmpRoot, "openspec", "changes", "alpha"), { recursive: true, force: true });
    pi.fire("tool_result", {});
    await tick();
    expect(statuses[statuses.length - 1]).toBeUndefined();

    // Auto-lock works again after archive-unlock
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "beta"), { recursive: true });
    pi.fire("tool_call", { input: { type: "bash", command: "openspec status --change beta --json" } });
    await tick();
    expect(statuses[statuses.length - 1]).toMatch(/^beta\b/);
  });
});
