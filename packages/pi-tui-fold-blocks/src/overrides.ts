// packages/pi-tui-fold-blocks/src/overrides.ts
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import type { ModeState } from "./mode.js";
import type { FoldBlocksConfig } from "./config.js";
import { renderBlock } from "./render.js";

// ToolRenderContext 在 SDK 内部类型但未公开 re-export;从 ToolDefinition 推导
type AnyToolDef = ToolDefinition<any, any, any>;
type RenderCallCtx = NonNullable<AnyToolDef["renderCall"]> extends (a: any, t: any, c: infer C) => any ? C : never;
type RenderResultCtx = NonNullable<AnyToolDef["renderResult"]> extends (r: any, o: any, t: any, c: infer C) => any ? C : never;

type DefFactory = (cwd: string) => AnyToolDef;

function override(
  pi: ExtensionAPI,
  name: string,
  cwd: string,
  factory: DefFactory,
  cfgGetter: () => FoldBlocksConfig,
  modeState: ModeState,
): void {
  const original = factory(cwd);
  // renderCall 签名: (args, theme, context); renderResult: (result, options, theme, context)
  // RenderCallCtx/RenderResultCtx 自带 args/toolCallId/invalidate/lastComponent/state/cwd/isPartial/isError/expanded
  const renderCall = (args: unknown, theme: unknown, context: RenderCallCtx): Component => {
    modeState.addInvalidator(context.toolCallId, context.invalidate);
    if (modeState.mode === "native") {
      // 完全放手:委托内置渲染(renderShell:self 限制下无状态色框,记录为已知限制)
      return (original.renderCall?.(args as never, theme as never, context) as Component) ?? new Text("", 0, 0);
    }
    // 单行原则:内容全部由 renderResult 渲染;这里返回 0 行空 Text,
    // 避免 SDK 将 renderCall 与 renderResult 都 addChild 导致两行。
    return new Text("", 0, 0);
  };
  const renderResult = (
    result: unknown,
    options: { expanded: boolean; isPartial: boolean },
    theme: unknown,
    context: RenderResultCtx,
  ): Component => {
    modeState.addInvalidator(context.toolCallId, context.invalidate);
    if (modeState.mode === "native") {
      return (original.renderResult?.(result as never, options as never, theme as never, context) as Component) ?? new Text("", 0, 0);
    }
    return renderBlock({
      toolName: name,
      kind: name === "bash" ? "bash" : "file",
      args: context.args,
      result,
      isPartial: options.isPartial,
      isError: context.isError,
      expanded: options.expanded,
      config: cfgGetter(), // 每次渲染取最新值,设置保存后立即生效
      cwd: context.cwd,
      modeState,
      theme: theme as never,
      lastComponent: context.lastComponent,
      toolCallId: context.toolCallId,
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

export function registerOverrides(pi: ExtensionAPI, cwd: string, cfgGetter: () => FoldBlocksConfig, modeState: ModeState): void {
  override(pi, "read", cwd, createReadToolDefinition as never, cfgGetter, modeState);
  override(pi, "bash", cwd, createBashToolDefinition as never, cfgGetter, modeState);
  override(pi, "edit", cwd, createEditToolDefinition as never, cfgGetter, modeState);
  override(pi, "write", cwd, createWriteToolDefinition as never, cfgGetter, modeState);
}