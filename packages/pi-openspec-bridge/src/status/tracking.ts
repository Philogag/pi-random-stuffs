// src/status/tracking.ts
//
// Map an `openspec` TOOL call to the change the status bar should track.
//
// This is the tool-era replacement for parsing `openspec …` out of a bash
// command: params are already structured, so no tokenizer is needed.
// The bash parser is kept as well (status/parser.ts) so muscle-memory
// `openspec status --change foo` through the shell still locks the bar.

import type { OpenspecSubcommand, OpenspecToolParams } from "../cli/schema.js";

/**
 * Subcommands that identify one concrete change/spec, so the status bar
 * should follow them. Read-only list/global commands are excluded on purpose:
 * `list` must not steal the tracked change.
 */
const TRACKING_SUBCOMMANDS: ReadonlySet<OpenspecSubcommand> = new Set([
  "new change",
  "archive",
  "validate",
  "show",
  "status",
  "instructions",
  "context",
  "view",
  "change show",
  "change validate",
  "spec show",
  "spec validate",
]);

export interface TrackedTarget {
  /** Change (or spec) name to track, when the call names one. */
  change?: string;
  /** Explicit spec root passed to the tool, when it differs from the cwd. */
  root?: string;
}

/**
 * Positional index holding the item name, per subcommand.
 * `new change <name>`, `archive [change-name]`, `show [item-name]`, …
 */
const POSITIONAL_INDEX: Partial<Record<OpenspecSubcommand, number>> = {
  "new change": 0,
  archive: 0,
  validate: 0,
  show: 0,
  "spec show": 0,
  "spec validate": 0,
  "change show": 0,
  "change validate": 0,
};

function firstNonFlag(value: string | number | boolean | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function trackTarget(params: OpenspecToolParams): TrackedTarget {
  const out: TrackedTarget = {};

  const root = firstNonFlag(params.root);
  if (root) out.root = root;

  const sub = params.subcommand;
  if (!sub || !TRACKING_SUBCOMMANDS.has(sub)) return out;

  // `--change` wins: it is unambiguous when it is present.
  const viaFlag = firstNonFlag(params.change);
  if (viaFlag) {
    out.change = viaFlag;
    return out;
  }

  const index = POSITIONAL_INDEX[sub];
  const args = params.args ?? [];
  if (index !== undefined) {
    const positional = firstNonFlag(args[index]);
    if (positional) out.change = positional;
  }
  return out;
}
