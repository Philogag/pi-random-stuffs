# Retrospective: add-tui-openspec-select

> Written: 2026-08-28 (after verify passed)
> Commit range: `63f2d21..3738730` (6 commits)
> Worktree: `.worktrees/feat/add-tui-openspec-select` (branch `feat/add-tui-openspec-select`)

---

## 0. Evidence

> 量化前置数据 — 后续 Wins / Misses bullets 直接引用，避免每行重复 [evidence: ...]。

- **Commit range**: `63f2d21..3738730` (6 commits)
- **Diff size**: +524 / -16 lines across 9 files
- **Tasks done**: 10/10 (`grep -cE '^\s*- \[x\]'` → 10)
- **Active hours**: ~2h (split across the original apply session + this controller session)
- **Subagent dispatches**: 8 (3 implementer, 3 task-reviewer, 1 final whole-branch reviewer, 1 scoped re-reviewer; +2 acp_delegate attempts that produced no output and were abandoned)
- **New external dependencies**: none (peerDep `@earendil-works/pi-coding-agent >=0.40.0` unchanged; devDeps unchanged)
- **Bugs encountered post-merge**: none (not merged yet)
- **OpenSpec validate state at archive**: pass (all items valid; 1 non-blocking Purpose-placeholder warning)
- **Test coverage signal**: vitest 88/88 (7 files), `tsc --noEmit` clean

Commit chain (时序):

```
63f2d21 docs(openspec): plan add-tui-openspec-select change (brainstorm, proposal, design, specs, tasks, plan)
285bebf feat(tui-openspec-status): add listActiveChanges discovery module
13d99ca feat(tui-openspec-status): add /tui-openspec-select command with manualLock
77c25b8 docs(tui-openspec-status): document /tui-openspec-select command
96d7aa7 docs(openspec): mark add-tui-openspec-select tasks complete
c7ff01b fix(tui-openspec-status): stale-reset guard, README accuracy, trailing newlines
3738730 docs(openspec): verify add-tui-openspec-select change
```

---

## 1. Wins

- [evidence: 285bebf + 13d99ca + select.test.ts] `/tui-openspec-select` command implemented end-to-end with manualLock override of bash auto-lock; all 6 spec scenarios covered by tests at the right seams (`ctx.ui.select`, `listActiveChanges` mocks).
- [evidence: c7ff01b + select.test.ts race test] Stale re-set race caught in final review and fixed with a one-line guard + a regression test the implementer proved fails without the guard.
- [evidence: 88/88 vitest + tsc clean] Full suite green throughout; the fix wave added a real race test without breaking any of the 78 existing tests.
- [evidence: plan.md + ledger rulings] SDD workflow held: per-task implementer+reviewer, pre-flight conflict scan with 5 recorded rulings, one fix wave, one scoped re-review (CLEAN).
- [evidence: verify.md §1-§7] Verify artifact passed all 7 checks; delta spec sync gap correctly flagged as 待同步 (archive will merge).

## 2. Misses

- 📌 [nit | evidence: index.ts:158 / 96d7aa7] The stale re-set race was pre-existing in shape (session_start/archive paths) and surfaced only in the final whole-branch review — an earlier task review could have caught it if the reviewer had traced render()'s snapshot-before-await pattern.
- 📌 [nit | evidence: plan.md Task 2 brief] The plan's Task-2 test code was initially broken (ctxFor lacked `select` wiring); the implementer had to fix it on the fly (ruled correct, spec is authority). Plan test snippets should be compile-checked before landing in a brief.
- 📌 [nit | evidence: README.md:42-45] The pre-existing "Behavior" bullet contradicted the new manual-picker feature until the final fix wave amended it — a sign the docs weren't re-read from the user's viewpoint after the feature landed.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1.2 (discover tests) | Fixtures create dirs under `<root>/openspec/changes/` (recursive) instead of `<root>/changes/` | Impl reads `openspec/changes/`; plan's `root/changes` fixture would let tests pass against a broken impl returning `[]` (ruling recorded) |
| 2.x (index tests) | `registerCommand` stub added to `makePi()` in index.test.ts + unlock.test.ts | Existing TUI-mode tests would crash without it once `registerCommand` was added (ruling recorded) |
| 2.3 (tool_call guard) | `schedule()` on effectiveCwd change kept BEFORE the manualLock guard | Plan Step 4 snippet conflicted with the plan's own test + spec scenario "手动锁定下 worktree 检测仍生效" — merged render required (ruling recorded) |
| 2.x (test timing) | tick() 5ms→50ms in unlock/select tests | Pre-existing load-sensitive flake; hardening only (ruling recorded) |
| 2.x (render race) | One-line stale guard `if (lockedChange !== name) return;` added in final fix wave | Closes spec gap "状态栏清空"; deferred minor promoted to fix |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ (planning phase, before this session) |
| superpowers:writing-plans                        | ✓ (planning phase, before this session) |
| superpowers:using-git-worktrees                  | ✓ (worktree pre-existed; verified + worked within it) |
| superpowers:subagent-driven-development          | ✓ (full loop: pre-flight, 3 tasks, final review, fix wave, re-review) |
| (transitive) superpowers:test-driven-development | ✓ (tests written alongside impl; race test proven to fail first) |
| (transitive) superpowers:requesting-code-review  | ✓ (code-reviewer.md template used for final review) |
| superpowers:finishing-a-development-branch       | ✓ (in progress — integration decision pending) |

### Deliberately Skipped Skills

> 全绿 — 本节空白是预期状态。

(none — all skills exercised)

## 5. Surprises

- The acp_delegate background review dispatches returned 0-byte results twice (infra hiccup); the native `subagent` tool worked fine after that — worth preferring native subagent when acp_delegate fails silently.
- The final whole-branch review (most capable model) caught a real race that 3 task reviews had passed — the "stale snapshot before await" pattern is easy to miss in scoped diffs but visible at branch scale.

## 6. Promote candidates → long-term learning

- [ ] 📌 **Plan test snippets should be type-checked before landing in a task brief** → **Promote to one-off**
  > **Why**: the Task-2 brief's select.test.ts code was broken (ui lacked select wiring); implementer fixed on the fly (spec is authority, correct).
  > **How to apply**: when generating task briefs from plan code blocks, note that snippets are illustrative; implementer owns typecheck.

- [ ] 📌 **Prefer native subagent over acp_delegate when delegate runs return empty** → **Promote to one-off**
  > **Why**: two acp_delegate review dispatches produced 0-byte results with exit 0; native subagent worked.
  > **How to apply**: if a delegate returns "(no output)" with exit 0, re-dispatch via native subagent rather than retrying the same channel.
