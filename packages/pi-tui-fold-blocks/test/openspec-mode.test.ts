// packages/pi-tui-fold-blocks/test/openspec-mode.test.ts
import { describe, it, expect, vi } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import { openspecRenderers, type OpenspecArgs } from "../src/openspec.js";
import { DEFAULT_CONFIG, type FoldBlocksConfig } from "../src/config.js";
import type { ToolRenderContext } from "../src/overrides.js";

const CWD = "/home/u/p";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

// bg 恒等透传(生产 bgFn 返回零宽 ANSI,不改变内容宽度),仅记录用到的背景色名,供"逐行铺底"断言用。
// 不能用 `[...]` 之类可见包裹——那会撑大渲染宽度、超出 buildLineRow 按原文算出的 basis,误触发截断。
function spyTheme() {
  const calls: string[] = [];
  const theme = {
    bg: (c: string, t: string) => { calls.push(`bg:${c}`); return t; },
    fg: (_c: string, t: string) => t,
  } as never;
  return { theme, calls };
}

function makeCtx(args: unknown, partial: { expanded?: boolean; isError?: boolean; isPartial?: boolean } = {}): ToolRenderContext {
  return {
    args,
    toolCallId: "t1",
    invalidate: () => {},
    lastComponent: undefined,
    state: undefined,
    cwd: CWD,
    executionStarted: true,
    argsComplete: true,
    isPartial: partial.isPartial ?? false,
    expanded: partial.expanded ?? false,
    showImages: false,
    isError: partial.isError ?? false,
  };
}

/** fake 原生渲染器:renderCall 单行、renderResult 五行。next() 返回它。 */
function fakeNative() {
  const renderCall = vi.fn(() => new Text("NATIVE-CALL", 0, 0));
  const renderResult = vi.fn(() => new Text("native-body-0\nnative-body-1\nnative-body-2\nnative-body-3\nnative-body-4", 0, 0));
  return { rs: { renderShell: "self", renderCall, renderResult } as never, renderCall, renderResult };
}

const OPENS: OpenspecArgs = { subcommand: "status", args: [], change: "add-user-auth" };
const RESULT = { content: [{ type: "text", text: "x" }] };

function renderers(cfg: FoldBlocksConfig, native?: ReturnType<typeof fakeNative>) {
  const nm = native ?? fakeNative();
  const renders = openspecRenderers(() => nm.rs, () => cfg) as unknown as {
    renderCall: (args: unknown, theme: never, ctx: ToolRenderContext) => { render: (w: number) => string[] };
    renderResult: (result: unknown, opt: { expanded: boolean; isPartial: boolean }, theme: never, ctx: ToolRenderContext) => { render: (w: number) => string[] };
  };
  return { renders, nm };
}

const FOLD = { ...DEFAULT_CONFIG, mode: "fold" as const };

describe("openspecRenderers — 模式路由", () => {
  it("native 模式 → 委托 next() 原生渲染器(双槽)", () => {
    const { renders, nm } = renderers({ ...FOLD, mode: "native" as const });
    const ctx = makeCtx(OPENS);
    renders.renderCall({} as never, spyTheme().theme, ctx);
    renders.renderResult(RESULT, { expanded: false, isPartial: false }, spyTheme().theme, ctx);
    expect(nm.renderCall).toHaveBeenCalledTimes(1);
    expect(nm.renderResult).toHaveBeenCalledTimes(1);
  });

  it("hide 模式 → 输出 0 行,call/result 槽都不调原生", () => {
    const { renders, nm } = renderers({ ...FOLD, mode: "hide" as const });
    const ctx = makeCtx(OPENS, { expanded: true });
    expect(renders.renderCall({} as never, spyTheme().theme, ctx).render(60)).toHaveLength(0);
    expect(renders.renderResult(RESULT, { expanded: true, isPartial: false }, spyTheme().theme, ctx).render(60)).toHaveLength(0);
    expect(nm.renderCall).not.toHaveBeenCalled();
    expect(nm.renderResult).not.toHaveBeenCalled();
  });

  it("fold 折叠态 → 单行 `openspec - status --change add-user-auth` + SUCCESS", () => {
    const { renders } = renderers(FOLD);
    const rows = renders.renderResult(RESULT, { expanded: false, isPartial: false }, spyTheme().theme, makeCtx(OPENS)).render(100).map(stripAnsi);
    const text = rows.join("\n");
    expect(text).toContain("openspec - status --change add-user-auth");
    expect(text).toContain("SUCCESS");
  });

  it("fold + expanded → 展开原生完整输出(无折叠摘要行)且保留状态背景", () => {
    const { renders, nm } = renderers(FOLD);
    const expandedTheme = spyTheme();
    const expandedRows = renders
      .renderResult(RESULT, { expanded: true, isPartial: false }, expandedTheme.theme, makeCtx(OPENS, { expanded: true }))
      .render(60)
      .map(stripAnsi);
    const text = expandedRows.join("\n");
    expect(text).toContain("NATIVE-CALL");
    expect(text).toContain("native-body-0");
    expect(text).toContain("native-body-4");
    // 不再显示折叠摘要行
    expect(text).not.toContain("openspec - status --change add-user-auth");
    // 聚合路径内原生两槽各被调一次
    expect(nm.renderCall).toHaveBeenCalledTimes(1);
    expect(nm.renderResult).toHaveBeenCalledTimes(1);
    // 展开盒逐行铺 toolSuccessBg 背景(记录到的背景色)
    expect(expandedTheme.calls).toContain("bg:toolSuccessBg");
  });

  it("再次收起(fold,expanded:false)→ 恢复单行", () => {
    const { renders } = renderers(FOLD);
    const collapsed = renders.renderResult(RESULT, { expanded: false, isPartial: false }, spyTheme().theme, makeCtx(OPENS)).render(60).map(stripAnsi);
    expect(collapsed.join("\n")).toContain("openspec - status --change add-user-auth");
  });

  it("next() 为 undefined 时折叠分支正常(fold)", () => {
    const renders = openspecRenderers(() => undefined, () => FOLD) as unknown as {
      renderResult: (result: unknown, opt: { expanded: boolean; isPartial: boolean }, theme: never, ctx: ToolRenderContext) => { render: (w: number) => string[] };
    };
    const rows = renders.renderResult(RESULT, { expanded: false, isPartial: false }, spyTheme().theme, makeCtx(OPENS)).render(60).map(stripAnsi);
    expect(rows.join("\n")).toContain("openspec - status --change add-user-auth");
  });

  it("next() 为 undefined 时展开态降级为 0 行(不崩溃)", () => {
    const renders = openspecRenderers(() => undefined, () => FOLD) as unknown as {
      renderResult: (result: unknown, opt: { expanded: boolean; isPartial: boolean }, theme: never, ctx: ToolRenderContext) => { render: (w: number) => string[] };
    };
    expect(() => renders.renderResult(RESULT, { expanded: true, isPartial: false }, spyTheme().theme, makeCtx(OPENS, { expanded: true })).render(60)).not.toThrow();
  });
});