// src/merge.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  mergeArtifactStatuses,
  mergeStatusResults,
  mergeTasks,
  parseTasksFile,
  readMergedTasks,
} from "./merge.js";
import type { ArtifactStatus, StatusJson } from "./types.js";

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

describe("mergeArtifactStatuses", () => {
  const P: ArtifactStatus = { id: "proposal", status: "done" };
  const D: ArtifactStatus = { id: "design", status: "done" };
  const S: ArtifactStatus = { id: "specs", status: "ready" };
  const T: ArtifactStatus = { id: "tasks", status: "ready" };

  it("unions two lists, done wins over ready", () => {
    const main: ArtifactStatus[] = [
      { id: "proposal", status: "done" },
      { id: "design", status: "ready" },
    ];
    const wt: ArtifactStatus[] = [
      { id: "design", status: "done" },
      { id: "specs", status: "ready" },
    ];
    const merged = mergeArtifactStatuses([main, wt]);
    expect(merged).toEqual([P, D, S]);
  });

  it("emits canonical order even if input order differs", () => {
    const reversed: ArtifactStatus[] = [
      { id: "tasks", status: "ready" },
      { id: "specs", status: "ready" },
      { id: "design", status: "done" },
      { id: "proposal", status: "done" },
    ];
    expect(mergeArtifactStatuses([reversed])).toEqual([P, D, S, T]);
  });

  it("returns empty when both lists empty", () => {
    expect(mergeArtifactStatuses([[], []])).toEqual([]);
  });

  it("skips null/undefined sources", () => {
    const main: ArtifactStatus[] = [{ id: "proposal", status: "done" }];
    expect(mergeArtifactStatuses([main, null, undefined])).toEqual([P]);
  });

  it("handles non-canonical artifact ids by appending", () => {
    const main: ArtifactStatus[] = [
      { id: "proposal", status: "done" },
      // @ts-expect-error - exercising forward-compat
      { id: "experiments", status: "ready" },
    ];
    const merged = mergeArtifactStatuses([main]);
    expect(merged[0]).toEqual(P);
    expect(merged[1]).toEqual({
      id: "experiments",
      status: "ready",
    });
  });
});

describe("mergeStatusResults", () => {
  it("returns null when all inputs are null", () => {
    expect(mergeStatusResults([null, null])).toBeNull();
  });

  it("preserves schemaName from the first valid source", () => {
    const a: StatusJson = { schemaName: "spec-driven", artifacts: [] };
    const b: StatusJson = { schemaName: "superpowers-bridge-cn", artifacts: [] };
    expect(mergeStatusResults([a, b])?.schemaName).toBe("spec-driven");
  });

  it("applied=true if any source says applied", () => {
    const a: StatusJson = { applied: false, artifacts: [] };
    const b: StatusJson = { applied: true, artifacts: [] };
    expect(mergeStatusResults([a, b])?.applied).toBe(true);
  });

  it("merges artifacts across sources", () => {
    const a: StatusJson = {
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "design", status: "ready" },
      ],
    };
    const b: StatusJson = {
      artifacts: [{ id: "design", status: "done" }],
    };
    const merged = mergeStatusResults([a, b]);
    expect(merged?.artifacts).toEqual([
      { id: "proposal", status: "done" },
      { id: "design", status: "done" },
    ]);
  });
});

describe("readMergedTasks — multi-source strategy", () => {
  let tmpRoot: string;
  let mainRoot: string;
  let wtRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-merge-"));
    mainRoot = path.join(tmpRoot, "main");
    wtRoot = path.join(tmpRoot, "wt");
    mkdirSync(mainRoot, { recursive: true });
    mkdirSync(wtRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeTasks(root: string, change: string, body: string) {
    const dir = path.join(root, "openspec", "changes", change);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "tasks.md"), body, "utf8");
  }

  it("falls back to worktree when main tasks.md is missing (regression: fail-fast bug)", async () => {
    // Main has NO tasks.md for "demo"; worktree has the only tasks.md.
    writeTasks(wtRoot, "demo", "- [x] 1.1 only-wt\n");

    const r = await readMergedTasks("demo", mainRoot, wtRoot);
    expect(r).toEqual({ done: 1, total: 1 });
  });

  it("merges tasks from both sources, OR-ing done", async () => {
    writeTasks(mainRoot, "demo", "- [x] 1.1\n- [ ] 1.2\n");
    writeTasks(wtRoot, "demo", "- [x] 1.2\n- [ ] 1.3\n");

    const r = await readMergedTasks("demo", mainRoot, wtRoot);
    expect(r).toEqual({ done: 2, total: 3 }); // 1.1 main, 1.2 wt
  });

  it("returns 0/0 when neither source has tasks.md", async () => {
    const r = await readMergedTasks("demo", mainRoot, wtRoot);
    expect(r).toEqual({ done: 0, total: 0 });
  });

  it("returns main only when worktreeCwd is omitted", async () => {
    writeTasks(mainRoot, "demo", "- [x] 1.1\n");
    writeTasks(wtRoot, "demo", "- [x] 1.2\n");

    const r = await readMergedTasks("demo", mainRoot);
    expect(r).toEqual({ done: 1, total: 1 });
  });
});
