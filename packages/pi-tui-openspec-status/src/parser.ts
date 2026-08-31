// src/parser.ts
import type { ParsedBashCommand } from "./types.js";

const LOCKING_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "new", "status", "apply", "archive", "verify",
  "sync", "instructions", "show", "validate", "context", "view",
]);

// `openspec new` takes a depth-2 verb: `new change <name>` or `new spec <name>`.
// `new` alone (e.g. `openspec new --help`) has no name token.
const NEW_SUBVERBS: ReadonlySet<string> = new Set(["change", "spec"]);

export function isLockingSubcommand(sub: string): boolean {
  return LOCKING_SUBCOMMANDS.has(sub);
}

const CONNECTORS = new Set(["&&", "||", "|", ";"]);

/**
 * Split a bash command string into a flat token list.
 * Supports quoted strings ("…" or '…') as single tokens.
 * Honors && || | ; connectors by emitting them as separators (kept out).
 */
export function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        buf += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (buf) {
        tokens.push(buf);
        buf = "";
      }
      continue;
    }
    if (CONNECTORS.has(buf + c) || CONNECTORS.has(c)) {
      if (buf) {
        tokens.push(buf);
        buf = "";
      }
      // Peek two-char connectors
      const next = cmd[i + 1];
      if ((c === "&" || c === "|") && next === c) {
        i++; // skip second char
      }
      continue;
    }
    buf += c;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/**
 * From a token list starting with the openspec subcommand
 * (e.g. ["status", "--change", "add-foo", "--json"]),
 * find the change name. Skips the leading subcommand token(s).
 *
 * Special-cases `new`: its sub-verb (`change` | `spec`) sits between the
 * subcommand and the name, so we skip 2 tokens for `openspec new change foo`
 * but only 1 for `openspec status --change foo` / `openspec archive foo`.
 */
export function extractChangeName(tokens: string[]): string | undefined {
  if (tokens.length === 0) return undefined;
  let start = 1;
  if (
    tokens[0] === "new" &&
    tokens.length >= 2 &&
    NEW_SUBVERBS.has(tokens[1]!)
  ) {
    start = 2;
  }
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i] === "--change") {
      const v = tokens[i + 1];
      if (v && !v.startsWith("--")) return v;
      continue;
    }
    if (tokens[i]?.startsWith("--")) continue; // other flag
    // first positional
    if (tokens[i]) return tokens[i];
  }
  return undefined;
}

/**
 * Find the last `cd <path>` in a token sequence and return the path.
 * Walks all tokens looking for "cd" followed by a non-flag arg.
 */
function lastCdTarget(tokens: string[]): string | undefined {
  let last: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "cd" && tokens[i + 1] && !tokens[i + 1]!.startsWith("--")) {
      last = tokens[i + 1];
      i++; // skip path
    }
  }
  return last;
}

const WORKTREE_RE = /\.worktrees\/([^/\s]+)/;

/**
 * Parse a bash command line.
 * Returns null when the command is not an `openspec` invocation.
 * Recognizes `openspec` anywhere in the pipeline (after `cd X &&`, etc.)
 * so that worktree prefixes are honored.
 */
export function parseBashCommand(cmd: string): ParsedBashCommand | null {
  const tokens = tokenize(cmd);
  if (tokens.length === 0) return null;

  const openspecIdx = tokens.indexOf("openspec");
  if (openspecIdx === -1) return null;

  const subcommand = tokens[openspecIdx + 1] ?? "";
  // rest includes the subcommand itself; extractChangeName will skip it.
  const rest = tokens.slice(openspecIdx + 1);
  // Scan the prefix (everything before `openspec`) for the last `cd <path>`.
  const cd = lastCdTarget(tokens.slice(0, openspecIdx));

  const effectiveCwd = cd ?? "";
  const isWorktree = !!effectiveCwd && WORKTREE_RE.test(effectiveCwd);
  const isLocking = isLockingSubcommand(subcommand);
  const changeName = isLocking ? extractChangeName(rest) : undefined;

  return {
    subcommand,
    changeName,
    effectiveCwd,
    isWorktree,
    isLocking,
  };
}

/**
 * Extract the change name from a bash command line, when the command
 * is an openspec invocation that locks a change (e.g. `openspec status
 * --change foo` / `openspec new change foo`). Returns null for
 * non-locking commands (list, doctor, …) and non-openspec commands.
 */
export function findSpec(cmd: string): string | null {
  const parsed = parseBashCommand(cmd);
  if (!parsed) return null;
  return parsed.isLocking && parsed.changeName ? parsed.changeName : null;
}

/**
 * Extract the worktree cwd from a bash command line, when the command
 * runs inside a worktree (`cd <wt> && openspec …`). Returns null
 * otherwise.
 */
export function findWorkTree(cmd: string): string | null {
  const parsed = parseBashCommand(cmd);
  if (!parsed) return null;
  return parsed.isWorktree ? parsed.effectiveCwd : null;
}
