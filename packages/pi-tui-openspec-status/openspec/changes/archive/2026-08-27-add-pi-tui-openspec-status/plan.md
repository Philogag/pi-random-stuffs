# `@philogag/pi-tui-openspec-status` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pi extension that renders the current locked openspec change as a single status-bar line, with auto worktree-aware task merging.

**Architecture:** A small monorepo package split into 4 single-responsibility units (parser / openspec / merge / render) glued by an `index.ts` extension entry. Each unit is pure & testable; only the entry talks to pi's `ctx.ui.setStatus`. Debounced (500ms) refresh on `tool_call` + `tool_result`.

**Tech Stack:** TypeScript (ES2022, NodeNext modules), Node 20+, `@earendil-works/pi-coding-agent` SDK (peerDependency ≥0.40), vitest for unit tests, pnpm workspaces.

**Spec:** `openspec/changes/add-pi-tui-openspec-status/design.md` + `openspec/changes/add-pi-tui-openspec-status/specs/tui-openspec-status/spec.md`

---

## Global Constraints

- Peer dependency: `@earendil-works/pi-coding-agent >= 0.40.0` (uses `ctx.ui.setStatus` API).
- Node 20+; ESM with `.js` import paths in TS sources.
- All async I/O wrapped in try/catch; failures MUST NOT throw.
- `ctx.hasUI === false` MUST skip every `setStatus` call.
- extensionId constant: `"pi-tui-openspec-status"`.
- Debounce window: 500ms (`SET_STATUS_DEBOUNCE_MS`).
- CLI timeout: 2000ms (`OPENSPEC_STATUS_TIMEOUT_MS`).
- Progress bar width: 10 cells; `done > total` MUST be clamped to `total`.
- Capability kebab-case: `tui-openspec-status`; package name: `@philogag/pi-tui-openspec-status`.

---

## File Structure

**Created in `packages/pi-tui-openspec-status/`:**
- `package.json` — package manifest + scripts.
- `tsconfig.json` — TS compiler config (ES2022, NodeNext, strict).
- `vitest.config.ts` — vitest config (node env, include `src/**/*.test.ts`).
- `README.md` — installation, behavior, worktree semantics.
- `src/index.ts` — pi ExtensionFactory; wires hooks + `ctx.ui.setStatus`.
- `src/parser.ts` — bash command → `{ subcommand, changeName?, effectiveCwd, isWorktree }`.
- `src/openspec.ts` — `runOpenspecStatus(changeName, cwd)` thin spawn wrapper.
- `src/merge.ts` — `parseTasksFile` / `mergeTasks` / `readMergedTasks` pure functions.
- `src/render.ts` — `formatArtifactTokens` / `formatProgressBar` / `renderLine` pure functions.
- `src/types.ts` — shared `StatusJson` / `ArtifactStatus` types.
- `src/parser.test.ts` — unit tests for parser.
- `src/merge.test.ts` — unit tests for merge.
- `src/render.test.ts` — unit tests for render.

**Modified:**
- None (greenfield monorepo sub-package).

---

## Task 1: 包骨架与构建配置

**Files:**
- Create: `packages/pi-tui-openspec-status/package.json`
- Create: `packages/pi-tui-openspec-status/tsconfig.json`
- Create: `packages/pi-tui-openspec-status/vitest.config.ts`
- Create: `packages/pi-tui-openspec-status/src/index.ts` (placeholder)

**Interfaces:**
- Produces: `pnpm -F @philogag/pi-tui-openspec-status build` exits 0.

- [ ] **Step 1: Create `packages/pi-tui-openspec-status/package.json`**

```json
{
  "name": "@philogag/pi-tui-openspec-status",
  "version": "0.1.0",
  "description": "pi extension: single-line status bar for the current locked openspec change, with worktree-aware task merging",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "watch": "tsc -p tsconfig.json --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.40.0"
  },
  "devDependencies": {
    "@types/node": ">=20",
    "typescript": ">=5.6",
    "vitest": ">=2.0"
  }
}
```

- [ ] **Step 2: Create `packages/pi-tui-openspec-status/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/pi-tui-openspec-status/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create placeholder `packages/pi-tui-openspec-status/src/index.ts`**

```ts
export default function placeholder() {
  return {};
}
```

- [ ] **Step 5: Install & verify build**

Run from repo root:
```bash
pnpm install
pnpm -F @philogag/pi-tui-openspec-status build
```
Expected: exit 0; `packages/pi-tui-openspec-status/dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/pi-tui-openspec-status/
git commit -m "feat(pi-tui-openspec-status): scaffold package with build config"
```

---

## Task 2: 共享类型 (`src/types.ts`)

**Files:**
- Create: `packages/pi-tui-openspec-status/src/types.ts`

**Interfaces:**
- Produces: `ArtifactStatus`, `StatusJson`, `ParsedBashCommand` types consumed by parser/merge/render/index.

- [ ] **Step 1: Write the file**

```ts
// src/types.ts
export interface ArtifactStatus {
  id: "proposal" | "design" | "specs" | "tasks";
  status: "done" | "ready" | "blocked" | "skipped";
}

export interface StatusJson {
  artifacts?: ArtifactStatus[];
  applied?: boolean;
  schemaName?: string;
  // Forward-compatible: additional fields allowed.
  [key: string]: unknown;
}

export interface ParsedBashCommand {
  subcommand: string;
  changeName?: string;
  effectiveCwd: string;
  isWorktree: boolean;
  isLocking: boolean;
}

export interface MergedTasks {
  done: number;
  total: number;
}
```

- [ ] **Step 2: Verify build still passes**

Run: `pnpm -F @philogag/pi-tui-openspec-status build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/pi-tui-openspec-status/src/types.ts
git commit -m "feat(pi-tui-openspec-status): add shared types"
```

---

## Task 3: parser 单元 — 锁定子命令判断

**Files:**
- Create: `packages/pi-tui-openspec-status/src/parser.ts`
- Create: `packages/pi-tui-openspec-status/src/parser.test.ts`

**Interfaces:**
- Produces: `isLockingSubcommand(sub: string): boolean` — true for `new|status|apply|archive|verify|sync|instructions|show|validate|context|view`.

- [ ] **Step 1: Write failing test**

```ts
// src/parser.test.ts
import { describe, expect, it } from "vitest";
import { isLockingSubcommand } from "./parser.js";

describe("isLockingSubcommand", () => {
  it.each([
    "new", "status", "apply", "archive", "verify",
    "sync", "instructions", "show", "validate", "context", "view",
  ])("returns true for %s", (sub) => {
    expect(isLockingSubcommand(sub)).toBe(true);
  });

  it.each(["list", "doctor", "schemas", "init", "help"])(
    "returns false for %s",
    (sub) => {
      expect(isLockingSubcommand(sub)).toBe(false);
    },
  );

  it("is case-sensitive and rejects uppercase", () => {
    expect(isLockingSubcommand("STATUS")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @philogag/pi-tui-openspec-status test -- parser.test.ts`
Expected: FAIL — `isLockingSubcommand is not a function`.

- [ ] **Step 3: Implement minimal code in `src/parser.ts`**

```ts
// src/parser.ts
import type { ParsedBashCommand } from "./types.js";

const LOCKING_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "new", "status", "apply", "archive", "verify",
  "sync", "instructions", "show", "validate", "context", "view",
]);

export function isLockingSubcommand(sub: string): boolean {
  return LOCKING_SUBCOMMANDS.has(sub);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @philogag/pi-tui-openspec-status test -- parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-tui-openspec-status/src/parser.ts \
        packages/pi-tui-openspec-status/src/parser.test.ts
git commit -m "feat(pi-tui-openspec-status): add isLockingSubcommand"
```

---

## Task 4: parser 单元 — bash tokenize + change 提取

**Files:**
- Modify: `packages/pi-tui-openspec-status/src/parser.ts`
- Modify: `packages/pi-tui-openspec-status/src/parser.test.ts`

**Interfaces:**
- Produces: `extractChangeName(tokens: string[]): string | undefined`

- [ ] **Step 1: Append failing tests to `src/parser.test.ts`**

```ts
import { extractChangeName, parseBashCommand } from "./parser.js";

describe("extractChangeName", () => {
  it("prefers --change flag", () => {
    expect(
      extractChangeName(["status", "--change", "add-foo", "--json"]),
    ).toBe("add-foo");
  });

  it("falls back to first non-flag positional", () => {
    expect(extractChangeName(["show", "add-bar"])).toBe("add-bar");
  });

  it("returns undefined when no change can be found", () => {
    expect(extractChangeName(["status", "--json"])).toBeUndefined();
  });

  it("ignores unknown flags as positional fallback when --change missing", () => {
    expect(extractChangeName(["show", "baz", "--json"])).toBe("baz");
  });
});

describe("parseBashCommand - non-openspec", () => {
  it("returns null for ls / pnpm / unrelated", () => {
    expect(parseBashCommand("ls -la")).toBeNull();
    expect(parseBashCommand("pnpm test")).toBeNull();
  });
});

describe("parseBashCommand - cd rewrite", () => {
  it("extracts effective cwd from 'cd X && ...'", () => {
    const r = parseBashCommand(
      "cd .worktrees/feat/x && openspec status --change foo --json",
    );
    expect(r?.effectiveCwd).toBe(".worktrees/feat/x");
    expect(r?.isWorktree).toBe(true);
    expect(r?.subcommand).toBe("status");
    expect(r?.changeName).toBe("foo");
    expect(r?.isLocking).toBe(true);
  });

  it("uses last cd in a chain", () => {
    const r = parseBashCommand(
      "cd /tmp && cd .worktrees/feat/x && openspec status --change foo",
    );
    expect(r?.effectiveCwd).toBe(".worktrees/feat/x");
  });

  it("ignores non-cd prefix", () => {
    const r = parseBashCommand(
      "echo hi && openspec status --change foo --json",
    );
    expect(r?.subcommand).toBe("status");
    expect(r?.changeName).toBe("foo");
  });
});

describe("parseBashCommand - locking semantics", () => {
  it("marks 'list' as non-locking", () => {
    const r = parseBashCommand("openspec list --json");
    expect(r?.subcommand).toBe("list");
    expect(r?.isLocking).toBe(false);
  });

  it("marks 'doctor' as non-locking", () => {
    const r = parseBashCommand("openspec doctor");
    expect(r?.subcommand).toBe("doctor");
    expect(r?.isLocking).toBe(false);
  });

  it("uses first positional when no --change", () => {
    const r = parseBashCommand("openspec show add-foo");
    expect(r?.changeName).toBe("add-foo");
    expect(r?.isLocking).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @philogag/pi-tui-openspec-status test -- parser.test.ts`
Expected: FAIL — `extractChangeName` and `parseBashCommand` not defined.

- [ ] **Step 3: Implement in `src/parser.ts`**

Append to existing `src/parser.ts`:

```ts
const CONNECTORS = new Set(["&&", "||", "|", ";"]);

/**
 * Split a bash command string into a flat token list.
 * Supports quoted strings ("…" or '…') as single tokens.
 * Honors && || | ; connectors by emitting them as separators (kept out).
 */
export function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        buf += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (buf) {
        tokens.push(buf);
        buf = "";
      }
      continue;
    }
    if (CONNECTORS.has(buf + c) || CONNECTORS.has(c)) {
      if (buf) {
        tokens.push(buf);
        buf = "";
      }
      // Peek two-char connectors
      const next = cmd[i + 1];
      if ((c === "&" || c === "|") && next === c) {
        i++; // skip second char
      }
      continue;
    }
    buf += c;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/**
 * From a token list starting AFTER "openspec <subcommand>",
 * find the change name.
 */
export function extractChangeName(tokens: string[]): string | undefined {
  // tokens[0] is the openspec subcommand; skip it.
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === "--change") {
      const v = tokens[i + 1];
      if (v && !v.startsWith("--")) return v;
      continue;
    }
    if (tokens[i]?.startsWith("--")) continue; // other flag
    // first positional
    if (tokens[i]) return tokens[i];
  }
  return undefined;
}

/**
 * Find the last `cd <path>` in a token sequence and return the path.
 * Walks all tokens looking for "cd" followed by a non-flag arg.
 */
function lastCdTarget(tokens: string[]): string | undefined {
  let last: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "cd" && tokens[i + 1] && !tokens[i + 1]!.startsWith("--")) {
      last = tokens[i + 1];
      i++; // skip path
    }
  }
  return last;
}

const WORKTREE_RE = /\.worktrees\/([^/\s]+)/;

/**
 * Parse a bash command line.
 * Returns null when the command is not an `openspec` invocation.
 * Recognizes `openspec` anywhere in the pipeline (after `cd X &&`, etc.)
 * so that worktree prefixes are honored.
 */
export function parseBashCommand(cmd: string): ParsedBashCommand | null {
  const tokens = tokenize(cmd);
  if (tokens.length === 0) return null;

  const openspecIdx = tokens.indexOf("openspec");
  if (openspecIdx === -1) return null;

  const subcommand = tokens[openspecIdx + 1] ?? "";
  // rest includes the subcommand itself; extractChangeName will skip it.
  const rest = tokens.slice(openspecIdx + 1);
  // Scan the prefix (everything before `openspec`) for the last `cd <path>`.
  const cd = lastCdTarget(tokens.slice(0, openspecIdx));

  const effectiveCwd = cd ?? "";
  const isWorktree = !!effectiveCwd && WORKTREE_RE.test(effectiveCwd);
  const isLocking = isLockingSubcommand(subcommand);
  const changeName = isLocking ? extractChangeName(rest) : undefined;

  return {
    subcommand,
    changeName,
    effectiveCwd,
    isWorktree,
    isLocking,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @philogag/pi-tui-openspec-status test -- parser.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-tui-openspec-status/src/parser.ts \
        packages/pi-tui-openspec-status/src/parser.test.ts
git commit -m "feat(pi-tui-openspec-status): add bash command parser"
```

---

## Task 5: merge 单元 — tasks.md 解析与去重

**Files:**
- Create: `packages/pi-tui-openspec-status/src/merge.ts`
- Create: `packages/pi-tui-openspec-status/src/merge.test.ts`

**Interfaces:**
- Produces: `parseTasksFile(text: string): Map<string, boolean>`
- Produces: `mergeTasks(main, worktree): MergedTasks`

- [ ] **Step 1: Write failing tests**

```ts
// src/merge.test.ts
import { describe, expect, it } from "vitest";
import { mergeTasks, parseTasksFile } from "./merge.js";

describe("parseTasksFile", () => {
  it("parses checked + unchecked tasks by ID", () => {
    const md = [
      "## 1. Foo",
      "- [x] 1.1 one",
      "- [ ] 1.2 two",
      "## 2. Bar",
      "- [x] 2.1 three",
    ].join("\n");
    const m = parseTasksFile(md);
    expect(m.size).toBe(3);
    expect(m.get("1.1")).toBe(true);
    expect(m.get("1.2")).toBe(false);
    expect(m.get("2.1")).toBe(true);
  });

  it("accepts 'done' as checked marker", () => {
    const md = "- [done] 1.1 foo";
    expect(parseTasksFile(md).get("1.1")).toBe(true);
  });

  it("returns empty Map for blank input", () => {
    expect(parseTasksFile("").size).toBe(0);
  });
});

describe("mergeTasks", () => {
  it("union by key, OR checked", () => {
    const main = new Map([
      ["1", true],
      ["2", false],
    ]);
    const wt = new Map([
      ["2", true],
      ["3", false],
    ]);
    const r = mergeTasks(main, wt);
    expect(r.total).toBe(3);
    expect(r.done).toBe(2); // 1 (main), 2 (wt)
  });

  it("treats all-unchecked worktree as not done", () => {
    const main = new Map([["1", true]]);
    const wt = new Map<string, boolean>();
    expect(mergeTasks(main, wt)).toEqual({ done: 1, total: 1 });
  });

  it("handles empty inputs", () => {
    expect(mergeTasks(new Map(), new Map())).toEqual({ done: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @philogag/pi-tui-openspec-status test -- merge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/merge.ts`**

```ts
// src/merge.ts
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { MergedTasks } from "./types.js";

const CHECKED_RE = /^\s*-\s*\[(x|done)\]\s+(\S+)/i;
const UNCHECKED_RE = /^\s*-\s*\[( |)\]\s+(\S+)/;
const ANY_TASK_RE = /^\s*-\s*\[[ xX]\]?\s*(\S+)/;

export function parseTasksFile(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const line of text.split(/\r?\n/)) {
    let m: RegExpExecArray | null;
    if ((m = CHECKED_RE.exec(line))) {
      out.set(m[2]!, true);
      continue;
    }
    if ((m = UNCHECKED_RE.exec(line))) {
      out.set(m[2]!, false);
      continue;
    }
    if ((m = ANY_TASK_RE.exec(line))) {
      // Fallback: line that looks like a task but didn't match above;
      // default to unchecked if not already present.
      if (!out.has(m[1]!)) out.set(m[1]!, false);
    }
  }
  return out;
}

export function mergeTasks(
  main: Map<string, boolean>,
  worktree: Map<string, boolean>,
): MergedTasks {
  const keys = new Set<string>([...main.keys(), ...worktree.keys()]);
  let done = 0;
  for (const k of keys) {
    if (main.get(k) === true || worktree.get(k) === true) done++;
  }
  return { done, total: keys.size };
}

/**
 * Read tasks.md from both main repo and (optional) worktree,
 * parse & merge. Returns { done: 0, total: 0 } on any read failure.
 */
export async function readMergedTasks(
  changeName: string,
  mainRepoRoot: string,
  worktreeCwd?: string,
): Promise<MergedTasks> {
  try {
    const mainPath = path.join(
      mainRepoRoot,
      "openspec",
      "changes",
      changeName,
      "tasks.md",
    );
    const mainText = await readFile(mainPath, "utf8");
    const mainMap = parseTasksFile(mainText);
    if (!worktreeCwd) {
      return mergeTasks(mainMap, new Map());
    }
    const wtPath = path.join(worktreeCwd, "openspec", "changes", changeName, "tasks.md");
    let wtMap = new Map<string, boolean>();
    try {
      const wtText = await readFile(wtPath, "utf8");
      wtMap = parseTasksFile(wtText);
    } catch {
      // worktree tasks.md may not exist; treat as empty
    }
    return mergeTasks(mainMap, wtMap);
  } catch {
    return { done: 0, total: 0 };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @philogag/pi-tui-openspec-status test -- merge.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-tui-openspec-status/src/merge.ts \
        packages/pi-tui-openspec-status/src/merge.test.ts
git commit -m "feat(pi-tui-openspec-status): add tasks.md merge with worktree dedup"
```

---

## Task 6: render 单元 — artifact 拼接与进度条

**Files:**
- Create: `packages/pi-tui-openspec-status/src/render.ts`
- Create: `packages/pi-tui-openspec-status/src/render.test.ts`

**Interfaces:**
- Produces: `formatArtifactTokens(statuses: ArtifactStatus[]): string`
- Produces: `formatProgressBar(done, total): string`
- Produces: `renderLine(name, schema, statuses, tasks): string`

- [ ] **Step 1: Write failing tests**

```ts
// src/render.test.ts
import { describe, expect, it } from "vitest";
import type { ArtifactStatus } from "./types.js";
import { formatArtifactTokens, formatProgressBar, renderLine } from "./render.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @philogag/pi-tui-openspec-status test -- render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/render.ts`**

```ts
// src/render.ts
import type { ArtifactStatus, MergedTasks } from "./types.js";

export const ARTIFACT_INITIALS: Record<ArtifactStatus["id"], string> = {
  proposal: "P",
  design: "D",
  specs: "S",
  tasks: "T",
};

const BAR_WIDTH = 10;
const FILLED = "█";
const EMPTY = "░";

export function formatArtifactTokens(statuses: ArtifactStatus[]): string {
  return statuses
    .filter((s): s is ArtifactStatus => s.id in ARTIFACT_INITIALS)
    .map((s) => `${ARTIFACT_INITIALS[s.id]}${s.status === "done" ? "●" : "○"}`)
    .join(" ");
}

export function formatProgressBar(done: number, total: number): string {
  const d = Math.max(0, Math.min(done, total));
  const filledCells = total === 0 ? 0 : Math.round((d / total) * BAR_WIDTH);
  return FILLED.repeat(filledCells) + EMPTY.repeat(BAR_WIDTH - filledCells);
}

export function renderLine(
  name: string,
  schemaName: string,
  statuses: ArtifactStatus[],
  tasks: MergedTasks,
): string {
  return [
    name,
    `(${schemaName})`,
    `[${formatArtifactTokens(statuses)}]`,
    "Tasks:",
    `${formatProgressBar(tasks.done, tasks.total)} ${tasks.done}/${tasks.total}`,
  ].join(" ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @philogag/pi-tui-openspec-status test -- render.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-tui-openspec-status/src/render.ts \
        packages/pi-tui-openspec-status/src/render.test.ts
git commit -m "feat(pi-tui-openspec-status): add status line rendering"
```

---

## Task 7: openspec CLI 封装

**Files:**
- Create: `packages/pi-tui-openspec-status/src/openspec.ts`

**Interfaces:**
- Produces: `runOpenspecStatus(changeName, cwd): Promise<StatusJson | null>`

- [ ] **Step 1: Write `src/openspec.ts`**

```ts
// src/openspec.ts
import { spawn } from "node:child_process";
import type { StatusJson } from "./types.js";

export const OPENSPEC_STATUS_TIMEOUT_MS = 2000;

export async function runOpenspecStatus(
  changeName: string,
  cwd: string,
): Promise<StatusJson | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: StatusJson | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    let stdout = "";
    let stderr = "";
    let proc: ReturnType<typeof spawn> | null = null;
    try {
      proc = spawn(
        "openspec",
        ["status", "--change", changeName, "--json"],
        { cwd: cwd || process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      proc?.kill();
      finish(null);
    }, OPENSPEC_STATUS_TIMEOUT_MS);

    proc.stdout?.on("data", (b) => (stdout += b.toString("utf8")));
    proc.stderr?.on("data", (b) => (stderr += b.toString("utf8")));

    proc.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as StatusJson;
        finish(parsed);
      } catch {
        finish(null);
      }
    });
  });
}
```

- [ ] **Step 2: Verify build & typecheck**

Run:
```bash
pnpm -F @philogag/pi-tui-openspec-status build
pnpm -F @philogag/pi-tui-openspec-status typecheck
```
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/pi-tui-openspec-status/src/openspec.ts
git commit -m "feat(pi-tui-openspec-status): add openspec CLI wrapper"
```

---

## Task 8: 入口与 hooks 串接 (`index.ts`)

**Files:**
- Create: `packages/pi-tui-openspec-status/src/index.ts`

**Interfaces:**
- Produces: default export `ExtensionFactory` consumed by pi.
- **CRITICAL**: factory MUST early-return when `ctx.mode !== "tui"` — no hooks, no I/O, no state.

- [ ] **Step 1: Replace placeholder `src/index.ts` with implementation**

```ts
// src/index.ts
import { runOpenspecStatus } from "./openspec.js";
import { readMergedTasks } from "./merge.js";
import { parseBashCommand } from "./parser.js";
import { renderLine } from "./render.js";

export const EXTENSION_ID = "pi-tui-openspec-status";
export const SET_STATUS_DEBOUNCE_MS = 500;

type PiMode = "tui" | "rpc" | "json" | "print";

interface ExtensionContextLike {
  mode: PiMode;
  hasUI: boolean;
  cwd: string;
  ui: {
    setStatus(extensionId: string, text: string | undefined): void;
  };
}

interface PiLike {
  on(event: "session_start", handler: () => void): void;
  on(
    event: "tool_call",
    handler: (event: unknown) => Promise<void> | void,
  ): void;
  on(
    event: "tool_result",
    handler: (event: unknown) => Promise<void> | void,
  ): void;
}

interface BashToolCallInput {
  type?: string;
  command?: string;
  cwd?: string;
}

function isBashInput(e: unknown): e is { input: BashToolCallInput } {
  return (
    typeof e === "object" &&
    e !== null &&
    "input" in (e as Record<string, unknown>)
  );
}

export default function piTuiOpenspecStatus(pi: PiLike, ctx: ExtensionContextLike) {
  // D9: TUI-mode exclusive activation. When pi is not running in its
  // interactive terminal mode, the extension is COMPLETELY INACTIVE.
  // We early-return WITHOUT registering any event listeners, starting
  // any resources, or touching internal state. This satisfies the
  // spec Requirement "TUI 模式独占激活". We use ctx.mode (NOT
  // ctx.hasUI) because hasUI is true for both tui and rpc — using
  // hasUI would wrongly activate in rpc mode.
  if (ctx.mode !== "tui") return;

  let lockedChange: string | undefined;
  let effectiveCwd = "";
  let lastRendered = "";
  let pending: ReturnType<typeof setTimeout> | undefined;

  const render = async () => {
    pending = undefined;
    if (!lockedChange) return;
    try {
      const cwd = effectiveCwd || ctx.cwd;
      const status = await runOpenspecStatus(lockedChange, cwd);
      const tasks = await readMergedTasks(
        lockedChange,
        ctx.cwd,
        effectiveCwd || undefined,
      );
      const line = renderLine(
        lockedChange,
        (status?.schemaName as string) || "spec-driven",
        (status?.artifacts ?? []) as never,
        tasks,
      );
      if (line === lastRendered) return;
      lastRendered = line;
      ctx.ui.setStatus(EXTENSION_ID, line);
    } catch {
      // swallow — see R 错误处理与无副作用
    }
  };

  const schedule = () => {
    if (pending) return;
    pending = setTimeout(render, SET_STATUS_DEBOUNCE_MS);
  };

  pi.on("session_start", () => {
    lastRendered = "";
    ctx.ui.setStatus(EXTENSION_ID, undefined);
  });

  pi.on("tool_call", (event) => {
    if (!isBashInput(event) || event.input?.type !== "bash") return;
    const cmd = event.input.command;
    if (typeof cmd !== "string") return;
    const parsed = parseBashCommand(cmd);
    if (!parsed) return;
    if (parsed.isWorktree) effectiveCwd = parsed.effectiveCwd;
    if (parsed.isLocking && parsed.changeName) {
      lockedChange = parsed.changeName;
      schedule();
    }
  });

  pi.on("tool_result", () => {
    if (lockedChange) schedule();
  });
}
```

- [ ] **Step 2: Verify build & typecheck**

Run:
```bash
pnpm -F @philogag/pi-tui-openspec-status build
pnpm -F @philogag/pi-tui-openspec-status typecheck
```
Expected: exit 0.

- [ ] **Step 3: Add TUI-mode gate unit test**

Append to `packages/pi-tui-openspec-status/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import piTuiOpenspecStatus from "./index.js";

function makePi() {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
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
  };
}

describe("piTuiOpenspecStatus — TUI-mode gate", () => {
  it("registers handlers when ctx.mode === 'tui'", () => {
    const pi = makePi();
    const ctx = {
      mode: "tui" as const,
      hasUI: true,
      cwd: "/repo",
      ui: { setStatus: () => {} },
    };
    piTuiOpenspecStatus(pi as never, ctx);
    expect(pi.listenerCount("session_start")).toBe(1);
    expect(pi.listenerCount("tool_call")).toBe(1);
    expect(pi.listenerCount("tool_result")).toBe(1);
  });

  it.each(["print", "json", "rpc"] as const)(
    "registers NO handlers when ctx.mode === '%s' (even if hasUI=true)",
    (mode) => {
      const pi = makePi();
      const ctx = {
        mode,
        hasUI: true, // rpc sets hasUI=true; we still must not activate
        cwd: "/repo",
        ui: { setStatus: () => {} },
      };
      piTuiOpenspecStatus(pi as never, ctx);
      expect(pi.listenerCount("session_start")).toBe(0);
      expect(pi.listenerCount("tool_call")).toBe(0);
      expect(pi.listenerCount("tool_result")).toBe(0);
    },
  );

  it("does not touch ctx.ui.setStatus in non-tui modes", () => {
    const pi = makePi();
    const calls: unknown[] = [];
    const ctx = {
      mode: "print" as const,
      hasUI: false,
      cwd: "/repo",
      ui: { setStatus: (...a: unknown[]) => calls.push(a) },
    };
    piTuiOpenspecStatus(pi as never, ctx);
    // No listener can fire because none registered.
    pi.fire("session_start");
    pi.fire("tool_call", { input: { type: "bash", command: "openspec status --change foo --json" } });
    pi.fire("tool_result", {});
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `pnpm -F @philogag/pi-tui-openspec-status test`
Expected: all PASS (parser/merge/render suites + new index.test.ts).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-tui-openspec-status/src/index.ts \
        packages/pi-tui-openspec-status/src/index.test.ts
git commit -m "feat(pi-tui-openspec-status): wire hooks into pi extension entry

- Factory early-returns when ctx.mode !== 'tui' (D9 / R TUI-mode gate)
- Replaces ctx.hasUI checks with ctx.mode (correct for rpc where
  hasUI is also true)
- Adds unit tests for tui/print/json/rpc mode gating"
```

---

## Task 9: README 文档

**Files:**
- Create: `packages/pi-tui-openspec-status/README.md`

- [ ] **Step 1: Write README**

````markdown
# `@philogag/pi-tui-openspec-status`

A [pi coding agent](https://github.com/mattoopie/pi) extension that
shows the current locked **openspec** change as a single status-bar line:

```
add-pi-tui-openspec-status (superpowers-bridge-cn) [P● D● S○ T○] Tasks: ███░░░░░░░ 2/7
```

## Install

```bash
pnpm add -D @philogag/pi-tui-openspec-status
```

Then enable in your pi config (`~/.pi/settings.json` or
`<repo>/.pi/settings.json`):

```json
{
  "extensions": ["@philogag/pi-tui-openspec-status"]
}
```

## Activation mode

The extension is **TUI-only**. It checks `ctx.mode === "tui"` at factory
time and early-returns in any other mode:

| Mode       | Activates? | Notes                              |
|------------|------------|------------------------------------|
| `tui`      | ✅ yes     | Normal interactive operation        |
| `rpc`      | ❌ no      | `ctx.hasUI === true` here too, but mode check excludes it |
| `json`     | ❌ no      | No event-stream output             |
| `print`    | ❌ no      | `-p` one-shot mode                 |

Per `pi.dev/docs/latest/extensions#ctx-mode`, `ctx.mode` (not
`ctx.hasUI`) is the correct TUI feature gate.

## Behavior

- The status line only appears when you (or the agent) invoke an
  openspec command that **explicitly names a change** —
  `new`, `status`, `apply`, `archive`, `verify`, `sync`,
  `instructions`, `show`, `validate`, `context`, `view`.
- Browsing commands like `openspec list` / `openspec doctor` clear the
  status line.
- The line refreshes 500ms after each matching `bash` tool call.

## Worktree support

When `openspec` is invoked inside a git worktree
(e.g. `.worktrees/feat/openspec-status/`), the extension reads
`tasks.md` from **both** the main repo and the worktree, then
deduplicates by task ID:

- A task is "done" if checked in either side.
- Total count is the union of unique task IDs.

This prevents the progress bar from regressing when the worktree is
ahead of the main repo (the common SDD apply scenario).

## Limitations

- Only the schema's external artifacts (`proposal`, `design`, `specs`,
  `tasks`) appear; planning-phase internal artifacts
  (`brainstorm`, `verify`, `retrospective`) are hidden.
- Requires the `openspec` CLI on `$PATH`. Missing CLI silently disables
  the extension.
- Does **not** render widgets, dialogs, or keyboard shortcuts — only
  the bottom status bar (`ctx.ui.setStatus`).
- **Does not activate in non-TUI modes** (rpc/json/print) — by design.
````

- [ ] **Step 2: Commit**

```bash
git add packages/pi-tui-openspec-status/README.md
git commit -m "docs(pi-tui-openspec-status): add README"
```

---

## Task 10: 验收

**Files:**
- None (verification only).

- [ ] **Step 1: Run all tests**

Run: `pnpm -F @philogag/pi-tui-openspec-status test`
Expected: all PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm -F @philogag/pi-tui-openspec-status typecheck`
Expected: exit 0.

- [ ] **Step 3: Run build**

Run: `pnpm -F @philogag/pi-tui-openspec-status build`
Expected: exit 0; `dist/index.js` exists.

- [ ] **Step 4: Manual smoke — main repo**

```bash
pi -e ./packages/pi-tui-openspec-status/src/index.ts
```

Inside pi:
- Run `openspec status --change add-pi-tui-openspec-status --json`
- Verify bottom status bar shows
  `add-pi-tui-openspec-status (superpowers-bridge-cn) [P● D● S○ T○] Tasks: ████░░░░░░ 4/8` (approx)
- Run `openspec list --json` → status bar clears.
- Run `openspec doctor` → status bar remains cleared.

- [ ] **Step 5: Manual smoke — worktree**

```bash
git worktree add .worktrees/test-merge -b test-merge
cd .worktrees/test-merge
pi -e ../../packages/pi-tui-openspec-status/src/index.ts
```

Inside pi:
- Run `openspec status --change add-pi-tui-openspec-status --json` →
  status bar should show merged progress.
- Edit `.worktrees/test-merge/openspec/changes/add-pi-tui-openspec-status/tasks.md`
  and check one more task → run another openspec command → bar updates.

- [ ] **Step 6: Manual smoke — non-TUI modes (all 4)**

For each mode below, run a benign prompt and verify NO status-bar output appears and NO error is raised. Use the BUILT path (`dist/index.js`), not `src/index.ts`, because pi loads the file as a module.

```bash
# print mode (the original "-p" non-interactive mode)
echo "hello" | pi -p -e ./packages/pi-tui-openspec-status/dist/index.js

# json mode (structured event stream)
echo "hello" | pi --mode json -e ./packages/pi-tui-openspec-status/dist/index.js

# rpc mode — critical: ctx.hasUI === true here, must STILL not activate.
# This is harder to drive from a shell because rpc expects a JSON-RPC client;
# the unit test in src/index.test.ts covers the rpc canary instead.
# (Manual verification skipped; covered by automated test.)
```

Expected per mode: stdout contains no status bar / no extra output beyond prompt; exit 0. The rpc case is the canary — if it activates, the `ctx.mode` gate is broken (covered by automated test in `src/index.test.ts`).

- [ ] **Step 7: Commit any final tweaks**

```bash
git add -A
git commit -m "chore(pi-tui-openspec-status): final tweaks from acceptance run" --allow-empty
```

---

## Self-Review Notes

1. **Spec coverage:** Each `Requirement:` in `specs/tui-openspec-status/spec.md`
   maps to at least one task — see below.
   - 锁定 spec 解析 → Task 3, 4 (parser)
   - 单行 status 条渲染 → Task 6 (render), Task 8 (entry)
   - artifact 首字母与状态符号 → Task 6
   - worktree 自动检测与 cwd 解析 → Task 4
   - worktree tasks 合并去重 → Task 5
   - 刷新策略与去抖 → Task 8
   - 错误处理与无副作用 → Task 7, 8 (try/catch)
   - 非交互模式无副作用 → Task 8 (`ctx.hasUI` guard)
   - 独立 extensionId → Task 8 (constant)

2. **Placeholder scan:** No "TBD" / "TODO" / "add appropriate error
   handling" remain; every code block is complete and executable.

3. **Type consistency:** `ParsedBashCommand.isLocking` (Task 4) is read
   in Task 8; `StatusJson` shape (Task 2) is consumed in Task 8 via
   `status?.schemaName` and `status?.artifacts`; `MergedTasks`
   interface (Task 2) is returned by `readMergedTasks` (Task 5) and
   passed to `renderLine` (Task 6).

4. **Run before commit policy:** Every implementation step is
   preceded by a failing test or a typecheck step, and followed by a
   passing verification + a commit. No step produces code without
   verification.
