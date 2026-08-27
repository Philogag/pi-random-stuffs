import { describe, it, expect } from "vitest";
import { nextMode } from "../src/settings.js";

describe("nextMode", () => {
  it("循环 fold -> hide -> native -> fold", () => {
    expect(nextMode("fold")).toBe("hide");
    expect(nextMode("hide")).toBe("native");
    expect(nextMode("native")).toBe("fold");
  });
});