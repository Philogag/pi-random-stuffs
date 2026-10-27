# How this tool injects into the prompt

`todo` reaches the model through three separate surfaces. They are not
interchangeable, and knowing which is which is the difference between "the model
knows the tool exists" and "the model uses it correctly".

| Surface | Where it lands | What it is for |
| --- | --- | --- |
| `description` | provider-native tool schema (in the API request as the function description) | the contract: actions, parameters, semantics |
| `promptSnippet` | the `<tools>` section of the system prompt, one line: `- todo: <snippet>` | makes the tool *visible* in the tool list |
| `promptGuidelines` | the `<rules>` section of the system prompt, one `- ` bullet each | when and how to use it |

The description is **not** part of the system prompt. A model that reads only the
system prompt learns the tool's name from the snippet and its rules from the
guidelines; the parameter documentation only arrives with the schema.

## What pi core actually does with these fields

Verified against `@earendil-works/pi-coding-agent` `dist/core/agent-session.js`
and `dist/core/system-prompt.js`:

- **`promptSnippet` is normalized to one line** — newlines become spaces,
  whitespace runs collapse, the result is trimmed. A snippet that normalizes to
  empty is dropped, and a tool with no snippet is *not listed in `<tools>` at
  all* (its schema may still be offered). So the snippet is the tool's visibility
  switch, not decoration.
- **`promptGuidelines` are trimmed and de-duplicated** through a `Set`, order
  preserved. They are rendered as `- rule` bullets inside `<rules>`, after the
  built-in tool-availability rules (the "use bash for file operations…" family)
  and before pi's two always-on rules (`Be concise in your responses`,
  `Show file paths clearly when working with files`).
- Both are resolved **at load** into the system prompt's structured sections and
  re-rendered whenever the prompt is rebuilt (tool loadout changes, compaction,
  `/reload`). Editing them in settings needs a `/reload`.
- Duplicates are dropped **within this tool's list and across lists** — a
  guideline identical to a built-in rule collapses into one bullet.

## Why the defaults are six lines

Every line here is paid on every request, in every turn, forever. The original
fork shipped eight guidelines and the ones that actually changed behaviour were
buried. Six lines, each answering a distinct failure:

1. **When to create a list** (multi-step, user-supplied list, definition of done)
   and when not to (trivial, conversational) — prevents list-spam on one-liners.
2. **Exactly one `in_progress`, set before the work** — the classic failure is a
   list with four tasks "in progress", which reports nothing.
3. **Complete only when verified** — a blocker is a *new task*, never a
   premature completion. This is the rule the `waiting` status exists to support.
4. **`waiting` with a `waitReason` when externally blocked** — the escape hatch
   from the stop-time reminder, spelled out in the prompt so the model does not
   have to discover it (see [reminders.md](./reminders.md)).
5. **`status` is the field that moves a task**, plus the exact call shape — the
   single most common protocol error is sending an update with only an `id`.
6. **`blockedBy` is additive** — `addBlockedBy` / `removeBlockedBy`, never resend
   the array; cycles are rejected.

Deliberately omitted: a bullet restating the parameter list (the schema already
does that, and restating it doubles the cost) and a bullet about `includeDeleted`
— it survives only as a parenthetical in rule 5.

## Overriding

`guidance.promptSnippet` / `guidance.promptGuidelines` under the
`@philogag/pi-todo` settings key replace the defaults wholesale (all-or-nothing
per field, never merged item by item). See
[configuration.md](./configuration.md#guidance). The override exists because the
right copy depends on the project's workflow; the defaults are the best general
answer, not dogma. `test/prompt-contract.test.ts` pins both the defaults and the
override path.
