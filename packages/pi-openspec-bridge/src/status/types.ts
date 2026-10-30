// src/types.ts
export interface ArtifactStatus {
  id: "proposal" | "design" | "specs" | "tasks";
  status: "done" | "ready" | "blocked" | "skipped";
}

export interface StatusJson {
  artifacts?: ArtifactStatus[];
  applied?: boolean;
  schemaName?: string;
  // Forward-compatible: additional fields allowed.
  [key: string]: unknown;
}

export interface ParsedBashCommand {
  subcommand: string;
  changeName?: string;
  effectiveCwd: string;
  isWorktree: boolean;
  isLocking: boolean;
}

export interface MergedTasks {
  done: number;
  total: number;
}
