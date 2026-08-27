// packages/pi-tui-fold-blocks/src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";

export default function (pi: ExtensionAPI): void {
  const config = loadConfig();
  void config;
}