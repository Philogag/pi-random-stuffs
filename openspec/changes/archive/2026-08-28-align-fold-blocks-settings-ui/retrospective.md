# Retrospective

**Change**: `align-fold-blocks-settings-ui`
**Date**: 2026-08-28
**Base**: `958cba8bcd8157af5fdf352f8ab1d2762f64b180`

---

## §0 Evidence

- **Commits**: 6 (`958cba8..dd23862`)
  `e167503` test: settings mapping helpers · `7420265` test: fix stale render/index tests · `e1244fe` feat: native SettingsList page · `ca87021` refactor: english description · `7d172fe` docs: README settings · `dd23862` chore: acceptance grep cleanup
- **Diff**: 6 files changed, ~250 insertions / ~90 deletions (src/settings.ts rewrite, test/render.test.ts rewrite, test/index.test.ts fix, test/settings.test.ts + command.test.ts new, README, index.ts 1 line)
- **Tasks**: 13/13 complete (tasks.md all `- [x]`; plan.md 23/23 task checkboxes)
- **Subagent dispatches**: 5 (1 failed pre-flight: `del_mtccexul_eatk` — dist missing; then Task1 `del_mtccgtn2_iqzs`, Task5 `del_mtccndj6_ys5i`, Task2 `del_mtccqpus_vopt`, Task3+4 batched `del_mtcctao7_4czw`)
- **New external deps**: 0
- **Merge-time bugs**: 0 (pending merge)
- **openspec validate at archive time**: 3/3 valid (1 pre-existing WARNING on `tui-openspec-status` spec Purpose placeholder — from previous change)
- **Test coverage signal**: 31/31 tests pass (7 suites); settings/render/index suites rewritten against current API
- **Activity**: single apply session, ~45 min

---

## §1 Wins

- **Full TDD on the core refactor**: Task 1 (helpers) went red → green → full suite, with the failing output (`boolToCfg is not a function`) captured verbatim in the report.
- **Batched tiny tasks**: Tasks 3+4 (1-line description + README section) dispatched as ONE worker run with two exact-message commits — saved a dispatch round-trip.
- **Pre-existing test debt fixed instead of papered over**: 7 stale failures at base (render API renamed by a remote merge, eager registration) were rewritten against the current API — user-approved scope addition, suite went 27→31 green.
- **Acceptance greps enforced to zero**: plan required `grep nextMode` and Chinese-UI-string greps to return nothing; two 1-line cleanup commits (describe title, README feature bullet) closed the last hits.
- **No scope creep**: handler logic, onSave closure, config schema, and settings.json format all untouched — only the page rendering changed.

## §2 Misses

- 🟡 **First Task 1 dispatch failed at load time**: delegate's own pi process auto-loads `../packages/pi-tui-fold-blocks` from the fresh worktree (`.pi/settings.json` is git-tracked) → `Cannot find module dist/index.js` because dist/ isn't built in a fresh worktree. Fixed by pre-building the package in the worktree before dispatching.
- 📌 **Task 3+4 plan wording lured a misstep**: plan's pre-flight had already resolved the `ctx.ui` cast question, but the brief still said "if it fails to typecheck, add a cast" — worker correctly used no cast. Low noise, but brief could have been absolute.
- 📌 **Two grep-cleanup commits post-acceptance**: `nextMode` survived in a test describe string (plan's own mandated test code!) and "显示模式" survived in a README feature bullet. The plan's Task 6 grep targets were not pre-checked against the plan's own Task 2 mandated strings — a 2-minute parent fix, but it should have been caught at plan-writing time.

## §3 Plan Deviations

- **Task 5 added (scope addition, user-approved)**: base `958cba8` carried 7 pre-existing test failures (stale render/index tests from a remote render-API refactor merged at `958cba8`). Plan Task 6 Step 1 demanded "all suites pass", which was impossible without fixing them. Surfaced to user → chose "Update stale tests". Plan.md/tasks.md updated with Task 5; acceptance renumbered to Task 6.
- **Acceptance cleanup commits (dd23862)**: two 1-line edits (test describe title, README bullet) to satisfy Task 6's zero-match greps — small deviation folded into a `chore` commit.

## §4 Skill / Workflow Compliance

| Skill | Used? |
|---|---|
| superpowers:using-git-worktrees | ✓ (worktree `feat/align-fold-blocks-settings-ui` from base) |
| superpowers:subagent-driven-development | ✓ (per-task worker dispatches + briefs + reports; no parallel implementation dispatches) |
| superpowers:test-driven-development | ✓ (Task 1 red→green; each task verified via suite) |
| superpowers:verification-before-completion | ✓ (suite/build/typecheck + greps before every commit claim) |
| superpowers:finishing-a-development-branch | ✓ (pending merge — this session's final step) |

### Deliberately Skipped Skills

None. All apply-phase skills executed.

## §5 Surprises

- **The worktree's pi process loads the extension at startup**: `.pi/settings.json` is committed to git, so every fresh worktree auto-loads the fold-blocks package and crashes if `dist/` is absent. This is the second time this bit a dispatch (first was pi-tui-openspec-status cycle). Root cause is known; see promote candidate.
- **`openspec status --json` reports `defaultSchema: spec-driven` but the change schema is `superpowers-bridge-cn`** — the two views disagree; planning/apply must trust `status --change <name> --json`'s per-change schema, not the planningHome default.

## §6 Promote Candidates → Long-term Learning

- [ ] 🟡 Fresh worktrees need `dist/` pre-built before dispatching extension workers — `.pi/settings.json` is git-tracked and auto-loads packages
  - → **Promote to** memory
  - > **Why**: Second occurrence (pi-tui-openspec-status, align-fold-blocks-settings-ui): worker's pi process crashed `Cannot find module dist/index.js` in a fresh worktree.
  - > **How to apply**: Any time a new worktree is created for a package with a `dist/` build and `.pi/settings.json` is tracked, run `pnpm -F <pkg> build` in the worktree BEFORE dispatching any delegate.
- [ ] 📌 Plan writers must grep their own mandated test strings against acceptance grep targets
  - → **Promote to** skill / one-off
  - > **Why**: Task 2's mandated `describe("settings bool helpers (replaces removed nextMode)")` directly violates Task 6's `grep nextMode → no matches`; README feature bullet "三态显示模式" hits `显示模式` grep. Cost: 2 post-hoc cleanup commits.
  - > **How to apply**: In plan.md self-review, run every acceptance grep against every verbatim string the plan itself mandates.
- [ ] 📌 Batched tiny-task dispatch (Task 3+4 in one run, two exact commits) worked well
  - → **Promote to** skill
  - > **Why**: Saved a dispatch round-trip; worker handled two disjoint files with two exact-message commits cleanly.
  - > **How to apply**: For tasks ≤ 2 lines / one section each with disjoint files and fixed commit messages, batch into one worker run with explicit per-task commit instructions.
- [ ] 📌 `.pi/settings.json` accumulating entries per installed package is local dev state, not change scope
  - → **Promote to** one-off
  - > **Why**: Main repo `.pi/settings.json` gained `pi-tui-openspec-status` entry from the prior session; it's the machine's pi config, deliberately left unstaged.
  - > **How to apply**: Don't commit `.pi/settings.json` mutations as part of unrelated changes; treat as user-local state unless the change is about extension loading.

---

## Follow-ups from verify

- [ ] 补写 `openspec/specs/tui-openspec-status/spec.md` Purpose 段（`openspec validate` WARNING，前次 change 遗留）
- [ ] Task 6 §3 手工 TUI smoke deferred（无交互终端）——settings/render 数据流由单元测试等价覆盖；归档后可在真实 TUI 里跑一次 `/tui-fold-blocks` 目检

---

## §7 Post-hoc: Cross-machine merge (2026-08-28)

Two master commits (`66d3cf4`, `72fc764`) from the user's other machine landed while this change was in flight, both touching files our branch modified (render.test.ts, index.test.ts, index.ts). Resolved via `git merge origin/master` into the branch: their render.ts/index.ts/test rewrites kept, our settings page + English description merged in, suite re-verified 33/33. Lesson reinforced: monitor `origin/master` for concurrent pushes during long apply sessions; re-fetch + re-merge before the final branch merge.
