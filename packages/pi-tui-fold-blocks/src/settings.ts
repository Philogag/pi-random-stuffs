// packages/pi-tui-fold-blocks/src/settings.ts
import { getSettingsListTheme, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";
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

export async function openSettings(
  ui: ExtensionUIContext,
  config: FoldBlocksConfig,
  onSave: (cfg: FoldBlocksConfig) => void,
): Promise<void> {
  let cfg = config;
  await ui.custom<void>((_tui, _theme, _kb, done) => {
    const items = buildSettingItems(cfg);
    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      (id, newValue) => {
        cfg = applySettingChange(cfg, id, newValue);
        onSave(cfg);
      },
      () => done(undefined),
      { enableSearch: false },
    );
    return {
      render: (w: number) => settingsList.render(w),
      invalidate: () => settingsList.invalidate(),
      handleInput: (data: string) => settingsList.handleInput?.(data),
    };
  });
}