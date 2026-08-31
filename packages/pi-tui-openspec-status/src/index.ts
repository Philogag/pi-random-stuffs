// src/index.ts
import { listActiveChanges } from "./discover.js";
import { findSpec, findWorkTree } from "./parser.js";
import { OpenSpecStatusRender } from "./render.js";
import {
  findLastPersistedLock,
  LOCK_CUSTOM_TYPE,
  type PersistedLock,
} from "./state.js";
import {
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export const EXTENSION_ID = "pi-tui-openspec-status";
export const SET_STATUS_DEBOUNCE_MS = 500;

export interface PiTuiOpenspecStatusOptions {
  /**
   * Override the render debounce window (ms). Defaults to
   * {@link SET_STATUS_DEBOUNCE_MS}. Tests typically pass a small value
   * (e.g. 0) to skip debouncing entirely.
   */
  debounceMs?: number;
}

/**
 * Wire the OpenSpec status bar into pi.
 *
 * Thin wiring layer: all tracking state and the render pipeline live
 * in {@link OpenSpecStatusRender}; this module only connects pi events
 * to it. A single render instance is created at session_start (or
 * lazily by the select command, which may run without session_start in
 * tests) and reused for the whole session.
 *
 * Lock persistence: every authoritative state change (lock / auto-lock
 * / worktree / clear / auto-unlock) is mirrored into the session file
 * via `pi.appendEntry(LOCK_CUSTOM_TYPE, snapshot)` — custom entries do
 * NOT participate in LLM context. On session_start (including
 * `/resume`, where pi reloads the extension with a fresh instance) the
 * last matching entry is read back via `findLastPersistedLock()` and
 * the render is rebuilt with the same lock type (manual vs auto), so
 * the status bar survives restarts instead of going empty.
 *
 * The extension factory receives ONLY `ExtensionAPI` (see
 * https://pi.dev/docs/latest/extensions) — there is no ctx at load
 * time, so the mode is unknown until the first event fires. Handlers
 * are therefore registered unconditionally, and the TUI gate
 * (`ctx.mode === "tui"`) runs inside session_start — the first event
 * that carries a real ExtensionContext. Until then every event is a
 * no-op because no render exists yet.
 */
export default function (
  pi: ExtensionAPI,
  options: PiTuiOpenspecStatusOptions = {},
): void {
  const debounceMs = options.debounceMs ?? SET_STATUS_DEBOUNCE_MS;
  let render: OpenSpecStatusRender | undefined;

  /**
   * Persist a lock snapshot to the session file. `null` (or an
   * all-cleared state) is stored as an explicit "no lock" entry so
   * that a later resume restores the empty state instead of a stale
   * lock. Persistence is best-effort: appendEntry failures must never
   * propagate into the extension's render path (D12).
   */
  const persistLock = (state: PersistedLock | null) => {
    try {
      pi.appendEntry(LOCK_CUSTOM_TYPE, state ?? {
        spec: "",
        manualLock: false,
        version: 1,
      });
    } catch {
      // append-only session journal; a failure here is not fatal.
    }
  };

  pi.on("session_start", (_event, ctx) => {
    // D9: only activate under a real TUI. rpc/json/print never create
    // a render, so the status bar is never touched.
    if (ctx?.mode !== "tui") return;

    render = new OpenSpecStatusRender(EXTENSION_ID, ctx, debounceMs, persistLock);

    // Resume/restart: rebuild the previous lock state from the session
    // journal (D1/D2/D4). A manual lock is pinned via render.lock(); an
    // auto lock keeps its auto semantics via setSpec + setWorkTree.
    // Recovery is best-effort: any failure keeps the empty state and
    // never throws into the session_start handler (D12).
    try {
      const restored = findLastPersistedLock(ctx.sessionManager.getEntries());
      if (restored && restored.spec) {
        if (restored.manualLock) {
          render.lock(restored.spec);
          if (restored.worktree) render.setWorkTree(restored.worktree);
        } else {
          render.setSpec(restored.spec);
          if (restored.worktree) render.setWorkTree(restored.worktree);
        }
      }
    } catch {
      // dirty journal data → stay in the empty state.
    }

    // Explicit initial publish: status bar shows "no change" until the
    // first lock. Kept out of the constructor so that creating a render
    // lazily (select command) has no side effects. Published after the
    // restore so a restored lock immediately supersedes it via refresh().
    ctx.ui.setStatus(EXTENSION_ID, undefined);
  });

  pi.on("tool_call", (event) => {
    if (!render) return;
    // Real event shape: { type, toolCallId, toolName: "bash", input: { command } }.
    // The bash tool input has NO `type` field — use the official guard
    // (checks event.toolName === "bash") instead of sniffing input.type.
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input.command;
    if (typeof cmd !== "string") return;
    const spec = findSpec(cmd);
    if (spec) render.setSpec(spec);
    const worktree = findWorkTree(cmd);
    if (worktree) render.setWorkTree(worktree);
  });

  pi.on("tool_result", () => {
    if (render) render.refresh();
  });

  pi.registerCommand("tui-openspec-select", {
    description:
      "Manually select which openspec change the status bar tracks (None to clear)",
    handler: async (_args, cmdCtx) => {
      // TUI-only, like the rest of the extension.
      if (cmdCtx.mode !== "tui") return;

      const changes = await listActiveChanges(cmdCtx.cwd);
      const choice = await cmdCtx.ui.select("Select spec to track:", [
        ...changes,
        "None",
      ]);

      if (choice === undefined) return; // cancelled — no side effects
      if (choice === "None") {
        render?.clearLock();
        return;
      }
      render ??= new OpenSpecStatusRender(
        EXTENSION_ID,
        cmdCtx,
        debounceMs,
        persistLock,
      );
      render.lock(choice);
    },
  });
}
