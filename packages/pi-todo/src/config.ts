/**
 * Configuration for @philogag/pi-todo. Self-contained: reads the `@philogag/pi-todo`
 * key out of pi's own `settings.json` (getAgentDir()), the same house convention
 * as `@philogag/pi-tui-fold-blocks`. No rpiv-* runtime dependency.
 *
 * Every field is optional and read fresh on each use (no `/reload` needed for
 * the reminder budget or the overlay line budget); only `collapseKey` is
 * registration-time (a shortcut is bound once at load — change needs `/reload`).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_REMINDER_MODES, type PiMode, parseModes } from "./mode.js";
import type { TaskStatus } from "./tool/types.js";

/** Settings key: `{ "@philogag/pi-todo": { ... } }` in pi's settings.json. */
export const PACKAGE_KEY = "@philogag/pi-todo";

// ---------------------------------------------------------------------------
// Guidance (the prompt-injection surface)
// ---------------------------------------------------------------------------

/**
 * Model-facing prompt injection. `promptSnippet` lands in pi's `<tools>` block,
 * `promptGuidelines` in `<rules>`. Overriding them here replaces our defaults
 * without a fork — the reason this is config and not constants.
 */
export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export interface ReminderSettings {
	/** Master switch for stop-time reminders. Default: true. */
	enabled: boolean;
	/** Reminders allowed per user prompt (not per session). Default: 3. */
	max: number;
	/** Suppress the reminder when the turn ended with a question to the user. Default: true. */
	skipWhenAwaitingUser: boolean;
	/** Run modes in which a reminder may fire. Default: `["tui", "rpc"]`. */
	modes: readonly PiMode[];
}

export interface TodoConfig {
	guidance?: GuidanceFields;
	maxWidgetLines?: number;
	collapseKey?: string;
	reminders?: Partial<ReminderSettings>;
}

export const DEFAULT_MAX_WIDGET_LINES = 12;
export const DEFAULT_COLLAPSE_KEY = "ctrl+shift+t";
export const COLLAPSE_KEY_OFF = "off";

/** Tested default. Higher values buy more correction attempts and cost one full
 *  provider request each; lower values risk nagging work that legitimately stopped. */
export const DEFAULT_REMINDER_MAX = 3;
/** Upper clamp — an unbounded nag is the anti-pattern this ceiling exists to stop. */
export const REMINDER_MAX_CEILING = 9;

function settingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/** Raw config bag for this package. Missing/corrupt file → `{}` (all defaults). */
export function loadConfig(path = settingsPath()): TodoConfig {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const section = parsed[PACKAGE_KEY];
		return typeof section === "object" && section !== null ? (section as TodoConfig) : {};
	} catch {
		return {};
	}
}

/** Sanitize the model-facing guidance override. Blank/empty values fall back to
 *  the built-in defaults at the call site (`??`), so return only usable fields. */
export function validateGuidanceFields(guidance: unknown): GuidanceFields {
	if (typeof guidance !== "object" || guidance === null) return {};
	const g = guidance as Record<string, unknown>;
	const out: GuidanceFields = {};
	const snippet = typeof g.promptSnippet === "string" ? g.promptSnippet.trim() : "";
	if (snippet.length > 0) out.promptSnippet = snippet;
	if (Array.isArray(g.promptGuidelines)) {
		const lines = g.promptGuidelines
			.filter((line): line is string => typeof line === "string")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (lines.length > 0) out.promptGuidelines = lines;
	}
	return out;
}

/** Content-row budget for the overlay. Values below the floor of 3 fall back. */
export function getMaxWidgetLines(): number {
	const lines = loadConfig().maxWidgetLines;
	if (typeof lines !== "number" || lines < 3) return DEFAULT_MAX_WIDGET_LINES;
	return lines;
}

/** Effective reminder settings, clamped and defaulted at read time. */
export function getReminderSettings(): ReminderSettings {
	const raw = loadConfig().reminders;
	const max = typeof raw?.max === "number" && Number.isFinite(raw.max) ? Math.floor(raw.max) : DEFAULT_REMINDER_MAX;
	return {
		enabled: raw?.enabled !== false,
		max: Math.min(REMINDER_MAX_CEILING, Math.max(1, max)),
		skipWhenAwaitingUser: raw?.skipWhenAwaitingUser !== false,
		modes: parseModes(raw?.modes) ?? DEFAULT_REMINDER_MODES,
	};
}

// ---------------------------------------------------------------------------
// Collapse shortcut
// ---------------------------------------------------------------------------

const SPECIAL_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

/** Validate against pi-tui's KeyId grammar (a loose check would let a typo like
 *  `ctr+]` match every bare `]` and swallow it globally). */
export function isValidCollapseKeySpec(spec: string): boolean {
	if (!spec) return false;
	if (spec.startsWith("+") || spec.endsWith("+") || spec.includes("++")) return false;
	const parts = spec.split("+");
	const base = parts[parts.length - 1] ?? "";
	const modifiers = parts.slice(0, -1);
	if (modifiers.length !== new Set(modifiers).size) return false;
	if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
	return base.length === 1 ? /[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]/.test(base) : SPECIAL_KEYS.has(base);
}

/** Resolved collapse/expand key, or the {@link COLLAPSE_KEY_OFF} sentinel. */
export function resolveCollapseKey(): string {
	const raw = typeof loadConfig().collapseKey === "string" ? (loadConfig().collapseKey ?? "").trim().toLowerCase() : "";
	if (raw === "") return DEFAULT_COLLAPSE_KEY;
	if (raw === COLLAPSE_KEY_OFF) return COLLAPSE_KEY_OFF;
	return isValidCollapseKeySpec(raw) ? raw : DEFAULT_COLLAPSE_KEY;
}

// ---------------------------------------------------------------------------
// Status vocabulary shared by config-level docs and tests
// ---------------------------------------------------------------------------

/** Statuses that count as "the model still owes work" — the reminder trigger set.
 *  `waiting` is deliberately excluded: a task parked on an external event is the
 *  structural escape hatch that keeps the nag from firing on legitimate pauses. */
export const OPEN_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["pending", "in_progress"]);
