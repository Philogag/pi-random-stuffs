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
