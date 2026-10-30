// src/status/openspec.ts
//
// `openspec status --change <name> --json` for the status bar.
//
// Runs through the shared bridge runner (cli/run.ts) so the status bar works
// without a global CLI: the bundled @fission-ai/openspec dependency is enough.

import type { StatusJson } from "./types.js";
import { runOpenspec } from "../cli/run.js";

// The CLI needs ~1.2–2s to produce the full status JSON on a cold start, and
// more under load. Keep generous headroom so a slow CLI never collapses the
// status line to "spec-driven".
export const OPENSPEC_STATUS_TIMEOUT_MS = 10_000;

export async function runOpenspecStatus(
  changeName: string,
  cwd: string,
): Promise<StatusJson | null> {
  const result = await runOpenspec({
    argv: ["status", "--change", changeName, "--json", "--no-interactive"],
    cwd: cwd || process.cwd(),
    timeoutMs: OPENSPEC_STATUS_TIMEOUT_MS,
  });

  if (result.spawnError || result.timedOut) return null;
  if (result.exitCode !== 0) return null;

  try {
    return JSON.parse(result.stdout) as StatusJson;
  } catch {
    return null;
  }
}
