// test/render.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { PersistedLock } from "../src/state.js";
import type { ArtifactStatus } from "../src/types.js";
import { OpenSpecStatusRender, formatArtifactTokens, formatProgressBar, renderLine } from "../src/render.js";

// render.ts spawns the openspec CLI in renderText(); stub it so the
// async render path is fast and deterministic (same pattern as
// unlock.test.ts). Only used by the "async auto-unlock" describe below.
vi.mock("../src/openspec.js", () => ({
  runOpenspecStatus: vi.fn(),
}));

import { runOpenspecStatus } from "../src/openspec.js";

const mockedRunOpenspecStatus = vi.mocked(runOpenspecStatus);

/** Drain queued microtasks + the setTimeout(0) used for debounce. */
async function tick() {
  // 50ms headroom: the render chain does real fs ops (access/readFile),
  // which can exceed a tiny window under parallel suite load.
  await new Promise<void>((r) => setTimeout(r, 50));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("formatArtifactTokens", () => {
  it("uses ● for done and ○ otherwise", () => {
    const s: ArtifactStatus[] = [
      { id: "proposal", status: "done" },
      { id: "design", status: "done" },
      { id: "specs", status: "ready" },
      { id: "tasks", status: "blocked" },
    ];
    expect(formatArtifactTokens(s)).toBe("P● D● S○ T○");
  });

  it("skips unknown artifact ids", () => {
    const s: ArtifactStatus[] = [
      { id: "proposal", status: "done" },
      { id: "brainstorm" as any, status: "done" },
    ];
    expect(formatArtifactTokens(s)).toBe("P●");
  });

  it("returns empty string for empty input", () => {
    expect(formatArtifactTokens([])).toBe("");
  });
});

describe("formatProgressBar", () => {
  it("renders 10-cell bar", () => {
    expect(formatProgressBar(0, 7)).toBe("░░░░░░░░░░");
    expect(formatProgressBar(7, 7)).toBe("██████████");
    expect(formatProgressBar(3, 7)).toBe("████░░░░░░");
  });

  it("clamps done > total to total (renders fully filled when 100% complete)", () => {
    expect(formatProgressBar(99, 3)).toBe("██████████");
    expect(formatProgressBar(3, 3)).toBe("██████████");
  });

  it("renders total=0 as all empty", () => {
    expect(formatProgressBar(0, 0)).toBe("░░░░░░░░░░");
  });
});

describe("renderLine", () => {
  it("joins all parts with the documented format", () => {
    const line = renderLine(
      "add-foo",
      "superpowers-bridge-cn",
      [
        { id: "proposal", status: "done" },
        { id: "design", status: "done" },
        { id: "specs", status: "ready" },
        { id: "tasks", status: "ready" },
      ],
      { done: 2, total: 7 },
    );
    expect(line).toBe(
      "add-foo (superpowers-bridge-cn) [P● D● S○ T○] Tasks: ███░░░░░░░ 2/7",
    );
  });

  it("contains no newlines", () => {
    const line = renderLine("x", "y", [], { done: 0, total: 0 });
    expect(line.includes("\n")).toBe(false);
  });
});

describe("OpenSpecStatusRender — onStateChange callback", () => {
  // Freeze timers so the debounced render() scheduled by
  // lock/setSpec/setWorkTree never fires during these synchronous
  // assertions. We only want to observe the synchronous
  // onStateChange fires — the async render pipeline is covered
  // exhaustively in unlock.test.ts.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeRender(onChange: (state: PersistedLock | null) => void) {
    // ctx only needs ui.setStatus for clearLock's lastRendered branch;
    // fresh instances never render so setStatus is never called.
    const ctx = { ui: { setStatus: () => {} } } as never;
    return new OpenSpecStatusRender("ext", ctx, 0, onChange);
  }

  it("fires with snapshot on lock (manualLock: true, worktree: undefined)", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    render.lock("alpha");
    expect(calls.at(-1)).toEqual({
      spec: "alpha",
      worktree: undefined,
      manualLock: true,
      version: 1,
    });
  });

  it("fires with null on clearLock", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    render.lock("alpha");
    render.clearLock();
    expect(calls.at(-1)).toBeNull();
  });

  it("fires snapshot on setSpec with manualLock: false", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    render.setSpec("beta");
    expect(calls.at(-1)).toEqual({
      spec: "beta",
      worktree: undefined,
      manualLock: false,
      version: 1,
    });
  });

  it("fires snapshot on setWorkTree reflecting current spec/manualLock", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    render.setSpec("beta");
    calls.length = 0; // reset before exercising the second fire
    render.setWorkTree("/tmp/wt");
    expect(calls.at(-1)).toEqual({
      spec: "beta",
      worktree: "/tmp/wt",
      manualLock: false,
      version: 1,
    });
  });

  it("does not fire when setSpec is deduped (same value as before)", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    render.setSpec("dup");
    render.setSpec("dup");
    expect(calls.length).toBe(1);
  });

  it("does not fire when setWorkTree is deduped (same value as before)", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    // A tracked spec must exist for the snapshot to be persistable;
    // otherwise setWorkTree never fires (see next test).
    render.setSpec("beta");
    render.setWorkTree("/tmp/wt");
    render.setWorkTree("/tmp/wt");
    // setSpec fired once + first setWorkTree fired once; the
    // deduped second setWorkTree adds nothing.
    expect(calls.length).toBe(2);
  });

  it("does not fire setWorkTree when no spec is tracked", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    render.setWorkTree("/tmp/wt");
    expect(calls.length).toBe(0);
  });

  it("does not fire setSpec while under manualLock (lock wins)", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    render.lock("alpha");
    const lockSnapshot = calls.at(-1);
    render.setSpec("beta");
    // setSpec is suppressed under manualLock → no extra fire,
    // last call still equals the lock snapshot.
    expect(calls.length).toBe(1);
    expect(calls.at(-1)).toEqual(lockSnapshot);
  });
});

describe("OpenSpecStatusRender — async auto-unlock fire", () => {
  // Real timers + real fs so the debounced renderText() actually runs
  // and reaches the all-sources-gone branch. onStateChange fires are
  // recorded through the full async pipeline (like unlock.test.ts).
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-oc-"));
    mockedRunOpenspecStatus.mockReset();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("fires null on auto-unlock when all sources disappear", async () => {
    const changeName = "auto-unlock-demo";
    // Folder exists so the first render finds an alive source and
    // renders a real line (spec stays locked).
    mkdirSync(path.join(tmpRoot, "openspec", "changes", changeName), {
      recursive: true,
    });
    mockedRunOpenspecStatus.mockResolvedValue({
      schemaName: "spec-driven",
      applied: false,
      artifacts: [],
    } as never);

    const calls: (PersistedLock | null)[] = [];
    const render = new OpenSpecStatusRender(
      "ext",
      {
        cwd: tmpRoot,
        ui: { setStatus: () => {} },
      } as never,
      0,
      (s) => calls.push(s),
    );

    // First render: folder alive → lock stays, snapshot fired on lock.
    render.lock(changeName);
    await tick();
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith(
      changeName,
      tmpRoot,
    );
    expect(calls.at(-1)).toEqual({
      spec: changeName,
      worktree: undefined,
      manualLock: true,
      version: 1,
    });

    // Remove the folder → next render finds no alive source →
    // auto-unlock fires null.
    rmSync(path.join(tmpRoot, "openspec", "changes", changeName), {
      recursive: true,
      force: true,
    });
    render.refresh();
    await tick();

    expect(calls.at(-1)).toBeNull();
  });
});

describe("OpenSpecStatusRender — setWorkTree under manualLock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeRender(onChange: (state: PersistedLock | null) => void) {
    const ctx = { ui: { setStatus: () => {} } } as never;
    return new OpenSpecStatusRender("ext", ctx, 0, onChange);
  }

  it("fires snapshot with manualLock: true when worktree changes under a manual lock", () => {
    const calls: (PersistedLock | null)[] = [];
    const render = makeRender((s) => calls.push(s));
    render.lock("alpha");
    calls.length = 0; // reset: only observe the setWorkTree fire
    render.setWorkTree("/tmp/wt");
    expect(calls.at(-1)).toEqual({
      spec: "alpha",
      worktree: "/tmp/wt",
      manualLock: true,
      version: 1,
    });
  });
});