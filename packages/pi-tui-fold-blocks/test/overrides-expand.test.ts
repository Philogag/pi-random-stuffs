// packages/pi-tui-fold-blocks/test/overrides-expand.test.ts
import { describe, it, expect, vi } from "vitest";
import { Box, Container, Text } from "@earendil-works/pi-tui";
import { overrideTool, type ToolRenderContext } from "../src/overrides.js";
import { DEFAULT_CONFIG, type FoldBlocksConfig } from "../src/config.js";

const CWD = "/home/u/p";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

/** bg 留下可观测标记 + 记录调用色名;fg 直通。 */
function spyTheme() {
  const calls: string[] = [];
  const theme = {
    bg: (_c: string, t: string) => { calls.push(`bg:${_c}`); return `[${t}]`; },
    fg: (_c: string, t: string) => t,
  } as never;
  return { theme, calls };
}

function makeCtx(args: unknown, partial: { expanded?: boolean; isError?: boolean } = {}): ToolRenderContext {
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
    expanded: partial.expanded ?? false,
    showImages: false,
    isError: partial.isError ?? false,
  };
}

/** 带 spy 的"原生"工具定义:renderCall 单行,renderResult 五行。 */
function fakeOriginal(payloadLines = 5) {
  const renderCall = vi.fn(() => new Text("NATIVE-CALL", 0, 0));
  const renderResult = vi.fn(() => {
    const lines = Array.from({ length: payloadLines }, (_, i) => `native-body-${i}`);
    return new Text(lines.join("\n"), 0, 0);
  });
  return { def: { renderCall, renderResult, execute: vi.fn() } as never, renderCall, renderResult };
}

function register(config: FoldBlocksConfig, original: unknown, theme?: unknown) {
  let registered: any;
  const pi = { registerTool: (d: unknown) => { registered = d; } } as never;
  overrideTool(pi, "read", CWD, (() => original) as never, () => config);
  return registered as { renderCall: (...a: any[]) => any; renderResult: (...a: any[]) => any };
}

const FOLD = { ...DEFAULT_CONFIG, mode: "fold" as const };
const RESULT = { content: [{ type: "text", text: "x" }] };

describe("overrideTool — fold 模式展开态聚合原生为单盒", () => {
  it("展开态:call 槽退让 0 行,result 槽把原生 call 头 + result 体聚合成单盒", () => {
    const { def, renderCall, renderResult } = fakeOriginal();
    const t = register(FOLD, def);
    const ctx = makeCtx({ path: "a.ts" }, { expanded: true });

    const callComp = t.renderCall({ path: "a.ts" }, spyTheme().theme, ctx);
    expect(callComp.render(60)).toHaveLength(0);
    // call 槽不触发原生的 renderCall(避免两套头)
    expect(renderCall).not.toHaveBeenCalled();

    const resComp = t.renderResult(RESULT, { expanded: true, isPartial: false }, spyTheme().theme, ctx);
    // result 槽内部各调用一次原生 renderCall + renderResult
    expect(renderCall).toHaveBeenCalledTimes(1);
    expect(renderResult).toHaveBeenCalledTimes(1);
    const [, options] = renderResult.mock.calls[0] as any[];
    expect(options).toMatchObject({ expanded: true, isPartial: false });

    const flat = resComp.render(60).map(stripAnsi).join("\n");
    expect(flat).toContain("NATIVE-CALL");
    expect(flat).toContain("native-body-0");
    expect(flat).toContain("native-body-4");
  });

  it("展开态整盒与折叠态同用 toolSuccessBg 背景(逐行铺底)", () => {
    const { def } = fakeOriginal();
    const t = register(FOLD, def);
    const collapsedTheme = spyTheme();
    const expandedTheme = spyTheme();

    // bg 调用在 .render() 时才发生,先渲染再断言
    const collapsedRows = t
      .renderResult(RESULT, { expanded: false, isPartial: false }, collapsedTheme.theme, makeCtx({ path: "a.ts" }))
      .render(60)
      .map(stripAnsi);
    const expandedRows = t
      .renderResult(RESULT, { expanded: true, isPartial: false }, expandedTheme.theme, makeCtx({ path: "a.ts" }, { expanded: true }))
      .render(60)
      .map(stripAnsi);

    // 折叠态调用过 toolSuccessBg
    expect(collapsedTheme.calls).toContain("bg:toolSuccessBg");
    // 展开态同样以 toolSuccessBg 铺底
    expect(expandedTheme.calls).toContain("bg:toolSuccessBg");
    // 展开盒每一行都带背景标记:spyTheme 的 bg 返回 `[...]`,故每行 trim 后以 `[` 开头
    expect(expandedRows.length).toBeGreaterThan(collapsedRows.length);
    for (const row of expandedRows) expect(row.trim().startsWith("[")).toBe(true);

  });

  it("折叠态(fold,expanded:false)→ 原生渲染器不被调用", () => {
    const { def, renderCall, renderResult } = fakeOriginal();
    const t = register(FOLD, def);
    const ctx = makeCtx({ path: "a.ts" });
    t.renderCall({ path: "a.ts" }, spyTheme().theme, ctx);
    t.renderResult(RESULT, { expanded: false, isPartial: false }, spyTheme().theme, ctx);
    expect(renderCall).not.toHaveBeenCalled();
    expect(renderResult).not.toHaveBeenCalled();
  });

  it("hide + expanded → 原生渲染器不被调用,输出 0 行", () => {
    const { def, renderResult } = fakeOriginal();
    const t = register({ ...FOLD, mode: "hide" as const }, def);
    const ctx = makeCtx({ path: "a.ts" }, { expanded: true });
    expect(t.renderCall({ path: "a.ts" }, spyTheme().theme, ctx).render(60)).toHaveLength(0);
    expect(t.renderResult(RESULT, { expanded: true, isPartial: false }, spyTheme().theme, ctx).render(60)).toHaveLength(0);
    expect(renderResult).not.toHaveBeenCalled();
  });

  it("native 模式 → 直接委托原生渲染器(保留双槽原样)", () => {
    const { def, renderResult } = fakeOriginal();
    const t = register({ ...FOLD, mode: "native" as const }, def);
    const ctx = makeCtx({ path: "a.ts" });
    t.renderResult(RESULT, { expanded: false, isPartial: false }, spyTheme().theme, ctx);
    expect(renderResult).toHaveBeenCalledTimes(1);
  });

  it("展开态行数 > 折叠态行数(read)", () => {
    const { def } = fakeOriginal();
    const t = register(FOLD, def);
    const collapsedCtx = makeCtx({ path: "a.ts" });
    const expandedCtx = makeCtx({ path: "a.ts" }, { expanded: true });

    const collapsed = [
      ...t.renderCall({ path: "a.ts" }, spyTheme().theme, collapsedCtx).render(60),
      ...t.renderResult(RESULT, { expanded: false, isPartial: false }, spyTheme().theme, collapsedCtx).render(60),
    ];
    const expanded = [
      ...t.renderCall({ path: "a.ts" }, spyTheme().theme, expandedCtx).render(60),
      ...t.renderResult(RESULT, { expanded: true, isPartial: false }, spyTheme().theme, expandedCtx).render(60),
    ];
    expect(expanded.length).toBeGreaterThan(collapsed.length);
  });

  it("委托时不复用 lastComponent(避免被折叠态 mutate 过的实例)", () => {
    const { def, renderCall, renderResult } = fakeOriginal();
    const t = register(FOLD, def);
    const dirty = new Text("DIRTY", 0, 0);
    const ctx = makeCtx({ path: "a.ts" }, { expanded: true });
    t.renderResult(RESULT, { expanded: true, isPartial: false }, spyTheme().theme, { ...ctx, lastComponent: dirty });
    // 聚合路径内对原生 renderCall/renderResult 的两次调用都不应透传 lastComponent
    for (const args of [...renderCall.mock.calls, ...renderResult.mock.calls]) {
      expect((args as any[])[2].lastComponent).toBeUndefined();
    }
  });

  // 回归 edit 顶部空两行:edit 的原生 renderCall 返回 Box(1,1)(自带 padding),其余工具返回单行 Text。
  // renderExpandedFold 必须把 Box 解壳为子组件,让唯一留白来自外层 buildBoxedBlock(padY=1),
  // 这样 CALL 行紧贴单行留白上方,不会被 Box 的 padding 再推出一层空行。
  it("展开态:Box 型 call 头被解壳 → 顶部只有一行留白(回归 edit 空两行)", () => {
    const boxCall = vi.fn(() => {
      const b = new Box(2, 2); b.addChild(new Text("CALL", 0, 0)); return b;
    });
    const boxResult = vi.fn(() => new Text("BODY", 0, 0));
    const original = { renderCall: boxCall, renderResult: boxResult, execute: vi.fn() } as never;
    const t = register(FOLD, original);
    const ctx = makeCtx({ path: "a.ts" }, { expanded: true });
    // 用透传主题:bg 恒等返回,留白行 pad 后就是空串,便于精确定位 CALL 行的纵向位置
    const identityTheme = { bg: (_c: string, x: string) => x, fg: (_c: string, x: string) => x } as never;
    const rows = t.renderResult(RESULT, { expanded: true, isPartial: false }, identityTheme, ctx)
      .render(60).map(stripAnsi);
    const callIdx = rows.findIndex((r) => r.includes("CALL"));
    // 顶部恰好一行留白(buildBoxedBlock padY=1);若 Box 的 padding 未解壳,CALL 会被推到第 3 行
    expect(callIdx).toBe(1);
    expect(rows[0].trim()).toBe("");           // 唯一留白行(空串)
    expect(rows.join("\n")).toContain("BODY");// 结果体仍在
  });

  // 回归 TUI bug:edit 块首次点击展开只显示 call 头,折叠后二次展开才完整。
  // 根因:edit 的原生 renderResult 会把 diff(经 setEditPreview+buildEditCallComponent)
  // 写回 renderCall 已返回的同一个 call Box(state.callComponent),而其自身返回一个空
  // Container。renderExpandedFold 若在调用 renderResult **之前**就当次解壳 call,则首次
  // 展开只取到 header;renderResult 对 call 盒的补写不被捕获 → 头-only。二次展开时
  // state.callComponent 已带 preview,renderCall 直接返回完整盒,才恢复正常。
  // 修复:先调用 renderResult,再解壳 call(把原生对 call 盒的补写纳入同一盒)。
  it("回归 edit:原生 renderResult 补写 call 盒后,展开盒仍含 call 头 + 结果体(首次展开完整)", () => {
    const shared = new Box(1, 1);
    const mutationCall = vi.fn(() => {
      shared.clear();
      shared.addChild(new Text("CALL-HEAD", 0, 0));
      return shared;
    });
    const mutationResult = vi.fn(() => {
      // 模拟 edit 原生 renderResult:把结果体写回同一 call 盒,自身返回空体
      shared.addChild(new Text("RESULT-BODY", 0, 0));
      return new Container();
    });
    const original = { renderCall: mutationCall, renderResult: mutationResult, execute: vi.fn() } as never;
    const t = register(FOLD, original);
    const ctx = makeCtx({ path: "a.ts" }, { expanded: true });
    const flat = t
      .renderResult(RESULT, { expanded: true, isPartial: false }, spyTheme().theme, ctx)
      .render(60)
      .map(stripAnsi)
      .join("\n");
    expect(flat).toContain("CALL-HEAD");
    expect(flat).toContain("RESULT-BODY");
  });
});