// src/parser.ts
import type { ParsedBashCommand } from "./types.js";

const LOCKING_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "new", "status", "apply", "archive", "verify",
  "sync", "instructions", "show", "validate", "context", "view",
]);

export function isLockingSubcommand(sub: string): boolean {
  return LOCKING_SUBCOMMANDS.has(sub);
}
