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
import type { Component } from "@earendil-works/pi-tui";
import type { FoldBlocksConfig } from "./config.js";
import { renderOwnedBlock, contentExitCode, type LineContext, type RenderBlockOpts } from "./render.js";
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
 * openspec 自选渲染器:返回 `{ renderShell:"self", renderCall, renderResult }`。
 * renderCall/renderResult 运行时经 cfgGetter() 读当前 mode 与 ctx.expanded 路由。
 */
export function openspecRenderers(
  next: () => ToolRenderers | undefined,
  cfgGetter: () => FoldBlocksConfig,
): ToolRenderers {
  const renderCall = (args: unknown, theme: Theme, context: ToolRenderContext<any, unknown>): Component => {
    const config = cfgGetter();
    if (config.mode === "native") {
      return renderNativeExpanded(resolveNative(next), "call", args, theme, context);
    }
    // fold 展开态:由 result 槽聚合单盒,call 槽退让 0 行
    if (config.mode === "fold" && context.expanded === true) {
      return renderExpandedFold(resolveNative(next), "call", args, theme, context);
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
    if (config.mode === "native") {
      return renderNativeExpanded(resolveNative(next), "result", result, theme, context);
    }
    // fold 展开态:聚合原生 call 头 + 原生 result 体进单个自绘盒(同折叠态背景)
    const expanded = options.expanded === true || context.expanded === true;
    if (config.mode === "fold" && expanded) {
      return renderExpandedFold(resolveNative(next), "result", result, theme, context);
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