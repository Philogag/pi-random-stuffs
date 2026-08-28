import { describe, it, expect } from "vitest";
import {
  buildReadBlockText,
  buildWriteBlockText,
  buildEditBlockText,
  buildBashBlockText,
  contentExitCode,
  buildBlockComponent,
  type LineContext,
} from "../src/render.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { ToolRenderContext } from "../src/overrides.js";

const CWD = "/home/u/p";

function makeCtx(args: unknown, partial: { isError?: boolean } = {}): ToolRenderContext {
  return {
    args,
    toolCallId: "t1",
    invalidate: () => {},
    lastComponent: undefined,
    state: undefined,
    cwd: CWD,
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: partial.isError ?? false,
  };
}

/** 去掉 ANSI SGR 与 OSC 链接标记(compositeTuiLine 的 SEGMENT_RESET)。 */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

describe("buildReadBlockText", () => {
  it("shown 为折叠路径,tips 为行号范围", () => {
    const t = buildReadBlockText(makeCtx({ path: "src/main.ts", offset: 10, limit: 20 }), {
      name: "read", stage: "result", args: {}, result: undefined, cwd: CWD, config: DEFAULT_CONFIG, theme: undefined as never,
    });
    expect(t.shown).toContain("src/main.ts");
    expect(t.tips).toBe("[ 10 - 29 ]");
    expect(t.result).toBe("OK");
  });
  it("无 limit 时行号范围以 ? 结尾", () => {
    const t = buildReadBlockText(makeCtx({ path: "a.ts", offset: 5 }), {
      name: "read", stage: "result", args: {}, result: undefined, cwd: CWD, config: DEFAULT_CONFIG, theme: undefined as never,
    });
    expect(t.tips).toBe("[ 5 - ? ]");
  });
  it("错误时 result 为 FAILED", () => {
    const t = buildReadBlockText(makeCtx({ path: "a.ts" }, { isError: true }), {
      name: "read", stage: "result", args: {}, result: undefined, cwd: CWD, config: DEFAULT_CONFIG, theme: undefined as never,
    });
    expect(t.result).toBe("FAILED");
  });
  it("调用阶段 result 为空", () => {
    const t = buildReadBlockText(makeCtx({ path: "a.ts" }), {
      name: "read", stage: "call", args: {}, result: undefined, cwd: CWD, config: DEFAULT_CONFIG, theme: undefined as never,
    });
    expect(t.result).toBe("");
  });
});

describe("buildWriteBlockText", () => {
  it("tips 为新增行数", () => {
    const t = buildWriteBlockText(makeCtx({ path: "a.ts", content: "x\ny\nz" }), {
      name: "write", stage: "result", args: {}, result: undefined, cwd: CWD, config: DEFAULT_CONFIG, theme: undefined as never,
    });
    expect(t.shown).toContain("a.ts");
    expect(t.tips).toBe("[ +3 ]");
  });
});

describe("buildEditBlockText", () => {
  it("tips 为删除/新增行数", () => {
    const t = buildEditBlockText(makeCtx({ path: "a.ts", edits: [{ oldText: "a\nb", newText: "x" }] }), {
      name: "edit", stage: "result", args: {}, result: undefined, cwd: CWD, config: DEFAULT_CONFIG, theme: undefined as never,
    });
    expect(t.tips).toBe("[ -2, +1 ]");
  });
});

describe("buildBashBlockText", () => {
  it("shown 为智能摘要,tips 为超时", () => {
    const t = buildBashBlockText(makeCtx({ command: "cd build && npm test", timeout: 30 }), {
      name: "bash", stage: "result", args: {}, result: undefined, cwd: CWD, config: DEFAULT_CONFIG, theme: undefined as never,
    });
    expect(t.shown).toContain("npm test");
    expect(t.tips).toBe("[ 30s ]");
  });
  it("错误时 result 含退出码", () => {
    const t = buildBashBlockText(makeCtx({ command: "ls" }, { isError: true }), {
      name: "bash", stage: "result", args: {}, result: { content: [{ type: "text", text: "boom\nexit code 2" }] }, cwd: CWD, config: DEFAULT_CONFIG, theme: undefined as never,
    });
    expect(t.result).toBe("FAILED(2)");
  });
});

describe("contentExitCode", () => {
  it("提取 exit code N", () => {
    expect(contentExitCode({ content: [{ type: "text", text: "boom\nexit code 2" }] })).toBe(2);
    expect(contentExitCode({ content: [{ type: "text", text: "ok" }] })).toBeUndefined();
  });
});

describe("buildBlockComponent", () => {
  const bg = (t: string) => t; // 恒等 bgFn,无 ANSI
  const text: LineContext = { icon: "", tool: "read", shown: "src/main.ts", tips: "[ 10 - 29 ]", result: "OK" };

  it("tips 完整显示,不被截断(窄宽度下仅 left 截断)", () => {
    const lines = buildBlockComponent(text, bg).render(24);
    const content = lines.map(stripAnsi).join("\n");
    expect(content).toContain("[ 10 - 29 ]");
    expect(content).toContain("OK");
  });

  it("left 与 right 之间保留至少 1 字符 padding", () => {
    const noTips: LineContext = { icon: "", tool: "read", shown: "a.ts", tips: "", result: "OK" };
    const lines = buildBlockComponent(noTips, bg).render(30);
    const content = lines.map(stripAnsi).join("\n");
    // shown 后至少 1 空格,再是 OK(而非紧贴)
    expect(content).toMatch(/a\.ts\s+OK/);
  });

  it("宽宽度下 shown 完整 + tips + 右对齐 OK", () => {
    const lines = buildBlockComponent(text, bg).render(60);
    const content = lines.map(stripAnsi).join("\n");
    expect(content).toContain("src/main.ts");
    expect(content).toContain("[ 10 - 29 ]");
    expect(content).toContain("OK");
  });
});
