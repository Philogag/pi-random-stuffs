# Verification Report

> 此文件由 `openspec-verify-change` skill 在 apply 完成后产生，用以确认实现
> 与 specs / design / tasks 的一致性。失败的检查须返回对应 artifact 修正后
> 再重跑 verify。

**Change**: `immediate-goal-kickoff`
**Verified at**: `2026-10-09 07:24`
**Verifier**: `worker`（执行 verify 作者；命令均在本次会话重跑）

> **过程提交折叠**：本变更的 per-task/per-phase 过程提交已在 wrap-up 时折叠为 `master` 上的**单个提交**，其父提交为本变更的 fork point `1249f648684fe9b8b48b171c6891bac78e11a85f`（变更开始前的 `master` tip），故本文不再引用各阶段提交 SHA。

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] 全部 items `"valid": true`

**结果**（`cd packages/pi-goal-loop && openspec validate --all --json`，exit 0）：

```text
{
  "items": [
    { "id": "goal-deferral",          "type": "spec",   "valid": true, "issues": [], "durationMs": 15 },
    { "id": "goal-lifecycle",         "type": "spec",   "valid": true, "issues": [], "durationMs": 3  },
    { "id": "immediate-goal-kickoff", "type": "change", "valid": true, "issues": [], "durationMs": 70 }
  ],
  "summary": {
    "totals": { "items": 3, "passed": 3, "failed": 0 },
    "byType": {
      "change": { "items": 1, "passed": 1, "failed": 0 },
      "spec":   { "items": 2, "passed": 2, "failed": 0 }
    }
  },
  "version": "1.0",
  "root": { "path": ".../packages/pi-goal-loop", "source": "nearest" }
}
```

复跑其余验证命令（供 §5/§7 引用）：

```text
$ cd packages/pi-goal-loop && openspec validate immediate-goal-kickoff --strict
Change 'immediate-goal-kickoff' is valid                       (exit 0)

$ pnpm --filter @philogag/pi-goal-loop test
$ vitest run
 Test Files  3 passed (3)
      Tests  50 passed (50)                                    (exit 0)

$ pnpm --filter @philogag/pi-goal-loop typecheck
$ tsc -b --noEmit                                              (exit 0)

$ pnpm --filter @philogag/pi-goal-loop build
$ tsc -b                                                       (exit 0)
```

**最终复跑**（verify.md 与 retrospective.md 均已写出后，于 2026-10-09 07:26 再次运行，确认 artifact 提交前状态）：

```text
$ openspec validate --all --json   → totals: {items: 3, passed: 3, failed: 0}   (exit 0)
$ pnpm --filter @philogag/pi-goal-loop test        → Test Files 3 passed (3) / Tests 50 passed (50)   (exit 0)
$ pnpm --filter @philogag/pi-goal-loop typecheck   → tsc -b --noEmit   (exit 0)
$ pnpm --filter @philogag/pi-goal-loop build       → tsc -b   (exit 0)
```

无失败项。

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] 所有 `- [ ]` 已变为 `- [x]`

**未完成任务**（若有）：

| Task | 未完成原因 | 是否阻塞 archive |
|---|---|---|
| — | — | — |

PRECHECK 原始计数（`cd packages/pi-goal-loop`）：

```text
$ git log --oneline $(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD origin/master 2>/dev/null)..HEAD | wc -l
1
$ grep -c '^- \[x\]' openspec/changes/immediate-goal-kickoff/tasks.md
8
$ grep -n '^- \[ \]' openspec/changes/immediate-goal-kickoff/tasks.md
（无输出，grep exit 1）
```

`tasks.md` 的 8 个 checkbox（1.1–1.5、2.1、3.1、3.2）全部 `- [x]`。其中两处为**有注记的历史/部分完成**，非静默勾选：

- **1.5** 的正文记录针对性运行 `vitest run test/index.test.ts` = 17 passed；全量 `1 failed | 49 passed (50)` 的历史结果由未提交的 `src/prompts.ts` WIP 造成，该失败由工作区既存 WIP 的落地提交修复（该提交已折叠进本变更的单个提交）；全量现为 `50 passed (50)`。
- **3.2** 的正文明确：空闲路径已用**未修改源码**的 RPC 模式复验通过（`-p --mode json` 载体无法观测命令触发的一轮，见 §7 与 `plan.md`「实现期偏差记录」）；streaming 路径（`/goal` 在 turn 边界不插队）标注为**未验证 — 需人工交互会话，用户稍后自测**。

两处均不阻塞 archive（见 Overall Decision）。

---

## 3. Delta Spec Sync State

对 `openspec/changes/immediate-goal-kickoff/specs/` 下的每个 capability 目录，与
`openspec/specs/<capability>/spec.md` 比对：

| Capability | Sync 状态 | 备注 |
|---|---|---|
| `goal-lifecycle` | ✗ 待 sync | delta 对 `目标登记命令（/goal）` 做 1 处 MODIFIED（新增空闲即启动/非空闲不投递/替换即启动 3 条 Scenario）；主 spec 仍是旧文本（4 条 Scenario）。待 archive 时由 OpenSpec 应用，属未归档变更的正常状态 |
| `goal-deferral` | ✗ 待 sync | delta 对 `唤醒来源仅为定时器与超时兜底` 做 RENAMED + MODIFIED + 2 条新 Scenario；主 spec 仍是旧 Requirement 标题与正文。archive 时应用 |

`openspec validate --all --json` 三个 item 均 `valid: true`（§1），说明两个 delta 语法与结构完整、可被 archive 正常应用。**✗ 待 sync 是本变更尚未 archive 的预期状态，非缺陷。**

---

## 4. Design / Specs Coherence Spot Check

抽样比对 `design.md` 的决策是否反映在 `specs/*.md` 的 Requirements 与 Scenarios 中：

| 抽样项 | design 描述 | specs 对应 | 差距 |
|---|---|---|---|
| D1 `ctx.isIdle()` 判定 | 带 `typeof ctx.isIdle === "function"` 守卫，true 才立刻投递 | `goal-lifecycle` Requirement：空闲则**立刻**投递，非空闲 MUST NOT 额外投递；对应 Scenario「空闲时立刻开始执行」「非空闲时不额外投递」 | 无（守卫是实现细节，未在 spec 层要求） |
| D2 复用续跑提示 | 复用 `buildContinuationPrompt` + `GOAL_LOOP_CUSTOM_TYPE` + `display: true` | Requirement：提示 MUST 使用与自动续跑相同的续跑提示词内容（含目标原文） | 无 |
| D3 首次与替换共用 | 统一在带参分支处理，不对「先前是否有目标」分支 | Scenario「替换目标且空闲时立刻开始执行」 | 无 |
| D4 streaming 不投递 | `isIdle()` false 时不做额外动作，交给 settle 边界 | Scenario「非空闲时不额外投递」；`goal-deferral` Requirement 明确 `/goal` 无参查询 MUST NOT 唤醒 | 无 |
| D5 状态机零改动 | `src/goal-state.ts` 不新增 API、不改语义 | `goal-lifecycle`「目标生命周期的唯一出口」「自动续跑边界」保持原义 | 无（diff 未含 `goal-state.ts`，见 §5） |

**漂移警告**（非阻塞）：

- **主 `openspec/specs/goal-deferral/spec.md` 的 Purpose 句残留漂移**：第 5 行仍写
  「唤醒来源的唯一性（仅定时器与超时兜底）」。delta 机制只能替换 **Requirement 块**，无法改写
  Purpose 引言句，故 archive 后该句仍与已实现的三来源语义矛盾。需要一次独立 follow-up（或在本
  change 追加覆盖 Purpose 的方式如不可行则手工修正）——**非阻塞**，`goal-deferral` 的 Requirement
  标题与正文会由 delta 正确改写。
- 其余 `design.md` 决策与 delta spec 一致；工作区既存 WIP 落地时曾使 `design.md` D2 的「三个出口」措辞过时，
  已在设计/验证记录同步时修正为「两个 agent 出口（`goal_finish` / `goal_sleep`）；`/goal-stop` 只在
  started/status 通知中出现」。当前无其他已知漂移。

---

## 5. Implementation Signal

- [x] Worktree 内无未 staged 的文件
- [x] 所有相关 commit 已推送 —— 操作者确认后推送至 `origin/master`：首次推送被拒（远端 `master` 已前进到 `fbebdf6 fix: release pi-goal-loop`），本提交已 rebase 到 `fbebdf6` 之上再推送，故最终父提交为 `fbebdf6`；临时分支 `feat/immediate-goal-kickoff` 已在合并后删除，其内容全部包含在该单提交中。

**Commit 范围**（若知道）：`1249f648684fe9b8b48b171c6891bac78e11a85f..HEAD` —— 本变更以 `master` 上的**单个提交**交付，其父提交即 fork point `1249f648684fe9b8b48b171c6891bac78e11a85f`（变更开始前的 `master` tip）。

```text
$ git status --porcelain
（空）

$ git diff --cached --name-only
（空）
```

Commit 链（`git log --oneline --reverse <base>..HEAD`，1 个提交）：

```text
1249f648684fe9b8b48b171c6891bac78e11a85f  (fork point / previous master tip)
<single commit> feat(pi-goal-loop): kick off a /goal turn immediately when idle   ← 本变更的单个提交（= master tip）
```

Diffstat（`git diff --numstat <base>..HEAD` → `files=18 ≈+1040 -17`；本文档自身也计入 diff，故总行数随最终提交小幅浮动）：

```text
$ git diff --stat 1249f648684fe9b8b48b171c6891bac78e11a85f..HEAD
 packages/pi-goal-loop/README.md                    |  44 +++-
 .../.openspec.yaml                                 |   2 +
 .../brainstorm.md                                  |  94 ++++++++
 .../2026-10-09-immediate-goal-kickoff/design.md    | 114 +++++++++
 .../2026-10-09-immediate-goal-kickoff/plan.md      | 187 +++++++++++++++
 .../2026-10-09-immediate-goal-kickoff/proposal.md  |  35 +++
 .../retrospective.md                               | 124 ++++++++++
 .../specs/goal-deferral/spec.md                    |  34 +++
 .../specs/goal-lifecycle/spec.md                   |  42 +++++
 .../2026-10-09-immediate-goal-kickoff/tasks.md     |  16 ++
 .../2026-10-09-immediate-goal-kickoff/verify.md    | 264 +++++++++++++++++++++
 .../openspec/specs/goal-deferral/spec.md           |  16 +-
 .../openspec/specs/goal-lifecycle/spec.md          |  23 +-
 packages/pi-goal-loop/src/index.ts                 |   2 +
 packages/pi-goal-loop/src/prompts.ts               |   3 +-
 packages/pi-goal-loop/test/index.test.ts           |  61 ++++++-
 packages/pi-goal-loop/test/prompts.test.ts         |   5 +-
 18 files changed, ≈1040 insertions(+), 17 deletions(-)
```

实现改动本体极小且集中于接线层：`src/index.ts` 只 +2 行（`if (typeof ctx.isIdle === "function" && ctx.isIdle()) wakeNow();` 及其注释）；`src/goal-state.ts` **零改动**。`test/index.test.ts` +61 行新增 4 个用例（idle 投递 / streaming 不投递 / 无参不投递 / 替换即投递），并把 `makeCtx` 参数化为 `makeCtx({ idle })`（默认非空闲，保住既有 3 处 `sent` 计数断言）。

`src/prompts.ts`（+3/-? 实际 5 行内）与 `test/prompts.test.ts` 的改动来自工作区既存 WIP 的落地提交（该提交已折叠进本变更的单个提交）：本变更开始前已存在的**未提交本地 WIP**（续跑提示词措辞 + 移除 `/goal-stop` 出口），在该落地提交中连同其测试期望与 README 语句一并收尾。它**不属于本变更 spec 范围**，是独立本地 WIP 收尾，已在 `tasks.md` 3.1 / `plan.md` 实现期偏差记录中披露。

Artifact 跟踪状态：归档后 `git ls-files openspec/changes/archive/2026-10-09-immediate-goal-kickoff | wc -l` = **8**（8 个 change 目录文件全部已跟踪并提交，无 untracked/未提交文件）。本文档中出现的相对路径 `openspec/changes/immediate-goal-kickoff/…` 均在归档时变为 `openspec/changes/archive/2026-10-09-immediate-goal-kickoff/…`。

**推送状态（最终）**：**已推送** —— 操作者确认后推送，推送后 `ahead 0`。交付方式为 `master` 上的单个提交；临时分支 `feat/immediate-goal-kickoff` 曾承载过程提交，已在 `finishing-a-development-branch` 的本地合并后删除，其内容全部包含在该单提交中。推送时远端 `master` 已前进到 `fbebdf6 fix: release pi-goal-loop`（该提交把同一文件的 `0.0.1` 提到 `0.1.0`），首次推送因此被拒；本提交已 rebase 到 `fbebdf6` 之上，版本冲突按操作者要求取 `0.1.1`，故最终父提交为 `fbebdf6`，而本文档前文使用的对照基线 `1249f64` 仍是运行时基线（`1249f64..HEAD` 的 diff 额外包含 `fbebdf6` 的那一行改动）。

---

## 6. Front-Door Routing Leak Detector（warning，非阻塞）

设计产出不应落在 `docs/superpowers/specs/`（brainstorm artifact 的
output redirection 会把它导到 `openspec/changes/<name>/brainstorm.md`）。

检测：

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

```text
$ ls docs/superpowers/specs/*.md 2>/dev/null
（无输出，exit 2 —— 该目录在仓库中不存在）
```

- [x] 无文件，或存在的文件是 schema 安装前的合法存留

**泄漏清单**（若有）：

| 文件 | 内容是否已 captured 进 change | 建议动作 |
|---|---|---|
| — | — | — |

> 不会挡住 archive。本次 brainstorm 产出正确落在
> `openspec/changes/immediate-goal-kickoff/brainstorm.md`（git 已跟踪，见 §5）。

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` 中 **无 `[~]` 标记的 deferred row**：

```text
$ grep -n '\[~\]' openspec/changes/immediate-goal-kickoff/plan.md
（无输出，grep exit 1）
```

按模板判读规则，「无 `[~]` 即不必填」本可使本节留空即 PASS。**但本 change 另有一处人工/未完成的
dogfood step 未被 `[~]` 覆盖**，为避免本节被误读为「分析了但没有缺口」，显式列出：

| Deferred dogfood (plan §) | Equivalent automated test | Coverage assessment | 真正 gap? |
|---|---|---|---|
| `plan.md` Task 6 Step 2（streaming 路径）——交互会话中 agent 工作时执行 `/goal X`，确认当轮不插队、由 `agent_before_settle` 续跑 | 无直接等价自动化测试；最近似的覆盖为 `test/index.test.ts`「does not start a turn when /goal is declared while streaming」（`makeCtx` 默认 `idle:false` → `sent` 长度为 0）——该测试只断言**不额外投递**，并不驱动一次真实 streaming 轮次去验证「该轮 settle 时照常续跑」 | 已触及：`/goal` 命令处理器的非空闲分支（分支跳过）。未触及：宿主真实 streaming 生命周期、「晚一轮续跑不丢循环」的端到端断言 | ✅ 真正 gap（但**已知且非阻塞**：需人造交互会话，`tasks.md` 3.2 已明确标注「未验证…用户稍后自测」） |
| `plan.md` Task 6 Step 1（`-p --mode json` 空闲路径）——原定义载体 | `test/index.test.ts`「starts a turn immediately when /goal is declared while idle」断言 `sendMessage`(customType/display/content/`triggerTurn`)，并由未修改源码的 RPC 模式端到端复验（README「`/goal` 空闲时立即启动(2026-10-09)」） | 已触及：命令处理器 idle 分支 + `wakeNow()` 投递 payload/选项（单测）；宿主真实一轮（RPC：`message_start/end role:"custom"` → assistant 回复 → `goal_finish`，0 条 `role:"user"`） | ❌ 已等价覆盖（原 `-p` 载体不可行，已改用 RPC 等价证据，用户已接受） |

**下游 follow-up**：上表 ✅ 行（streaming 路径）在 `retrospective.md` 的 Misses 与后续事项中记录为
唯一显式覆盖缺口。

---

## Overall Decision

- [ ] ✅ PASS — 可进入 finishing-a-development-branch 与 archive
- [x] ⚠️ PASS WITH WARNINGS — 可进入后续步骤但需注意：
  - **(a)** `tasks.md` 3.2 的后半段（streaming 中 `/goal` 在 turn 边界不插队、由 settle 续跑）**未验证**，需人工交互会话；用户已选择保留为显式的「未验证」并稍后自测。属显式声明的已知缺口，非静默遗漏。
  - **(b)** 主 `openspec/specs/goal-deferral/spec.md` 的 Purpose 引言句（`唤醒来源的唯一性（仅定时器与超时兜底）`，第 ~5 行）无法由 delta 机制修正，archive 后仍是陈旧绝对表述；需一次 follow-up 修正（见 §4 漂移警告）。
  - **(c)** `goal-lifecycle` 的 `/goal` 无参查询两条新 Scenario（`/goal` 无参查询不唤醒、无参数且无目标）无专门的接线级测试；无参分支由既有测试间接覆盖（如 `test/index.test.ts` 的 `handler("   ")` 不投递用例），属既有测试缺口而非本次回归。
- [ ] ❌ FAIL — 返回失败的 artifact 修正后重跑 verify

**下一步**：archive **可以继续**——（a）（b）（c）三项均为非阻塞的已知风险/文档卫生项，没有阻塞项。建议顺序：先由 `finishing-a-development-branch` 收尾分支；archive 后立即用一次小型 follow-up 修正 (b) 的主 spec Purpose 句，并在 retrospective 记录 (a) 的人工自测与 (c) 的测试补齐。

