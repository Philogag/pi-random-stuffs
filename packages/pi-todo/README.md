# @philogag/pi-todo

A todo list the model maintains for itself, rendered where you can see it.

Forked from [`@juicesharp/rpiv-todo`](https://www.npmjs.com/package/@juicesharp/rpiv-todo)
2.13.8 and cut loose from the `rpiv-*` runtime. The plumbing is largely the
fork's; **the model-facing contract is not** — that is what this package is for.

## What it gives you

- **`todo` tool** — `create` / `update` / `list` / `get` / `delete` / `clear`
  over a 5-state task graph (`pending`, `in_progress`, `waiting`, `completed`,
  `deleted`), with `blockedBy` dependencies, cycle rejection, and metadata.
- **Live overlay** — a persistent widget under the editor showing the list,
  collapsible with `ctrl+shift+t` (configurable), expansion-mode aware.
- **`/todos`** — the same list on demand, grouped by status.
- **Stop-time reminders** — when a turn ends with work still open, the extension
  may ask for one more turn. Budgeted, single-flight, and escapable — see
  [docs/reminders.md](docs/reminders.md).

## Run modes

`todo` itself is host-agnostic: it is a plain tool plus a state entry, so it
works the same in every pi mode. Only two things vary, and both are explicit:

| Mode | `todo` tool | `/todos` | Overlay widget | Stop-time reminder |
| --- | --- | --- | --- | --- |
| `tui` | yes | yes | **yes** | yes |
| `rpc` | yes | yes | no | yes |
| `json` | yes | no (headless) | no | no |
| `print` | yes | no (headless) | no | no |

The overlay is never registered outside `tui`, and its module is not even
imported there, so headless runs pay nothing for it. Reminders default to
`tui` + `rpc` because that is the only case where "ask for one more turn" means
"the human can still see the answer" — override with
`reminders.modes` under [Configure](#configure).

## What changed vs the fork

| Area | Fork | Here |
| --- | --- | --- |
| Prompt copy | 8 guidelines, no `waiting` | 6 guidelines rewritten around verification and the `waiting` escape hatch — [docs/prompt-injection.md](docs/prompt-injection.md) |
| States | 4 (`pending`/`in_progress`/`completed`/`deleted`) | 5, adding `waiting` (+ required `waitReason`) |
| Stop-time reminder | absent | budgeted (`max`, default 3 per prompt), single-flight, `waiting`-aware — [docs/reminders.md](docs/reminders.md) |
| Config | own XDG `config.json` | pi's `settings.json` under `@philogag/pi-todo` — [docs/configuration.md](docs/configuration.md) |
| i18n | `@juicesharp/rpiv-i18n` SDK | English literals behind a local `t(key, fallback)` bridge |
| Widget key | `rpiv-todos` | `pi-todos` |

Kept **verbatim on purpose**, because session history depends on them: tool name
`todo`, the state entry type `pi-todo-state` (the fork's `rpiv-todo-state` is
still accepted on replay), and the `details` snapshot shape.

## Install

```bash
pi install npm:@philogag/pi-todo   # or link a local checkout
```

Or from a checkout of this monorepo:

```bash
pnpm --filter @philogag/pi-todo build
pi install ./packages/pi-todo
```

## Configure

Optional, in pi's `settings.json`:

```json
{
  "@philogag/pi-todo": {
    "maxWidgetLines": 12,
    "collapseKey": "ctrl+shift+t",
    "reminders": { "enabled": true, "max": 3, "modes": ["tui", "rpc"], "skipWhenAwaitingUser": true }
  }
}
```

Full table: [docs/configuration.md](docs/configuration.md).

## Docs

- [docs/tool-schema.md](docs/tool-schema.md) — parameters, state machine, envelopes, error strings
- [docs/prompt-injection.md](docs/prompt-injection.md) — the three prompt surfaces and what pi does with each
- [docs/reminders.md](docs/reminders.md) — the stop-time reminder policy and its guards
- [docs/overlay.md](docs/overlay.md) — the widget: layout, budget, collapse

## Develop

```bash
pnpm --filter @philogag/pi-todo build      # tsc -b
pnpm --filter @philogag/pi-todo test       # vitest run
pnpm --filter @philogag/pi-todo typecheck
```

Tests are excluded from `tsc -b` by the repo's base config (vitest transpiles
them). `test/` is organised to mirror the specs below — 9 files, 149 tests:

| File | Spec capability |
| --- | --- |
| `test/task-graph.test.ts` | `todo-task-graph` — transitions, `waiting`, `blockedBy`, metadata, tombstones |
| `test/envelope.test.ts` | `todo-task-graph` — result text, error strings, persistence seam, render hooks |
| `test/replay.test.ts` | `todo-task-graph` — branch replay precedence and copy semantics |
| `test/overlay-format.test.ts` | `todo-overlay` — rows, row budget, id gating, counts |
| `test/todo-command.test.ts` | `todo-overlay` — `/todos` groups, section order, empty/no-UI paths |
| `test/modes.test.ts` | `prompt-contract` / `todo-overlay` / `todo-reminder` — mode resolution, overlay gating, reminder gating |
| `test/reminders.test.ts` | `todo-reminder` — budget, latch, guards, prompt text |
| `test/waiting.test.ts` | `todo-task-graph` — `waiting` invariants at the reducer boundary |
| `test/prompt-contract.test.ts` | `prompt-contract` — the three surfaces and settings override |

### Specs

The behavioural contract lives in this package's own OpenSpec workspace:

```bash
cd packages/pi-todo
openspec list          # active changes
openspec validate --specs   # 4 specs / 40 requirements
```

| Capability | Covers |
| --- | --- |
| [`todo-task-graph`](openspec/specs/todo-task-graph/spec.md) | tool params, 5-state machine, `waiting`, `blockedBy` graph, envelopes, persistence/replay |
| [`prompt-contract`](openspec/specs/prompt-contract/spec.md) | the three prompt surfaces, default copy constraints, settings override |
| [`todo-reminder`](openspec/specs/todo-reminder/spec.md) | budget, single-flight latch, skip guards, prompt text, no mute switch |
| [`todo-overlay`](openspec/specs/todo-overlay/spec.md) | widget registration, row budget, collapse key, foreground gating, `/todos` |

## License

MIT — original code © the rpiv-todo authors, modifications © Philogag.
