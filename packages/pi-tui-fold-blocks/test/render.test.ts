import { describe, it, expect } from "vitest";
import { buildFoldLine, buildSingleLine, contentRows, contentExitCode } from "../src/render.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("buildFoldLine", () => {
  it("文件块:左 工具名 文件名 (参数) 右 行数", () => {
    const line = buildFoldLine({
      toolName: "read", kind: "file", path: "src/main.ts", args: { offset: 10, limit: 20 },
      rows: 20, config: DEFAULT_CONFIG, cwd: "/home/u/p",
    });
    expect(line!.left).toContain("read");
    expect(line!.left).toContain("src/main.ts");
    expect(line!.left).toContain("10");
    expect(line!.right).toBe("20");
  });
  it("bash 块:左 exec 摘要 右 输出行数", () => {
    const line = buildFoldLine({
      toolName: "bash", kind: "bash", command: "cd build && npm test", args: null,
      rows: 5, exitCode: 0, config: DEFAULT_CONFIG, cwd: "/home/u/p",
    });
    expect(line!.left).toContain("npm test");
    expect(line!.right).toContain("5");
  });
  it("hide 模式返回 null 渲染", () => {
    expect(buildFoldLine({
      toolName: "read", kind: "file", path: "a.ts", args: null, rows: 0,
      config: { ...DEFAULT_CONFIG, mode: "hide" }, cwd: "/",
    })).toBeNull();
  });
});

describe("buildSingleLine", () => {
  it("左右拼接且含留白", () => {
    expect(buildSingleLine("read a.ts", "20")).toMatch(/^read a\.ts\s+20$/);
  });
  it("超长左概要截断加 ...", () => {
    const line = buildSingleLine("x".repeat(80), "20");
    expect(line).toContain("...");
    expect(line.length).toBeLessThan(90); // 60 (左截断) + 22 (右留白) + 2 (右) = 84
  });
});

describe("contentRows / contentExitCode", () => {
  it("contentRows 聚合 TextContent 行数", () => {
    expect(contentRows({ content: [{ type: "text", text: "a\nb\nc" }] })).toBe(3);
    expect(contentRows({})).toBe(0);
  });
  it("contentExitCode 提取 exit code N", () => {
    expect(contentExitCode({ content: [{ type: "text", text: "boom\nexit code 2" }] })).toBe(2);
    expect(contentExitCode({ content: [{ type: "text", text: "ok" }] })).toBeUndefined();
  });
});