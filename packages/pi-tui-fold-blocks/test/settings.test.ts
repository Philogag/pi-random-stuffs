// test/settings.test.ts
import { describe, expect, it } from "vitest";
import type { FoldBlocksConfig } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { applySettingChange, boolToCfg, buildSettingItems, cfgToBool } from "../src/settings.js";

describe("settings mapping helpers", () => {
  it("boolToCfg / cfgToBool round-trip", () => {
    expect(boolToCfg(true)).toBe("on");
    expect(boolToCfg(false)).toBe("off");
    expect(cfgToBool("on")).toBe(true);
    expect(cfgToBool("off")).toBe(false);
  });

  it("buildSettingItems maps config to SettingItem[]", () => {
    const items = buildSettingItems(DEFAULT_CONFIG);
    const mode = items.find((i) => i.id === "mode")!;
    const nerd = items.find((i) => i.id === "nerdFont")!;
    expect(mode.values).toEqual(["fold", "hide", "native"]);
    expect(mode.currentValue).toBe("fold");
    expect(nerd.values).toEqual(["on", "off"]);
    expect(nerd.currentValue).toBe("on");
  });

  it("applySettingChange updates booleans and enums", () => {
    const cfg: FoldBlocksConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const next = applySettingChange(cfg, "nerdFont", "off");
    expect(next.nerdFont).toBe(false);
    const next2 = applySettingChange(cfg, "mode", "hide");
    expect(next2.mode).toBe("hide");
    const next3 = applySettingChange(cfg, "fileBlocks.pathStyle", "absolute");
    expect(next3.fileBlocks.pathStyle).toBe("absolute");
  });
});
