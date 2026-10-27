/**
 * mode.ts — which pi run mode are we in, and what may we do there?
 *
 * pi loads extensions in every mode (`ExtensionMode = "tui" | "rpc" | "json" |
 * "print"`, extensions.md:248), but the UI surfaces differ sharply:
 *
 * | mode  | hasUI | widget factories | dialogs | notify |
 * |-------|-------|------------------|---------|--------|
 * | tui   | true  | rendered         | yes     | drawn  |
 * | rpc   | true  | DROPPED (rpc-mode.js: `setWidget` ignores component factories) | yes | `extension_ui_request` |
 * | json  | false | no-op ui         | no      | dropped |
 * | print | false | no-op ui         | no      | dropped |
 *
 * Two consequences this module encodes:
 *
 * 1. The overlay is a TUI-only surface. Registering a factory in RPC burns work
 *    for nothing (the call is silently discarded), so we never bind a UI ctx
 *    outside TUI — the overlay is simply absent, and `/todos` still works
 *    because RPC forwards `notify` through the extension UI sub-protocol.
 * 2. The stop-time reminder is a *cost* decision, not a UI one: each reminder is
 *    one extra provider request. Interactive (tui) and client-driven (rpc)
 *    sessions get them; one-shot pipelines (json/print) do not, because nobody
 *    is there to act on the nag. `reminders.modes` overrides that policy.
 *
 * Pure and pi-import-free so the policy is unit-testable.
 */

/** pi's run modes, in escalating order of "no human attached". */
export type PiMode = "tui" | "rpc" | "json" | "print";

export const PI_MODES: readonly PiMode[] = ["tui", "rpc", "json", "print"];

/**
 * Modes where a stop-time reminder is worth a provider request by default:
 * a human is attached, either at a terminal or through an RPC client.
 */
export const DEFAULT_REMINDER_MODES: readonly PiMode[] = ["tui", "rpc"];

/** Modes whose host can actually render a `setWidget` component factory. */
export const OVERLAY_MODES: readonly PiMode[] = ["tui"];

export function isPiMode(value: unknown): value is PiMode {
	return typeof value === "string" && (PI_MODES as readonly string[]).includes(value);
}

/** The parts of a pi `ExtensionContext` this module needs. */
export interface ModeBearingContext {
	mode?: unknown;
	hasUI?: boolean;
}

/**
 * Resolve the run mode of a context, tolerating hosts that predate `ctx.mode`.
 *
 * A missing/unknown mode is interpreted through `hasUI`: an interactive-capable
 * host (which is where a widget can be rendered and a human can act) is treated
 * as TUI, and a UI-less host as `print` — the most conservative mode on both
 * axes (no overlay, no reminder).
 */
export function resolveMode(ctx: ModeBearingContext | undefined): PiMode {
	if (isPiMode(ctx?.mode)) return ctx.mode;
	return ctx?.hasUI === true ? "tui" : "print";
}

/** Should this mode bind the persistent overlay widget? */
export function overlaySupported(mode: PiMode): boolean {
	return OVERLAY_MODES.includes(mode);
}

/** Should a stop-time reminder be allowed to spend a request in this mode? */
export function remindersAllowed(mode: PiMode, modes: readonly PiMode[]): boolean {
	return modes.includes(mode);
}

/**
 * Validate a `reminders.modes` override.
 *
 * Unknown entries are dropped (a typo must not silently disable reminders),
 * duplicates collapse, and the result keeps `PI_MODES` order. An override that
 * leaves nothing usable returns `undefined` so the caller falls back to the
 * default policy — use `enabled: false` to turn reminders off outright.
 */
export function parseModes(raw: unknown): PiMode[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const wanted = new Set(raw.filter(isPiMode));
	if (wanted.size === 0) return undefined;
	return PI_MODES.filter((mode) => wanted.has(mode));
}
