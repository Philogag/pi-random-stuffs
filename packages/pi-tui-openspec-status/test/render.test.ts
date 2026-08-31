// test/render.test.ts
import { describe, expect, it } from "vitest";
import type { ArtifactStatus } from "../src/types.js";
import { formatArtifactTokens, formatProgressBar, renderLine } from "../src/render.js";

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