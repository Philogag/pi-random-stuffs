import { describe, expect, it } from "vitest";
import { cfgToBool } from "../src/settings.js";

describe("settings bool helpers (replaces removed nextMode)", () => {
  it("maps on/off strings to booleans", () => {
    expect(cfgToBool("on")).toBe(true);
    expect(cfgToBool("off")).toBe(false);
  });
});
