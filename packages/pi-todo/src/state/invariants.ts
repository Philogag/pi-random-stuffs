import type { TaskStatus } from "../tool/types.js";

/**
 * Allowed forward transitions per source status. `completed` is one-way to
 * `deleted` (never back to `in_progress`); `deleted` is terminal.
 *
 * `waiting` is a reversible parking spot, not a terminal state: it can be
 * entered from any live status and left again for pending/in_progress. That
 * reversibility is the point — parking a task must never be a one-way door,
 * or the model would learn to use `completed` as its parking spot instead.
 *
 * Idempotent same→same is checked separately in `isTransitionValid` so this
 * table only enumerates actual transitions.
 */
export const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
	pending: new Set(["in_progress", "completed", "waiting", "deleted"]),
	in_progress: new Set(["pending", "completed", "waiting", "deleted"]),
	waiting: new Set(["pending", "in_progress", "completed", "deleted"]),
	completed: new Set(["deleted"]),
	deleted: new Set(),
};

export function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean {
	if (from === to) return true;
	return VALID_TRANSITIONS[from].has(to);
}
