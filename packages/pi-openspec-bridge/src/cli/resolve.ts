// src/cli/resolve.ts
//
// Locate the OpenSpec binary that this extension wraps.
//
// Resolution order (first hit wins):
//   1. `PI_OPENSPEC_BIN` / `OPENSPEC_BIN` env override (absolute path to a
//      JS entry, e.g. an `openspec` shim or a checkout).
//   2. The `@fission-ai/openspec` package bundled as this extension's
//      dependency → `<pkg root>/bin/openspec.js` (run with the current node).
//   3. `openspec` on PATH (system install, e.g. the Chinese fork).
//
// The bundled dependency wins over PATH so the tool keeps working even when
// no global CLI is installed — that is the whole point of "wrapping" it.

import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

export interface ResolvedBinary {
  /** Executable to spawn. */
  command: string;
  /** Arguments that must precede the CLI argv. */
  prefixArgs: string[];
  /** Where the resolution came from, for diagnostics. */
  source: "env" | "bundled" | "path";
  /** Human-readable description of the resolved entry. */
  label: string;
}

export const BUNDLED_PACKAGE = "@fission-ai/openspec";
export const ENV_OVERRIDES = ["PI_OPENSPEC_BIN", "OPENSPEC_BIN"] as const;

function isExecutableFile(p: string): boolean {
  try {
    accessSync(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the package root of the bundled dependency.
 *
 * `exports` in the OpenSpec package.json does not expose `./bin/openspec.js`
 * or `./package.json`, so `require.resolve` can only reach the entry point
 * (`<root>/dist/index.js`). Walk one level up from it.
 */
export function resolveBundledBin(): string | undefined {
  const require = createRequire(import.meta.url);
  const candidates: string[] = [];

  try {
    const entry = require.resolve(BUNDLED_PACKAGE);
    candidates.push(path.join(path.dirname(path.dirname(entry)), "bin", "openspec.js"));
  } catch {
    // package not installed — fall through to PATH
  }

  // Fallback for layouts where resolution fails but the package is present
  // next to this extension (pnpm symlinks, vendored builds).
  const here = path.dirname(new URL(import.meta.url).pathname);
  candidates.push(
    path.join(here, "..", "..", "node_modules", BUNDLED_PACKAGE, "bin", "openspec.js"),
    path.join(here, "..", "..", "..", "node_modules", BUNDLED_PACKAGE, "bin", "openspec.js"),
  );

  return candidates.find(isExecutableFile);
}

/** True when `command` is a plain path that exists (not a bare name). */
function looksLikePath(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

export function resolveBinary(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBinary {
  for (const key of ENV_OVERRIDES) {
    const value = env[key];
    if (!value) continue;
    if (looksLikePath(value)) {
      return {
        command: process.execPath,
        prefixArgs: [value],
        source: "env",
        label: `${key}=${value}`,
      };
    }
    return {
      command: value,
      prefixArgs: [],
      source: "env",
      label: `${key}=${value}`,
    };
  }

  const bundled = resolveBundledBin();
  if (bundled) {
    return {
      command: process.execPath,
      prefixArgs: [bundled],
      source: "bundled",
      label: bundled,
    };
  }

  return {
    command: "openspec",
    prefixArgs: [],
    source: "path",
    label: "openspec (PATH)",
  };
}
