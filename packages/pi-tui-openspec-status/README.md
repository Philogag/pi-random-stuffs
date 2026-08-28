# `@philogag/pi-tui-openspec-status`

A [pi coding agent](https://github.com/mattoopie/pi) extension that
shows the current locked **openspec** change as a single status-bar line:

```
add-pi-tui-openspec-status (superpowers-bridge-cn) [P● D● S○ T○] Tasks: ███░░░░░░░ 2/7
```

## Install

```bash
pnpm add -D @philogag/pi-tui-openspec-status
```

Then enable in your pi config (`~/.pi/settings.json` or
`<repo>/.pi/settings.json`):

```json
{
  "extensions": ["@philogag/pi-tui-openspec-status"]
}
```

## Activation mode

The extension is **TUI-only**. It checks `ctx.mode === "tui"` at factory
time and early-returns in any other mode:

| Mode       | Activates? | Notes                              |
|------------|------------|------------------------------------|
| `tui`      | ✅ yes     | Normal interactive operation        |
| `rpc`      | ❌ no      | `ctx.hasUI === true` here too, but mode check excludes it |
| `json`     | ❌ no      | No event-stream output             |
| `print`    | ❌ no      | `-p` one-shot mode                 |

Per `pi.dev/docs/latest/extensions#ctx-mode`, `ctx.mode` (not
`ctx.hasUI`) is the correct TUI feature gate.

## Behavior

- The status line appears when you (or the agent) invoke an
  openspec command that **explicitly names a change** —
  `new`, `status`, `apply`, `archive`, `verify`, `sync`,
  `instructions`, `show`, `validate`, `context`, `view` — **or** when
  you manually select a change with `/tui-openspec-select`.
- Browsing commands like `openspec list` / `openspec doctor` clear the
  status line.
- The line refreshes 500ms after each matching `bash` tool call.

## Manual tracking with `/tui-openspec-select`

In TUI mode you can take manual control of the status bar with the
`/tui-openspec-select` command:

- Opens an interactive picker listing every **active** change
  (`openspec/changes/*/` minus `archive/`) plus a `None` option.
- Selecting a change manually **locks** the status bar to it: bash
  `openspec` commands will NOT switch it away until you manually
  re-select another change or pick `None` (manual overrides auto).
- Picking `None` clears the manual lock and restores automatic
  tracking from bash commands.
- Cancelling the picker (Esc) changes nothing — the current tracking
  state is left untouched.
- Archiving the manually tracked change (e.g. `openspec archive <name>`)
  still auto-clears the status bar, as usual.

## Worktree support

When `openspec` is invoked inside a git worktree
(e.g. `.worktrees/feat/openspec-status/`), the extension reads
`tasks.md` from **both** the main repo and the worktree, then
deduplicates by task ID:

- A task is "done" if checked in either side.
- Total count is the union of unique task IDs.

This prevents the progress bar from regressing when the worktree is
ahead of the main repo (the common SDD apply scenario).

## Limitations

- Only the schema's external artifacts (`proposal`, `design`, `specs`,
  `tasks`) appear; planning-phase internal artifacts
  (`brainstorm`, `verify`, `retrospective`) are hidden.
- Requires the `openspec` CLI on `$PATH`. Missing CLI silently disables
  the extension.
- Does **not** render widgets, dialogs, or keyboard shortcuts — only
  the bottom status bar (`ctx.ui.setStatus`).
- **Does not activate in non-TUI modes** (rpc/json/print) — by design.