# The stop-time reminder

The one place this extension asks for another turn. Everything here is in
`src/reminders.ts` as a pure function (`planReminder`) so the state machine is
testable without an agent runtime, and wired to pi in `src/index.ts`.

## Why a budget and not a mute

Every reminder costs one full provider request. The anti-pattern this guards
against is an unconditional `continue: true` at stop time: the model ends a turn
with open tasks, the harness resumes it, it ends again, forever. So the ceiling
is hard and small (default 3 per user prompt).

The tempting alternative — a `todo pause_reminder` operation — is deliberately
**absent**. A mute with no visible residue is cheaper than finishing the work, so
the model would learn to press it. The escape hatch is structural instead: move
the task to `waiting` with a `waitReason`. That is visible in the overlay, it is
reversible with `status: in_progress`, and it removes the task from the set the
reminder ever looks at.

## When it fires

`agent_before_settle` → `planReminder` → either a skip with a reason, or a
`custom_message` entry (`customType: "pi-todo-reminder"`) plus `continue: true`.

Guards, in order. The first one that matches wins and the reminder is skipped:

| Reason | Condition |
| --- | --- |
| `disabled` | `reminders.enabled` is false. |
| `not-completed` | the settle outcome is `aborted` or `error` — never nag into an interrupt or a real failure. |
| `awaiting-progress` | the single-flight latch is still set: no tool result since the last reminder. |
| `budget-exhausted` | `attempt >= reminders.max`. |
| `no-open-tasks` | nothing is `pending` or `in_progress` (see below). |
| `awaiting-user` | the turn's last line is a question (guard can be turned off). |
| `no-continuation` | pi itself refuses to continue (no runnable context). |

Open means `pending` **or** `in_progress`. `waiting` is excluded by
construction, and `completed` / `deleted` are not work.

## The two pieces of state

```ts
interface ReminderState {
  attempt: number;          // reminders fired for the CURRENT user prompt
  awaitingProgress: boolean; // single-flight latch
  trail: ReminderDecision[]; // bounded audit ring, newest last
}
```

- **`attempt` is reset by exactly one thing**: a new user prompt
  (`before_agent_start`). Not by tool results, not by compaction, and — this is
  the load-bearing detail — not by `agent_start`, which also fires for the
  continuation the extension itself triggers. Resetting there would turn the
  ceiling into an infinite loop.
- **`awaitingProgress`** is set when a reminder fires and cleared by the next
  tool result of *any* tool, not just `todo`. A run of productive work must
  release the latch; only a turn that ends with nothing having happened stays
  quiet.

State is kept per session id, so a child session cannot spend — or reset — the
foreground session's budget.

The trail keeps the last 12 decisions (`TRAIL_LIMIT`) with an estimated
output-token count per fired reminder. `PI_TODO_DEBUG=1` prints skips with their
reason; a fired reminder is already visible in the transcript (`display: true`),
because a nag the user cannot see is indistinguishable from the model talking to
itself.

## What the reminder says

Short, enumerating the open tasks (at most 6, then `… and N more`), then four
numbered options: continue, complete if verified, park in `waiting`, or delete —
and an explicit statement that staying silent is legitimate when actually
blocked, plus the budget's remaining value. The wording is pinned by
`buildReminderPrompt`'s tests because it is prompt copy, not decoration.

## Run modes

The reminder is gated on `ctx.mode` before any state is touched, because it is a
**cost** decision rather than a UI one — each firing is one full provider
request:

| Mode | Fires? | Why |
| --- | --- | --- |
| `tui` | yes | A human is at the terminal. |
| `rpc` | yes | A client drives the session; the nag arrives as an event it can act on. |
| `json` | no | A streaming pipeline usually runs one prompt; a continuation would be an unsolicited extra turn and a silent doubling of cost. |
| `print` | no | One-shot run, nobody on the other end. |

`reminders.modes` overrides the set (see
[configuration.md](./configuration.md#remindersmodes)). When `ctx.mode` is
missing — an older host — the mode falls back to `hasUI`: UI means `tui`,
no UI means `print`, i.e. the conservative side of both axes.

In `rpc` the reminder reads **this session's own** task slot rather than the
ctx-less foreground render slot: the render slot is only claimed in TUI mode, so
reading it would make every RPC reminder see an empty list. Same reason a child
session never judges its parent's tasks.

## Headless noise avoided

In `rpc`, `json` and `print` the overlay module is never imported (and the lazy
pre-warm never fires): the host either discards widget factories (`rpc`) or has
a no-op UI (`json`, `print`). `/todos` still works in `rpc` — its text goes out
through `notify`, which the RPC host forwards on the extension UI sub-protocol.
