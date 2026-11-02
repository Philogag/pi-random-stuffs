// src/status/openspec.ts
//
// `openspec status --change <name> --json` for the status bar.
//
// Runs through the shared bridge runner (cli/run.ts) so the status bar works
// without a global CLI: the bundled @fission-ai/openspec dependency is enough.

import type { StatusJson } from "./types.js";
import { runOpenspec } from "../cli/run.js";
import { buildArgv } from "../cli/argv.js";

// The CLI needs ~1.2–2s to produce the full status JSON on a cold start, and
// more under load. Keep generous headroom so a slow CLI never collapses the
// status line to "spec-driven".
export const OPENSPEC_STATUS_TIMEOUT_MS = 10_000;

/**
 * The argv used to query one change's status: `status --json --change <name>`.
 *
 * Built through the shared {@link buildArgv} so flag scoping stays in one
 * place. `openspec status` rejects `--no-interactive` (and `--allow-unknown`),
 * and a rejected flag makes the CLI exit 1 — which used to blank out the whole
 * status line (schema fell back to "spec-driven", artifacts to `[]`). The
 * builder silently drops flags the subcommand does not accept.
 *
 * Exported so `test/status-query.test.ts` can assert the exact argv against
 * the real command tree of the bundled CLI.
 */
export function statusQueryArgv(changeName: string): string[] {
  return buildArgv({
    subcommand: "status",
    change: changeName,
    json: true,
    noInteractive: true,
  }).argv;
}

export async function runOpenspecStatus(
  changeName: string,
  cwd: string,
): Promise<StatusJson | null> {
  const result = await runOpenspec({
    argv: statusQueryArgv(changeName),
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
