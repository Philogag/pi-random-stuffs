/**
 * Single localization seam for this plugin.
 *
 * Forked from rpiv-todo, where this module forwarded to `@juicesharp/rpiv-i18n`.
 * This package has no rpiv runtime dependency, so the lookup is deliberately a
 * plain identity passthrough: the English literal at each call site IS the
 * string. Keeping the `t(key, fallback)` shape (instead of inlining the
 * literals) preserves every call site as a one-line change when a real catalog
 * lands, and keeps the status vocabulary in exactly one place.
 *
 * Call sites MUST resolve at render time — never bake the result into a
 * top-level `const X = formatStatusLabel(...)`, or a future live locale switch
 * would be frozen at import.
 */

import type { TaskStatus } from "../tool/types.js";

export const I18N_NAMESPACE = "@philogag/pi-todo";

type ScopeFn = (key: string, fallback: string) => string;

/** Identity passthrough — the fallback literal is the string. */
const scopeImpl: ScopeFn = (_key, fallback) => fallback;

export const t: ScopeFn = scopeImpl;

const STATUS_LABEL_PENDING = "pending";
const STATUS_LABEL_IN_PROGRESS = "in progress";
const STATUS_LABEL_COMPLETED = "completed";
const STATUS_LABEL_WAITING = "waiting";
const STATUS_LABEL_DELETED = "deleted";

/** Canonical display label for a status. Single point of localization. */
export function formatStatusLabel(status: TaskStatus): string {
	switch (status) {
		case "pending":
			return t("status.pending", STATUS_LABEL_PENDING);
		case "in_progress":
			return t("status.in_progress", STATUS_LABEL_IN_PROGRESS);
		case "completed":
			return t("status.completed", STATUS_LABEL_COMPLETED);
		case "waiting":
			return t("status.waiting", STATUS_LABEL_WAITING);
		case "deleted":
			return t("status.deleted", STATUS_LABEL_DELETED);
	}
}
