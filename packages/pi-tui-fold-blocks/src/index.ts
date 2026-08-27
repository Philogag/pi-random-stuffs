// packages/pi-tui-fold-blocks/src/index.ts
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig, setMode, type FoldBlocksConfig, type Mode } from "./config.js";
import { createModeState } from "./mode.js";
import { registerOverrides } from "./overrides.js";
import { nextMode, openSettings } from "./settings.js";

export default function (pi: ExtensionAPI): void {
  let config = loadConfig();
  const modeState = createModeState(config.mode, () => {
    config = setMode(config, modeState.mode);
  });
  const cwd = process.cwd();
  registerOverrides(pi, cwd, config, modeState);

  pi.registerCommand("fold-blocks", {
    description: "循环切换工具块显示模式(原生/折叠/隐藏)并进入设置",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (args.trim() === "settings") {
        await openSettings(ctx.ui, config, (next) => {
          config = next as FoldBlocksConfig;
          saveConfig(config);
        });
        return;
      }
      const next = nextMode(modeState.mode);
      modeState.setMode(next); // 触发 rerenderAll
      config = setMode(config, next);
      saveConfig(config);
    },
  });
}