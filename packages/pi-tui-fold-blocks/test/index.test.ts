import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.js";

type Handler = (event: unknown, ctx: { mode: string }) => unknown;

function makeMockPi() {
  const handlers = new Map<string, Handler>();
  const pi = {
    on: vi.fn((name: string, handler: Handler) => {
      handlers.set(name, handler);
      return pi;
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
  };
  return { pi: pi as unknown as ExtensionAPI, handlers };
}

function fireSessionStart(handlers: Map<string, Handler>, mode: string) {
  const handler = handlers.get("session_start");
  expect(handler).toBeDefined();
  handler?.({ reason: "startup" }, { mode });
}

describe("index 注册入口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("session_start 在非 TUI 模式(print/json/rpc)下不注册渲染钩子与命令", () => {
    const { pi, handlers } = makeMockPi();
    extension(pi);

    for (const mode of ["print", "json", "rpc"]) {
      fireSessionStart(handlers, mode);
      expect(pi.registerTool).not.toHaveBeenCalled();
      expect(pi.registerCommand).not.toHaveBeenCalled();
    }
  });

  it("session_start 在 TUI 模式下注册渲染钩子(read/bash/edit/write)与命令", () => {
    const { pi, handlers } = makeMockPi();
    extension(pi);

    fireSessionStart(handlers, "tui");

    const toolNames = (pi.registerTool as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0].name,
    );
    expect(toolNames).toEqual(
      expect.arrayContaining(["read", "bash", "edit", "write"]),
    );

    const cmdNames = (pi.registerCommand as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(cmdNames).toContain("tui-fold-blocks");
  });

  it("重复触发 session_start 不重复注册(TUI 模式幂等)", () => {
    const { pi, handlers } = makeMockPi();
    extension(pi);

    fireSessionStart(handlers, "tui");
    fireSessionStart(handlers, "tui");

    const toolCalls = (pi.registerTool as unknown as ReturnType<typeof vi.fn>).mock.calls;
    // 4 个工具 × 1 次
    expect(toolCalls).toHaveLength(4);
  });
});
