// packages/pi-tui-fold-blocks/src/settings.ts
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { type FoldBlocksConfig, type Mode } from "./config.js";

export function nextMode(mode: Mode): Mode {
  return mode === "fold" ? "hide" : mode === "hide" ? "native" : "fold";
}

export async function openSettings(
  pi: Pick<ExtensionUIContext, "select" | "confirm" | "input">,
  config: FoldBlocksConfig,
  onSave: (cfg: FoldBlocksConfig) => void,
): Promise<void> {
  let cfg = config;
  for (;;) {
    const choice = await pi.select("tui-fold-blocks 设置", [
      `${cfg.mode === "fold" ? "[x]" : "[ ]"} 模式:${cfg.mode}`,
      `${cfg.nerdFont ? "[x]" : "[ ]"} nerd font 图标`,
      `路径样式:${cfg.fileBlocks.pathStyle}`,
      `${cfg.fileBlocks.foldGitWorktree ? "[x]" : "[ ]"} git worktree 折叠`,
      `${cfg.bashBlocks.smart ? "[x]" : "[ ]"} bash 智能识别`,
      `${cfg.bashBlocks.showStatus ? "[x]" : "[ ]"} 状态提示`,
      "保存并退出",
    ]);
    if (!choice || choice === "保存并退出") break;
    if (choice.includes("模式:")) {
      const m = await pi.select("显示模式", ["native", "fold", "hide"]);
      if (m) cfg = { ...cfg, mode: m as Mode };
    } else if (choice.includes("nerd font")) {
      cfg = { ...cfg, nerdFont: !cfg.nerdFont };
    } else if (choice.includes("路径样式")) {
      const s = await pi.select("路径样式", ["relative", "absolute", "basename"]);
      if (s) {
        cfg = { ...cfg, fileBlocks: { ...cfg.fileBlocks, pathStyle: s as FoldBlocksConfig["fileBlocks"]["pathStyle"] } };
      }
    } else if (choice.includes("git worktree")) {
      cfg = { ...cfg, fileBlocks: { ...cfg.fileBlocks, foldGitWorktree: !cfg.fileBlocks.foldGitWorktree } };
    } else if (choice.includes("智能识别")) {
      cfg = { ...cfg, bashBlocks: { ...cfg.bashBlocks, smart: !cfg.bashBlocks.smart } };
    } else if (choice.includes("状态提示")) {
      cfg = { ...cfg, bashBlocks: { ...cfg.bashBlocks, showStatus: !cfg.bashBlocks.showStatus } };
    }
  }
  onSave(cfg);
}