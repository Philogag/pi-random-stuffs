// packages/pi-tui-fold-blocks/src/index.ts
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig, setMode, type FoldBlocksConfig } from "./config.js";
import { createModeState } from "./mode.js";
import { registerOverrides } from "./overrides.js";
import { openSettings } from "./settings.js";

export default function (pi: ExtensionAPI): void {
  let config = loadConfig();
  const modeState = createModeState(config.mode, () => {
    config = setMode(config, modeState.mode);
  });
  const cwd = process.cwd();
  // 用 getter 把活 config 暴露给 overrides —— 让设置保存后立刻生效(P1-1 修复)
  const getConfig = (): FoldBlocksConfig => config;

  registerOverrides(pi, cwd, getConfig);

  // 当且仅当 pi 运行于 TUI 模式(interactive)时才注册渲染钩子与命令:
  // ExtensionAPI 工厂入参无 mode 字段,需在事件 handler 中经 ctx.mode 判断
  // (官方文档: Use ctx.mode === "tui" to guard terminal-only features)。
  // registered 标志保证 session_start 多次触发(reload/new/resume/fork)时只注册一次。
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    pi.registerCommand("tui-fold-blocks", {
      description: "Open tui-fold-blocks settings page",
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        await openSettings(ctx.ui, config, (next) => {
          config = next;
          if (next.mode !== modeState.mode) modeState.setMode(next.mode); // 模式字段实时同步,触发 rerenderAll
          saveConfig(config);
        });
      },
    });
  });
}