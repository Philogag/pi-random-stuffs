import { describe, it, expect } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  buildReadBlockText,
  buildBashBlockText,
  contentExitCode,
  renderBlock,
  type RenderBlockOpts,
} from "../src/render.js";
import type { ToolRenderContext } from "../src/overrides.js";
import { DEFAULT_CONFIG } from "../src/config.js";

// 最小 fixture:这些用例不真正渲染,theme 用恒等函数占位即可。
function makeCtx(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
  return {
    args: {},
    toolCallId: "t1",
    invalidate: () => {},
    lastComponent: undefined,
    state: undefined,
    cwd: "/home/u/p",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
    ...overrides,
  };
}

function makeOpts(overrides: Partial<RenderBlockOpts> = {}): RenderBlockOpts {
  return {
    name: "read",
    stage: "call",
    args: {},
    cwd: "/home/u/p",
    config: DEFAULT_CONFIG,
    theme: { bg: () => (t: string) => t } as unknown as Theme,
    ...overrides,
  };
}

describe("contentExitCode", () => {
  it("从 content 文本提取 exit code N", () => {
    expect(contentExitCode({ content: [{ type: "text", text: "boom\nexit code 2" }] })).toBe(2);
  });
  it("无 exit code 返回 undefined", () => {
    expect(contentExitCode({ content: [{ type: "text", text: "ok" }] })).toBeUndefined();
  });
  it("空结果返回 undefined", () => {
    expect(contentExitCode({})).toBeUndefined();
  });
});

describe("buildReadBlockText", () => {
  it("tool 为 read,shown 含折叠路径,tips 为行号区间", () => {
    const line = buildReadBlockText(
      makeCtx({ args: { path: "src/main.ts", offset: 10, limit: 20 } }),
      makeOpts(),
    );
    expect(line.tool).toBe("read");
    expect(line.shown).toContain("src/main.ts");
    expect(line.tips).toBe("[ 10 - 29 ]");
  });
  it("call 阶段 result 为空字符串", () => {
    const line = buildReadBlockText(makeCtx({ args: { path: "a.ts" } }), makeOpts());
    expect(line.result).toBe("");
  });
  it("result 阶段成功返回 OK", () => {
    const line = buildReadBlockText(
      makeCtx({ args: { path: "a.ts" } }),
      makeOpts({ stage: "result" }),
    );
    expect(line.result).toBe("OK");
  });
  it("isError 时返回 FAILED", () => {
    const line = buildReadBlockText(
      makeCtx({ args: { path: "a.ts" }, isError: true }),
      makeOpts({ stage: "result" }),
    );
    expect(line.result).toBe("FAILED");
  });
});

describe("buildBashBlockText", () => {
  it("tool 为 exec,shown 含命令摘要(smart 折叠 cd 前缀)", () => {
    const line = buildBashBlockText(
      makeCtx({ args: { command: "cd build && npm test" } }),
      makeOpts({ name: "bash" }),
    );
    expect(line.tool).toBe("exec");
    expect(line.shown).toContain("npm test");
  });
  it("result 阶段成功返回 OK", () => {
    const line = buildBashBlockText(
      makeCtx({ args: { command: "npm test" } }),
      makeOpts({ name: "bash", stage: "result" }),
    );
    expect(line.result).toBe("OK");
  });
  it("isError 时返回 FAILED(退出码)", () => {
    const line = buildBashBlockText(
      makeCtx({ args: { command: "npm test" }, isError: true }),
      makeOpts({
        name: "bash",
        stage: "result",
        result: { content: [{ type: "text", text: "exit code 2" }] },
      }),
    );
    expect(line.result).toBe("FAILED(2)");
  });
});

describe("renderBlock", () => {
  it("hide 模式渲染 0 行", () => {
    const component = renderBlock(
      makeCtx({ args: { path: "a.ts" } }),
      makeOpts({ stage: "result", config: { ...DEFAULT_CONFIG, mode: "hide" } }),
    );
    expect(component.render(80)).toEqual([]);
  });
});
