// src/types.ts
export interface ArtifactStatus {
  id: "proposal" | "design" | "specs" | "tasks";
  /**
   * `unknown` is a client-side state only: the CLI never emits it. The status
   * bar uses it when the status query failed, so the line can say "we do not
   * know" instead of inventing a state.
   */
  status: "done" | "ready" | "blocked" | "skipped" | "unknown";
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
