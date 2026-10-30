// packages/pi-tui-fold-blocks/test/openspec-render.test.ts
import { describe, it, expect } from "vitest";
import { openspecShown, openspecStatusText, buildOpenspecBlockText } from "../src/openspec.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { ToolRenderContext } from "../src/overrides.js";

const FOLD = { ...DEFAULT_CONFIG, mode: "fold" as const };

function makeCtx(args: unknown, partial: { isError?: boolean; stage?: "call" | "result" } = {}): ToolRenderContext {
  return {
    args,
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
    isError: partial.isError ?? false,
  };
}

function opts(stage: "call" | "result", result?: unknown) {
  return {
    name: "openspec" as const,
    stage,
    args: undefined,
    result,
    cwd: "/home/u/p",
    config: FOLD,
    theme: { bg: (_c: string, t: string) => t, fg: (_c: string, t: string) => t } as never,
  };
}

describe("openspecShown — 折叠行左侧内容", () => {
  it("status + change → `status --change add-user-auth`", () => {
    expect(openspecShown({ subcommand: "status", args: [], change: "add-user-auth" })).toBe("status --change add-user-auth");
  });

  it("new change + args + 无 change → `new change add-dark-mode` 且不含 --change", () => {
    expect(openspecShown({ subcommand: "new change", args: ["add-dark-mode"], change: undefined })).toBe("new change add-dark-mode");
  });

  it("多个 args 顺序保留、用空格隔开", () => {
    expect(openspecShown({ subcommand: "spec show", args: ["a", "--req"], change: undefined })).toBe("spec show a --req");
  });

  it("缺失字段不崩溃(undefined subcommand/args/change)", () => {
    expect(openspecShown({})).toBe("");
    expect(openspecShown({ subcommand: "status" })).toBe("status");
  });
});

describe("openspecStatusText — 右侧状态", () => {
  const ok = { content: [{ type: "text", text: "ok" }] };
  const failed = { content: [{ type: "text", text: "boom\n[exit code 3]" }] };

  it("退出码 0 → SUCCESS", () => {
    expect(openspecStatusText({ content: [{ type: "text", text: "[exit code 0]" }] }, false)).toBe("SUCCESS");
    expect(openspecStatusText(ok, false)).toBe("SUCCESS");
  });

  it("非零退出码文本 → FAILED(N)", () => {
    expect(openspecStatusText(failed, true)).toBe("FAILED(3)");
  });

  it("无 exit code 文本时按 isError 判定", () => {
    expect(openspecStatusText(ok, false)).toBe("SUCCESS");
    expect(openspecStatusText({ content: [] }, true)).toBe("FAILED");
  });
});

describe("buildOpenspecBlockText — lineBuilder 集成", () => {
  it("左侧为 openspec - <shown>，右侧 call 阶段为空", () => {
    const text = buildOpenspecBlockText(makeCtx({ subcommand: "status", args: [], change: "add-x" }), opts("call"));
    expect(text.tool).toBe("openspec");
    expect(text.shown).toBe("status --change add-x");
    expect(text.result).toBe("");
  });

  it("result 阶段成功 → SUCCESS，失败 → FAILED", () => {
    const success = buildOpenspecBlockText(makeCtx({ subcommand: "validate" }), opts("result", { content: [{ type: "text", text: "[exit code 0]" }] }));
    expect(success.result).toBe("SUCCESS");
    const failed = buildOpenspecBlockText(makeCtx({ subcommand: "validate" }, { isError: true }), opts("result", { content: [{ type: "text", text: "nope\n[exit code 1]" }] }));
    expect(failed.result).toBe("FAILED(1)");
  });
});