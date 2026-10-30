// src/cli/argv.ts
//
// Turn structured tool params into the exact argv the OpenSpec binary
// expects. Pure and side-effect free so it is trivially unit-testable.

import {
  FLAGS,
  OPENSPEC_SUBCOMMANDS,
  type OpenspecSubcommand,
  type OpenspecToolParams,
} from "./schema.js";

export class OpenspecArgvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenspecArgvError";
  }
}

const KNOWN = new Set<string>(OPENSPEC_SUBCOMMANDS);

export function isKnownSubcommand(value: string): value is OpenspecSubcommand {
  return KNOWN.has(value);
}

export interface BuiltArgv {
  /** argv without the binary, e.g. ["list", "--json"]. */
  argv: string[];
  /** Subcommand used, for logging/telemetry in details. */
  subcommand: OpenspecSubcommand;
}

/**
 * Build the CLI argv from tool params.
 *
 * Order: subcommand tokens → positionals → flags (in FLAGS order). Flags
 * only fire when the caller actually passed them, so no default sneaks in.
 * Unknown keys are rejected instead of silently forwarded: the model then
 * sees a correction instead of a confusing binary error.
 */
export function buildArgv(params: OpenspecToolParams): BuiltArgv {
  const subcommand = params.subcommand;
  if (typeof subcommand !== "string" || !isKnownSubcommand(subcommand)) {
    throw new OpenspecArgvError(
      `Unknown openspec subcommand: ${String(subcommand)}. Known subcommands: ${[...OPENSPEC_SUBCOMMANDS].join(", ")}`,
    );
  }

  const argv = subcommand.split(" ");

  const positionals = params.args ?? [];
  if (!Array.isArray(positionals)) {
    throw new OpenspecArgvError("`args` must be an array of strings.");
  }
  for (const value of positionals) {
    if (typeof value !== "string") {
      throw new OpenspecArgvError("`args` must contain only strings.");
    }
    argv.push(value);
  }

  const knownKeys = new Set<string>(["subcommand", "args", "root"]);
  for (const spec of FLAGS) knownKeys.add(spec.key);
  for (const key of Object.keys(params)) {
    if (!knownKeys.has(key)) {
      throw new OpenspecArgvError(
        `Unknown parameter: ${key}. Use \`args\` for positionals or one of the documented flags.`,
      );
    }
  }

  for (const spec of FLAGS) {
    if (!spec.flag) continue;
    // Not every subcommand accepts every flag (e.g. `status` rejects
    // `--allow-unknown`/`--no-interactive`). When a flag is scoped to
    // other subcommands, silently drop it here rather than let the binary
    // fail with an "unknown option" error.
    if (spec.appliesTo && !spec.appliesTo.includes(subcommand)) continue;
    const raw = (params as Record<string, unknown>)[spec.key];
    if (raw === undefined || raw === null) continue;

    if (spec.kind === "boolean") {
      if (raw === true) argv.push(spec.flag);
      continue;
    }

    if (spec.kind === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw new OpenspecArgvError(`\`${spec.key}\` must be a finite number.`);
      }
      argv.push(spec.flag, String(raw));
      continue;
    }

    if (typeof raw !== "string") {
      throw new OpenspecArgvError(`\`${spec.key}\` must be a string.`);
    }
    if (raw.length === 0) continue; // empty string = "not set"
    argv.push(spec.flag, raw);
  }

  return { argv, subcommand };
}
