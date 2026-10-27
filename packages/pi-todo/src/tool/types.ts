import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

// ---------------------------------------------------------------------------
// Tool / command identity — verbatim string boundaries.
// Tool name "todo" is the persistence key for branch replay (filtering
// `toolResult.toolName === "todo"`). Intentionally NOT renamed: keeping it lets
// sessions recorded by @juicesharp/rpiv-todo replay into this plugin's slot.
// ---------------------------------------------------------------------------

export const TOOL_NAME = "todo";
export const TOOL_LABEL = "Todo";
export const COMMAND_NAME = "todos";

/**
 * Custom session-entry type carrying the `details` snapshot of every
 * state-changing `todo` call — the replay source that survives calls made
 * through another tool (`ctx.executeTool`, e.g. Pi's codemode), whose results
 * never land on the branch as standalone `toolResult` messages. Persistence key
 * for branch replay, like `TOOL_NAME`. DO NOT rename.
 */
export const STATE_ENTRY_TYPE = "pi-todo-state";

/** Entry type written by @juicesharp/rpiv-todo — accepted on replay for migration. */
export const LEGACY_STATE_ENTRY_TYPE = "rpiv-todo-state";

// ---------------------------------------------------------------------------
// User-facing strings (kept stable for /todos UX parity).
// ---------------------------------------------------------------------------

export const ERR_REQUIRES_INTERACTIVE = "/todos requires interactive mode";
export const MSG_NO_TODOS = "No todos yet. Ask the agent to add some!";

/** Tool-call description — the first paragraph the model reads. */
export const TOOL_DESCRIPTION =
	"Task list for multi-step work. Actions: create, update, list, get, delete, clear. " +
	"Lifecycle: pending → in_progress → completed, plus waiting (parked on an external event; requires waitReason) and deleted (tombstone). " +
	"blockedBy models task dependencies. Call it before starting work and again whenever a task's state changes — the list is the user's window into what you are actually doing.";

// ---------------------------------------------------------------------------
// Public domain types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "waiting" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	/** Why a `waiting` task is parked (CI, user decision, upstream subagent).
	 *  Required while status is `waiting`, dropped on every other status. */
	waitReason?: string;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Persistence + replay snapshot. Every successful `todo` tool call returns this
 * shape under `details`; `state/replay.ts` reads the latest one from the branch
 * to reconstruct module state. Field order and field names are pinned by
 * cross-version replay compatibility.
 */
export interface TaskDetails {
	action: TaskAction;
	params: Record<string, unknown>;
	tasks: Task[];
	nextId: number;
	error?: string;
}

/**
 * Open-shape input bag the reducer accepts. Stays an interface so the index
 * signature (`[key: string]: unknown`) lets the runtime pass through TypeBox
 * `Static<typeof TodoParamsSchema>` without `as` casts.
 */
export interface TaskMutationParams {
	[key: string]: unknown;
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TaskStatus;
	waitReason?: string;
	blockedBy?: number[];
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
	id?: number;
	includeDeleted?: boolean;
}

// ---------------------------------------------------------------------------
// TypeBox parameter schema — every `description` doubles as LLM-facing prompt
// copy. Field order and wording are pinned by registration tests.
// ---------------------------------------------------------------------------

export const TodoParamsSchema = Type.Object({
	action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
	subject: Type.Optional(Type.String({ description: "Task subject line (required for create)" })),
	description: Type.Optional(Type.String({ description: "Long-form task description" })),
	activeForm: Type.Optional(
		Type.String({
			description: "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
		}),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed", "waiting", "deleted"] as const, {
			description:
				"Set this task's status (update): pending, in_progress, completed, waiting (parked on an external event — requires waitReason; suppresses reminders), or deleted (tombstone). When action is list, filters returned tasks by this status.",
		}),
	),
	waitReason: Type.Optional(
		Type.String({
			description:
				"Why the task is parked (use with status: waiting), e.g. 'waiting on CI run 4821'. Required when moving a task to waiting; cleared automatically when it leaves waiting.",
		}),
	),
	blockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Initial blockedBy ids (create only)",
		}),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to add to blockedBy (update only, additive merge)",
		}),
	),
	removeBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to remove from blockedBy (update only, additive merge)",
		}),
	),
	owner: Type.Optional(Type.String({ description: "Agent/owner assigned to this task" })),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Arbitrary metadata; pass null value for a key to delete that key on update",
		}),
	),
	id: Type.Optional(
		Type.Number({
			description: "Task id (required for update, get, delete)",
		}),
	),
	includeDeleted: Type.Optional(
		Type.Boolean({
			description: "If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
		}),
	),
});

export type TodoParams = Static<typeof TodoParamsSchema>;
