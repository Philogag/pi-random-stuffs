// src/state.ts
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface PersistedLock {
  spec: string;
  worktree?: string;
  manualLock: boolean;
  version: 1;
}

export const LOCK_CUSTOM_TYPE = "pi-tui-openspec-status";

function isPersistedLock(data: unknown): data is PersistedLock {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.version === 1 && typeof d.spec === "string" && typeof d.manualLock === "boolean";
}

export function findLastPersistedLock(entries: SessionEntry[]): PersistedLock | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e) continue;
    if (e.type === "custom" && e.customType === LOCK_CUSTOM_TYPE) {
      const data = e.data;
      if (isPersistedLock(data)) return data;
      return null; // latest matching entry is dirty — stop, fall back to empty
    }
  }
  return null;
}
