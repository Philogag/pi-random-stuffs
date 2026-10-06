# Verification Report

> 此文件由 `openspec-verify-change` skill 在 apply 完成后产生，用以确认实现
> 与 specs / design / tasks 的一致性。失败的检查须返回对应 artifact 修正后
> 再重跑 verify。

**Change**: `add-goal-loop`
**Verified at**: `2026-10-06 03:17`
**Verifier**: `pi (stdd-apply 流程)`

**Precheck（实现证据）**：

```text
$ git log --oneline f5158bb..HEAD | wc -l     # 必须以 merge-base 为基线
11
$ grep -c '^- \[x\]' openspec/changes/add-goal-loop/tasks.md
30
```

两条均 > 0，apply 阶段已产出可审查的变更。

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] 全部 items `"valid": true`

**结果**（在 `packages/pi-goal-loop` 运行）：

```text
{
  "items": [
    { "id": "add-goal-loop", "type": "change", "valid": true, "issues": [] }
  ],
  "summary": { "totals": { "items": 1, "passed": 1, "failed": 0 } }
}
```

若有失败项，列出 id + issues：

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [ ] 所有 `- [ ]` 已变为 `- [x]`
- 统计：`- [x]` **30** 项，`- [~]` **1** 项，`- [ ]` **0** 项 → 无未开始任务

**未完成任务**（若有）：

| Task | 未完成原因 | 是否阻塞 archive |
|---|---|---|
| 6.3 | 手工验收**部分完成**：`/goal` 自动续跑与 `goal_finish` 收口已在真实 pi 0.87.1 会话中端到端验证；`/goal-stop`、`goal_sleep` 抑制/唤醒、Esc 中断、`/reload` 四项为交互式 TUI 路径，未人工逐项执行（等价自动化测试见 §7） | 否（记为 `[~]` 而非 `[ ]`，且 §7 已逐项做等价性分析） |

---

## 3. Delta Spec Sync State

对每个 `openspec/changes/add-goal-loop/specs/` 下的 capability 目录，与
`openspec/specs/<capability>/spec.md` 比对：

| Capability | Sync 状态 | 备注 |
|---|---|---|
| goal-lifecycle | ✗ 待 sync | `openspec/specs/` 目前为空（该 capability 仅存在于本 change）。delta 含 **10** requirements / **22** scenarios；archive 时由 `openspec archive` 同步进主 specs |
| goal-deferral | ✗ 待 sync | 同上。delta 含 **6** requirements / **15** scenarios |

> 说明：主 specs 目录为空是「本 change 是该 capability 的首次引入」的正常状态，
> 而非遗漏——`openspec/specs/` 由 archive 阶段填充。

---

## 4. Design / Specs Coherence Spot Check

抽样比对 `design.md` 的决策是否反映在 `specs/*.md` 的 Requirements 与
Scenarios 中：

| 抽样项 | design 描述 | specs 对应 | 差距 |
|---|---|---|---|
| D1 续跑机制 | 复用宿主 `agent_before_settle` 的 `BoundaryResult.continue: true`，不自定义事件循环 | goal-lifecycle「自动续跑边界」（含 `continue: true` 断言） | 一致 |
| D2 延迟语义 | `goal_sleep` 一次性抑制首次 settle + `settlesDuringSleep` 计数，计数 > 0 则不注入 | goal-deferral「一次性抑制第一次 settle」「定时器唤醒与「已恢复则跳过注入」」 | 一致 |
| D3 唯一出口 | 仅 `finishGoal` / `stopGoal` 清除目标；`aborted`/`error` 仅暂停本轮 | goal-lifecycle「目标生命周期的唯一出口」「中断与错误时暂停续跑」 | 一致 |
| D4 提示词成本 | 不设 `promptSnippet`/`promptGuidelines`，加载时静态注册工具 | goal-lifecycle「工具引导不经过系统提示词」 | 一致 |
| D5 版本前提 | `agent_before_settle` 自 pi 0.87.0 起提供，需 `peerDependencies >=0.87.0` | goal-lifecycle「运行环境版本下限」（验证时补充） | 一致（见下方漂移说明） |
| D6 状态存放 | 仅内存，不写 session entry / 磁盘 | goal-lifecycle「目标状态仅存于内存」 | 一致 |

**漂移警告**（非阻塞）：

- ~~design.md Context 提到 pi 版本前提，但 delta spec 无对应版本下限要求~~ →
  验证时已修正：向 `specs/goal-lifecycle/spec.md` 补充
  「运行环境版本下限」Requirement（`peerDependencies >=0.87.0`、devDep `>=0.87.1`），
  并已通过 `openspec validate --all` 复检。**当前无残留漂移。**

---

## 5. Implementation Signal

- [x] Worktree 内无未 staged 的文件（本报告及其 spec 补充同批提交后 worktree 干净）
- [ ] 所有相关 commit 已推送 —— **未推送**，`feat/add-goal-loop` 仍为本地分支

**Commit 范围**（若知道）：`d643d6d..99da455`（10 个提交）

```text
d643d6d docs(pi-goal-loop): add openspec change add-goal-loop planning artifacts
6fdc34d chore(pi-goal-loop): scaffold package
336a439 feat(pi-goal-loop): goal state machine lifecycle
2406b3e feat(pi-goal-loop): sleep scheduling with duration clamp
42fbc91 feat(pi-goal-loop): continuation guard on boundary
c665d89 feat(pi-goal-loop): sleep suppression, resume counting, wake-up dedupe
7693750 feat(pi-goal-loop): user-facing copy and notices
0f56f67 feat(pi-goal-loop): pi wiring for commands, tools, boundary and timer wake
bc534ca chore(pi-goal-loop): refresh workspace lockfile for pi 0.87.1
99da455 docs(pi-goal-loop): README, verified pi version and artifact corrections
```

**本地验证闸门**（均在 `packages/pi-goal-loop` 运行，全部通过）：

```text
pnpm --filter @philogag/pi-goal-loop typecheck   → exit 0 (tsc -b --noEmit)
pnpm --filter @philogag/pi-goal-loop test        → 46/46 passed (3 files)
pnpm --filter @philogag/pi-goal-loop build       → exit 0, dist/index.js 产出
openspec validate add-goal-loop --strict         → Change 'add-goal-loop' is valid
```

**端到端证据**（真实 pi 0.87.1 会话，`pi -e ./src/index.ts -p --mode json "/goal …" "Begin now."`）：

| 轮次 | 宿主事件 |
|---|---|
| 1 | agent 完成但未调 `goal_finish` → `agent_end` 后 `entry_appended`（`customType: "goal-loop"`） |
| 2 | 仍未收口 → 第二次 `entry_appended`（`goal-loop`） |
| 3 | agent 调用 `goal_finish` → 目标清除、不再注入 → `agent_settled` 后正常退出（exit 0） |

---

## 6. Front-Door Routing Leak Detector（warning，非阻塞）

设计产出不应落在 `docs/superpowers/specs/`（brainstorm artifact 的
output redirection 会把它导到 `openspec/changes/<name>/brainstorm.md`）。

检测：

```bash
$ ls docs/superpowers/specs/*.md 2>/dev/null
(no docs/superpowers/specs)        # 目录不存在
```

- [x] 无文件，或存在的文件是 schema 安装前的合法存留

**泄漏清单**（若有）：

| 文件 | 内容是否已 captured 进 change | 建议动作 |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

对 plan/tasks 中标记 `[~]` deferred 的手动 dogfood / smoke task，逐项列出
等价的自动化测试覆盖。若没有等价自动化测试，该项应视为**真正的 gap** 而非
合理 deferral，建议在 retrospective Misses 中记录。

| Deferred dogfood (tasks §) | Equivalent automated test | Coverage assessment | 真正 gap? |
|---|---|---|---|
| §6.3 交互 `/goal-stop` 停止循环 | `index.test.ts` `it("stops continuing after /goal-stop")`；`goal-state.test.ts` `it("stopGoal clears the goal")` | 命令注册 + handler 接线 + 边界不再返回 `continue` + 状态清除，四层断言均为手动路径 assertion 的超集 | ❌ 已等价覆盖 |
| §6.3 `goal_sleep` 抑制一次 + 到点唤醒 | `index.test.ts` `it("goal_sleep defers the boundary and reports the clamped duration")`、`it("wakes with a triggered turn when the sleep timer fires")`、`it("skips the triggered turn when the loop already resumed")`；`goal-state.test.ts` `it("suppresses exactly the first completed settle")`、`it("wakes at the timer when nothing resumed the loop")`、`it("ignores a stale timer callback")` | 注入式 scheduler 使「到点」与「计数」确定性触发，比手工等待更强（无时序 flake） | ❌ 已等价覆盖 |
| §6.3 Esc 中断后不续跑且目标保留 | `index.test.ts` `it("pauses (without clearing the goal) on aborted")`；`goal-state.test.ts` `it("pauses on aborted and keeps the goal")`、`it("does not clear the goal on aborted or error")`、`it("resumes continuing after the pause")` | 状态机层全覆盖；未覆盖的唯一环节是「真实 Esc 按键 → `outcome: "aborted"`」的宿主映射（pi 内部行为，非本扩展代码） | ❌ 已等价覆盖（映射属宿主） |
| §6.3 `/reload` 后目标丢失 | `index.test.ts` `it("does not persist goal state to session entries")` | 仅断言「不写 session entry」这一**因果机制**；没有真正重建扩展 runtime 再断言「无活动目标」的测试 | ✅ **真正 gap**（已记入 retrospective，见 follow-up） |

> **判读规则**：
> - 「等价」= 自动化测试的 assertion 集合是手动 dogfood 预期 assertion 的超集
> - 「Coverage assessment」= 列出实际被触及的 layer (context / DB schema / wiring / HTTP path / etc.)
> - 任何「真正 gap = ✅」的列，Overall Decision 仍可 PASS，但须在 retrospective 留 follow-up 条目

---

## Overall Decision

- [ ] ✅ PASS — 可进入 finishing-a-development-branch 与 archive
- [x] ⚠️ PASS WITH WARNINGS — 可进入后续步骤但需注意：
  1. **tasks 6.3 部分手工验收**：自动续跑与 `goal_finish` 已真实会话验证；四项交互路径未人工执行（§7 已逐项等价性分析）。
  2. **一个真实覆盖 gap**：`/reload` 后目标丢失只有「不写 session entry」的间接断言，无 runtime 重建断言 → 已列入 retrospective follow-up。
  3. **分支未推送**：`feat/add-goal-loop` 仍在本地（10 commits）。
- [ ] ❌ FAIL — 返回失败的 artifact 修正后重跑 verify

**下一步**：

1. 生成 `retrospective.md`（含上述 reload 覆盖 gap 的 follow-up）。
2. 进入 `finishing-a-development-branch`：推送 `feat/add-goal-loop`、合并或开 PR。
3. 合并后 `openspec archive add-goal-loop`，把两个 delta capability 同步进 `openspec/specs/`。
