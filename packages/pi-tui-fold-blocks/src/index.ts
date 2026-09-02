// packages/pi-tui-fold-blocks/src/index.ts
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig, setMode, type FoldBlocksConfig } from "./config.js";
import { createModeState } from "./mode.js";
import { registerOverrides } from "./overrides.js";
import { openSettings } from "./settings.js";
import { markFoldBlocksActive, publishConfig, getFoldConfig, subscribeFoldConfig, isFoldBlocksActive, subscribeFoldBlocksActive } from "./compat.js";
import { renderOwnedBlock, buildBlockComponent, contentLineCount, contentExitCode, type LineContext } from "./render.js";
import { foldCommand, type FoldCommandOpts } from "./folders/command.js";
import type { ToolRenderContext } from "./overrides.js";

// 兼容导出面(供其他扩展复用折叠渲染能力)。类型/常量/函数逐一来自其定义模块:
//   renderOwnedBlock/LineContext/render.ts;buildBlockComponent/contentLineCount/contentExitCode 同;
//   foldCommand(+FoldCommandOpts) 在 folders/command.ts;FoldBlocksConfig 在 config.ts;
//   ToolRenderContext 在 overrides.ts;激活/配置单例在 compat.ts。
export {
  renderOwnedBlock,
  buildBlockComponent,
  contentLineCount,
  contentExitCode,
  foldCommand,
  type FoldCommandOpts,
  type LineContext,
  type FoldBlocksConfig,
  type ToolRenderContext,
  getFoldConfig,
  isFoldBlocksActive,
  subscribeFoldBlocksActive,
  subscribeFoldConfig,
};

export default function (pi: ExtensionAPI): void {
  markFoldBlocksActive(); // 库面激活门控:工厂执行即视为扩展激活(幂等)。
  let config = loadConfig();
  publishConfig(config);
  const modeState = createModeState(config.mode, () => {
    config = setMode(config, modeState.mode);
    publishConfig(config); // persist-then-notify:onModeChange 由 setMode/rerenderAll 触发
  });
  const cwd = process.cwd();
  // 用 getter 把活 config 暴露给 overrides —— 让设置保存后立刻生效(P1-1 修复)
  const getConfig = (): FoldBlocksConfig => config;

  // registerTool 的渲染钩子必须在工具执行前就位:session_start 事件触发时首帧渲染可能已完成,
  // 在事件 handler 中注册会导致 read/bash/edit/write 的折叠渲染不生效。故放顶层无条件注册。
  registerOverrides(pi, cwd, getConfig);

  // 命令仅 TUI 模式需要(依赖 ctx.ui 打开设置页),且 ExtensionAPI 工厂入参无 mode 字段,
  // 需在事件 handler 中经 ctx.mode 判断(官方文档: Use ctx.mode === "tui" to guard
  // terminal-only features)。registered 标志保证 session_start 多次触发时只注册一次。
  let commandRegistered = false;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || commandRegistered) return;
    commandRegistered = true;

    pi.registerCommand("tui-fold-blocks", {
      description: "Open tui-fold-blocks settings page",
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        await openSettings(ctx.ui, config, (next) => {
          config = next;
          saveConfig(config);
          publishConfig(config); // persist-then-notify:先存盘,再通知订阅者
          if (next.mode !== modeState.mode) modeState.setMode(next.mode); // 模式字段实时同步,触发 rerenderAll
        });
      },
    });
  });
}