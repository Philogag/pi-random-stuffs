# `todo` tool reference

Complete parameter schema, status machine, response envelope, and error strings
for the `todo` tool registered by
[`@juicesharp/rpiv-todo`](https://www.npmjs.com/package/@juicesharp/rpiv-todo).

## Actions

| Action | Required params | What it does |
| --- | --- | --- |
| `create` | `subject` | Adds a task in `pending`, assigns the next id. |
| `update` | `id` + at least one mutable field | Changes status, fields, or dependencies. |
| `list` | — | Returns all tasks, optionally filtered by `status`. |
| `get` | `id` | Returns one task with its `blockedBy` and reverse `blocks` edges. |
| `delete` | `id` | Tombstones the task (`status: "deleted"`); it is not removed. |
| `clear` | — | Drops every task and resets the id counter to `1`. |

## Parameters

```ts
todo({
  action: "create" | "update" | "list" | "get" | "delete" | "clear",

  // create-only
  subject?: string,                   // required for create
  blockedBy?: number[],               // initial dependency ids

  // create + update
  description?: string,               // long-form detail
  activeForm?: string,                // present-continuous label shown while in_progress
  owner?: string,                     // agent/owner assigned to this task
  metadata?: Record<string, unknown>, // on update, a null value deletes that key

  // update-only
  addBlockedBy?: number[],            // additive merge into blockedBy
  removeBlockedBy?: number[],         // additive removal from blockedBy

  // update / get / delete
  id?: number,

  // update (sets this task's status) or list (filters by status)
  status?: "pending" | "in_progress" | "waiting" | "completed" | "deleted",

  // update, required whenever status is "waiting"
  waitReason?: string,                // what external event this task is parked on

  // list-only
  includeDeleted?: boolean,           // default false — hides tombstones
})
```

`update` merges `metadata` key by key into the existing record; passing `null`
for a key removes it, and emptying the record drops the field entirely.
`addBlockedBy` and `removeBlockedBy` are additive — do not resend the whole
array.

## Status transitions

| From | Allowed targets |
| --- | --- |
| `pending` | `in_progress`, `completed`, `waiting`, `deleted` |
| `in_progress` | `pending`, `completed`, `waiting`, `deleted` |
| `waiting` | `pending`, `in_progress`, `completed`, `deleted` |
| `completed` | `deleted` |
| `deleted` | _(terminal)_ |

A transition to the current status is always accepted and reported as a no-op.
`delete` keeps the task as a tombstone so historic `blockedBy` references still
resolve; tombstones are hidden from `list` unless you pass `includeDeleted: true`.

### `waiting` — parking, not finishing

`waiting` is this fork's one addition to the fork source's state machine, and it
exists to give the model a legitimate way to stop: a task blocked on an external
event (CI run, subagent, user decision) is not `in_progress` work and must not be
`completed` work either — marking it completed early is the failure mode the
prompt guidelines explicitly forbid.

- **Entering requires `waitReason`** (non-blank, trimmed, persisted on the task).
  A waiting task without a reason is a silent mute with nothing to audit, so the
  update is rejected: `status: waiting requires waitReason (what external event are you waiting for?)`.
- **Leaving clears it.** `waiting` is reversible into `pending` or `in_progress`,
  and the `waitReason` field is dropped when the task moves on. Reversibility is
  the point — a one-way door would teach the model to use `completed` as its
  parking spot instead.
- **It is not open work.** Reminders and `open` counts consider only `pending`
  and `in_progress`, so a parked task never triggers a nag. See
  [reminders.md](./reminders.md).
- **It is visible everywhere**: `/todos` renders a `── Waiting ──` section with a
  `◍` glyph, and the overlay counts it in the heading summary.

## Dependencies

`blockedBy` holds the ids this task waits on. Validation runs before the state
is mutated, so a rejected call leaves the list untouched:

- a dependency id that does not exist is rejected;
- a dependency that is already tombstoned is rejected;
- blocking a task on itself is rejected;
- an `addBlockedBy` that would close a cycle in the graph is rejected.

`get` also reports the reverse edges as a `blocks:` line, derived from the other
tasks' `blockedBy` arrays.

## Return envelope

```ts
{
  content: [{ type: "text", text: string }], // human-readable summary of the op
  details: {                                 // full snapshot — replay reads this back
    action: TaskAction,
    params: Record<string, unknown>,
    tasks: Array<{
      id: number,
      subject: string,
      description?: string,
      activeForm?: string,
      status: "pending" | "in_progress" | "waiting" | "completed" | "deleted",
      waitReason?: string,                  // present only while status is waiting
      blockedBy?: number[],
      owner?: string,
      metadata?: Record<string, unknown>,
    }>,
    nextId: number,
    error?: string,                          // present only on a rejected call
  }
}
```

## Persistence

`details` is the persistence format. Every successful call embeds the complete
post-mutation snapshot. Every call that changes the list (`create`, `delete`,
`clear`, or an `update` that changed something) also saves the same `details`
object as a `pi-todo-state` custom entry on the session branch (a legacy
`rpiv-todo-state` entry from the fork still replays). Custom entries
are never sent to the model.

The custom entry matters when `todo` is called from another tool, such as a Pi
codemode script: Pi records that call only as a short summary on the outer
tool's result, so its own `details` never reach the branch.

The session-lifecycle handlers rebuild state by walking the branch and taking
the last `pi-todo-state` snapshot. Sessions saved before these entries existed
fall back to the last `todo` tool result's `details`. Either way, tasks survive
`/reload`, `/resume`, `/tree` and compaction without any disk writes.

## Content strings

| Situation | `content[0].text` |
| --- | --- |
| Created | `Created #3: Write the parser (pending)` |
| Updated with a status change | `Updated #3 (pending → in_progress)` |
| Updated without a status change | `Updated #3` |
| Update that changed nothing | `No change: #3 already matches the requested values (status: in_progress)` |
| Deleted | `Deleted #3: Write the parser` |
| Cleared | `Cleared 7 tasks` |
| `list` row | `[in_progress] #3 Write the parser (writing the parser) ⛓ #1,#2` |
| `list` with nothing to show | `No tasks` |
| Any rejection | `Error: <message>` |

The `No change` reply exists so a model that re-issues an identical update sees
that it was a no-op instead of a fresh `Updated #N`.

## Error messages

| Message | Cause |
| --- | --- |
| `subject required for create` | `create` without a non-blank `subject`. |
| `blockedBy: #N not found` | `create` naming an unknown dependency. |
| `blockedBy: #N is deleted` | `create` naming a tombstoned dependency. |
| `id required for update` / `get` / `delete` | `id` omitted. |
| `#N not found` | No task with that id. |
| `update requires at least one mutable field: subject, description, activeForm, status, owner, metadata, addBlockedBy, or removeBlockedBy` | `update` with only an `id`. |
| `illegal transition completed → in_progress` | Target status not reachable from the current one. |
| `status: waiting requires waitReason (what external event are you waiting for?)` | `status: "waiting"` without a non-blank reason. |
| `cannot block #N on itself` | `addBlockedBy` includes the task's own id. |
| `addBlockedBy: #N not found` / `is deleted` | Unknown or tombstoned dependency. |
| `addBlockedBy would create a cycle in the blockedBy graph` | The edge would close a cycle. |
| `#N is already deleted` | `delete` on a tombstone. |

Errors are returned in-band: `content` carries `Error: …` and `details.error`
carries the bare message. Task state is unchanged.

## Prompt guidance

The tool ships a `promptSnippet` and eight `promptGuidelines` bullets telling the
model when to open a list, to keep exactly one task `in_progress`, to mark work
completed immediately rather than in batches, never to complete a task with
failing tests, and the literal `update {id, status}` call shape for changing a
task's status. Both are overridable — see
[configuration.md](./configuration.md#guidance).
