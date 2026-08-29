// src/unlock.test.ts
// Integration tests for the multi-source scanning + unlock strategy:
//   - Default: scan main workspace's spec only.
//   - When a worktree enters via `cd <worktree> && openspec ...`: scan
//     main AND worktree, merge artifacts (union, done wins) and tasks.
//   - Unlock: clear the lock only when ALL scanned sources'
//     `openspec/changes/<name>/` folders are gone. If main still has
//     it, we keep tracking (e.g. the worktree was removed but the
//     change is still alive in main).
//
// runOpenspecStatus normally spawns a real subprocess; we stub it via
// vi.mock so tests are fast and deterministic. Tests control what
// each source "returns" by changing the mock implementation per test.
// debounceMs: 0 skips the 500ms timer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// vi.mock is hoisted ABOVE all imports by vitest's transformer.
vi.mock("./openspec.js", () => ({
  runOpenspecStatus: vi.fn(),
}));

import piTuiOpenspecStatus from "../src/index.js";
import { runOpenspecStatus } from "../src/openspec.js";

const mockedRunOpenspecStatus = vi.mocked(runOpenspecStatus);

function makePi() {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  const commands: string[] = [];
  return {
    on(event: string, h: (...a: unknown[]) => void) {
      (listeners[event] ??= []).push(h);
    },
    fire(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((h) => h(...args));
    },
    registerCommand(name: string, _opts: unknown) {
      commands.push(name);
    },
  };
}

interface CallRecord {
  id: string;
  text: string | undefined;
}

/** Drain queued microtasks + the setTimeout(0) used for debounce. */
async function tick() {
  // 50ms headroom: the render chain does real fs ops (access/readFile),
  // which can exceed a tiny window under parallel suite load.
  await new Promise<void>((r) => setTimeout(r, 50));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("piTuiOpenspecStatus — multi-source scan + unlock", () => {
  let tmpRoot: string;
  let pi: ReturnType<typeof makePi>;
  let calls: CallRecord[];

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-unlock-"));
    pi = makePi();
    calls = [];
    const ctx = {
      mode: "tui" as const,
      hasUI: true,
      cwd: tmpRoot,
      ui: {
        setStatus: (id: string, text: string | undefined) => {
          calls.push({ id, text });
        },
      },
    };
    piTuiOpenspecStatus(pi as never, ctx, { debounceMs: 0 });
    mockedRunOpenspecStatus.mockReset();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // --- helpers ---

  /** Make a change folder with optional tasks body. */
  function makeChange(root: string, name: string, tasks?: string) {
    const dir = path.join(root, "openspec", "changes", name);
    mkdirSync(dir, { recursive: true });
    if (tasks !== undefined) {
      writeFileSync(path.join(dir, "tasks.md"), tasks, "utf8");
    }
  }

  /**
   * Stub runOpenspecStatus such that calling it from `cwd` returns the
   * given status. Used to simulate main vs worktree returning
   * different artifact sets.
   */
  function mockStatusByCwd(
    map: Record<string, { schemaName: string; artifacts: unknown[] } | null>,
  ) {
    mockedRunOpenspecStatus.mockImplementation(async (_name, cwd) => {
      // The mock factory receives (name, cwd); find the matching entry.
      for (const [key, val] of Object.entries(map)) {
        if (cwd === key) return val as never;
      }
      return null;
    });
  }

  // ------------------------------------------------------------
  // Default behavior (no worktree): main only
  // ------------------------------------------------------------

  it("main-only mode: sets status when main folder exists, unlocks when main folder vanishes", async () => {
    makeChange(tmpRoot, "demo", "- [x] 1.1\n");
    mockStatusByCwd({
      [tmpRoot]: { schemaName: "spec-driven", artifacts: [] },
    });

    pi.fire("session_start");
    await tick();
    expect(calls).toEqual([
      { id: "pi-tui-openspec-status", text: undefined },
    ]);

    pi.fire("tool_call", {
      input: { type: "bash", command: "openspec new change demo" },
    });
    await tick();
    expect(calls.some((c) => c.text?.startsWith("demo"))).toBe(true);
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith(
      "demo",
      tmpRoot,
    );

    // Remove the main folder → no source alive → unlock
    rmSync(path.join(tmpRoot, "openspec", "changes", "demo"), {
      recursive: true,
      force: true,
    });

    pi.fire("tool_result", {});
    await tick();

    const last = calls[calls.length - 1]!;
    expect(last.text).toBeUndefined();
  });

  it("main-only mode: regression — does NOT clear while folder still exists", async () => {
    makeChange(tmpRoot, "keep", "- [x] 1.1\n");
    mockStatusByCwd({
      [tmpRoot]: { schemaName: "spec-driven", artifacts: [] },
    });

    pi.fire("session_start");
    await tick();
    pi.fire("tool_call", {
      input: { type: "bash", command: "openspec new change keep" },
    });
    await tick();
    expect(calls.filter((c) => c.text !== undefined).length).toBeGreaterThan(0);

    pi.fire("tool_result", {});
    await tick();

    const undefinedAfterStart = calls
      .slice(1)
      .filter((c) => c.text === undefined);
    expect(undefinedAfterStart.length).toBe(0);
  });

  // ------------------------------------------------------------
  // Worktree mode: merge main + worktree
  // ------------------------------------------------------------

  it("worktree mode: merges artifacts and tasks from main + worktree", async () => {
    // Path matches parser's WORKTREE_RE (\.worktrees/<name>) so the
    // listener adopts effectiveCwd.
    const wtParent = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-mt-"));
    const wtRoot = path.join(wtParent, ".worktrees", "mt-change");
    mkdirSync(wtRoot, { recursive: true });

    // Main has proposal + design done; worktree adds specs done.
    makeChange(tmpRoot, "mt-change", "- [x] 1.1 main-task\n");
    makeChange(wtRoot, "mt-change", "- [x] 1.1 main-task\n- [x] 1.2 wt-task\n");

    mockStatusByCwd({
      [tmpRoot]: {
        schemaName: "spec-driven",
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "design", status: "done" },
        ],
      },
      [wtRoot]: {
        schemaName: "spec-driven",
        artifacts: [{ id: "specs", status: "done" }],
      },
    });

    pi.fire("session_start");
    await tick();

    pi.fire("tool_call", {
      input: {
        type: "bash",
        command: `cd ${wtRoot} && openspec status --change mt-change --json`,
      },
    });
    await tick();

    // Both sources were queried
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith(
      "mt-change",
      tmpRoot,
    );
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith(
      "mt-change",
      wtRoot,
    );

    // Merged line shows all three artifacts + 2/2 tasks
    const lineCalls = calls.filter((c) => c.text !== undefined);
    const last = lineCalls[lineCalls.length - 1]!.text!;
    expect(last).toMatch(/^mt-change\b/);
    expect(last).toMatch(/P●/); // proposal done
    expect(last).toMatch(/D●/); // design done (from main)
    expect(last).toMatch(/S●/); // specs done (from wt)
    expect(last).toMatch(/Tasks:.*2\/2/);

    rmSync(wtParent, { recursive: true, force: true });
  });

  it("worktree removed but main still has it → KEEP locked (only all-gone unlocks)", async () => {
    const wtParent = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-mt-"));
    const wtRoot = path.join(wtParent, ".worktrees", "keep-main");
    mkdirSync(wtRoot, { recursive: true });

    // Main has the change folder; worktree also has it.
    makeChange(tmpRoot, "keep-main", "- [x] 1.1\n");
    makeChange(wtRoot, "keep-main", "- [ ] 1.2\n");
    mockStatusByCwd({
      [tmpRoot]: { schemaName: "spec-driven", artifacts: [] },
      [wtRoot]: { schemaName: "spec-driven", artifacts: [] },
    });

    pi.fire("session_start");
    await tick();

    pi.fire("tool_call", {
      input: {
        type: "bash",
        command: `cd ${wtRoot} && openspec status --change keep-main --json`,
      },
    });
    await tick();
    expect(
      calls.filter((c) => c.text?.startsWith("keep-main")).length,
    ).toBeGreaterThan(0);

    // Remove ONLY the worktree's change folder (simulate `git worktree remove`)
    rmSync(path.join(wtRoot, "openspec", "changes", "keep-main"), {
      recursive: true,
      force: true,
    });

    const callsBeforeRefire = calls.length;
    pi.fire("tool_result", {});
    await tick();

    // Must NOT unlock — main still has the folder, so status is still set
    expect(calls.length).toBeGreaterThan(callsBeforeRefire); // render re-ran
    const last = calls[calls.length - 1]!;
    expect(last.text).toBeDefined();
    expect(last.text).toMatch(/^keep-main\b/);

    // Now remove main too → unlock
    rmSync(path.join(tmpRoot, "openspec", "changes", "keep-main"), {
      recursive: true,
      force: true,
    });
    pi.fire("tool_result", {});
    await tick();
    expect(calls[calls.length - 1]!.text).toBeUndefined();

    rmSync(wtParent, { recursive: true, force: true });
  });

  it("worktree mode: change exists only in worktree (not main) → still works", async () => {
    const wtParent = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-mt-"));
    const wtRoot = path.join(wtParent, ".worktrees", "wt-only");
    mkdirSync(wtRoot, { recursive: true });

    // Only worktree has the change; main does NOT.
    makeChange(wtRoot, "wt-only", "- [x] 1.1\n");
    mockStatusByCwd({
      [tmpRoot]: null, // main has no status (folder doesn't exist)
      [wtRoot]: { schemaName: "spec-driven", artifacts: [] },
    });

    pi.fire("session_start");
    await tick();

    pi.fire("tool_call", {
      input: {
        type: "bash",
        command: `cd ${wtRoot} && openspec status --change wt-only --json`,
      },
    });
    await tick();

    // Should render using only the worktree source
    expect(
      calls.filter((c) => c.text?.startsWith("wt-only")).length,
    ).toBeGreaterThan(0);
    // runOpenspecStatus is only invoked for sources whose change
    // folder actually exists (we probed via access() first). Since
    // main does NOT have the folder, the CLI is NOT called for it —
    // that's the whole point of the existence probe: avoid wasted
    // spawns on a source we know has nothing.
    expect(mockedRunOpenspecStatus).toHaveBeenCalledTimes(1);
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith("wt-only", wtRoot);
    expect(mockedRunOpenspecStatus).not.toHaveBeenCalledWith(
      "wt-only",
      tmpRoot,
    );

    // Remove worktree's folder → both sources gone → unlock
    rmSync(path.join(wtRoot, "openspec", "changes", "wt-only"), {
      recursive: true,
      force: true,
    });
    pi.fire("tool_result", {});
    await tick();
    expect(calls[calls.length - 1]!.text).toBeUndefined();

    rmSync(wtParent, { recursive: true, force: true });
  });

  it("main-only mode: render is idempotent — no setStatus call when line unchanged", async () => {
    makeChange(tmpRoot, "idem", "- [x] 1.1\n");
    mockStatusByCwd({
      [tmpRoot]: { schemaName: "spec-driven", artifacts: [] },
    });

    pi.fire("session_start");
    await tick();
    pi.fire("tool_call", {
      input: { type: "bash", command: "openspec new change idem" },
    });
    await tick();
    const callsAfterLock = calls.length;

    pi.fire("tool_result", {});
    await tick();

    // Same content → render deduped → no extra setStatus call
    expect(calls.length).toBe(callsAfterLock);
  });
});
