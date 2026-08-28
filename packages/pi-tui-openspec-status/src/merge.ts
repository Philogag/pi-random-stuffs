// src/merge.ts
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { ArtifactStatus, MergedTasks, StatusJson } from "./types.js";

const CHECKED_RE = /^\s*-\s*\[(x|done)\]\s+(\S+)/i;
const UNCHECKED_RE = /^\s*-\s*\[( |)\]\s+(\S+)/;
const ANY_TASK_RE = /^\s*-\s*\[[ xX]\]?\s*(\S+)/;

export function parseTasksFile(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const line of text.split(/\r?\n/)) {
    let m: RegExpExecArray | null;
    if ((m = CHECKED_RE.exec(line))) {
      out.set(m[2]!, true);
      continue;
    }
    if ((m = UNCHECKED_RE.exec(line))) {
      out.set(m[2]!, false);
      continue;
    }
    if ((m = ANY_TASK_RE.exec(line))) {
      // Fallback: line that looks like a task but didn't match above;
      // default to unchecked if not already present.
      if (!out.has(m[1]!)) out.set(m[1]!, false);
    }
  }
  return out;
}

export function mergeTasks(
  main: Map<string, boolean>,
  worktree: Map<string, boolean>,
): MergedTasks {
  const keys = new Set<string>([...main.keys(), ...worktree.keys()]);
  let done = 0;
  for (const k of keys) {
    if (main.get(k) === true || worktree.get(k) === true) done++;
  }
  return { done, total: keys.size };
}

/**
 * Read tasks.md from `p`, returning an empty Map on any failure.
 * Use this so that a missing file is "no tasks here", not a fatal
 * error that aborts the whole merge.
 */
async function readTasksMap(p: string): Promise<Map<string, boolean>> {
  try {
    const text = await readFile(p, "utf8");
    return parseTasksFile(text);
  } catch {
    return new Map();
  }
}

/**
 * Read tasks.md from both main repo and (optional) worktree,
 * parse & merge.
 *
 * Each source is read independently — a missing tasks.md in main does
 * NOT suppress the worktree's tasks (and vice versa). The caller
 * (`render`) decides whether missing change folders overall mean
 * "unlock"; this function only merges whatever it can find.
 */
export async function readMergedTasks(
  changeName: string,
  mainRepoRoot: string,
  worktreeCwd?: string,
): Promise<MergedTasks> {
  const mainMap = await readTasksMap(
    path.join(mainRepoRoot, "openspec", "changes", changeName, "tasks.md"),
  );
  const wtMap = worktreeCwd
    ? await readTasksMap(
        path.join(worktreeCwd, "openspec", "changes", changeName, "tasks.md"),
      )
    : new Map();
  return mergeTasks(mainMap, wtMap);
}

// Canonical artifact order in the status line.
const ARTIFACT_ORDER: ArtifactStatus["id"][] = [
  "proposal",
  "design",
  "specs",
  "tasks",
];

/**
 * Union multiple artifact-status lists. Per id:
 * - "done" wins over any other status (union of completed work)
 * - otherwise keep the first non-empty status we see
 * Output is de-duped by id and emitted in canonical order, with any
 * unknown ids appended at the end.
 */
export function mergeArtifactStatuses(
  lists: ReadonlyArray<ReadonlyArray<ArtifactStatus> | undefined | null>,
): ArtifactStatus[] {
  const out = new Map<ArtifactStatus["id"], ArtifactStatus["status"]>();
  const orderedIds: ArtifactStatus["id"][] = [...ARTIFACT_ORDER];

  // Pass 1: canonical ids in canonical order
  for (const id of ARTIFACT_ORDER) {
    for (const list of lists) {
      if (!list) continue;
      const hit = list.find((a) => a.id === id);
      if (!hit) continue;
      const cur = out.get(id);
      if (!cur || hit.status === "done") out.set(id, hit.status);
    }
  }

  // Pass 2: any non-canonical ids, in first-seen order
  for (const list of lists) {
    if (!list) continue;
    for (const a of list) {
      if (orderedIds.includes(a.id)) continue;
      orderedIds.push(a.id);
      const cur = out.get(a.id);
      if (!cur || a.status === "done") out.set(a.id, a.status);
    }
  }

  return orderedIds
    .filter((id) => out.has(id))
    .map((id) => ({ id, status: out.get(id)! }));
}

/**
 * Merge multiple StatusJson results (e.g. from main + worktree scans).
 * - schemaName: first non-empty wins
 * - applied: true if any source says true
 * - artifacts: union via mergeArtifactStatuses
 * Returns null when ALL inputs are null.
 */
export function mergeStatusResults(
  results: ReadonlyArray<StatusJson | null>,
): StatusJson | null {
  const valid = results.filter((r): r is StatusJson => r !== null);
  if (valid.length === 0) return null;
  const schemaName = valid.find((r) => typeof r.schemaName === "string")
    ?.schemaName;
  const applied = valid.some((r) => r.applied === true);
  return {
    schemaName,
    applied,
    artifacts: mergeArtifactStatuses(valid.map((r) => r.artifacts)),
  };
}
