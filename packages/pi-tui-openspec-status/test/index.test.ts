import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// The render pipeline spawns the real openspec CLI; stub it so the
// restore-publish tests are fast and deterministic.
vi.mock("../src/openspec.js", () => ({
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
    listenerCount(event: string) {
      return (listeners[event] ?? []).length;
    },
    registerCommand(name: string, _opts: unknown) {
      commands.push(name);
    },
    commands,
  };
}

describe("piTuiOpenspecStatus — extension entry registration", () => {
  it("registers handlers + command unconditionally (factory receives only pi)", () => {
    const pi = makePi();
    // Docs contract: the factory gets ONLY ExtensionAPI — no ctx at
    // load time. Handlers are registered up front; the TUI gate runs
    // inside session_start, the first event that carries ctx.
    piTuiOpenspecStatus(pi as never);
    expect(pi.listenerCount("session_start")).toBe(1);
    expect(pi.listenerCount("tool_call")).toBe(1);
    expect(pi.listenerCount("tool_result")).toBe(1);
    expect(pi.commands).toEqual(["tui-openspec-select"]);
  });

  it("is defensive when loaded with no ctx at all (pi -e) — does not throw", () => {
    const pi = makePi();
    expect(() => piTuiOpenspecStatus(pi as never, undefined)).not.toThrow();
  });

  it("publishes setStatus(undefined) only after a tui session_start", () => {
    const pi = makePi();
    const calls: unknown[] = [];
    const ctx = {
      mode: "tui" as const,
      hasUI: true,
      cwd: "/repo",
      ui: { setStatus: (...a: unknown[]) => calls.push(a) },
    };
    piTuiOpenspecStatus(pi as never);
    // tool events before any tui session_start are no-ops (no render).
    pi.fire("tool_call", { toolName: "bash", input: { command: "openspec status --change foo --json" } });
    pi.fire("tool_result", {});
    expect(calls).toEqual([]);
    pi.fire("session_start", {}, ctx);
    expect(calls).toEqual([["pi-tui-openspec-status", undefined]]);
  });

  it.each(["print", "json", "rpc"] as const)(
    "does nothing in non-tui modes (session_start with mode '%s')",
    (mode) => {
      const pi = makePi();
      const calls: unknown[] = [];
      const ctx = {
        mode,
        hasUI: mode === "rpc", // rpc sets hasUI=true; still must not activate
        cwd: "/repo",
        ui: { setStatus: (...a: unknown[]) => calls.push(a) },
      };
      piTuiOpenspecStatus(pi as never);
      pi.fire("session_start", {}, ctx);
      pi.fire("tool_call", { toolName: "bash", input: { command: "openspec status --change foo --json" } });
      pi.fire("tool_result", {});
      expect(calls).toEqual([]);
    },
  );

  it("session_start with no ctx (undefined) does not throw and publishes nothing", () => {
    const pi = makePi();
    const calls: unknown[] = [];
    piTuiOpenspecStatus(pi as never);
    pi.fire("session_start", {}, undefined);
    expect(calls).toEqual([]);
  });
});

describe("piTuiOpenspecStatus — lock persistence (appendEntry + resume restore)", () => {
  const LOCK_CUSTOM_TYPE = "pi-tui-openspec-status";

  // Fake ExtensionAPI + sessionManager with a scriptable journal.
  function makePersistentPi(journal: unknown[] = []) {
    const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
    const entries: Array<[string, unknown]> = [];
    let commandHandler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
    return {
      on(event: string, h: (...a: unknown[]) => void) {
        (listeners[event] ??= []).push(h);
      },
      fire(event: string, ...args: unknown[]) {
        (listeners[event] ?? []).forEach((h) => h(...args));
      },
      registerCommand(_name: string, opts: { handler: (a: string, c: unknown) => Promise<void> }) {
        commandHandler = opts.handler;
      },
      runCommand(args: string, ctx: unknown) {
        return commandHandler?.(args, ctx);
      },
      appendEntry: (customType: string, data: unknown) => {
        entries.push([customType, data]);
      },
      getEntries: () => journal,
      entries,
    };
  }

  function tuiCtx(overrides: Record<string, unknown> = {}) {
    const journal = (overrides.entries as unknown[]) ?? [];
    return {
      mode: "tui" as const,
      hasUI: true,
      cwd: "/repo",
      sessionManager: { getEntries: () => journal },
      ui: { setStatus: () => {} },
      ...overrides,
    };
  }

  const customEntry = (data: unknown) => ({
    type: "custom",
    id: "e1",
    parentId: null,
    timestamp: "t",
    customType: LOCK_CUSTOM_TYPE,
    data,
  });

  it("auto-lock via bash (setSpec) writes a custom entry with manualLock:false", () => {
    const pi = makePersistentPi();
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    pi.fire("session_start", {}, tuiCtx());
    pi.fire("tool_call", {
      toolName: "bash",
      input: { command: "openspec status --change alpha --json" },
    });
    expect(pi.entries).toContainEqual([
      LOCK_CUSTOM_TYPE,
      { spec: "alpha", worktree: undefined, manualLock: false, version: 1 },
    ]);
  });

  it("manual lock via /tui-openspec-select writes a custom entry with manualLock:true", async () => {
    const pi = makePersistentPi();
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    const cmdCtx = tuiCtx({
      ui: {
        select: async () => "beta" as const,
        setStatus: () => {},
      },
    });
    await pi.runCommand("", cmdCtx as never);
    expect(pi.entries).toContainEqual([
      LOCK_CUSTOM_TYPE,
      { spec: "beta", worktree: undefined, manualLock: true, version: 1 },
    ]);
  });

  it("restores a manual lock from the journal on session_start and publishes the spec", async () => {
    // The render pipeline requires a real change folder in cwd to
    // publish a line (zero alive sources → unlock + nothing). Create
    // it so the restore actually renders "gamma".
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-restore-"));
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "gamma"), {
      recursive: true,
    });

    const journal = [customEntry({ spec: "gamma", manualLock: true, version: 1 })];
    const pi = makePersistentPi(journal);
    const statuses: Array<string | undefined> = [];
    mockedRunOpenspecStatus.mockResolvedValue({
      schemaName: "spec-driven",
      artifacts: [],
    });
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    pi.fire("session_start", {}, tuiCtx({
      cwd: tmpRoot,
      entries: journal,
      ui: { setStatus: (_id: string, text: string | undefined) => statuses.push(text) },
    }));
    // Debounced render: drain the 0ms timer + microtasks.
    await new Promise((r) => setTimeout(r, 30));
    expect(statuses.some((s) => s?.startsWith("gamma"))).toBe(true);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("restores an auto-lock and keeps auto semantics (bash update still works)", async () => {
    const journal = [customEntry({ spec: "alpha", worktree: undefined, manualLock: false, version: 1 })];
    const pi = makePersistentPi(journal);
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    pi.fire("session_start", {}, tuiCtx({ entries: journal }));
    // Auto-restore → setSpec("alpha") (no manualLock). A subsequent
    // bash openspec command must still switch the tracked spec.
    pi.fire("tool_call", {
      toolName: "bash",
      input: { command: "openspec status --change gamma --json" },
    });
    expect(pi.entries.at(-1)).toEqual([
      LOCK_CUSTOM_TYPE,
      { spec: "gamma", worktree: undefined, manualLock: false, version: 1 },
    ]);
  });

  it("clearing the lock (None) persists an explicit empty state", async () => {
    const pi = makePersistentPi();
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    const select = async () => "alpha" as const;
    const cmdCtx = tuiCtx({ ui: { select, setStatus: () => {} } });
    await pi.runCommand("", cmdCtx as never);
    expect(pi.entries.at(-1)).toEqual([
      LOCK_CUSTOM_TYPE,
      { spec: "alpha", worktree: undefined, manualLock: true, version: 1 },
    ]);

    // Now pick None → clearLock → persist the empty-state marker.
    const noneCtx = tuiCtx({ ui: { select: async () => "None" as const, setStatus: () => {} } });
    await pi.runCommand("", noneCtx as never);
    expect(pi.entries.at(-1)).toEqual([
      LOCK_CUSTOM_TYPE,
      { spec: "", manualLock: false, version: 1 },
    ]);
  });

  it("restores an auto-lock WITH worktree and merges both sources", async () => {
    // Spec scenario「resume 后恢复 worktree」: auto-lock journal with a
    // worktree path must drive setWorkTree so the status merges main +
    // worktree sources on resume.
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-wtrestore-"));
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "beta"), {
      recursive: true,
    });
    const wtRoot = path.join(tmpRoot, ".worktrees", "feat", "x");
    mkdirSync(path.join(wtRoot, "openspec", "changes", "beta"), {
      recursive: true,
    });

    const journal = [
      customEntry({ spec: "beta", worktree: wtRoot, manualLock: false, version: 1 }),
    ];
    const pi = makePersistentPi(journal);
    const statuses: Array<string | undefined> = [];
    mockedRunOpenspecStatus.mockImplementation(async (_name: string, cwd: string) => ({
      schemaName: "spec-driven",
      artifacts: [],
    }));
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    pi.fire("session_start", {}, tuiCtx({
      cwd: tmpRoot,
      entries: journal,
      ui: { setStatus: (_id: string, text: string | undefined) => statuses.push(text) },
    }));
    // Debounced render: drain the 0ms timer + microtasks.
    await new Promise((r) => setTimeout(r, 30));
    expect(statuses.some((s) => s?.startsWith("beta"))).toBe(true);
    // Both sources were scanned: main (setSpec) + worktree (setWorkTree).
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith("beta", tmpRoot);
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith("beta", wtRoot);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resume from cleared (empty) state stays empty", async () => {
    // Spec scenario「清除锁定后持久化空状态」: clearLock persists the
    // empty marker; resume must NOT resurrect any lock.
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-emptyresume-"));
    const journal = [customEntry({ spec: "", manualLock: false, version: 1 })];
    const pi = makePersistentPi(journal);
    const statuses: Array<string | undefined> = [];
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    pi.fire("session_start", {}, tuiCtx({
      cwd: tmpRoot,
      entries: journal,
      ui: { setStatus: (_id: string, text: string | undefined) => statuses.push(text) },
    }));
    await new Promise((r) => setTimeout(r, 30));
    // Only the initial empty publish; spec:"" fails the `saved && saved.spec`
    // guard → no restore, no line ever published, no writes during restore.
    expect(statuses).toEqual([undefined]);
    expect(pi.entries).toHaveLength(0);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("restores a manual lock WITH worktree (setWorkTree applies as scan source)", async () => {
    // The manual branch pins the spec via lock(); the worktree must still
    // be adopted as an additional scan source.
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-wtmanual-"));
    mkdirSync(path.join(tmpRoot, "openspec", "changes", "gamma"), {
      recursive: true,
    });
    const wtRoot = path.join(tmpRoot, ".worktrees", "feat", "y");
    mkdirSync(path.join(wtRoot, "openspec", "changes", "gamma"), {
      recursive: true,
    });

    const journal = [
      customEntry({ spec: "gamma", worktree: wtRoot, manualLock: true, version: 1 }),
    ];
    const pi = makePersistentPi(journal);
    const statuses: Array<string | undefined> = [];
    mockedRunOpenspecStatus.mockImplementation(async (_name: string, cwd: string) => ({
      schemaName: "spec-driven",
      artifacts: [],
    }));
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    pi.fire("session_start", {}, tuiCtx({
      cwd: tmpRoot,
      entries: journal,
      ui: { setStatus: (_id: string, text: string | undefined) => statuses.push(text) },
    }));
    await new Promise((r) => setTimeout(r, 30));
    expect(statuses.some((s) => s?.startsWith("gamma"))).toBe(true);
    expect(mockedRunOpenspecStatus).toHaveBeenCalledWith("gamma", wtRoot);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("restore ignores dirty journal data (wrong version) → stays empty", async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-dirty-"));
    const journal = [customEntry({ spec: "gamma", manualLock: true, version: 2 })];
    const pi = makePersistentPi(journal);
    const statuses: Array<string | undefined> = [];
    piTuiOpenspecStatus(pi as never, { debounceMs: 0 });
    pi.fire("session_start", {}, tuiCtx({
      cwd: tmpRoot,
      entries: journal,
      ui: { setStatus: (_id: string, text: string | undefined) => statuses.push(text) },
    }));
    // findLastPersistedLock rejects version!==1 → no restore → only
    // the initial empty publish happens, never a spec line.
    await new Promise((r) => setTimeout(r, 30));
    expect(statuses).toEqual([undefined]);
    expect(pi.entries).toHaveLength(0);
    rmSync(tmpRoot, { recursive: true, force: true });
  });
});
