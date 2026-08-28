// packages/pi-tui-fold-blocks/src/overrides.ts
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FoldBlocksConfig } from "./config.js";
import { renderBlock } from "./render.js";

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
}

type DefFactory = (cwd: string) => AnyToolDef;

function override(
  pi: ExtensionAPI,
  name: string,
  cwd: string,
  factory: DefFactory,
  cfgGetter: () => FoldBlocksConfig,
): void {
  const original = factory(cwd);

  const renderCall = (args: unknown, theme: Theme, context: ToolRenderContext): Component => {
    const config = cfgGetter();
    if (config.mode === "native") {
      return (original.renderCall?.(args as never, theme as never, context) as Component) ?? new Text("", 0, 0);
    }
    return renderBlock(context, {
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
    context: ToolRenderContext,
  ): Component => {
    const config = cfgGetter();
    if (config.mode === "native") {
      return (original.renderResult?.(result as never, options as never, theme as never, context) as Component) ?? new Text("", 0, 0);
    }
    return renderBlock(context, {
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

export function registerOverrides(pi: ExtensionAPI, cwd: string, cfgGetter: () => FoldBlocksConfig): void {
  override(pi, "read", cwd, createReadToolDefinition as never, cfgGetter);
  override(pi, "write", cwd, createWriteToolDefinition as never, cfgGetter);
  override(pi, "edit", cwd, createEditToolDefinition as never, cfgGetter);
  override(pi, "bash", cwd, createBashToolDefinition as never, cfgGetter);
}