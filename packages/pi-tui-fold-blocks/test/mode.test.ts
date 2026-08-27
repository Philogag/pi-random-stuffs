// packages/pi-tui-fold-blocks/test/mode.test.ts
import { describe, it, expect } from "vitest";
import { createModeState } from "../src/mode.js";

describe("mode state", () => {
  it("默认 fold,setMode 循环 native/fold/hide", () => {
    const s = createModeState("fold", () => {});
    expect(s.mode).toBe("fold");
    s.setMode("hide");
    expect(s.mode).toBe("hide");
    s.setMode("native");
    expect(s.mode).toBe("native");
  });
  it("rerenderAll 触发所有 invalidator", () => {
    let calls = 0;
    const s = createModeState("fold", () => { calls++; });
    s.addInvalidator("t1", () => { calls++; });
    s.rerenderAll();
    expect(calls).toBe(2);
  });
});