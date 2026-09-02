import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, {
  isFoldBlocksActive,
  subscribeFoldBlocksActive,
  getFoldConfig,
  subscribeFoldConfig,
  renderOwnedBlock,
  buildBlockComponent,
  contentLineCount,
  contentExitCode,
  foldCommand,
  type FoldCommandOpts,
  type LineContext,
  type FoldBlocksConfig,
  type ToolRenderContext,
} from "../src/index.js";

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

describe("index 命名导出面(库面)", () => {
  it("导入默认导出即暴露库面命名导出且为函数/类型", () => {
    expect(typeof extension).toBe("function");
    expect(typeof isFoldBlocksActive).toBe("function");
    expect(typeof subscribeFoldBlocksActive).toBe("function");
    expect(typeof getFoldConfig).toBe("function");
    expect(typeof subscribeFoldConfig).toBe("function");
    expect(typeof renderOwnedBlock).toBe("function");
    expect(typeof buildBlockComponent).toBe("function");
    expect(typeof contentLineCount).toBe("function");
    expect(typeof contentExitCode).toBe("function");
    expect(typeof foldCommand).toBe("function");
    // 类型层面校验存在性(编译期);运行时无法断言类型。
    const _t1: FoldCommandOpts = { smart: true };
    const _t2: LineContext = { tool: "x", shown: "y" };
    const _t3: FoldBlocksConfig = getFoldConfig();
    void _t1; void _t2; void _t3;
    void (null as unknown as ToolRenderContext);
  });

  it("默认导出工厂执行 → markFoldBlocksActive 生效(isFoldBlocksActive true,激活后订阅同步回调)", () => {
    const { pi } = makeMockPi();
    extension(pi);
    expect(isFoldBlocksActive()).toBe(true);

    // 已激活后再订阅 → 立即同步回调;unsub 后不再收到(再跑工厂幂等,不重复回调)。
    let calls = 0;
    const unsub = subscribeFoldBlocksActive(() => {
      calls++;
    });
    expect(calls).toBe(1);
    unsub();
    extension(pi);
    extension(pi);
    expect(calls).toBe(1);
    expect(isFoldBlocksActive()).toBe(true);
  });
});
