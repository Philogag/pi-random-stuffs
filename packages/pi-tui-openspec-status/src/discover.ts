// src/discover.ts
import { readdir } from "node:fs/promises";
import * as path from "node:path";

/**
 * List active (non-archived) openspec change names under
 * `<openspecRoot>/openspec/changes/`. Stable-sorted; excludes the
 * `archive` directory. Returns [] when the directory is
 * missing/unreadable.
 */
export async function listActiveChanges(
  openspecRoot: string,
): Promise<string[]> {
  const changesDir = path.join(openspecRoot, "openspec", "changes");
  let entries;
  try {
    entries = await readdir(changesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== "archive")
    .map((e) => e.name)
    .sort();
}
