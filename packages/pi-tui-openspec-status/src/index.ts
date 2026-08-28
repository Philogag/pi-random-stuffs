// src/index.ts
import { access } from "node:fs/promises";
import * as path from "node:path";
import { runOpenspecStatus } from "./openspec.js";
import { listActiveChanges } from "./discover.js";
import { mergeStatusResults, readMergedTasks } from "./merge.js";
import { parseBashCommand } from "./parser.js";
import { renderLine } from "./render.js";

export const EXTENSION_ID = "pi-tui-openspec-status";
export const SET_STATUS_DEBOUNCE_MS = 500;

type PiMode = "tui" | "rpc" | "json" | "print";

interface ExtensionContextLike {
  mode: PiMode;
  hasUI: boolean;
  cwd: string;
  ui: {
    setStatus(extensionId: string, text: string | undefined): void;
  };
}

interface PiLike {
  on(event: "session_start", handler: () => void): void;
  on(
    event: "tool_call",
    handler: (event: unknown) => Promise<void> | void,
  ): void;
  on(
    event: "tool_result",
    handler: (event: unknown) => Promise<void> | void,
  ): void;
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (
        args: string,
        cmdCtx: {
          cwd: string;
          ui: {
            select(
              prompt: string,
              items: string[],
            ): Promise<string | undefined>;
          };
        },
      ) => Promise<void> | void;
    },
  ): void;
}

interface BashToolCallInput {
  type?: string;
  command?: string;
  cwd?: string;
}

function isBashInput(e: unknown): e is { input: BashToolCallInput } {
  return (
    typeof e === "object" &&
    e !== null &&
    "input" in (e as Record<string, unknown>)
  );
}

export interface PiTuiOpenspecStatusOptions {
  /**
   * Override the render debounce window (ms). Defaults to
   * {@link SET_STATUS_DEBOUNCE_MS}. Tests typically pass a small value
   * (e.g. 0) to skip debouncing entirely.
   */
  debounceMs?: number;
}

export default function piTuiOpenspecStatus(
  pi: PiLike,
  ctx?: ExtensionContextLike,
  options: PiTuiOpenspecStatusOptions = {},
) {
  // D9: TUI-mode exclusive activation. When pi is not running in its
  // interactive terminal mode, the extension is COMPLETELY INACTIVE.
  // We early-return WITHOUT registering any event listeners, starting
  // any resources, or touching internal state. This satisfies the
  // spec Requirement "TUI 模式独占激活". We use ctx.mode (NOT
  // ctx.hasUI) because hasUI is true for both tui and rpc — using
  // hasUI would wrongly activate in rpc mode.
  //
  // Defensive: pi's extension loader MAY invoke the factory with
  // ctx === undefined when loading via `-e` (e.g. `pi -p -e path`).
  // In that case, mode is also undefined, so `ctx?.mode !== "tui"`
  // is the safest gate.
  if (ctx?.mode !== "tui") return;

  const debounceMs = options.debounceMs ?? SET_STATUS_DEBOUNCE_MS;

  let lockedChange: string | undefined;
  let manualLock = false;
  let effectiveCwd = "";
  let lastRendered = "";
  let pending: ReturnType<typeof setTimeout> | undefined;

  const render = async () => {
    pending = undefined;
    if (!lockedChange) return;
    try {
      const name = lockedChange;
      const mainCwd = ctx.cwd;
      const wtCwd = effectiveCwd || "";

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
      // unlock — see the R unlock conditions.
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

      if (aliveSources.length === 0) {
        // Fully archived (or all worktrees removed): release the lock.
        lockedChange = undefined;
        effectiveCwd = "";
        manualLock = false;
        if (lastRendered !== "") {
          lastRendered = "";
          ctx.ui.setStatus(EXTENSION_ID, undefined);
        }
        return;
      }

      // Query each alive source in parallel; merge artifacts/schema.
      const [statusResults, tasks] = await Promise.all([
        Promise.all(
          aliveSources.map((s) => runOpenspecStatus(name, s.cwd)),
        ),
        readMergedTasks(name, mainCwd, wtCwd || undefined),
      ]);
      const status = mergeStatusResults(statusResults);

      const line = renderLine(
        name,
        (status?.schemaName as string) || "spec-driven",
        (status?.artifacts ?? []) as never,
        tasks,
      );
      if (line === lastRendered) return;
      lastRendered = line;
      ctx.ui.setStatus(EXTENSION_ID, line);
    } catch {
      // swallow — see R 错误处理与无副作用
    }
  };

  const schedule = () => {
    if (pending) return;
    pending = setTimeout(render, debounceMs);
  };

  pi.on("session_start", () => {
    lastRendered = "";
    ctx.ui.setStatus(EXTENSION_ID, undefined);
  });

  pi.on("tool_call", (event) => {
    if (!isBashInput(event) || event.input?.type !== "bash") return;
    const cmd = event.input.command;
    if (typeof cmd !== "string") return;
    const parsed = parseBashCommand(cmd);
    if (!parsed) return;
    if (parsed.isWorktree && parsed.effectiveCwd !== effectiveCwd) {
      effectiveCwd = parsed.effectiveCwd;
      schedule();
    }
    if (manualLock) return; // manual selection overrides auto-lock
    if (parsed.isLocking && parsed.changeName) {
      lockedChange = parsed.changeName;
      schedule();
    }
  });

  pi.on("tool_result", () => {
    if (lockedChange) schedule();
  });

  pi.registerCommand("tui-openspec-select", {
    description:
      "Manually select which openspec change the status bar tracks (None to clear)",
    handler: async (_args, cmdCtx) => {
      const changes = await listActiveChanges(cmdCtx.cwd);
      const choice = await cmdCtx.ui.select("Select spec to track:", [
        ...changes,
        "None",
      ]);
      if (choice === undefined) return; // cancelled — no side effects
      if (choice === "None") {
        manualLock = false;
        lockedChange = undefined;
        if (lastRendered !== "") {
          lastRendered = "";
          ctx.ui.setStatus(EXTENSION_ID, undefined);
        }
        return;
      }
      lockedChange = choice;
      manualLock = true;
      schedule();
    },
  });
}