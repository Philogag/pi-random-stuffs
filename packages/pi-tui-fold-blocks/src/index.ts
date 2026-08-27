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
  // 用 getter 把活 config 暴露给 overrides —— 让设置保存后立刻生效(P1-1 修复)
  const getConfig = (): FoldBlocksConfig => config;
  registerOverrides(pi, cwd, getConfig, modeState);

  pi.registerCommand("fold-blocks", {
    description: "循环切换工具块显示模式(原生/折叠/隐藏)并进入设置",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (args.trim() === "settings") {
        await openSettings(ctx.ui, config, (next) => {
          config = next;
          if (next.mode !== modeState.mode) modeState.setMode(next.mode); // 模式字段实时同步,触发 rerenderAll
          saveConfig(config);
        });
        return;
      }
      const next = nextMode(modeState.mode);
      config = setMode(config, next); // 先持久化(setMode 不会触发 onModeChange,这里显式 set 一下触发 rerenderAll)
      modeState.setMode(next);
      saveConfig(config);
    },
  });
}