// src/index.ts
//
// pi-openspec-bridge — one extension, two jobs:
//
//   1. `openspec` TOOL — a structured bridge over the whole OpenSpec CLI
//      (every documented subcommand, every flag, explicit spec root) so the
//      agent no longer shells out to `openspec …`.
//   2. OpenSpec STATUS LINE — the single-line status bar previously shipped
//      as `@philogag/pi-tui-openspec-status`, now driven primarily by the
//      tool (bash `openspec …` calls still work for muscle memory).
//
// Merge notes: the status modules under `status/` are the merged sources of
// pi-tui-openspec-status. Their only behavioural change is that
// `status/openspec.ts` now runs through the bridge runner, so the bar works
// without a global CLI installed.

import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { listActiveChanges } from "./status/discover.js";
import { findSpec, findWorkTree } from "./status/parser.js";
import { OpenSpecStatusRender } from "./status/render.js";
import {
  findLastPersistedLock,
  LOCK_CUSTOM_TYPE,
  type PersistedLock,
} from "./status/state.js";
import { trackTarget } from "./status/tracking.js";
import { registerOpenspecTool, TOOL_NAME } from "./tool.js";
import type { OpenspecToolParams } from "./cli/schema.js";
import * as path from "node:path";

export const EXTENSION_ID = "pi-openspec-bridge";
export const SET_STATUS_DEBOUNCE_MS = 500;

/** Custom-entry type used to persist the tracked change across restarts. */
export const LOCK_ENTRY_TYPE = EXTENSION_ID;

export interface PiOpenspecBridgeOptions {
  /**
   * Override the render debounce window (ms). Defaults to
   * {@link SET_STATUS_DEBOUNCE_MS}. Tests typically pass a small value
   * (e.g. 0) to skip debouncing entirely.
   */
  debounceMs?: number;
  /** Register the `openspec` tool. Defaults to true. */
  enableTool?: boolean;
  /** Track the openspec status line. Defaults to true. */
  enableStatusBar?: boolean;
}

/**
 * Wire the OpenSpec tool and status bar into pi.
 *
 * The status bar is created lazily on `session_start` (the first event that
 * carries a real `ExtensionContext`), and only under a TUI: rpc/json/print
 * sessions never touch it. The tool, by contrast, is registered immediately —
 * it has no UI dependency and must be available headless.
 *
 * Lock persistence: every authoritative state change is mirrored into the
 * session file via `pi.appendEntry` — custom entries do NOT participate in
 * LLM context. On `session_start` (including `/resume`) the last matching
 * entry is read back, so the bar survives restarts.
 */
export default function (
  pi: ExtensionAPI,
  options: PiOpenspecBridgeOptions = {},
): void {
  const debounceMs = options.debounceMs ?? SET_STATUS_DEBOUNCE_MS;
  const enableTool = options.enableTool ?? true;
  const enableStatusBar = options.enableStatusBar ?? true;

  let render: OpenSpecStatusRender | undefined;
  /**
   * Latest `root` param seen from the tool. The status bar uses it as an
   * extra scan source (the merged extension's "worktree" concept, generalised
   * from `cd <worktree> && openspec …` to "the command ran against this spec
   * root").
   */
  let toolRoot: string | undefined;

  /**
   * Persist a lock snapshot to the session file. `null` (or an all-cleared
   * state) is stored as an explicit "no lock" entry so a later resume
   * restores the empty state instead of a stale lock. Best-effort: a failure
   * here must never propagate into the render path.
   */
  const persistLock = (state: PersistedLock | null) => {
    try {
      pi.appendEntry(LOCK_ENTRY_TYPE, state ?? {
        spec: "",
        manualLock: false,
        version: 1,
      });
    } catch {
      // append-only session journal; a failure here is not fatal.
    }
  };

  if (enableTool) {
    registerOpenspecTool(pi, {
      onRun: (params: OpenspecToolParams, result) => {
        if (!render) return;
        // A hard spawn failure says nothing about the tracked change.
        if (result.spawnError) return;

        const target = trackTarget(params);
        if (target.root) {
          toolRoot = path.resolve(result.cwd);
          // The root the command actually ran in is the authoritative source;
          // `result.cwd` already reflects param resolution.
          if (toolRoot === path.resolve(render.ctx.cwd)) toolRoot = undefined;
          if (toolRoot) render.setWorkTree(toolRoot);
        }
        if (target.change) render.setSpec(target.change);
        else render.refresh();
      },
    });
  }

  if (!enableStatusBar) return;

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    // Only activate under a real TUI. rpc/json/print never create a render,
    // so the status bar is never touched.
    if (ctx?.mode !== "tui") return;

    render = new OpenSpecStatusRender(EXTENSION_ID, ctx, debounceMs, persistLock);

    // Resume/restart: rebuild the previous lock state from the session
    // journal. A manual lock is pinned via render.lock(); an auto lock keeps
    // its auto semantics via setSpec + setWorkTree. Best-effort: any failure
    // keeps the empty state and never throws into session_start.
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

    // Explicit initial publish: the bar shows "no change" until the first
    // lock. Kept out of the constructor so that a lazy render instance has no
    // side effects.
    ctx.ui.setStatus(EXTENSION_ID, undefined);
  });

  // Legacy path: `openspec …` typed into the shell tool still locks the bar.
  // Agent-side calls normally go through the `openspec` tool, but a user can
  // still drive the CLI by hand.
  pi.on("tool_call", (event) => {
    if (!render) return;
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input.command;
    if (typeof cmd !== "string") return;

    // If the shell command is an openspec invocation, prefer the shell tool
    // over the bridge: warn nothing, but do not double-book the lock.
    const spec = findSpec(cmd);
    if (spec) render.setSpec(spec);
    const worktree = findWorkTree(cmd);
    if (worktree) render.setWorkTree(worktree);
  });

  pi.on("tool_result", (event) => {
    if (!render) return;
    // Ignore our own tool result here: `onRun` already updated the lock with
    // structured params, and refreshing twice would race the debounce.
    if ("toolName" in event && event.toolName === TOOL_NAME) return;
    render.refresh();
  });

  pi.registerCommand("openspec-bridge", {
    description:
      "Manually select which openspec change the status bar tracks (None to clear)",
    handler: async (_args, cmdCtx) => {
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
