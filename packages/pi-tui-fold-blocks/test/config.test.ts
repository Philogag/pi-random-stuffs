import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, loadConfig, setMode } from "../src/config.js";

describe("config", () => {
  it("DEFAULT_CONFIG 默认 fold、nerdFont 开、pathStyle relative、smart 开", () => {
    expect(DEFAULT_CONFIG.mode).toBe("fold");
    expect(DEFAULT_CONFIG.nerdFont).toBe(true);
    expect(DEFAULT_CONFIG.fileBlocks.pathStyle).toBe("relative");
    expect(DEFAULT_CONFIG.fileBlocks.foldGitWorktree).toBe(true);
    expect(DEFAULT_CONFIG.bashBlocks.smart).toBe(true);
  });

  it("settings 缺失/损坏时回退默认值且不抛错", () => {
    const cfg = loadConfig("/nonexistent/settings.json");
    expect(cfg.mode).toBe("fold");
    expect(cfg.nerdFont).toBe(true);
  });

  it("setMode 返回新对象并写入 mode", () => {
    const next = setMode(DEFAULT_CONFIG, "hide");
    expect(next.mode).toBe("hide");
    expect(DEFAULT_CONFIG.mode).toBe("fold"); // 原对象不可变
  });
});