// packages/pi-tui-fold-blocks/src/openspec.ts
//
// openspec 工具渲染覆盖(方案 A:pi.registerToolRenderer)。
//
// pi-openspec-bridge 注册的 `openspec` 工具没有渲染器 → 走 pi 默认整块渲染。这里
// 只通过 SDK 的 registerToolRenderer 按工具名接管其"渲染",完全不动 execute/定义,
// 从而零耦合(不 import openspec-bridge,只读 subcommand/args/change 三个字段)。
//
// 链路机制(SDK runner.resolveToolRenderers):扩展按加载序注册的 resolver 依次执行,
// `next()` 返回"剩余 resolver 之后、以及已注册工具"将用的渲染器(ToolRenderers|
// undefined)。因此:
//   - 非 openspec 工具 → 返回 next() 让链路继续(无副作用);
//   - openspec 工具   → 返回自绘折叠渲染器,原生/展开态经 next() 委托到底层渲染器。
//
// 路由与内置四工具一致(native/hide/fold+expanded/fold),折叠核心复用 renderOwnedBlock,
// 展开态委托用 renderNativeExpanded / renderExpandedFold(next() 提供唯一可信原生来源)。

import type { ExtensionAPI, Theme, ToolRenderers, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { FoldBlocksConfig } from "./config.js";
import {
  renderOwnedBlock,
  contentExitCode,
  contentText,
  buildExpandedBodyText,
  buildNativeToolHeader,
  buildSelfExpandedBlock,
  bgFor,
  type LineContext,
  type RenderBlockOpts,
} from "./render.js";
import { renderNativeExpanded, renderExpandedFold, type ToolRenderContext } from "./overrides.js";

type AnyToolDef = ToolDefinition<any, any, any>;

/** openspec 参数对象上稳定且文档化的三个字段(不 import openspec-bridge)。 */
export interface OpenspecArgs {
  subcommand?: string;
  args?: string[];
  change?: string;
}

/** 折叠行左侧 `shown`:`[subcommand, ...args, change?"--change "+change:""]` 去空拼接。 */
export function openspecShown(args: OpenspecArgs): string {
  return [args.subcommand ?? "", ...(args.args ?? []), args.change ? `--change ${args.change}` : ""]
    .filter(Boolean)
    .join(" ");
}

/** 折叠行右侧状态:从 result 文本解析退出码(contentExitCode 非零 → FAILED(N));退回到 isError 判定泛化 FAILED/SUCCESS。 */
export function openspecStatusText(result: unknown, isError: boolean): string {
  const errorCode = contentExitCode(result);
  if (errorCode !== undefined && errorCode !== 0) return `FAILED(${errorCode})`;
  return isError ? "FAILED" : "SUCCESS";
}

/** openspec 折叠行构造器(与 read/bash 折叠行同构:"openspec - <shown>" + 右状态)。 */
export function buildOpenspecBlockText(ctx: ToolRenderContext, opts: RenderBlockOpts): LineContext {
  const args = (ctx.args ?? {}) as OpenspecArgs;
  return {
    icon: opts.config.nerdFont ? "\u2605" : "",
    tool: "openspec",
    shown: openspecShown(args),
    result: opts.stage === "call" ? "" : openspecStatusText(opts.result, ctx.isError),
  };
}

/** 解析 next() 得到底层渲染器;next() 为 undefined(默认渲染器路径差异)时安全降级为空原文。
 * renderNativeExpanded/renderExpandedFold 对 renderCall/renderResult 均用 `?.` 防御,folding 分支不依赖它。 */
function resolveNative(next: () => ToolRenderers | undefined): AnyToolDef {
  return (next() ?? {}) as AnyToolDef;
}

/**
 * next() 的返回值是否真的带渲染器。
 *
 * 关键前提:pi-openspec-bridge 只用 `pi.registerTool` 注册 openspec,不带 renderCall/
 * renderResult,于是链路末尾的 withBuiltInRenderers 会原样返回该定义对象(有 name/execute,
 * 但两个渲染器都 undefined)。此时任何"委托原生"的路径(renderNativeExpanded /
 * renderExpandedFold)都只能产出空组件——展开后屏幕上只剩一条空行(本 bug 的根因)。
 * 只有确实存在渲染器时才委托,否则走自绘兜底。
 */
function hasNativeRenderer(def: AnyToolDef): boolean {
  return typeof (def as { renderCall?: unknown }).renderCall === "function"
    || typeof (def as { renderResult?: unknown }).renderResult === "function";
}

/**
 * 无原生渲染器时的展开体:自绘单盒 —— 与 pi 原生 fallback 同构(`typescript`
 * `tool-execution.js`:`createCallFallback` + `createResultFallback`)。
 *
 * 结构(单盒、同 toolSuccessBg/toolErrorBg 背景、上下留白 1 行、paddingX = outputPad):
 *   1. 标题行 `openspec` + 逐行 `  <key>: <value>`(即 `formatToolCallWithArgs(..., expanded=true)`);
 *   2. 结果全量原文(每行 toolOutput 着色,不截断、不只看前 10 行)。
 *
 * 不使用折叠摘要行(`openspec - <subcommand> ...` + SUCCESS):那是折叠态形态。native 观感的
 * 展开态只展示工具名与参数 + 完整输出,与 openspec-tool-collapse 的"展开显示完整输出 /
 * 不再显示折叠摘要行"场景一致。与 renderExpandedFold 一样不看 isPartial:展开时已到的部分
 * 输出立即可见。
 */
export function renderOpenspecSelfExpanded(
  ctx: ToolRenderContext<any, unknown>,
  result: unknown,
  theme: Theme,
): Component {
  const bgFn = bgFor("result", ctx.isError, theme);
  return buildSelfExpandedBlock(
    buildNativeToolHeader("openspec", ctx.args, theme),
    buildExpandedBodyText(contentText(result), theme, bgFn),
    bgFn,
    ctx.outputPad ?? 1,
  );
}

/**
 * openspec 自选渲染器:返回 `{ renderShell:"self", renderCall, renderResult }`。
 * renderCall/renderResult 运行时经 cfgGetter() 读当前 mode 与 ctx.expanded 路由。
 */
export function openspecRenderers(
  next: () => ToolRenderers | undefined,
  cfgGetter: () => FoldBlocksConfig,
): ToolRenderers {
  const renderCall = (args: unknown, theme: Theme, context: ToolRenderContext<any, unknown>): Component => {
    const config = cfgGetter();
    const native = resolveNative(next);
    if (config.mode === "native") {
      // 无原生渲染器 → 不自绘 call 头(交给 result 槽的单盒),否则会与 result 槽重复成两行
      if (!hasNativeRenderer(native)) return new Text("", 0, 0);
      return renderNativeExpanded(native, "call", args, theme, context);
    }
    // fold 展开态:由 result 槽聚合单盒,call 槽退让 0 行
    if (config.mode === "fold" && context.expanded === true) {
      if (!hasNativeRenderer(native)) return new Text("", 0, 0);
      return renderExpandedFold(native, "call", args, theme, context);
    }
    return renderOwnedBlock(context as any, {
      name: "openspec",
      stage: "call",
      args: context.args,
      result: undefined,
      cwd: context.cwd,
      config: config,
      theme: theme,
    }, buildOpenspecBlockText);
  };

  const renderResult = (
    result: unknown,
    options: { expanded: boolean; isPartial: boolean },
    theme: Theme,
    context: ToolRenderContext<any, unknown>,
  ): Component => {
    const config = cfgGetter();
    const native = resolveNative(next);
    const delegate = hasNativeRenderer(native);
    if (config.mode === "native" && delegate) {
      return renderNativeExpanded(native, "result", result, theme, context);
    }
    // fold 展开态:聚合原生 call 头 + 原生 result 体进单个自绘盒(同折叠态背景)。
    // options.expanded 与 ctx.expanded 任一为真即视为展开。
    const expanded = options.expanded === true || context.expanded === true;
    if (config.mode === "fold" && expanded) {
      // 有原生渲染器 → 委托原生(行号/着色 1:1);没有(openspec-bridge 常态)→ 自绘单盒,
      // 否则委托结果为空组件,展开后只剩一条空行。
      return delegate
        ? renderExpandedFold(native, "result", result, theme, context)
        : renderOpenspecSelfExpanded(context, result, theme);
    }
    if (config.mode === "native" && expanded) {
      // native 模式 + 无原生渲染器:同样自绘展开视图,避免整块消失
      return renderOpenspecSelfExpanded(context, result, theme);
    }
    return renderOwnedBlock(context as any, {
      name: "openspec",
      stage: "result",
      args: context.args,
      result,
      cwd: context.cwd,
      config: config,
      theme: theme,
    }, buildOpenspecBlockText);
  };

  return { renderShell: "self", renderCall, renderResult };
}

/**
 * 注册 openspec 渲染覆盖:按工具名分发的 resolver。
 * toolName === "openspec" → openspecRenderers;否则委托 next() 保持链路(未装 openspec-bridge 时对一切工具无副作用)。
 */
export function registerOpenspecRenderer(pi: ExtensionAPI, cfgGetter: () => FoldBlocksConfig): void {
  pi.registerToolRenderer((toolName, next) =>
    toolName === "openspec" ? openspecRenderers(next, cfgGetter) : next()
  );
}