# Retrospective: immediate-goal-kickoff

> Written: 2026-10-09 (after verify passed)
> Commit range: `1249f648684fe9b8b48b171c6891bac78e11a85f..HEAD`（本变更以 `master` 上的单个提交交付）
> Worktree: main workspace, branch `feat/immediate-goal-kickoff`（未创建独立 git worktree，见 §4；该临时分支已在收尾的本地合并后删除）

---

## 0. Evidence

> 量化前置数据 — 后续 Wins / Misses bullets 直接引用，避免每行重复 [evidence: ...]。

- **Commit range**: 本变更以 `master` 上的**单个提交**交付，其父提交即 fork point `1249f648684fe9b8b48b171c6891bac78e11a85f`（变更开始前的 `master` tip）（1 commit）
- **Diff size**: ≈+1040 / -17 lines across 18 files（`git diff --numstat`，含本归档记录自身与版本号 bump；其中实现本体 `src/index.ts` 仅 +2 行，`src/goal-state.ts` 0 行）
- **过程提交折叠**: 本变更的 per-task/per-phase 过程提交已在 wrap-up 时折叠为上述单个 `master` 提交，故本文不再引用各阶段提交 SHA。
- **Tasks done**: 8/8（`grep -c '^- \[x\]' tasks.md` → 8；无 `- [ ]` 剩余）
- **Active hours**: ≈0.5h（ledger 文件 06:53 创建 → 07:22 最后一次提交；提交时间戳 07:02–07:22）
- **Subagent dispatches**: ≈7（T1–4 implementer batch、其 fresh-context spec reviewer、T5 静态验证、T6 真实 e2e、Round 2 WIP+delta、Round 3 artifact sync、final review；精确计数未落盘于 ledger）
- **New external dependencies**: none（`peerDependencies` / `package.json` 未改）
- **Bugs encountered post-merge**: 0（wrap-up 时以单个提交落到 `master`）
- **OpenSpec validate state at archive**: pass — `openspec validate --all --json` → 3 items / 3 passed / 0 failed（2 主 spec + 本 change）
- **Test coverage signal**: vitest `Test Files 3 passed (3) / Tests 50 passed (50)`；针对性 `vitest run test/index.test.ts` = 17 passed；`typecheck` / `build` exit 0

Commit chain (时序):

```
1249f648684fe9b8b48b171c6891bac78e11a85f  (fork point / previous master tip)
<single commit> feat(pi-goal-loop): kick off a /goal turn immediately when idle   ← 本变更的单个提交（= master tip）
```

---

## 1. Wins

- [evidence: 测试先行→实现转绿（TDD 阶段）；`task-1-4-report.md`] **真 RED → GREEN 的 TDD 循环**：4 个新用例先失败（`test/index.test.ts` RED，2 failed），实现落地仅 +2 行即转绿（17 passed），且未削弱既有断言（`makeCtx` 默认 `idle:false` 保住 3 处 `sent` 计数断言）。
- [evidence: `git diff <base>..HEAD -- packages/pi-goal-loop/src/goal-state.ts` = 空] **改动面精确收敛**：纯状态机 `goal-state.ts` 零改动，`/goal-stop`、`goal_finish`、`goal_sleep`、`agent_before_settle` 处理器全部未触碰；差异集中在 `src/index.ts`（+2 行）与测试。
- [evidence: `src/index.ts:31-40,44-49`] **复用单一续跑提示来源**：kickoff 走既有 `wakeNow()`（`buildContinuationPrompt` + `GOAL_LOOP_CUSTOM_TYPE` + `display:true` + `{triggerTurn:true}`），未在 `index.ts` 内联第二份文案，首轮与后续自动续跑在 agent 视角完全一致。
- [evidence: 真机端到端验证记录 / README「`/goal` 空闲时立即启动(2026-10-09)」；`task-6-report.md`] **功能获真实宿主端到端证据**：同一未修改源码经 RPC 模式复验，事件链 `agent_start → turn_start → message_start/end(role:"custom", customType:"goal-loop", display:true, 含目标原文) → assistant 回复 + goal_finish → agent_settled`，全程 **0 条 `role:"user"` 消息**——即无需额外用户输入即开启一轮。
- [evidence: 评审整改时；`final-review.md`「ISSUES FOUND」] **代码审查发现真实过度声明并当轮修正**：fresh-context review 指出 `tasks.md` 1.5/3.1 与 README 的「全绿」类表述与实际 `1 failed | 49 passed` 不符，评审整改时逐一改写为可核实的措辞；审查报告自身也没被当作形式主义（后续 delta 补齐与记录同步继续消费其发现）。
- [evidence: delta 补齐时；`openspec validate --all` 3/3] **补上 goal-deferral delta 消除跨 spec 张力**：final review 指出主 spec 标题将成为与已实现行为矛盾的绝对句，本 change 追加 `specs/goal-deferral/spec.md` delta（RENAMED + MODIFIED + 2 Scenario）并勾选 3.2，使变更在 archive 时能同时修正 requirement 层。

## 2. Misses

- 🟡 [painful | evidence: `plan.md`「实现期偏差记录」§2；`task-6-report.md` §1.2] **T6 指定载体 `-p --mode json` 无法观测命令触发的一轮**：print 模式在扩展命令返回 `disposition:"handled"` 后 `disposeRuntime()` 并 abort，扩展的 `sendMessage` 又是 fire-and-forget，干净流只有 `session` + `agent_start` 两行。发现晚至 T6，导致插桩临时副本 + RPC 模式返工。
- 🟡 [painful | evidence: `plan.md` §3；README `entry_appended` 旧记录] **宿主事件形态假设错误**：brief/旧 README 假设 `entry_appended`（宿主 0.87.x），实机 pi 1.1.0 发 `message_start`/`message_end`（`role:"custom"`）。旧端到端记录基于 0.87.1，易被误读为当前行为，需追加前向说明。
- 🟡 [painful | evidence: `final-review.md` §3；评审整改时] **两项「Important」级声明不实**：`tasks.md` 1.5 声称全量 `test` 全绿（实际只跑了单文件 17 例），3.1 勾选并称 `test` 全部通过（实际 exit 1）。虽在评审整改时修正，但这类过度声明本可在 apply 阶段用一次「命令原文 vs 措辞」自检避免。
- 🟡 [painful | evidence: delta 补齐时；主 `goal-deferral/spec.md:5,104`] **跨 spec 张力发现偏晚**：主 `goal-deferral` Requirement 标题与 Purpose 引言在变更落地后成为伪绝对，直到 final review 才被点名，追加了一次 delta 提交（且 Purpose 引言仍无法由 delta 修正，留为 §4/§6 的 follow-up）。
- 📌 [nit | evidence: `plan.md` 16 个 `- [ ]` step 未勾选] **plan.md 的 step checkbox 全程未勾**，完成度只由 `tasks.md` 承载；与已归档变更（archive 前勾 step）惯例不一致，易让读者误判执行状态。
- 📌 [nit | evidence: `tasks.md` 3.2] **streaming 路径未验证**：`/goal` 在 turn 边界不插队需人工交互会话，保留为显式「未验证…用户稍后自测」；verify §7 记为其唯一真实覆盖缺口。
- 📌 [nit | evidence: `final-review.md` 覆盖表 scenario 6/7] **无参查询两条 Scenario 无专门接线测试**：`/goal` 无参查询/无参数且无目标仅有文案层测试与间接的「不投递」负向守卫。

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Task 6 Step 1 | 载体由 `pi -p --mode json` 改为 **RPC 模式**（`pi --mode rpc --no-session -ne -e …`） | print 模式在命令返回 `handled` 后立即 `disposeRuntime()`+abort，无法观测命令触发的一轮（`plan.md` 实现期偏差记录 §2） |
| Task 6 Step 2 | **未运行** | 需人工交互会话验证 streaming 不插队；用户选择保留为显式未验证并稍后自测 |
| Task 5 Step 3 | 提交改用**显式文件清单**，而非计划里的 `git commit -am` | 避免把变更范围外、当时未提交的 `src/prompts.ts` WIP 一并卷入本 change 提交 |
| （范围外补充）工作区既存 WIP 收尾提交 | 既有本地 `src/prompts.ts` WIP + `test/prompts.test.ts` 期望 + README 语句作为独立提交收尾 | 该 WIP 使全量测试为 `1 failed / 49 passed`；收尾后全量 `50 passed`。该收尾提交已折叠进本变更的单个提交，明确**不属于本 change 的 spec 范围**，仅为让分支可验证 |
| （范围外补充）goal-deferral delta 补齐 | 新增 `specs/goal-deferral/spec.md` delta 并勾选 `tasks.md` 3.2 | final review 发现主 `goal-deferral` Requirement 标题将变为与实现矛盾的绝对句；以 delta 方式在 archive 时一并修正 requirement 层 |
| （范围约束）worktree | 未创建独立 worktree，改在 `feat/immediate-goal-kickoff` 分支于主工作区实施 | 见 §4 `using-git-worktrees` DELIBERATE-SKIP |

## 4. Skill / workflow compliance

本 schema（`superpowers-bridge-cn`）在 `openspec/schemas/superpowers-bridge-cn/schema.yaml`（apply 段，~L450–454）声明的 skill 清单为：`brainstorming`、`writing-plans`、`using-git-worktrees`、`subagent-driven-development`（传递依赖 `test-driven-development`、`requesting-code-review`）、`finishing-a-development-branch`。未在 schema 中发现其他声明 skill；`verification-before-completion` 与 OpenSpec 生命周期为本次实际执行但未被该 schema 显式声明的步骤，一并列出。

| Skill / workflow                                 | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓（产出 `brainstorm.md`，任务勾选/artifacts 落地时） |
| superpowers:writing-plans                        | ✓（产出 `plan.md`，任务勾选/artifacts 落地时） |
| superpowers:using-git-worktrees                  | ✗（DELIBERATE SKIP — 仅跳过 worktree 子步骤，见下） |
| superpowers:subagent-driven-development          | ✓（ledger `.superpowers/sdd/plan/`，任务 brief/report/review 齐全） |
| (transitive) superpowers:test-driven-development | ✓（RED 先观测：`task-1-4-report.md` 记录新测试在 `src/index.ts` 改动前失败，实现落地后转绿） |
| (transitive) superpowers:requesting-code-review  | ✓（一轮 fresh-context `reviewer` 静态审查 + 一轮 final review 返回 ISSUES FOUND，发现项在评审整改与记录同步中修正） |
| superpowers:finishing-a-development-branch       | ✓（本地合并 + 推送 `origin/master`：`master` 快进为单个提交，随后删除临时分支 `feat/immediate-goal-kickoff`；首次推送被拒后 rebase 到 `fbebdf6` 再推送，版本冲突取 `0.1.1`） |
| superpowers:verification-before-completion       | ✓（`openspec validate --all`、全量 test、typecheck、build 全部实跑并留原文；verify.md §1/§5） |
| OpenSpec 生命周期（proposal/design/specs/tasks/plan/verify 作者） | ✓（任务勾选时落 artifacts；delta 补齐时补 delta；verify/retrospective 本次产出） |

> **Default expectation**: 全部 ✓。每个 skill 都是 schema 设计的一部分，
> 跳过属于异常情境。任一项 ✗ 都必须在下方
> `### Deliberately Skipped Skills` subsection 提出原因与预防方案。

### Deliberately Skipped Skills

- **`superpowers:using-git-worktrees`**
  - **What was skipped**: 仅跳过「为本变更创建隔离 git worktree」这一 sub-step；**分支隔离本身未跳过**——工作在一个专用分支 `feat/immediate-goal-kickoff`（自本变更的 fork point（变更开始前的 `master` tip）切出）于主工作区完成。
  - **Why this cycle**: 具体触发条件是该包与仓库根安装**路径耦合**：仓库无 pnpm workspace 文件，`pnpm --filter @philogag/pi-goal-loop` 直接按包路径寻址，而 `node_modules` 位于仓库根；在独立 worktree 中运行需完整重新安装。磁盘上另一处证据是本 change 开始时 `src/prompts.ts` 带有范围外的未提交本地编辑，worktree 切换会引入该 WIP 的搬运风险。操作者的 apply 指令明确允许在「包与根安装路径耦合」时于主工作区用分支代替 worktree，控制器已在 `progress.md` 立「Ruling」记录（`lib/…` 无独立 worktree，`git branch` 显示仅本分支）。
  - **How to prevent recurrence**: **scope-judgment rule** —— 将操作者自身的判读固化为通用规则：「当目标包与仓库根 `node_modules` 路径耦合、或 `pnpm --filter` 按包路径寻址而无 workspace 文件时，以主工作区专用分支代替 worktree，并在 ledger 显式记录该 Ruling」。该规则应写入 adopters 的 `CLAUDE.md.fragment` 的 apply-阶段判读段（而非改 schema graph——worktree 仍应是默认路径，此处只是有据可依的 boundary case）。注意：这**不是**「one-off — schema boundary case」，因为该仓库拓扑（多包 + 根 node_modules + 无 workspace 文件）在本仓库可复现，未来同仓变更会再次命中。

> **与 §6 Promote candidates 的关系**：本 cycle 为单次 skip，尚无「多个 cycle 同 skill 同答案」的累积；若下次同仓 apply 再次命中，应在 §6 升为 schema/CLAUDE.md PR 动机。

## 5. Surprises

- **`-p --mode json` 对「命令触发的一轮」本质无用**：即使 `isIdle()` 为 true、`wakeNow()` 已执行 `sendMessage(..., {triggerTurn:true})`，print 模式也会在命令返回后 abort；这不是扩展缺陷而是载体限制（宿主 `sendMessage` 丢弃 Promise）。→ 验证任何 command-triggered run 的应用 RPC 模式。
- **宿主 pi 1.1.0 不再发 `entry_appended`**：扩展注入的 custom message 以 `message_start`/`message_end`（`role:"custom"`）呈现，与 brief/旧 README（0.87.x）描述的字段名不同。
- **本机全局已装同名扩展**：`pi -e <repo>/src/index.ts` 因 `goal_finish`/`goal_sleep` 工具名冲突而 exit 1，必须 `pi -ne -e <provider> -e <被测源码>` 才能加载。
- **主 `goal-deferral` 的 Purpose 引言无法由 delta 机制修正**：delta 只替换 Requirement 块，archive 后 Purpose 的「唤醒来源唯一性（仅定时器与超时兜底）」仍是陈旧绝对表述——需要 delta 之外的 follow-up。
- **某些 agent role 无 shell**：`reviewer`/`evidence-auditor` 不能加载 ambient 扩展、无 shell，凡需实跑命令的验证必须用 `worker`；这直接改变了 review/verify 的分工方式。

## 6. Promote candidates → long-term learning

- [ ] 📌 **本环境绝不传 `model` override 给 subagent** → **Promote to** memory (type: feedback)
  > **Why**: 本 cycle 实测传入 `omniroute/agentrouter/*` 的 `model` override 一律失败——`All credentials for model gpt-5.5 are cooling down`（429），或 `glm-5.3`/`claude-opus-4-8` 返回 `Stream ended before producing a non-ping SSE event`（responseId `chatcmpl-keepalive`，0 token）；不传 override、继承会话默认模型则成功。`progress.md` 的 Lane notes / Ruling 有逐字记录。
  > **How to apply**: 任何 `contact_supervisor`/subagent 派发前，默认省略 `model` 字段；只有确认目标模型凭证健康时才显式指定。

- [ ] 🟡 **subagent 派发到 cooldown 模型会静默浪费一轮** → **Promote to** project CLAUDE.md（pi 工作区 apply/verify 段）
  > **Why**: 本 cycle 的 override 失败以「空 SSE / 429」形式出现，且首轮已消耗调度，排查耗时。若派发前先查候选模型可用性可避免。
  > **How to apply**: 需指定模型时，先查 `{action:"models"}` 状态；遇 cooldown/空流即以会话默认模型重试，不要重复试同一 override。

- [ ] 📌 **`-p --mode json` 无法验证任何命令触发的一轮，改用 RPC 模式** → **Promote to** project CLAUDE.md（pi 扩展验证段）/ skill
  > **Why**: print 模式在扩展命令返回 `disposition:"handled"` 后 `disposeRuntime()`+abort，扩展 `sendMessage` 是 fire-and-forget（`task-6-report.md`；本次 T6 因此返工一次）。
  > **How to apply**: 凡验证 `/命令` 触发后续运行（`triggerTurn` 等），一律用 `pi --mode rpc --no-session -ne -e <provider> -e <被测源码>` 并检查 `turn_start`/`message_start`/`assistant` 事件。

- [ ] 📌 **`reviewer`/`evidence-auditor` 无法加载 ambient 扩展或无 shell，需实跑的验证交 `worker`** → **Promote to** project CLAUDE.md（agent 能力段）
  > **Why**: 本 cycle 的 fresh-context `reviewer` 无 shell，只能静态核验并请控制器代跑命令（`task-1-4-review.md` 头注明）；`progress.md` 亦记「`fd`/`rg` shims in the child environment report `Syntax error`」。
  > **How to apply**: 派发前按 agent role 的能力表选择：静态/阅读类 → `reviewer`/`evidence-auditor`；必须在子环境中 `bash`（pnpm test / git 等）→ `worker`。
