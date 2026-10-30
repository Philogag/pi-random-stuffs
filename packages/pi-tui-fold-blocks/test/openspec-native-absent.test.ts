// packages/pi-tui-fold-blocks/test/openspec-native-absent.test.ts
import { describe, it, expect, vi } from "vitest";
import { registerOpenspecRenderer } from "../src/openspec.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { ToolRendererResolver } from "@earendil-works/pi-coding-agent";

describe("registerOpenspecRenderer — resolver 链路", () => {
  it("非 openspec 工具 → 返回 next() 结果(src: 保持链路)", () => {
    let captured: ToolRendererResolver | undefined;
    registerOpenspecRenderer({ registerToolRenderer: (r) => { captured = r; } } as never, () => DEFAULT_CONFIG);
    expect(captured).toBeDefined();

    let nextCalled = false;
    const result = captured!("read", () => { nextCalled = true; return undefined; });
    expect(nextCalled).toBe(true);
    expect(result).toBeUndefined();
  });

  it("openspec 工具 → 返回 { renderShell, renderCall, renderResult }", () => {
    let captured: ToolRendererResolver | undefined;
    registerOpenspecRenderer({ registerToolRenderer: (r) => { captured = r; } } as never, () => DEFAULT_CONFIG);
    const renders = captured!("openspec", () => undefined);
    expect(renders).toBeDefined();
    expect(renders?.renderShell).toBe("self");
    expect(typeof renders?.renderCall).toBe("function");
    expect(typeof renders?.renderResult).toBe("function");
  });

  it("未注册 openspec 工具(模拟无该工具)时对其它工具无副作用", () => {
    // 与上同:resolver 只拦截 "openspec",其余委托。这里再断言不误判拼写接近的工具名。
    let captured: ToolRendererResolver | undefined;
    const cfg = { ...DEFAULT_CONFIG };
    registerOpenspecRenderer({ registerToolRenderer: (r) => { captured = r; } } as never, () => cfg);
    for (const name of ["openspc", "open-spec", "openspecify", "bash"]) {
      const called = vi.fn(() => ({ renderShell: "self" } as never));
      expect(captured!(name, called)).toBeDefined();
      expect(called).toHaveBeenCalledTimes(1);
    }
  });
});