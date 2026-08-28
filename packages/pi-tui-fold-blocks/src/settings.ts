// packages/pi-tui-fold-blocks/src/settings.ts
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { type FoldBlocksConfig, type Mode } from "./config.js";

export function boolToCfg(value: boolean): "on" | "off" {
  return value ? "on" : "off";
}

export function cfgToBool(value: string): boolean {
  return value === "on";
}

export function buildSettingItems(cfg: FoldBlocksConfig): SettingItem[] {
  return [
    { id: "mode", label: "Mode", currentValue: cfg.mode, values: ["fold", "hide", "native"] },
    { id: "nerdFont", label: "Nerd font icons", currentValue: boolToCfg(cfg.nerdFont), values: ["on", "off"] },
    { id: "fileBlocks.pathStyle", label: "Path style", currentValue: cfg.fileBlocks.pathStyle, values: ["relative", "absolute", "basename"] },
    { id: "fileBlocks.foldGitWorktree", label: "Fold git worktree", currentValue: boolToCfg(cfg.fileBlocks.foldGitWorktree), values: ["on", "off"] },
    { id: "bashBlocks.smart", label: "Bash smart detection", currentValue: boolToCfg(cfg.bashBlocks.smart), values: ["on", "off"] },
    { id: "bashBlocks.showStatus", label: "Show status hints", currentValue: boolToCfg(cfg.bashBlocks.showStatus), values: ["on", "off"] },
  ];
}

export function applySettingChange(cfg: FoldBlocksConfig, id: string, newValue: string): FoldBlocksConfig {
  const next: FoldBlocksConfig = {
    ...cfg,
    fileBlocks: { ...cfg.fileBlocks },
    bashBlocks: { ...cfg.bashBlocks },
  };
  switch (id) {
    case "mode":
      next.mode = newValue as Mode;
      break;
    case "nerdFont":
      next.nerdFont = cfgToBool(newValue);
      break;
    case "fileBlocks.pathStyle":
      next.fileBlocks.pathStyle = newValue as FoldBlocksConfig["fileBlocks"]["pathStyle"];
      break;
    case "fileBlocks.foldGitWorktree":
      next.fileBlocks.foldGitWorktree = cfgToBool(newValue);
      break;
    case "bashBlocks.smart":
      next.bashBlocks.smart = cfgToBool(newValue);
      break;
    case "bashBlocks.showStatus":
      next.bashBlocks.showStatus = cfgToBool(newValue);
      break;
  }
  return next;
}

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