// src/status/project-schema.ts
//
// Fallback schema lookup for the status bar.
//
// The authoritative schema name comes from `openspec status --json`
// (`schemaName`). When that query fails — CLI missing, timeout, archived
// change — the bar must not fabricate a name (it used to print a hardcoded
// `spec-driven`, which is a lie on any project with a custom schema). Instead
// it reads the same two files the CLI reads, in the same priority order:
//
//   1. `openspec/changes/<name>/.openspec.yaml` — per-change pin, created by
//      `openspec new change`;
//   2. `openspec/config.yaml` — project default.
//
// All reads are best-effort: a missing or unparsable file is simply skipped.

import { readFile } from "node:fs/promises";
import * as path from "node:path";

/** `schema: <name>` at the start of a line (YAML top-level scalar). */
const SCHEMA_LINE_RE = /^\s*schema:\s*("[^"]*"|'[^']*'|[^\s#]+)/m;

/** Pull the `schema:` value out of an OpenSpec YAML file. */
export function parseSchemaName(text: string): string | undefined {
  const match = SCHEMA_LINE_RE.exec(text);
  const raw = match?.[1]?.trim();
  if (!raw) return undefined;
  const unquoted = raw.replace(/^["']|["']$/g, "").trim();
  return unquoted.length > 0 ? unquoted : undefined;
}

async function readSchemaFrom(file: string): Promise<string | undefined> {
  try {
    return parseSchemaName(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Resolve the schema name from the project files, trying every root in order
 * (main checkout first, then a worktree).
 *
 * Change-local pins win over project defaults across ALL roots: a worktree
 * that pins the change explicitly should not be overruled by the main
 * checkout's project config.
 */
export async function readSchemaName(
  changeName: string,
  roots: ReadonlyArray<string | undefined>,
): Promise<string | undefined> {
  const live = roots.filter((r): r is string => Boolean(r));
  const candidates = [
    ...live.map((root) =>
      path.join(root, "openspec", "changes", changeName, ".openspec.yaml"),
    ),
    ...live.map((root) => path.join(root, "openspec", "config.yaml")),
  ];
  for (const candidate of candidates) {
    const name = await readSchemaFrom(candidate);
    if (name) return name;
  }
  return undefined;
}
