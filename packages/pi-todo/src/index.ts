/**
 * @philogag/pi-todo — Pi extension. Registers the `todo` tool, `/todos` slash
 * command, the persistent TodoOverlay widget, and the stop-time reminder policy.
 *
 * Forked from @juicesharp/rpiv-todo 2.13.8 and cut loose from the rpiv-* runtime:
 * config comes from pi's own settings.json, strings from the local identity
 * bridge. What actually changed vs the fork is the model-facing contract — the
 * tool description, the prompt snippet/guidelines, the added `waiting` status,
 * and the bounded reminder mechanism (`src/reminders.ts`) that the original
 * deliberately omitted.
 *
 * Tool name "todo" and the replay shape are preserved verbatim so session
 * history recorded by the original package still reconstructs here.
 */

import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { COLLAPSE_KEY_OFF, getReminderSettings, resolveCollapseKey } from "./config.js";
import { overlaySupported, remindersAllowed, resolveMode } from "./mode.js";
import {
	createReminderState,
	onToolResult,
	onUserPrompt,
	planReminder,
	type ReminderState,
} from "./reminders.js";
import { replayFromBranch } from "./state/replay.js";
import {
	clearActiveRenderSession,
	evictSession,
	getActiveRenderSession,
	getRenderState,
	getState,
	replaceState,
	setActiveRenderSession,
	sid,
} from "./state/store.js";
import { registerTodosCommand, registerTodoTool, TOOL_NAME } from "./todo.js";
import type { TodoOverlay } from "./todo-overlay.js";

type TodoOverlayModule = typeof import("./todo-overlay.js");
type TodoOverlayImporter = () => Promise<TodoOverlayModule>;

/**
 * Marker shared by the loader's poisoned-namespace error and the
 * `isStaleOverlayModuleError` predicate that lets handlers re-throw it while
 * swallowing transient load failures.
 */
const STALE_OVERLAY_MESSAGE = "Todo overlay module cache is stale; restart Pi";

/** True for the loader's latched poisoned-namespace error (see below). */
export function isStaleOverlayModuleError(e: unknown): boolean {
	return String(e).includes(STALE_OVERLAY_MESSAGE);
}

/**
 * Memoize the overlay graph after a successful load, but drop a rejected
 * promise so a failed pre-warm does not permanently replay the same rejection.
 * The export guard turns jiti's poisoned-namespace failure into a useful restart
 * error instead of a bare "TodoOverlay is not a constructor" TypeError.
 */
export function makeTodoOverlayLoader(
	importOverlay: TodoOverlayImporter = () => import("./todo-overlay.js"),
): TodoOverlayImporter {
	let memo: Promise<TodoOverlayModule> | undefined;

	return async (): Promise<TodoOverlayModule> => {
		memo ??= importOverlay();
		const current = memo;
		let mod: TodoOverlayModule;
		try {
			mod = await current;
		} catch (error) {
			// Clear only OUR rejected promise: a late catch from a concurrent
			// awaiter must never clobber a fresh retry another caller installed.
			if (memo === current) memo = undefined;
			throw error;
		}
		if (typeof mod.TodoOverlay !== "function") {
			// Deliberately latched: the memo keeps this resolved-but-poisoned
			// namespace, so every subsequent load re-throws instead of retrying.
			// Re-importing would hand back the same cached jiti namespace — a
			// retry can never heal this; only the restart the error asks for can.
			const keys = JSON.stringify(Object.keys(mod));
			throw new Error(`${STALE_OVERLAY_MESSAGE} (resolved namespace keys: ${keys})`);
		}
		return mod;
	};
}

/** Delay the overlay graph pre-warm until Pi's startup work has settled. */
export const PREWARM_DELAY_MS = 2000;

/** Custom entry type of the reminder message — greppable in a transcript. */
export const REMINDER_CUSTOM_TYPE = "pi-todo-reminder";

/** `PI_TODO_DEBUG=1` logs every skipped reminder with its reason. */
function isReminderDebugEnabled(): boolean {
	return process.env["PI_TODO_DEBUG"] === "1";
}

/**
 * Text of the last assistant message in the settling turn, or undefined.
 * Structural (no pi-ai import) — content is either a string or a block array,
 * and only text blocks matter for the "did you end by asking the user" guard.
 */
export function lastAssistantText(messages: readonly unknown[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { role?: string; content?: unknown } | undefined;
		if (message?.role !== "assistant") continue;
		const content = message.content;
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return undefined;
		const text = content
			.map((block) => {
				const b = block as { type?: string; text?: unknown };
				return b.type === "text" && typeof b.text === "string" ? b.text : "";
			})
			.filter((part) => part.length > 0)
			.join("\n");
		return text.length > 0 ? text : undefined;
	}
	return undefined;
}

// pi-core's ExtensionRunner throws this exact phrase from an invalidated ctx
// proxy after session replacement/reload. Match the stable substring so genuine
// replay bugs still propagate instead of being silently swallowed.
function isStaleCtxError(e: unknown): boolean {
	return /stale after session replacement/.test(String(e));
}

/**
 * Render a caught `unknown` as a human-readable message — the `instanceof Error`
 * dance collapsed to one place. Local copy of the `formatError` in
 * packages/rpiv-workflow/internal-utils.ts:56-58 (that module disclaims its
 * public surface, so the cross-package import is not available). M2 boundary
 * duplication: tracked as a documented-constant seam.
 */
function formatError(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export default function (pi: ExtensionAPI, importOverlay: TodoOverlayImporter = () => import("./todo-overlay.js")) {
	let todoOverlay: TodoOverlay | undefined;
	const loadTodoOverlay = makeTodoOverlayLoader(importOverlay);
	let uiCtx: ExtensionUIContext | undefined;
	let lifecycleGeneration = 0;
	// Reminder bookkeeping is per-session, mirroring the task store's slots: a
	// child session must not spend (or reset) the foreground session's budget.
	const reminderStates = new Map<string, ReminderState>();

	async function updateTodoOverlay(
		resetCompletedDisplayState = false,
		generation = lifecycleGeneration,
	): Promise<void> {
		const hasVisibleTasks = getRenderState().tasks.some((task) => task.status !== "deleted");
		if (!uiCtx || (!todoOverlay && !hasVisibleTasks)) return;

		const { TodoOverlay } = await loadTodoOverlay();
		if (generation !== lifecycleGeneration || !uiCtx) return;

		todoOverlay ??= new TodoOverlay();
		todoOverlay.setUICtx(uiCtx);
		if (resetCompletedDisplayState) todoOverlay.resetCompletedDisplayState();
		todoOverlay.update();
	}

	registerTodoTool(pi);
	registerTodosCommand(pi);

	// Collapse/expand hotkey for the todo overlay. The key is resolved once at
	// factory scope from config (register-once contract: a config change needs
	// `/reload` to re-bind, same as lane-switcher's env hotkey) and the binding is
	// skipped entirely when collapseKey is "off". The handler closes over the
	// closure-local `todoOverlay` by reference and re-reads it at fire time, so an
	// overlay loaded after shortcut registration is picked up. No-op in headless
	// mode, before the overlay has loaded, or when the widget isn't currently
	// registered (auto-hidden on an empty list).
	const collapseKey = resolveCollapseKey();
	if (collapseKey !== COLLAPSE_KEY_OFF) {
		pi.registerShortcut(collapseKey as KeyId, {
			description: "Collapse or expand the todo overlay",
			handler: (ctx) => {
				if (!ctx.hasUI || !todoOverlay?.isRegistered()) return;
				todoOverlay.toggleCollapse();
			},
		});
	}

	// Re-key a session's slot from its branch, then refresh the overlay only when
	// the refreshed session IS the foreground. Shared by session_compact and
	// session_tree (verbatim-identical pre-extraction). A stale ctx (auto-compaction
	// races session disposal: pi-core invalidates the runner while still emitting the
	// event, so `ctx` may be a dead proxy whose getters throw) keeps current state —
	// the replacement session's session_start replays it. Other errors are real replay
	// bugs and must propagate. The render is sid-gated so a child never refreshes the
	// foreground overlay.
	const replayAndRefresh = async (
		ctx: Parameters<typeof sid>[0] & Parameters<typeof replayFromBranch>[0],
	): Promise<void> => {
		let isForeground = false;
		try {
			const id = sid(ctx);
			replaceState(id, replayFromBranch(ctx));
			isForeground = id === getActiveRenderSession();
		} catch (e) {
			if (!isStaleCtxError(e)) throw e;
		}
		if (isForeground) await updateTodoOverlay(true);
	};

	pi.on("session_start", async (_event, ctx) => {
		let id: string;
		try {
			id = sid(ctx);
			// Every session replays into its OWN data slot (Phase 1 isolation).
			replaceState(id, replayFromBranch(ctx));
		} catch (e) {
			// Parity with compact/tree/shutdown: session_start is the fresh-ctx event
			// so the stale risk is low, but a stale/throwing ctx has nothing to bind —
			// swallow the known stale error and bail; let real replay bugs propagate.
			if (!isStaleCtxError(e)) throw e;
			return;
		}
		if (!ctx.hasUI) return;
		// The overlay is a TUI-only surface. In RPC the host silently DISCARDS
		// component factories (`setWidget` only accepts string arrays there), and
		// JSON/print carry a no-op ui context — so binding a ui ctx outside TUI
		// would only warm a widget nobody can see while costing a render pass per
		// todo mutation. Replay above already ran, so `/todos` and the reminder
		// still read this session's tasks in every mode.
		if (!overlaySupported(resolveMode(ctx))) return;
		schedulePrewarm();
		// First UI-bearing session_start claims the foreground (the interactive
		// launcher, by spawn-ordering) without eagerly loading the overlay.
		if (getActiveRenderSession() === "") setActiveRenderSession(id);
		// Only the foreground re-binds/refreshes the shared overlay. A child
		// (distinct sid) is skipped — does not rebind to a relay/stale ui.
		if (id !== getActiveRenderSession()) return;
		const generation = ++lifecycleGeneration;
		uiCtx = ctx.ui;
		await updateTodoOverlay(true, generation);
	});

	pi.on("session_compact", async (_event, ctx) => {
		await replayAndRefresh(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await replayAndRefresh(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		// Best-effort sid: disposal can race a stale ctx (like compact). An
		// unknown/stale sid resolves to "" and is treated as foreground — the
		// safe pre-isolation default that disposes as before.
		let s: string;
		try {
			s = sid(ctx);
		} catch (e) {
			if (!isStaleCtxError(e)) throw e;
			s = "";
		}
		// The shutting-down session's own data slot is always evicted.
		evictSession(s);
		// Overlay teardown is sid-gated: a child shutdown (distinct sid) must not
		// dispose the foreground's overlay. Only the foreground's own shutdown
		// (or an unknown/stale sid) tears it down and clears the pointer.
		if (s === "" || s === getActiveRenderSession()) {
			// Invalidate pending imports before clearing the foreground binding so a
			// replaced session cannot inherit the stale overlay or UI context.
			lifecycleGeneration++;
			uiCtx = undefined;
			// `dispose()`'s first act is setWidget(KEY, undefined) on a possibly-stale
			// ui proxy, which can throw. evictSession(s) above already deleted this
			// slot, so leaving `activeRenderSession` pointing at it would resolve
			// getRenderState() to a fresh EMPTY_STATE (overlay silently renders empty).
			// try/finally guarantees the pointer-clear + overlay-drop run regardless.
			try {
				todoOverlay?.dispose();
			} finally {
				todoOverlay = undefined;
				clearActiveRenderSession();
			}
		}
	});

	// Reads getTodos() at render time; do NOT call replayFromBranch here
	// (branch is stale — message_end runs after tool_execution_end).
	pi.on("tool_execution_end", async (event, ctx) => {
		// Any tool result — not just `todo` — counts as progress and releases the
		// reminder's single-flight latch. Clearing only on `todo` would let a long
		// run of productive non-todo work suppress reminders for the wrong reason.
		releaseReminderLatch(ctx);
		if (event.toolName !== TOOL_NAME || event.isError) return;
		try {
			await updateTodoOverlay();
		} catch (e) {
			// The tool itself succeeded — a transient overlay-load failure only
			// costs this one refresh, and the loader's cleared memo lets the next
			// update retry. Don't surface that as an extension error. The latched
			// stale-namespace error still propagates: it never self-heals, and the
			// user needs its restart guidance.
			if (isStaleOverlayModuleError(e)) throw e;
			console.warn(`[pi-todo] overlay refresh failed (will retry on next update): ${formatError(e)}`);
		}
	});

	// A new USER prompt opens a new reminder budget. Deliberately NOT `agent_start`:
	// that also fires for the continuation this extension itself triggers, which
	// would reset the budget on every nag and turn the ceiling into an infinite loop.
	pi.on("before_agent_start", async (_event, ctx) => {
		const id = safeSid(ctx);
		if (id === undefined) return;
		reminderStates.set(id, onUserPrompt(reminderStates.get(id) ?? createReminderState()));
	});

	// Stop-time reminder: the ONLY place this extension asks for another turn.
	pi.on("agent_before_settle", (event, ctx) => {
		// Mode policy first: a reminder is one extra provider request, so headless
		// pipelines (json/print) never get one — nobody is there to act on the nag,
		// and a `--mode json` run would silently double its cost and emit an
		// unsolicited turn into the client's event stream. TUI and RPC keep them;
		// `reminders.modes` overrides the set either way.
		const settings = getReminderSettings();
		if (!remindersAllowed(resolveMode(ctx), settings.modes)) {
			if (isReminderDebugEnabled()) console.warn(`[pi-todo] reminder skipped: mode`);
			return undefined;
		}
		const id = safeSid(ctx);
		if (id === undefined) return undefined;

		const state = reminderStates.get(id) ?? createReminderState();
		const plan = planReminder({
			state,
			settings,
			outcome: event.outcome,
			// This session's OWN slot, not the ctx-less render slot: the render slot
			// is only claimed in TUI mode, so reading it here would make every RPC
			// reminder see an empty list (and a child session judge its parent's).
			tasks: getState(id).tasks,
			canContinue: event.context.canContinue,
			lastAssistantText: lastAssistantText(event.context.llmMessages),
			now: Date.now(),
		});
		reminderStates.set(id, plan.state);

		if (plan.kind === "skip") {
			if (isReminderDebugEnabled()) console.warn(`[pi-todo] reminder skipped: ${plan.reason}`);
			return undefined;
		}
		todoOverlay?.hideCompletedTasksFromPreviousTurn();
		return {
			entries: [
				{
					type: "custom_message" as const,
					customType: REMINDER_CUSTOM_TYPE,
					content: plan.prompt,
					// Visible on purpose: a nag the user cannot see is indistinguishable
					// from the agent talking to itself, and unmeterable when debugging.
					display: true,
				},
			],
			continue: true,
		};
	});

	// Evaluate the lazy graph after startup while Pi's boot-time dependency paths
	// are still stable. This loads no widget and constructs no overlay; those stay
	// deferred until a TUI session has visible tasks. A rejected pre-warm is
	// intentionally swallowed after loadTodoOverlay clears its memo, allowing the
	// first real update to retry. unref avoids holding an embedder open.
	//
	// Scheduled from the first TUI `session_start` rather than unconditionally at
	// factory scope: in rpc/json/print the overlay module is dead weight (the host
	// drops widget factories or has no ui at all), so headless runs must not pay
	// to import it.
	let prewarmTimer: ReturnType<typeof setTimeout> | undefined;
	function schedulePrewarm(): void {
		if (prewarmTimer !== undefined) return;
		prewarmTimer = setTimeout(() => void loadTodoOverlay().catch(() => undefined), PREWARM_DELAY_MS);
		prewarmTimer.unref?.();
	}

	pi.on("agent_start", async () => {
		todoOverlay?.hideCompletedTasksFromPreviousTurn();
	});

	function safeSid(ctx: Parameters<typeof sid>[0]): string | undefined {
		try {
			const id = sid(ctx);
			return id === "" ? undefined : id;
		} catch (e) {
			// Stale ctx (session replacement race) has no budget to charge.
			if (isStaleCtxError(e)) return undefined;
			throw e;
		}
	}

	function releaseReminderLatch(ctx: Parameters<typeof sid>[0]): void {
		const id = safeSid(ctx);
		if (id === undefined) return;
		const state = reminderStates.get(id);
		if (state === undefined) return;
		reminderStates.set(id, onToolResult(state));
	}
}
