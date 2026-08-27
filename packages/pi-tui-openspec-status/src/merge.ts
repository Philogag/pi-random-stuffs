// src/merge.ts
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { MergedTasks } from "./types.js";

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
 * Read tasks.md from both main repo and (optional) worktree,
 * parse & merge. Returns { done: 0, total: 0 } on any read failure.
 */
export async function readMergedTasks(
  changeName: string,
  mainRepoRoot: string,
  worktreeCwd?: string,
): Promise<MergedTasks> {
  try {
    const mainPath = path.join(
      mainRepoRoot,
      "openspec",
      "changes",
      changeName,
      "tasks.md",
    );
    const mainText = await readFile(mainPath, "utf8");
    const mainMap = parseTasksFile(mainText);
    if (!worktreeCwd) {
      return mergeTasks(mainMap, new Map());
    }
    const wtPath = path.join(worktreeCwd, "openspec", "changes", changeName, "tasks.md");
    let wtMap = new Map<string, boolean>();
    try {
      const wtText = await readFile(wtPath, "utf8");
      wtMap = parseTasksFile(wtText);
    } catch {
      // worktree tasks.md may not exist; treat as empty
    }
    return mergeTasks(mainMap, wtMap);
  } catch {
    return { done: 0, total: 0 };
  }
}
