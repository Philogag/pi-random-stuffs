---
change: restore-openspec-lock-on-resume
design-doc: openspec/changes/restore-openspec-lock-on-resume/design.md
base-ref: 5a31b6e66f7b9c3dc6e54ffd5816eda03c2edd80
---

# Restore OpenSpec Lock on Resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the openspec lock state (spec / worktree / lock type) via `pi.appendEntry()` and restore it on `session_start` so `/resume` no longer leaves the status bar empty.

**Architecture:** `OpenSpecStatusRender` gains an `onStateChange` callback fired at every state-change point; `src/index.ts` wires it to `pi.appendEntry(LOCK_CUSTOM_TYPE, snapshot)`. On `session_start`, `src/index.ts` scans `ctx.sessionManager.getEntries()` for the last matching custom entry and restores via `render.lock()` (manual) or `render.setSpec()` + `setWorkTree()` (auto). Restore triggers the existing `refresh()` → re-queries `openspec status --json` → republishes.

**Tech Stack:** TypeScript, pi Extension API (`pi.appendEntry`, `ctx.sessionManager.getEntries`, `CustomEntry`), Node's `node:test` + `assert` for tests, `tsc -b` for build.

**Spec:** `openspec/changes/restore-openspec-lock-on-resume/specs/tui-openspec-status/spec.md`
**Design:** `openspec/changes/restore-openspec-lock-on-resume/design.md`
**Tasks:** `openspec/changes/restore-openspec-lock-on-resume/tasks.md`

## Global Constraints

- Only touch `packages/pi-tui-openspec-status/` — no other package.
- `LOCK_CUSTOM_TYPE` MUST be the exact string `"pi-tui-openspec-status"`.
- `PersistedLock` MUST have `version: 1`; restore MUST ignore entries whose `version !== 1` or whose `spec` is not a string (dirty data → null → empty state).
- Restore takes the **last** matching entry (getEntries order = time order).
- All restore/persist calls MUST be wrapped in try/catch; failures keep empty state, never throw, never touch LLM context.
- CustomEntry does NOT participate in LLM context — never inject it into context.
- Existing tests run with `pnpm test` (node:test, all in `packages/pi-tui-openspec-status/test/`); build with `pnpm build` (`tsc -b`).

---

### Task 1: `PersistedLock` type + `findLastPersistedLock` helper

**Files:**
- Create: `packages/pi-tui-openspec-status/src/state.ts`
- Modify: `packages/pi-tui-openspec-status/src/index.ts` (import — later task wires usage)
- Test: `packages/pi-tui-openspec-status/test/state.test.ts`

**Interfaces:**
- Produces: `export interface PersistedLock { spec: string; worktree?: string; manualLock: boolean; version: 1 }`, `export const LOCK_CUSTOM_TYPE = "pi-tui-openspec-status"`, `export function findLastPersistedLock(entries: SessionEntry[]): PersistedLock | null` (returns `null` when no valid entry).

- [ ] **Step 1: Write the failing test**

Create `packages/pi-tui-openspec-status/test/state.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCK_CUSTOM_TYPE, findLastPersistedLock } from "../src/state.js";
import type { CustomEntry } from "@earendil-works/pi-coding-agent";

function customEntry(data?: unknown, customType = LOCK_CUSTOM_TYPE): CustomEntry {
  return { type: "custom", id: "e1", parentId: null, timestamp: "t", customType, data };
}

test("returns null when no entries", () => {
  assert.equal(findLastPersistedLock([]), null);
});

test("returns the last matching entry", () => {
  const entries = [
    customEntry({ spec: "alpha", manualLock: false, version: 1 }),
    customEntry({ spec: "beta", manualLock: true, version: 1 }),
  ] as CustomEntry[];
  const got = findLastPersistedLock(entries);
  assert.deepEqual(got, { spec: "beta", manualLock: true, version: 1 });
});

test("ignores non-matching customType", () => {
  const entries = [customEntry({ spec: "alpha", manualLock: false, version: 1 }, "other-ext")] as CustomEntry[];
  assert.equal(findLastPersistedLock(entries), null);
});

test("ignores dirty data: wrong version", () => {
  const entries = [customEntry({ spec: "alpha", manualLock: false, version: 2 })] as CustomEntry[];
  assert.equal(findLastPersistedLock(entries), null);
});

test("ignores dirty data: non-string spec", () => {
  const entries = [customEntry({ spec: 42, manualLock: false, version: 1 })] as CustomEntry[];
  assert.equal(findLastPersistedLock(entries), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/pi-tui-openspec-status && npx tsc -b && node --test test/state.test.ts`
Expected: FAIL — `Cannot find module '../src/state.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/pi-tui-openspec-status/src/state.ts`:

```ts
import type { CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";

export interface PersistedLock {
  spec: string;
  worktree?: string;
  manualLock: boolean;
  version: 1;
}

export const LOCK_CUSTOM_TYPE = "pi-tui-openspec-status";

function isPersistedLock(data: unknown): data is PersistedLock {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.version === 1 && typeof d.spec === "string" && typeof d.manualLock === "boolean";
}

export function findLastPersistedLock(entries: SessionEntry[]): PersistedLock | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "custom" && (e as CustomEntry).customType === LOCK_CUSTOM_TYPE) {
      if (isPersistedLock((e as CustomEntry).data)) return (e as CustomEntry).data;
      return null; // latest matching entry is dirty — stop, fall back to empty
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/pi-tui-openspec-status && npx tsc -b && node --test test/state.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-tui-openspec-status/src/state.ts packages/pi-tui-openspec-status/test/state.test.ts
git commit -m "feat: add PersistedLock type and findLastPersistedLock helper"
```

---

### Task 2: `onStateChange` callback on `OpenSpecStatusRender`

**Files:**
- Modify: `packages/pi-tui-openspec-status/src/render.ts`
- Test: `packages/pi-tui-openspec-status/test/render.test.ts` (if exists — else create)

**Interfaces:**
- Consumes: `PersistedLock`, `LOCK_CUSTOM_TYPE` from `src/state.ts`.
- Produces: `OpenSpecStatusRender` constructor option `onStateChange?: (state: PersistedLock | null) => void`. Fired with a full snapshot on `setSpec` / `setWorkTree` / `lock` / `clearLock` and with `null` on auto-unlock (all sources gone) in `renderText()`.

- [ ] **Step 1: Write the failing test**

In `packages/pi-tui-openspec-status/test/render.test.ts` (create if absent; mirror existing test setup — mock `ctx.ui.setStatus`):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenSpecStatusRender } from "../src/render.js";

test("onStateChange fires with snapshot on lock", async () => {
  const calls: (unknown)[] = [];
  const render = new OpenSpecStatusRender("ext", { ui: { setStatus: () => {} } } as never, {
    onStateChange: (s) => calls.push(s),
    debounceMs: 0,
  } as never);
  render.lock("alpha");
  assert.deepEqual(calls.at(-1), { spec: "alpha", manualLock: true, version: 1 });
});

test("onStateChange fires with null on clearLock", () => {
  const calls: (unknown)[] = [];
  const render = new OpenSpecStatusRender("ext", { ui: { setStatus: () => {} } } as never, {
    onStateChange: (s) => calls.push(s),
    debounceMs: 0,
  } as never);
  render.lock("alpha");
  render.clearLock();
  assert.equal(calls.at(-1), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/pi-tui-openspec-status && npx tsc -b && node --test test/render.test.ts`
Expected: FAIL — `render.lock is not a function` (constructor signature mismatch) or `calls` stays empty.

- [ ] **Step 3: Write minimal implementation**

In `packages/pi-tui-openspec-status/src/render.ts`:

```ts
import type { PersistedLock } from "./state.js";

// In OpenSpecStatusRender constructor options:
export interface OpenSpecStatusRenderOptions {
  debounceMs?: number;
  onStateChange?: (state: PersistedLock | null) => void;
}

// Store as private field: private readonly onStateChange: ((state: PersistedLock | null) => void) | undefined;
// Assign from options in constructor.

// In setSpec(change): after `this.spec = change; this.refresh();` add:
this.onStateChange?.({ spec: this.spec, worktree: this.worktree, manualLock: false, version: 1 });

// In setWorkTree(worktree): after `this.worktree = worktree; this.refresh();` add:
this.onStateChange?.({ spec: this.spec, worktree: this.worktree, manualLock: this.manualLock, version: 1 });

// In lock(change): after setting manualLock/spec + refresh, add:
this.onStateChange?.({ spec: this.spec, worktree: this.worktree, manualLock: true, version: 1 });

// In clearLock(): after resetting fields + setStatus(undefined), add:
this.onStateChange?.(null);

// In renderText()'s auto-unlock branch (all sources gone): after resetting spec/worktree/manualLock, add:
this.onStateChange?.(null);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/pi-tui-openspec-status && npx tsc -b && node --test test/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite (regression: unlock/auto-lock paths still publish)**

Run: `cd packages/pi-tui-openspec-status && node --test test/`
Expected: PASS (all existing tests unaffected — `onStateChange` optional).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-tui-openspec-status/src/render.ts packages/pi-tui-openspec-status/test/render.test.ts
git commit -m "feat: add onStateChange callback to OpenSpecStatusRender"
```

---

### Task 3: Persist on state change + restore on session_start

**Files:**
- Modify: `packages/pi-tui-openspec-status/src/index.ts`
- Modify: `packages/pi-tui-openspec-status/test/index.test.ts` (fake sessionManager + resume cases)

**Interfaces:**
- Consumes: `findLastPersistedLock`, `LOCK_CUSTOM_TYPE`, `PersistedLock` (Task 1); `onStateChange` option (Task 2).
- Produces: persisted `CustomEntry` with `customType = "pi-tui-openspec-status"` on every state change; restored lock on `session_start`.

- [ ] **Step 1: Write the failing test — persist on lock**

In `packages/pi-tui-openspec-status/test/index.test.ts`, extend the fake `pi` with `appendEntry` and the fake ctx with a sessionManager whose `getEntries()` returns a controllable array. Add:

```ts
test("lock persists state via pi.appendEntry", async () => {
  const { pi, ctx, calls, factory } = makeHarness();
  await pi.fire("session_start", {}, ctx);
  pi.commands["tui-openspec-select"].handler(["alpha"], ctx);
  assert.ok(pi.appendEntries.some(([t, d]) => t === "pi-tui-openspec-status" && d?.spec === "alpha" && d?.manualLock === true));
});

test("session_start restores manual lock from entries", async () => {
  const { pi, ctx, calls } = makeHarness();
  ctx.sessionEntries = [{ type: "custom", id: "e1", parentId: null, timestamp: "t", customType: "pi-tui-openspec-status", data: { spec: "alpha", manualLock: true, version: 1 } }];
  await pi.fire("session_start", {}, ctx);
  await flush(); // allow debounce/refresh to run
  assert.ok(calls.some((c) => typeof c === "string" && c.includes("alpha")));
});

test("session_start restores auto lock and stays auto", async () => {
  const { pi, ctx, calls } = makeHarness();
  ctx.sessionEntries = [{ type: "custom", id: "e1", parentId: null, timestamp: "t", customType: "pi-tui-openspec-status", data: { spec: "beta", manualLock: false, version: 1 } }];
  await pi.fire("session_start", {}, ctx);
  await flush();
  // bash with a new change switches the lock (auto semantics preserved)
  await pi.fire("tool_call", { type: "tool_call", toolName: "bash", input: { command: "openspec status --change gamma --json" } }, ctx);
  await flush();
  assert.ok(calls.some((c) => typeof c === "string" && c.includes("gamma")));
});
```

(Adjust `makeHarness` to record `appendEntries`; reuse existing `flush()` helper that awaits debounce timers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/pi-tui-openspec-status && npx tsc -b && node --test test/index.test.ts`
Expected: FAIL — no restore behavior / `appendEntry` not wired.

- [ ] **Step 3: Implement persistence wiring**

In `packages/pi-tui-openspec-status/src/index.ts`, when constructing `OpenSpecStatusRender`, pass:

```ts
onStateChange: (state) => {
  try {
    pi.appendEntry(LOCK_CUSTOM_TYPE, state ?? { spec: "", manualLock: false, version: 1 });
  } catch { /* never throw on persist failure */ }
}
```

Import `LOCK_CUSTOM_TYPE`, `findLastPersistedLock` from `./state.js`.

- [ ] **Step 4: Implement restore in session_start**

In the `session_start` handler, after `render = new OpenSpecStatusRender(...)` and `ctx.ui.setStatus(EXTENSION_ID, undefined)`:

```ts
try {
  const saved = findLastPersistedLock(ctx.sessionManager.getEntries());
  if (saved && saved.spec) {
    if (saved.manualLock) {
      render.lock(saved.spec);
      if (saved.worktree) render.setWorkTree(saved.worktree);
    } else {
      render.setSpec(saved.spec);
      if (saved.worktree) render.setWorkTree(saved.worktree);
    }
  }
} catch { /* keep empty state on any restore failure */ }
```

Note: `setSpec` is a no-op under manualLock, so the branch order above is deliberate (manual branch uses `lock`, auto branch uses `setSpec`). Both call `refresh()` → re-query + republish.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/pi-tui-openspec-status && npx tsc -b && node --test test/index.test.ts`
Expected: PASS (3 new tests).

- [ ] **Step 6: Run full suite + build**

Run: `cd packages/pi-tui-openspec-status && node --test test/ && cd ../.. && pnpm build`
Expected: all tests pass, `tsc -b` clean.

- [ ] **Step 7: Commit**

```bash
git add packages/pi-tui-openspec-status/src/index.ts packages/pi-tui-openspec-status/test/index.test.ts
git commit -m "feat: persist lock state and restore on session_start"
```

---

### Task 4: README + final verification

**Files:**
- Modify: `packages/pi-tui-openspec-status/README.md`

- [ ] **Step 1: Document persistence behavior**

Add a section to `README.md`:

```markdown
## 锁定状态持久化

锁定状态（spec / worktree / 锁类型）通过 `pi.appendEntry()` 写入 session 文件，
在 `/resume`（或 startup/new）时自动恢复：
- 手动锁 → resume 后固定显示该 change；
- 自动锁 → resume 后保持 auto-lock 语义（后续 bash openspec 命令仍可更新）。
```

- [ ] **Step 2: Final verification**

Run: `cd packages/pi-tui-openspec-status && node --test test/ && cd ../.. && pnpm build`
Expected: all tests pass, build clean.

- [ ] **Step 3: Commit**

```bash
git add packages/pi-tui-openspec-status/README.md
git commit -m "docs: document lock state persistence and restore"
```
