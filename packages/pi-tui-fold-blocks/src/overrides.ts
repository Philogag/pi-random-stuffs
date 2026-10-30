// packages/pi-tui-fold-blocks/src/overrides.ts
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FoldBlocksConfig } from "./config.js";
import { renderBlock, buildBoxedBlock, bgFor } from "./render.js";
import { registerOpenspecRenderer } from "./openspec.js";

// ToolRenderContext 在 SDK 内部类型但未公开 re-export;从 ToolDefinition 推导
type AnyToolDef = ToolDefinition<any, any, any>;

export interface ToolRenderContext<TState = any, TArgs = any> {
	/** Current tool call arguments. Shared across call/result renders for the same tool call. */
	args: TArgs;
	/** Unique id for this tool execution. Stable across call/result renders for the same tool call. */
	toolCallId: string;
	/** Invalidate just this tool execution component for redraw. */
	invalidate: () => void;
	/** Previously returned component for this render slot, if any. */
	lastComponent: Component | undefined;
	/** Shared renderer state for this tool row. Initialized by tool-execution.ts. */
	state: TState;
	/** Working directory for this tool execution. */
	cwd: string;
	/** Whether the tool execution has started. */
	executionStarted: boolean;
	/** Whether the tool call arguments are complete. */
	argsComplete: boolean;
	/** Whether the tool result is partial/streaming. */
	isPartial: boolean;
	/** Whether the result view is expanded. */
	expanded: boolean;
	/** Whether inline images are currently shown in the TUI. */
	showImages: boolean;
	/** Whether the current result is an error. */
	isError: boolean;
	/** Horizontal padding used by the native result renderer (mirrors Box paddingX). */
	outputPad?: number;
	/** Execution duration in ms; only set once the execution has ended. */
	durationMs?: number;
}

type DefFactory = (cwd: string) => AnyToolDef;

/**
 * fold 模式的展开态：本包没有可自绘的权威布局展开视图，直接委托原生渲染器（设计 D1）。
 * 行号 / 语法高亮 / 截断提示 / bash 全量输出因此与 `native` 模式 1:1 一致。
 */
export function renderNativeExpanded(
  original: AnyToolDef,
  stage: "call" | "result",
  payload: unknown,
  theme: Theme,
  ctx: ToolRenderContext<any, unknown>,
): Component {
  // 不传 lastComponent：折叠态可能已 mutate 过该槽返回的组件，复用会残留旧布局
  const base = { ...ctx, lastComponent: undefined, expanded: true } as never;
  if (stage === "call") {
    return (
      (original.renderCall?.(ctx.args as never, theme as never, base) as Component | undefined) ?? new Text("", 0, 0)
    );
  }
  return (
    (original.renderResult?.(
      payload as never,
      { expanded: true, isPartial: ctx.isPartial } as never,
      theme as never,
      base,
    ) as Component | undefined) ?? new Text("", 0, 0)
  );
}

export function overrideTool(
  pi: ExtensionAPI,
  name: string,
  cwd: string,
  factory: DefFactory,
  cfgGetter: () => FoldBlocksConfig,
): void {
  const original = factory(cwd);

  const renderCall = (args: unknown, theme: Theme, context: ToolRenderContext<any, unknown>): Component => {
    const config = cfgGetter();
    if (config.mode === "native") {
      return renderNativeExpanded(original, "call", args, theme, context);
    }
    // fold 展开态：由 result 槽聚合单盒，call 槽退让为 0 行
    if (config.mode === "fold" && context.expanded === true) {
      return renderExpandedFold(original, "call", args, theme, context);
    }
    return renderBlock(context as any, {
      name: name,
      stage: "call",
      args: context.args,
      result: undefined,
      cwd: context.cwd,
      config: config,
      theme: theme,
    });
  };

  const renderResult = (
    result: unknown,
    options: { expanded: boolean; isPartial: boolean },
    theme: Theme,
    context: ToolRenderContext<any, unknown>,
  ): Component => {
    const config = cfgGetter();
    if (config.mode === "native") {
      return renderNativeExpanded(original, "result", result, theme, context);
    }
    // fold 展开态：聚合原生 call 头 + 原生 result 体进单个自绘盒（与折叠态同背景）。
    // options.expanded 与 ctx.expanded 任一为真即视为展开。
    const expanded = options.expanded === true || context.expanded === true;
    if (config.mode === "fold" && expanded) {
      return renderExpandedFold(original, "result", result, theme, context);
    }
    return renderBlock(context as any, {
      name: name,
      stage: "result",
      args: context.args,
      result,
      cwd: context.cwd,
      config: config,
      theme: theme,
    });
  };
  pi.registerTool({
    ...original,
    renderShell: "self",
    execute: original.execute, // 原样委托,行为不变(D1/D8)
    renderCall: renderCall as never,
    renderResult: renderResult as never,
  });
}

/**
 * fold 模式展开态（内置四工具）：把原生渲染内容聚合进**单个自绘盒子**，背景与折叠态同名配色。
 *
 * 为什么不能直接返回裸原生组件：self-shell 的 selfRenderContainer 是普通 Container（无 Box 背景），
 * 原生 read/bash 渲染器返回的也是无背景 Text，展开后整块掉回终端默认背景，与折叠态的绿条完全不同——迷惑。
 * 收敛到单盒：由 result 槽独占产出 `[原生 call 头 + 原生 result 体]`（call 槽退让 0 行），
 * 因此展开体与折叠态同背景、同单盒形态，内容仍是原生视图（行号/着色/截断提示 1:1）。
 */

/**
 * 把原生 call 头的返回值平铺成要叠加进展开盒的子组件列表。
 *
 * 差异来源:read/write/bash 的原生 renderCall 返回一个无外框的单行 Text;而 edit 的原生
 * renderCall 返回 `new Box(1, 1, …)`(renderers/edit.js 的 createEditCallRenderComponent),
 * 该 Box 自带 paddingY=1 与自己的 header 背景。若原样叠加,展开盒里会平添一层 `[空行, 头, 空行]`
 * (灰底),叠在下方 buildBoxedBlock 的绿色上留白之上 → edit 顶部空两行,与 read/write/bash 的空一行
 * 不一致。这里的 Box 除了做把子内容包一层 padding/bg 的“壳”,别无承载;因此展开态取它的
 * 子组件直接叠加,背景/留白统一交给外层的 buildBoxedBlock(单盒同背景),从而四工具顶部同款空一行。
 * (`Box.children` 为 pi-tui 公开字段;非 Box 组件原样返回,read/write/bash 不受影响。)
 */
function unwrapBoxChildren(component: Component | undefined): Component[] {
  if (!component) return [];
  return component instanceof Box ? component.children : [component];
}

export function renderExpandedFold(
  original: AnyToolDef,
  stage: "call" | "result",
  payload: unknown,
  theme: Theme,
  ctx: ToolRenderContext<any, unknown>,
): Component {
  if (stage === "call") return new Text("", 0, 0);
  const bgFn = bgFor("result", ctx.isError, theme);
  const base = { ...ctx, lastComponent: undefined, expanded: true } as never;
  const stack = new Container();
  const call = original.renderCall?.(ctx.args as never, theme as never, base) as Component | undefined;
  const body = original.renderResult?.(
    payload as never,
    { expanded: true, isPartial: ctx.isPartial } as never,
    theme as never,
    base,
  );
  // edit 的原生 renderResult 会把 diff(经 setEditPreview + buildEditCallComponent)写回
  // renderCall 已返回的同一个 call Box(state.callComponent),自身却返回空的 Container。
  // 若在调用 renderResult 之前就当次解壳 call,首次展开(此时 call 盒内尚无 preview)只取到
  // call 头,原生 result 对它的补写不被捕获 → 展开不完整(回归 bug);for 循环因此移到
  // renderResult 之后,把原生对 call 盒的补写纳入同一展开盒。其余工具的 renderResult 不
  // 改动 call 盒,解壳时序对它们无影响。
  for (const c of unwrapBoxChildren(call)) stack.addChild(c);
  if (body) stack.addChild(body as Component);
  return buildBoxedBlock(stack, bgFn, ctx.outputPad ?? 1);
}

export function registerOverrides(pi: ExtensionAPI, cwd: string, cfgGetter: () => FoldBlocksConfig): void {
  overrideTool(pi, "read", cwd, createReadToolDefinition as never, cfgGetter);
  overrideTool(pi, "write", cwd, createWriteToolDefinition as never, cfgGetter);
  overrideTool(pi, "edit", cwd, createEditToolDefinition as never, cfgGetter);
  overrideTool(pi, "bash", cwd, createBashToolDefinition as never, cfgGetter);
  // openspec 工具(pi-openspec-bridge 注册)走 registerToolRenderer 折叠,不重建定义、不动 execute。
  registerOpenspecRenderer(pi, cfgGetter);
}
