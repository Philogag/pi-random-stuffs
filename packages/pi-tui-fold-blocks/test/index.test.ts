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

  it("渲染钩子在顶层无条件注册(read/bash/edit/write)", () => {
    const { pi, handlers } = makeMockPi();
    extension(pi);

    // registerTool 在工厂期即注册(不依赖 session_start),保证工具执行前钩子已就位
    const toolNames = (pi.registerTool as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0].name,
    );
    expect(toolNames).toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));
    expect(handlers.get("session_start")).toBeDefined();
  });

  it("session_start 在非 TUI 模式(print/json/rpc)下不注册命令", () => {
    const { pi, handlers } = makeMockPi();
    extension(pi);

    for (const mode of ["print", "json", "rpc"]) {
      fireSessionStart(handlers, mode);
      expect(pi.registerCommand).not.toHaveBeenCalled();
    }
  });

  it("session_start 在 TUI 模式下注册命令 tui-fold-blocks", () => {
    const { pi, handlers } = makeMockPi();
    extension(pi);

    fireSessionStart(handlers, "tui");

    const cmdNames = (pi.registerCommand as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(cmdNames).toContain("tui-fold-blocks");
  });

  it("重复触发 session_start 不重复注册命令(TUI 模式幂等)", () => {
    const { pi, handlers } = makeMockPi();
    extension(pi);

    fireSessionStart(handlers, "tui");
    fireSessionStart(handlers, "tui");

    const cmdCalls = (pi.registerCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(cmdCalls).toHaveLength(1);
  });
});
