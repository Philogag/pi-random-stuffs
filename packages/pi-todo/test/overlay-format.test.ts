import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatCommandTaskLine, formatOverlayTaskLine, overlayStatusGlyph } from "../src/view/format.js";
import {
	selectHasActive,
	selectOverlayLayout,
	selectShowTaskIds,
	selectTodoCounts,
	selectVisibleTasks,
} from "../src/state/selectors.js";
import type { TaskState } from "../src/state/state.js";
import type { Task } from "../src/tool/types.js";

/** Identity theme so assertions read the literal text, not ANSI output. */
const theme = {
	fg: (_color: string, s: string) => s,
	bold: (s: string) => s,
	strikethrough: (s: string) => `<s>${s}</s>`,
} as unknown as Theme;

function state(...tasks: Task[]): TaskState {
	return { tasks, nextId: Math.max(0, ...tasks.map((t) => t.id)) + 1 };
}

function task(id: number, status: Task["status"], extra: Partial<Task> = {}): Task {
	return { id, status, subject: `task ${id}`, ...extra };
}

describe("overlay rows — spec: todo-overlay / 字形与等待理由可见性", () => {
	it("uses the overlay glyph set, not the tool glyph set", () => {
		expect(overlayStatusGlyph("completed", theme)).toBe("✓");
		expect(overlayStatusGlyph("deleted", theme)).toBe("✗");
		expect(overlayStatusGlyph("waiting", theme)).toBe("◍");
	});

	it("renders pending, in-progress and completed rows", () => {
		expect(formatOverlayTaskLine(task(1, "pending"), theme, true)).toBe("○ #1 task 1");
		expect(formatOverlayTaskLine(task(1, "in_progress", { activeForm: "Writing" }), theme, true)).toBe(
			"◐ #1 task 1 (Writing)",
		);
		expect(formatOverlayTaskLine(task(1, "completed"), theme, true)).toBe("✓ #1 <s>task 1</s>");
	});

	it("shows what a parked task is parked on, inline", () => {
		expect(formatOverlayTaskLine(task(1, "waiting", { waitReason: "CI run" }), theme, true)).toBe("◍ #1 task 1 ⏸ CI run");
		expect(formatOverlayTaskLine(task(1, "waiting"), theme, true)).toBe("◍ #1 task 1");
	});

	it("appends the dependency chain", () => {
		expect(formatOverlayTaskLine(task(3, "pending", { blockedBy: [1, 2] }), theme, true)).toBe("○ #3 task 3 ⛓ #1,#2");
	});

	it("drops the id prefix when no row carries a dependency", () => {
		expect(formatOverlayTaskLine(task(4, "pending"), theme, false)).toBe("○ task 4");
	});

	it("sanitizes model-authored text before it reaches the terminal", () => {
		expect(formatOverlayTaskLine(task(1, "pending", { subject: "a\u001b[31mb\nc" }), theme, true)).toBe("○ #1 ab c");
		expect(formatOverlayTaskLine(task(1, "waiting", { waitReason: "x\u001b]0;t\u0007y" }), theme, true)).toBe(
			"◍ #1 task 1 ⏸ xy",
		);
	});
});

describe("row budget — spec: todo-overlay / 先丢 completed 再截尾部", () => {
	it("returns everything when it fits, with zero overflow", () => {
		const s = state(task(1, "pending"), task(2, "completed"));
		expect(selectOverlayLayout(s, 2)).toEqual({ visible: s.tasks, hiddenCompleted: 0, truncatedTail: 0 });
	});

	it("counts only visible tasks against the budget", () => {
		const s = state(task(1, "pending"), task(2, "deleted"), task(3, "deleted"));
		expect(selectVisibleTasks(s).map((t) => t.id)).toEqual([1]);
		expect(selectOverlayLayout(s, 1).visible.map((t) => t.id)).toEqual([1]);
	});

	it("drops completed rows before touching open ones", () => {
		const s = state(
			task(1, "pending"),
			task(2, "completed"),
			task(3, "in_progress"),
			task(4, "completed"),
			task(5, "completed"),
		);
		// budget 4 → reserves one slot for the summary row → 3 body slots.
		expect(selectOverlayLayout(s, 4)).toEqual({
			visible: [s.tasks[0], s.tasks[1], s.tasks[2]],
			hiddenCompleted: 2,
			truncatedTail: 0,
		});
	});

	it("truncates the open tail only once no completed row is left", () => {
		const s = state(task(1, "pending"), task(2, "pending"), task(3, "pending"), task(4, "pending"));
		expect(selectOverlayLayout(s, 3)).toEqual({ visible: [s.tasks[0], s.tasks[1]], hiddenCompleted: 0, truncatedTail: 2 });
	});
});

/** Spec: todo-overlay / #id 门控 — rows only carry ids when a chain needs the anchor. */
describe("id gating — spec: todo-overlay", () => {
	it("is off when nothing carries a dependency", () => {
		expect(selectShowTaskIds(state(task(1, "pending")))).toBe(false);
	});

	it("is on as soon as one visible task is blocked", () => {
		expect(selectShowTaskIds(state(task(1, "pending"), task(2, "pending", { blockedBy: [1] })))).toBe(true);
	});

	it("ignores a blocked tombstone, which is never rendered", () => {
		expect(selectShowTaskIds(state(task(1, "deleted", { blockedBy: [9] })))).toBe(false);
	});
});

describe("counts and activity — spec: todo-overlay", () => {
	it("counts visible tasks by status, excluding tombstones from the total", () => {
		const s = state(
			task(1, "pending"),
			task(2, "in_progress"),
			task(3, "completed"),
			task(4, "waiting"),
			task(5, "deleted"),
		);
		expect(selectTodoCounts(s)).toEqual({ total: 4, pending: 1, inProgress: 1, completed: 1, waiting: 1 });
	});

	it("treats waiting as parked, not active", () => {
		expect(selectHasActive(state(task(1, "waiting")))).toBe(false);
		expect(selectHasActive(state(task(1, "pending")))).toBe(true);
		expect(selectHasActive(state(task(1, "in_progress")))).toBe(true);
	});
});

describe("command rows — spec: todo-overlay / /todos 行格式", () => {
	it("indents with a two-space bullet prefix and no color", () => {
		expect(formatCommandTaskLine(task(1, "pending"), "○")).toBe("  ○ #1 task 1");
	});

	it("inlines a parked reason with a four-space gutter", () => {
		expect(formatCommandTaskLine(task(1, "waiting", { waitReason: "CI run" }), "◍")).toBe("  ◍ #1 task 1    ⏸ CI run");
	});

	it("inlines the dependency chain with the same gutter", () => {
		expect(formatCommandTaskLine(task(2, "pending", { blockedBy: [1] }), "○")).toBe("  ○ #2 task 2    ⛓ #1");
	});

	it("shows the active form for in-progress rows only", () => {
		expect(formatCommandTaskLine(task(1, "in_progress", { activeForm: "Writing" }), "◐")).toBe(
			"  ◐ #1 task 1 (Writing)",
		);
		expect(formatCommandTaskLine(task(1, "pending", { activeForm: "Writing" }), "○")).toBe("  ○ #1 task 1");
	});
});
