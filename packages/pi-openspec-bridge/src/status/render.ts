// src/render.ts
import { access } from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runOpenspecStatus } from "./openspec.js";
import { readSchemaName } from "./project-schema.js";
import { mergeStatusResults, readMergedTasks } from "./merge.js";
import type { PersistedLock } from "./state.js";
import type { ArtifactStatus, MergedTasks } from "./types.js";

export const ARTIFACT_INITIALS: Record<ArtifactStatus["id"], string> = {
  proposal: "P",
  design: "D",
  specs: "S",
  tasks: "T",
};

/** Canonical artifact order for the `[P D S T]` group. */
export const ARTIFACT_IDS = ["proposal", "design", "specs", "tasks"] as const;

const BAR_WIDTH = 10;
const FILLED = "█";
const EMPTY = "░";

/**
 * Per-status glyph. `done` is the only filled dot; every other real state is
 * an empty dot (the CLI's "not done yet"); `unknown` — a state the CLI never
 * emits, set when the status query failed — is a dash, so a degraded line
 * never claims progress it does not know about.
 */
const SYMBOLS: Record<ArtifactStatus["status"], string> = {
  done: "●",
  ready: "○",
  blocked: "○",
  skipped: "○",
  unknown: "–",
};

/** Shown in place of a schema name when it cannot be resolved at all. */
export const UNKNOWN_SCHEMA = "?";

/**
 * Placeholder statuses for a failed status query: the canonical four slots,
 * all `unknown` → `[P– D– S– T–]`. Keeping the slots visible means the line
 * never shrinks to `[]` (which read like "no artifacts" instead of "no data").
 */
export function unknownArtifactStatuses(): ArtifactStatus[] {
  return ARTIFACT_IDS.map((id) => ({ id, status: "unknown" as const }));
}

export function formatArtifactTokens(
  statuses: ArtifactStatus[],
  /** Slots to render as `–` when absent from `statuses` (degraded renders). */
  placeholders: readonly ArtifactStatus["id"][] = [],
): string {
  const byId = new Map<ArtifactStatus["id"], ArtifactStatus>();
  for (const s of statuses) {
    if (s.id in ARTIFACT_INITIALS) byId.set(s.id, s);
  }
  // With placeholders the token group always covers the canonical four slots
  // in canonical order (CLI order is not part of the contract); without them
  // the CLI's order is preserved so callers keep full control.
  const ids: ArtifactStatus["id"][] =
    placeholders.length > 0
      ? [...ARTIFACT_IDS]
      : statuses.filter((s) => s.id in ARTIFACT_INITIALS).map((s) => s.id);
  const tokens: string[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    tokens.push(
      `${ARTIFACT_INITIALS[id]}${s ? (SYMBOLS[s.status] ?? "○") : SYMBOLS.unknown}`,
    );
  }
  return tokens.join(" ");
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
  /** Slots rendered as `–` when the CLI did not report them. */
  placeholders: readonly ArtifactStatus["id"][] = [],
): string {
  return [
    name,
    `(${schemaName})`,
    `[${formatArtifactTokens(statuses, placeholders)}]`,
    "Tasks:",
    `${formatProgressBar(tasks.done, tasks.total)} ${tasks.done}/${tasks.total}`,
  ].join(" ");
}

/**
 * Base class for debounced status-bar renders.
 *
 * The constructor is intentionally side-effect free: creating a render
 * instance must not publish anything to the status bar. Callers decide
 * when the initial "no status" publish happens (see the session_start
 * handler in index.ts). This matters for the lazy render path — a
 * cancelled `/tui-openspec-select` must leave the status bar untouched.
 */
export class StatusRender {
  id: string
  ctx: ExtensionContext
  timer: ReturnType<typeof setTimeout> | undefined
  debounce: number
  lastRendered = ""

  constructor(id: string, ctx: ExtensionContext, debounce = 500) {
    this.id = id;
    this.ctx = ctx;
    this.debounce = debounce;
  }

  async render() {
    this.timer = undefined;
    const text = (await this.renderText()).trim();
    if (text === this.lastRendered) return;
    this.lastRendered = text;
    if (text.length > 0)
      this.ctx.ui.setStatus(this.id, text);
    else
      this.ctx.ui.setStatus(this.id, undefined);
  }

  refresh() {
    if (!this.timer)
      // Arrow keeps `this` bound when the timer fires.
      this.timer = setTimeout(() => this.render(), this.debounce);
  }

  async renderText(): Promise<string> { return ""; }
}

/**
 * Renders the openspec change status bar line.
 *
 * Owns all tracking state (spec, worktree, manual lock) and the full
 * multi-source render pipeline: probe `openspec/changes/<name>` in each
 * source, query `openspec status --json` for the alive ones, merge
 * artifacts + tasks from main and worktree, then emit the line.
 *
 * The optional `onStateChange` callback receives a full
 * {@link PersistedLock} snapshot (or `null` when all sources are
 * gone) at every authoritative state transition. Fires occur after
 * the dedupe early-returns (i.e. only when state actually changed)
 * and from the auto-unlock branch of `renderText()`. Consumers
 * (e.g. the session-persistence layer wired in index.ts) use this
 * to publish the live lock state to pi's custom-message stream.
 */
export class OpenSpecStatusRender extends StatusRender {
  spec?: string;
  worktree?: string;
  manualLock = false;
  private readonly onStateChange:
    | ((state: PersistedLock | null) => void)
    | undefined;

  constructor(
    id: string,
    ctx: ExtensionContext,
    debounce = 500,
    onStateChange?: (state: PersistedLock | null) => void,
  ) {
    super(id, ctx, debounce);
    this.onStateChange = onStateChange;
  }

  /**
   * Auto-lock from a bash `openspec` command. No-op while a manual
   * lock (via /tui-openspec-select) is active.
   */
  setSpec(spec: string) {
    if (this.manualLock) return;
    if (this.spec === spec) return;
    this.spec = spec;
    this.onStateChange?.({
      spec: this.spec,
      worktree: this.worktree,
      manualLock: false,
      version: 1,
    });
    this.refresh();
  }

  /**
   * Adopt a worktree cwd (from `cd <worktree> && openspec ...`).
   * Always applies — even under a manual lock the worktree is an
   * additional scan source, not a change of the tracked spec.
   */
  setWorkTree(worktree: string) {
    if (this.worktree === worktree) return;
    this.worktree = worktree;
    // A worktree change without a tracked spec has no persistable
    // full lock snapshot (PersistedLock.spec is required); skip the
    // fire. The restore path only calls setWorkTree when a spec is
    // present, so no persisted state is lost.
    if (this.spec) {
      this.onStateChange?.({
        spec: this.spec,
        worktree: this.worktree,
        manualLock: this.manualLock,
        version: 1,
      });
    }
    this.refresh();
  }

  /** Manual lock via /tui-openspec-select: pins the tracked change. */
  lock(change: string) {
    this.manualLock = true;
    this.spec = change;
    this.onStateChange?.({
      spec: this.spec,
      worktree: this.worktree,
      manualLock: true,
      version: 1,
    });
    this.refresh();
  }

  /** Release the lock and clear the status bar (if a line is showing). */
  clearLock() {
    this.manualLock = false;
    this.spec = undefined;
    this.worktree = "";
    this.onStateChange?.(null);
    if (this.lastRendered !== "") {
      this.lastRendered = "";
      this.ctx.ui.setStatus(this.id, undefined);
    }
  }

  override async renderText(): Promise<string> {
    const name = this.spec;
    if (!name) return "";

    const mainCwd = this.ctx.cwd;
    const wtCwd = this.worktree ?? "";

    // Sources to scan, in priority order. Main is always scanned
    // (canonical source of truth). When a worktree is active, the
    // worktree is scanned in ADDITION to main — the displayed status
    // is the union of both.
    type Source = { cwd: string; kind: "main" | "worktree" };
    const sources: Source[] = [{ cwd: mainCwd, kind: "main" }];
    if (wtCwd) sources.push({ cwd: wtCwd, kind: "worktree" });

    // Probe each source's change folder in parallel. A missing folder
    // is "skip this source", not "fail the render". Only when ALL
    // sources are gone do we treat the change as fully archived and
    // unlock.
    const aliveFlags = await Promise.all(
      sources.map(async (s) => {
        const dir = path.join(s.cwd, "openspec", "changes", name);
        try {
          await access(dir);
          return true;
        } catch {
          return false;
        }
      }),
    );
    const aliveSources = sources.filter((_, i) => aliveFlags[i]);

    // Cleared or re-locked mid-render — never unlock or publish for a
    // stale change.
    if (this.spec !== name) return "";

    if (aliveSources.length === 0) {
      // Fully archived (or all worktrees removed): release the lock.
      this.spec = undefined;
      this.worktree = "";
      this.manualLock = false;
      this.onStateChange?.(null);
      return "";
    }

    // Query each alive source in parallel; merge artifacts/schema.
    const [statusResults, tasks] = await Promise.all([
      Promise.all(aliveSources.map((s) => runOpenspecStatus(name, s.cwd))),
      readMergedTasks(name, mainCwd, wtCwd || undefined),
    ]);

    // Cleared or re-locked while the queries were in flight.
    if (this.spec !== name) return "";

    const status = mergeStatusResults(statusResults);
    if (!status) {
      // Degraded render: the query failed for every alive source, so we know
      // nothing about artifacts. Report "unknown" (`[P– D– S– T–]`) and read
      // the schema name from the project files instead of hardcoding
      // `spec-driven` — which is wrong on any project with a custom schema and
      // was exactly what made a broken query look like a working status bar.
      const schemaName =
        (await readSchemaName(name, [mainCwd, wtCwd || undefined])) ??
        UNKNOWN_SCHEMA;
      if (this.spec !== name) return "";
      return renderLine(name, schemaName, unknownArtifactStatuses(), tasks);    }

    return renderLine(
      name,
      (status.schemaName as string) ||
        (await readSchemaName(name, [mainCwd, wtCwd || undefined])) ||
        UNKNOWN_SCHEMA,
      (status.artifacts ?? []) as never,
      tasks,
      ARTIFACT_IDS,
    );
  }
}
