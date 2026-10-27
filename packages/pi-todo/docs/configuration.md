# Configuration reference

Every option `@philogag/pi-todo` reads, where the value lives, and exactly what
happens when it is wrong.

## Where the settings live

No config file of its own. Options are read from pi's own `settings.json`
(`getAgentDir()`, overridable with `$PI_CODING_AGENT_DIR`) under the package key:

```json
{
  "@philogag/pi-todo": {
    "maxWidgetLines": 12,
    "collapseKey": "ctrl+shift+t",
    "reminders": {
      "enabled": true,
      "max": 3,
      "skipWhenAwaitingUser": true,
      "modes": ["tui", "rpc"]
    }
  }
}
```

The section is optional. Absent, malformed, or a non-object value means every
default applies — the extension never writes this file. A read failure is
swallowed (a broken settings.json elsewhere in pi must not take the todo list
down with it), and every value is validated individually: one bad field falls
back to its own default instead of discarding the whole section.

Everything except `collapseKey` is read fresh on each use, so the reminder budget
or the overlay line budget takes effect immediately. `collapseKey` is bound once
at load — `/reload` after changing it.

## `maxWidgetLines`

**Default `12`.** Content-row budget for the overlay — the heading row and, on
overflow, the `+N more` row both count against it. Only the trailing blank
spacer sits outside the budget, so `12` renders up to 13 terminal rows.

- Floor of `3`; below that, or a non-number, falls back to the default.
- No ceiling.
- Read fresh on every render.
- Pi's tool-output expansion mode (`ctrl+o`) temporarily overrides the budget and
  shows every task; collapsing restores it.

## `collapseKey`

**Default `"ctrl+shift+t"`.** Shortcut that collapses and expands the overlay.

The value is trimmed and lowercased, then matched against pi's keybinding
grammar: zero or more distinct modifiers joined by `+`, then a base key.

| Part | Accepted |
| --- | --- |
| Modifiers | `ctrl`, `shift`, `alt`, `super` — each at most once |
| Base key | one printable character (`a`, `7`, `]`, `/`, …) |
| Base key | a named key: `escape`, `esc`, `enter`, `return`, `tab`, `space`, `backspace`, `delete`, `insert`, `clear`, `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`, `f1`–`f12` |

Examples: `alt+o`, `ctrl+shift+t`, `super+alt+f5`.

- Missing, empty, blank, non-string, or ungrammatical → default. The grammar is
  checked strictly on purpose: pi takes the last `+`-part as the base key and
  ignores unknown parts, so a typo like `ctr+]` would otherwise capture every
  bare `]` keypress globally.
- `"off"` disables the feature — no shortcut is registered at all.
- Resolved **once at extension load**; `/reload` to rebind.

## `reminders`

Stop-time nudges. See [reminders.md](./reminders.md) for the mechanism; this is
the knob table.

### `reminders.enabled`

**Default `true`.** Master switch. `false` disables the `agent_before_settle`
handler's entire effect — no reminder, no extra request.

### `reminders.max`

**Default `3`.** Reminders allowed **per user prompt**. Clamped to `1…9`; a
non-number or non-finite value falls back to the default.

The ceiling exists because every reminder is a full extra provider request, and
an unbounded `continue: true` is the documented infinite-loop anti-pattern. The
budget is per prompt, not per session: a new user message resets it, an internal
continuation never does.

### `reminders.skipWhenAwaitingUser`

**Default `true`.** Suppress the reminder when the settling turn's last non-empty
line is a question to the user (`?`, `？`, or phrases like "would you like…",
"let me know…"). A false positive costs one reminder; a false negative spends a
request nagging a question that was already asked.

### `reminders.modes`

**Default `["tui", "rpc"]`.** Which pi run modes may spend a reminder.

| Mode | `hasUI` | Default | Why |
| --- | --- | --- | --- |
| `tui` | true | on | A human is watching a terminal. |
| `rpc` | true | on | A client is driving the session and receives the nag as an event. |
| `json` | false | off | Streaming pipeline, usually one prompt: an injected continuation is an unsolicited extra turn and a silent doubling of cost. |
| `print` | false | off | One-shot run, nobody to act on the nag. |

Unknown mode names are dropped, duplicates collapse, and the result is sorted
`tui` → `rpc` → `json` → `print`. An override with nothing usable falls back to
the default set — it is never read as "off". Turn reminders off with
`reminders.enabled: false`.

```json
{ "@philogag/pi-todo": { "reminders": { "modes": ["tui", "rpc", "json"] } } }
```

## `guidance`

`guidance.promptSnippet` (string) and `guidance.promptGuidelines` (array of
strings) replace the prompt copy the `todo` tool injects into the model's
context. See [prompt-injection.md](./prompt-injection.md) for what pi does with
each field.

- `promptSnippet` must be a non-empty string; empty or wrong type → default.
- `promptGuidelines` must be a non-empty array of non-empty strings. A non-array,
  or an array containing an empty string, falls back to the default — the array
  is all-or-nothing, not merged item by item.
- Both are read at extension load; `/reload` after editing.

## Environment variables

| Variable | Effect |
| --- | --- |
| `PI_CODING_AGENT_DIR` | Relocates pi's agent dir, and with it `settings.json`. |
| `PI_TODO_DEBUG` | `1` logs every skipped reminder with its reason (budget, latch, …). |

`@philogag/pi-todo` reads no other environment variables. There is no i18n layer:
chrome strings are English literals in `src/state/i18n-bridge.ts`.
