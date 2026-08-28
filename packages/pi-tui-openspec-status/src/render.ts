// src/render.ts
import type { ArtifactStatus, MergedTasks } from "./types.js";

export const ARTIFACT_INITIALS: Record<ArtifactStatus["id"], string> = {
  proposal: "P",
  design: "D",
  specs: "S",
  tasks: "T",
};

const BAR_WIDTH = 10;
const FILLED = "█";
const EMPTY = "░";

export function formatArtifactTokens(statuses: ArtifactStatus[]): string {
  return statuses
    .filter((s): s is ArtifactStatus => s.id in ARTIFACT_INITIALS)
    .map((s) => `${ARTIFACT_INITIALS[s.id]}${s.status === "done" ? "●" : "○"}`)
    .join(" ");
}

export function formatProgressBar(done: number, total: number): string {
  const d = Math.max(0, Math.min(done, total));
  const filledCells = total === 0 ? 0 : Math.round((d / total) * BAR_WIDTH);
  return FILLED.repeat(filledCells) + EMPTY.repeat(BAR_WIDTH - filledCells);
}

export function renderLine(
  name: string,
  schemaName: string,
  statuses: ArtifactStatus[],
  tasks: MergedTasks,
): string {
  return [
    name,
    `(${schemaName})`,
    `[${formatArtifactTokens(statuses)}]`,
    "Tasks:",
    `${formatProgressBar(tasks.done, tasks.total)} ${tasks.done}/${tasks.total}`,
  ].join(" ");
}
