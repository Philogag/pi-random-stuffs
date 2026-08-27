// packages/pi-tui-fold-blocks/src/index.ts
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, setMode, type Mode } from "./config.js";
import { createModeState } from "./mode.js";
import { registerOverrides } from "./overrides.js";

export default function (pi: ExtensionAPI): void {
  let config = loadConfig();
  const modeState = createModeState(config.mode, () => {
    config = setMode(config, modeState.mode);
    // 持久化见 Task 6(命令注册)
  });
  const cwd = process.cwd();
  registerOverrides(pi, cwd, config, modeState);

  pi.registerCommand("fold-blocks", {
    description: "循环切换工具块显示模式(原生/折叠/隐藏)并进入设置",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      void args; void _ctx;
      // Task 6 填充:循环三态 + 设置子页面
    },
  });
}