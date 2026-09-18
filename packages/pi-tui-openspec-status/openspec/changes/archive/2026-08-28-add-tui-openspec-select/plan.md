# add-tui-openspec-select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/tui-openspec-select` TUI slash command to `pi-tui-openspec-status` so the user can manually pick which openspec change the status bar tracks (with `None` to clear), where manual selection overrides bash auto-lock.

**Architecture:** A small `discover.ts` module lists active changes from the filesystem (`<root>/openspec/changes/*/` minus `archive`). `index.ts` registers the command via `pi.registerCommand` inside the existing TUI-only activation branch; the handler opens `ctx.ui.select`, then either sets `lockedChange` + new `manualLock = true` (selected change), clears both (None), or does nothing (cancel). The `tool_call` handler skips auto-lock updates while `manualLock` is true but keeps worktree `effectiveCwd` tracking; the existing all-sources-gone unlock branch also resets `manualLock`.

**Tech Stack:** TypeScript, pi extension API (`pi.registerCommand`, `ctx.ui.select`), Vitest (`pnpm exec vitest run` from `packages/pi-tui-openspec-status/`), Node built-in `fs/promises`.

**Spec:** `openspec/changes/add-tui-openspec-select/specs/tui-openspec-status/spec.md`
**Design:** `openspec/changes/add-tui-openspec-select/design.md`

## Global Constraints

- Package dir: `packages/pi-tui-openspec-status/`; extension id string `"pi-tui-openspec-status"` (`EXTENSION_ID` in `src/index.ts`).
- TUI-only activation: everything (including command registration) lives AFTER the `if (ctx?.mode !== "tui") return;` gate in `src/index.ts` — never register or touch state outside it.
- Status clearing rule: call `ctx.ui.setStatus(EXTENSION_ID, undefined)` only when `lastRendered !== ""`, then set `lastRendered = ""`.
- Unlock rule: only when ALL scanned sources' `openspec/changes/<name>/` folders are gone.
- Debounce: reuse existing `schedule()` (`setTimeout(render, debounceMs)`, default `SET_STATUS_DEBOUNCE_MS = 500`).
- All openspec CLI / fs / parse operations stay inside try/catch; no throwing, no popups, no session mutation (spec 错误处理与无副作用).
- Run tests from the package dir: `cd packages/pi-tui-openspec-status && pnpm exec vitest run` (root `pnpm test` runs unrelated suites — do not use it as the gate).

---

## Task 1: 活动 change 发现模块 (`discover.ts`)

**Files:**
- Create: `packages/pi-tui-openspec-status/src/discover.ts`
- Create: `packages/pi-tui-openspec-status/src/discover.test.ts`
- Modify: none

**Interfaces:**
- Consumes: nothing (Node built-ins only).
- Produces: `export async function listActiveChanges(openspecRoot: string): Promise<string[]>` — returns stable-sorted directory names under `<openspecRoot>/changes/`, excluding `archive`; returns `[]` when the directory is missing or unreadable.

- [ ] **Step 1: Write the failing test**

Create `packages/pi-tui-openspec-status/src/discover.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { listActiveChanges } from "./discover.js";

describe("listActiveChanges", () => {
  let root: string;

  const setup = () => {
    root = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-discover-"));
    return root;
  };
  const teardown = () => rmSync(root, { recursive: true, force: true });

  it("returns sorted active change dirs, excluding archive", async () => {
    setup();
    try {
      mkdirSync(path.join(root, "changes", "beta"), { recursive: true });
      mkdirSync(path.join(root, "changes", "alpha"), { recursive: true });
      mkdirSync(path.join(root, "changes", "archive", "2026-01-01-old"), {
        recursive: true,
      });
      writeFileSync(path.join(root, "changes", "not-a-dir.md"), "x");
      expect(await listActiveChanges(root)).toEqual(["alpha", "beta"]);
    } finally {
      teardown();
    }
  });

  it("returns [] when changes dir is missing", async () => {
    setup();
    try {
      expect(await listActiveChanges(root)).toEqual([]);
    } finally {
      teardown();
    }
  });

  it("returns [] when changes dir is unreadable", async () => {
    setup();
    try {
      // Point at a path that is a FILE, so readdir rejects.
      const file = path.join(root, "changes");
      writeFileSync(file, "x");
      expect(await listActiveChanges(file)).toEqual([]);
    } finally {
      teardown();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/pi-tui-openspec-status && pnpm exec vitest run src/discover.test.ts`
Expected: FAIL — `Cannot find module './discover.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/pi-tui-openspec-status/src/discover.ts`:

```typescript
// src/discover.ts
import { readdir } from "node:fs/promises";
import * as path from "node:path";

/**
 * List active (non-archived) openspec change names under
 * `<openspecRoot>/changes/`. Stable-sorted; excludes the `archive`
 * directory. Returns [] when the directory is missing/unreadable.
 */
export async function listActiveChanges(
  openspecRoot: string,
): Promise<string[]> {
  const changesDir = path.join(openspecRoot, "openspec", "changes");
  let entries;
  try {
    entries = await readdir(changesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== "archive")
    .map((e) => e.name)
    .sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/pi-tui-openspec-status && pnpm exec vitest run src/discover.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/pi-tui-openspec-status/src/discover.ts packages/pi-tui-openspec-status/src/discover.test.ts
git commit -m "feat(tui-openspec-status): add listActiveChanges discovery module"
```

---

## Task 2: `/tui-openspec-select` 命令注册与 manualLock 状态

**Files:**
- Modify: `packages/pi-tui-openspec-status/src/index.ts` (imports; `PiLike` interface; factory body)
- Modify: none else

**Interfaces:**
- Consumes: `listActiveChanges(openspecRoot: string): Promise<string[]>` from `./discover.js` (Task 1).
- Produces (used by Task 3 tests):
  - `PiLike.registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: { cwd: string; ui: { select(prompt: string, items: string[]): Promise<string | undefined> } }) => Promise<void> | void }): void`
  - Behavior contract: when the command handler picks a change name → `lockedChange = name; manualLock = true; schedule();` — when `"None"` → `manualLock = false; lockedChange = undefined;` clear status per rule; when `undefined` → no state change.

- [ ] **Step 1: Write the failing test**

Create `packages/pi-tui-openspec-status/src/select.test.ts` (mirrors the harness pattern in `src/unlock.test.ts`):

```typescript
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
  await new Promise<void>((r) => setTimeout(r, 5));
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
    ui: { setStatus: (_id: string, text: string | undefined) => statuses.push(text) },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/pi-tui-openspec-status && pnpm exec vitest run src/select.test.ts`
Expected: FAIL — TypeScript errors on `pi.registerCommand` missing from `PiLike`; runtime failures on no command registered.

- [ ] **Step 3: Implement — extend `PiLike` + register the command**

In `packages/pi-tui-openspec-status/src/index.ts`:

Add import: `import { listActiveChanges } from "./discover.js";`

Extend the `PiLike` interface with `registerCommand` (add this method signature after the `tool_result` overload):

```typescript
  on(
    event: "tool_result",
    handler: (event: unknown) => Promise<void> | void,
  ): void;
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (
        args: string,
        cmdCtx: {
          cwd: string;
          ui: {
            select(
              prompt: string,
              items: string[],
            ): Promise<string | undefined>;
          };
        },
      ) => Promise<void> | void;
    },
  ): void;
```

Add `let manualLock = false;` alongside the other state vars (next to `let lockedChange: string | undefined;`).

In the factory body (AFTER the `ctx?.mode !== "tui"` gate, next to the existing `pi.on(...)` registrations), register the command:

```typescript
  pi.registerCommand("tui-openspec-select", {
    description:
      "Manually select which openspec change the status bar tracks (None to clear)",
    handler: async (_args, cmdCtx) => {
      const changes = await listActiveChanges(cmdCtx.cwd);
      const choice = await cmdCtx.ui.select("Select spec to track:", [
        ...changes,
        "None",
      ]);
      if (choice === undefined) return; // cancelled — no side effects
      if (choice === "None") {
        manualLock = false;
        lockedChange = undefined;
        if (lastRendered !== "") {
          lastRendered = "";
          ctx.ui.setStatus(EXTENSION_ID, undefined);
        }
        return;
      }
      lockedChange = choice;
      manualLock = true;
      schedule();
    },
  });
```

- [ ] **Step 4: Implement — manualLock gating in tool_call + unlock reset**

Modify the `tool_call` handler so manual lock blocks auto-lock but keeps worktree tracking (keep `effectiveCwd` update BEFORE the manualLock guard):

```typescript
  pi.on("tool_call", (event) => {
    if (!isBashInput(event) || event.input?.type !== "bash") return;
    const cmd = event.input.command;
    if (typeof cmd !== "string") return;
    const parsed = parseBashCommand(cmd);
    if (!parsed) return;
    if (parsed.isWorktree) effectiveCwd = parsed.effectiveCwd;
    if (manualLock) return; // manual selection overrides auto-lock
    if (parsed.isLocking && parsed.changeName) {
      lockedChange = parsed.changeName;
      schedule();
    }
  });
```

Modify the all-sources-gone unlock branch inside `render()` to also reset `manualLock`:

```typescript
      if (aliveSources.length === 0) {
        lockedChange = undefined;
        effectiveCwd = "";
        manualLock = false;
        if (lastRendered !== "") {
          lastRendered = "";
          ctx.ui.setStatus(EXTENSION_ID, undefined);
        }
        return;
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/pi-tui-openspec-status && pnpm exec vitest run`
Expected: PASS — all suites including the 6 new select tests and the existing 78 (unlock, merge, parser, render, index, discover).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-tui-openspec-status/src/index.ts packages/pi-tui-openspec-status/src/select.test.ts
git commit -m "feat(tui-openspec-status): add /tui-openspec-select command with manualLock"
```

---

## Task 3: 文档更新 (README)

**Files:**
- Modify: `packages/pi-tui-openspec-status/README.md`

**Interfaces:**
- Consumes: command name `/tui-openspec-select` and semantics from Task 2.
- Produces: user-facing usage docs.

- [ ] **Step 1: Add the command section**

Append to `packages/pi-tui-openspec-status/README.md` a section documenting:

- `/tui-openspec-select` — opens an interactive picker listing all active changes (`openspec/changes/*/` minus `archive`) plus a `None` option.
- Selecting a change manually locks the status bar to it; bash `openspec` commands will NOT switch it away until you manually re-select or pick `None` (manual overrides auto).
- Picking `None` clears the manual lock and restores automatic tracking from bash commands.
- Cancelling (Esc) changes nothing.
- Archiving the manually tracked change still auto-clears the status bar.

- [ ] **Step 2: Verify docs render (no tests needed for markdown)**

Run: `cd packages/pi-tui-openspec-status && pnpm exec vitest run` (sanity — still green)
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/pi-tui-openspec-status/README.md
git commit -m "docs(tui-openspec-status): document /tui-openspec-select command"
```
