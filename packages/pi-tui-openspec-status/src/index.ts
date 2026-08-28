// src/index.ts
import { runOpenspecStatus } from "./openspec.js";
import { readMergedTasks } from "./merge.js";
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

export default function piTuiOpenspecStatus(pi: PiLike, ctx?: ExtensionContextLike) {
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

  let lockedChange: string | undefined;
  let effectiveCwd = "";
  let lastRendered = "";
  let pending: ReturnType<typeof setTimeout> | undefined;

  const render = async () => {
    pending = undefined;
    if (!lockedChange) return;
    try {
      const cwd = effectiveCwd || ctx.cwd;
      const status = await runOpenspecStatus(lockedChange, cwd);
      const tasks = await readMergedTasks(
        lockedChange,
        ctx.cwd,
        effectiveCwd || undefined,
      );
      const line = renderLine(
        lockedChange,
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
    pending = setTimeout(render, SET_STATUS_DEBOUNCE_MS);
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
    if (parsed.isWorktree) effectiveCwd = parsed.effectiveCwd;
    if (parsed.isLocking && parsed.changeName) {
      lockedChange = parsed.changeName;
      schedule();
    }
  });

  pi.on("tool_result", () => {
    if (lockedChange) schedule();
  });
}