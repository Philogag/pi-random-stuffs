// packages/pi-tui-fold-blocks/test/openspec-expand.test.ts
//
// 回归 TUI bug:openspec 块点击展开后变成一条空行。
// 根因:pi-openspec-bridge 只 `pi.registerTool`,不提供 renderCall/renderResult,
// 于是 next() 走到链路末尾拿回的是"没有渲染器"的工具定义 → 委托 renderExpandedFold
// 只能得到空组件。修复:检测不到原生渲染器时自绘单盒(折叠摘要头 + 结果全量文本)。
import { describe, it, expect, vi } from "vitest";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { openspecRenderers } from "../src/openspec.js";
import { DEFAULT_CONFIG, type FoldBlocksConfig } from "../src/config.js";
import type { ToolRenderContext } from "../src/overrides.js";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";

const CWD = "/home/u/p";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

function makeCtx(expanded = false, isError = false): ToolRenderContext {
  return {
    args: { subcommand: "validate", args: ["--all"], change: "add-x" },
    toolCallId: "t1",
    invalidate: () => {},
    lastComponent: undefined,
    state: undefined,
    cwd: CWD,
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded,
    showImages: false,
    isError,
  };
}

/** bg 记录调用色名后透传(不用可见标记:标记会改变可见宽度、影响 HStack 截断),fg 直通。 */
function spyTheme() {
  const calls: string[] = [];
  const theme = {
    bg: (c: string, t: string) => { calls.push(c); return t; },
    fg: (_c: string, t: string) => t,
    bold: (t: string) => `**${t}**`,
  } as never;
  return { theme, calls };
}

function result(text: string) {
  return { content: [{ type: "text", text }], isError: false };
}

/** openspec-bridge 的常态:注册了工具,但没有 renderCall/renderResult。 */
function bareNext() {
  return () => ({ execute: vi.fn() } as unknown as ToolRenderers);
}

/**
 * 便于模拟"第三方给 openspec 提供原生渲染器"的场景。
 */
function nativeNext() {
  const def = {
    execute: vi.fn(),
    renderCall: vi.fn(() => new Text("NATIVE-CALL", 0, 0)),
    renderResult: vi.fn(() => new Text("native-body", 0, 0)),
  };
  return { next: () => def as unknown as ToolRenderers, def };
}

function fold(overrides: Partial<FoldBlocksConfig> = {}): FoldBlocksConfig {
  return { ...DEFAULT_CONFIG, mode: "fold" as const, ...overrides };
}

describe("openspec 展开态(无原生渲染器)", () => {
  it("fold + expanded:result 槽不再是空行,产出原生观感标题 + 全量输出", () => {
    const r = openspecRenderers(bareNext(), () => fold());
    const { theme } = spyTheme();
    const rows = r
      .renderResult!(result("REQ-1 ok\nREQ-2 ok\nSUMMARY: 2 passed"), { expanded: true, isPartial: false }, theme, makeCtx(true))
      .render(80)
      .map(stripAnsi);

    expect(rows.length).toBeGreaterThan(1);
    const flat = rows.join("\n");
    // pi 原生 fallback 标题:工具名 + 逐行 `  key: value`(不是折叠摘要行)
    expect(flat).toContain("**openspec**");
    // 展开态参数:字符串原样不加引号(native 行为),非字符串走 JSON.stringify(缩进 2)
    expect(flat).toContain("  subcommand: validate");
    expect(flat).toContain("  change: add-x");
    expect(flat).toContain("  args: [");
    expect(flat).toContain('    "--all"');
    // 展开态不再显示折叠摘要行(openspec-tool-collapse 的 Scenario)
    expect(flat).not.toContain("openspec - validate");
    expect(flat).not.toContain("SUCCESS");
    // 展开态:全量,不截断
    expect(flat).toContain("REQ-1 ok");
    expect(flat).toContain("REQ-2 ok");
    expect(flat).toContain("SUMMARY: 2 passed");
  });

  it("fold + expanded:call 槽退让 0 行(不与 result 槽重复成两行)", () => {
    const r = openspecRenderers(bareNext(), () => fold());
    const { theme } = spyTheme();
    const rows = r.renderCall!({ subcommand: "validate", args: [] }, theme, makeCtx(true)).render(80);
    expect(rows).toHaveLength(0);
  });

  it("fold + expanded:展开体比折叠态高,且逐行铺 toolSuccessBg 背景", () => {
    const r = openspecRenderers(bareNext(), () => fold());
    const text = "line-1\nline-2\nline-3\nline-4\nline-5";

    const collapsedTheme = spyTheme();
    const collapsed = r
      .renderResult!(result(text), { expanded: false, isPartial: false }, collapsedTheme.theme, makeCtx(false))
      .render(80)
      .map(stripAnsi);

    const expandedTheme = spyTheme();
    const expanded = r
      .renderResult!(result(text), { expanded: true, isPartial: false }, expandedTheme.theme, makeCtx(true))
      .render(80)
      .map(stripAnsi);

    expect(collapsedTheme.calls).toContain("toolSuccessBg");
    expect(expandedTheme.calls).toContain("toolSuccessBg");
    expect(expanded.length).toBeGreaterThan(collapsed.length);
    // 每行(含上下留白行)都被盒壳 pad 到同一可见宽,证明整块共享单盒背景
    const widths = new Set(expanded.map((row) => visibleWidth(row)));
    expect(widths).toEqual(new Set([80]));
  });

  it("fold + expanded + 失败结果:背景用 toolErrorBg,输出仍全量展示", () => {
    const r = openspecRenderers(bareNext(), () => fold());
    const { theme, calls } = spyTheme();
    const ctx = makeCtx(true, true);
    const flat = r
      .renderResult!(result("boom\n[exit code 2]"), { expanded: true, isPartial: false }, theme, ctx)
      .render(80)
      .map(stripAnsi)
      .join("\n");

    expect(calls).toContain("toolErrorBg");
    expect(flat).toContain("boom");
    expect(flat).toContain("[exit code 2]");
  });

  it("fold + 流式(isPartial)展开:已到的部分输出立即可见(不被 isPartial 闸门吞掉)", () => {
    const r = openspecRenderers(bareNext(), () => fold());
    const { theme } = spyTheme();
    const rows = r
      .renderResult!(result("openspec validate --all"), { expanded: true, isPartial: true }, theme, makeCtx(true))
      .render(80)
      .map(stripAnsi);
    expect(rows.join("\n")).toContain("openspec validate --all");
    expect(rows.length).toBeGreaterThan(1);
  });

  it("native 模式 + 无原生渲染器:展开态同样自绘(不再整块消失)", () => {
    const r = openspecRenderers(bareNext(), () => fold({ mode: "native" as const }));
    const { theme } = spyTheme();
    const ctx = makeCtx(true);
    expect(r.renderCall!({ subcommand: "status" }, theme, ctx).render(80)).toHaveLength(0);
    const rows = r
      .renderResult!(result("BODY-A\nBODY-B"), { expanded: true, isPartial: false }, theme, ctx)
      .render(80)
      .map(stripAnsi);
    expect(rows.join("\n")).toContain("BODY-A");
    expect(rows.join("\n")).toContain("BODY-B");
  });
});

describe("openspec 展开态(存在原生渲染器时仍委托)", () => {
  it("fold + expanded:委托原生渲染器(不触发自绘兜底)", () => {
    const { next, def } = nativeNext();
    const r = openspecRenderers(next, () => fold());
    const { theme } = spyTheme();
    const flat = r
      .renderResult!(result("x"), { expanded: true, isPartial: false }, theme, makeCtx(true))
      .render(80)
      .map(stripAnsi)
      .join("\n");
    expect(def.renderResult).toHaveBeenCalledTimes(1);
    expect(def.renderCall).toHaveBeenCalledTimes(1); // 展开盒里的原生 call 头
    expect(flat).toContain("NATIVE-CALL");
    expect(flat).toContain("native-body");
  });

  it("native 模式:委托原生渲染器(保留双槽原样)", () => {
    const { next, def } = nativeNext();
    const r = openspecRenderers(next, () => fold({ mode: "native" as const }));
    const { theme } = spyTheme();
    r.renderResult!(result("x"), { expanded: false, isPartial: false }, theme, makeCtx(false));
    expect(def.renderResult).toHaveBeenCalledTimes(1);
  });
});
