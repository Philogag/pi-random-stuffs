// packages/pi-tui-fold-blocks/src/config.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type Mode = "native" | "fold" | "hide";

export interface FoldBlocksConfig {
  mode: Mode;
  nerdFont: boolean;
  fileBlocks: {
    collapse: boolean;
    pathStyle: "absolute" | "relative" | "basename";
    foldGitWorktree: boolean;
  };
  bashBlocks: { collapse: boolean; smart: boolean; showStatus: boolean };
}

export const DEFAULT_CONFIG: FoldBlocksConfig = {
  mode: "fold",
  nerdFont: true,
  fileBlocks: { collapse: true, pathStyle: "relative", foldGitWorktree: true },
  bashBlocks: { collapse: true, smart: true, showStatus: true },
};

const PACKAGE_KEY = "@philogag/pi-tui-fold-blocks";

function sanitize(raw: unknown): FoldBlocksConfig {
  if (typeof raw !== "object" || raw === null) return DEFAULT_CONFIG;
  const r = raw as Record<string, unknown>;
  return {
    mode: r.mode === "native" || r.mode === "hide" ? r.mode : r.mode === "fold" ? "fold" : DEFAULT_CONFIG.mode,
    nerdFont: typeof r.nerdFont === "boolean" ? r.nerdFont : DEFAULT_CONFIG.nerdFont,
    fileBlocks: {
      collapse: typeof (r.fileBlocks as any)?.collapse === "boolean" ? (r.fileBlocks as any).collapse : DEFAULT_CONFIG.fileBlocks.collapse,
      pathStyle: ["absolute", "relative", "basename"].includes((r.fileBlocks as any)?.pathStyle)
        ? (r.fileBlocks as any).pathStyle
        : DEFAULT_CONFIG.fileBlocks.pathStyle,
      foldGitWorktree: typeof (r.fileBlocks as any)?.foldGitWorktree === "boolean" ? (r.fileBlocks as any).foldGitWorktree : DEFAULT_CONFIG.fileBlocks.foldGitWorktree,
    },
    bashBlocks: {
      collapse: typeof (r.bashBlocks as any)?.collapse === "boolean" ? (r.bashBlocks as any).collapse : DEFAULT_CONFIG.bashBlocks.collapse,
      smart: typeof (r.bashBlocks as any)?.smart === "boolean" ? (r.bashBlocks as any).smart : DEFAULT_CONFIG.bashBlocks.smart,
      showStatus: typeof (r.bashBlocks as any)?.showStatus === "boolean" ? (r.bashBlocks as any).showStatus : DEFAULT_CONFIG.bashBlocks.showStatus,
    },
  };
}

export function loadConfig(settingsPath?: string): FoldBlocksConfig {
  const path = settingsPath ?? findSettingsPath();
  try {
    const text = readFileSync(path, "utf8");
    const json = JSON.parse(text) as Record<string, unknown>;
    return sanitize(json[PACKAGE_KEY]);
  } catch {
    return { ...DEFAULT_CONFIG, fileBlocks: { ...DEFAULT_CONFIG.fileBlocks }, bashBlocks: { ...DEFAULT_CONFIG.bashBlocks } };
  }
}

export function saveConfig(cfg: FoldBlocksConfig, settingsPath?: string): void {
  const path = settingsPath ?? findSettingsPath();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch { /* 新建 */ }
  json[PACKAGE_KEY] = cfg;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(json, null, 2), "utf8");
}

export function setMode(cfg: FoldBlocksConfig, mode: Mode): FoldBlocksConfig {
  return { ...cfg, mode, fileBlocks: { ...cfg.fileBlocks }, bashBlocks: { ...cfg.bashBlocks } };
}

function findSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}