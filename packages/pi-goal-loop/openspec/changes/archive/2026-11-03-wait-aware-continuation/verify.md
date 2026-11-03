# Verification Report

**Change**: `wait-aware-continuation`
**Verified at**: `2026-10-10`
**Verifier**: main session（实现与验证同一会话；命令均在本次会话重跑）

> **过程提交折叠**：本变更以 `master` 上的**单个提交**交付，其父提交为 fork point `e5d281d1f8d41d82cfb472e281e0aceee5190fda`（变更开始前的 `master` tip），故本文不引用各阶段提交 SHA。

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] 全部 items `"valid": true`

**结果**（`cd packages/pi-goal-loop && openspec validate --all --json`，exit 0）：

```text
summary.totals: items 3, passed 3, failed 0
byType: change 1/1, spec 2/2
root: packages/pi-goal-loop (nearest)
```

`openspec validate wait-aware-continuation --strict` → `Change 'wait-aware-continuation' is valid`。

## 2. Task Completion (`tasks.md`)

- [x] 6 个 section、全部 17 个任务勾选完成（`grep -c '^- \[x\]' tasks.md` → 17；无 `- [ ]` 剩余）

| Section | 任务 | 落点 |
| --- | --- | --- |
| 1 状态机 | 1.1–1.4 | `packages/pi-goal-loop/src/goal-state.ts`（114→140 行，净 +89/−95） |
| 2 接线 | 2.1–2.4 | `packages/pi-goal-loop/src/index.ts`（净 +40/−33） |
| 3 文案 | 3.1–3.2 | `packages/pi-goal-loop/src/prompts.ts`（净 +3/−10） |
| 4 测试 | 4.1–4.3 | `packages/pi-goal-loop/test/{goal-state,index,prompts}.test.ts` |
| 5 文档 | 5.1–5.2 | `packages/pi-goal-loop/README.md`、`package.json`（`0.1.1` → `0.1.2`） |
| 6 验证收尾 | 6.1–6.2 | 本文件 + `retrospective.md` + 归档 |

## 3. Delta Spec Sync State

| Capability | Delta | 状态 |
| --- | --- | --- |
| `goal-wait` | ADDED（4 requirements） | 待归档时新建主 spec |
| `goal-lifecycle` | MODIFIED（tools / notices / custom-type） | 待归档时整块替换 |
| `goal-deferral` | REMOVED | 待归档时删除 `openspec/specs/goal-deferral/`，`GOAL_RETROSPECTIVE` 场景迁到 `goal-wait` |

归档前主 specs 仍是「旧版本（含 `goal_sleep`）」，这是归档前的正常中间态；`openspec archive` 会一并完成上述三步。

## 4. Design / Specs Coherence Spot Check

| 设计决策 | 代码证据 | 一致 |
| --- | --- | --- |
| 两个维度：阻塞「在途」vs 异步「闩锁」 | `WaitState.inFlight: Set<string>` + `latched: boolean`（`src/goal-state.ts`） | ✅ |
| 不内置定时器/时钟 | `createGoalState()` 无参无依赖；`onBoundary(state, outcome)` 无 `now` | ✅ |
| 事件驱动而非工具声明 | `src/index.ts` 订阅 `pi.events` + `tool_execution_start/end` + `agent_start` + `input` | ✅ |
| 未知/改名 = 安全失败 | `classifyToolCall` 返回 `null` → 不进入等待态，退化为继续续跑 | ✅ |
| 实时判定而非 settle 快照 | `onBoundary` 内调用 `isWaiting(state)` | ✅ |

## 5. Implementation Signal

```text
$ pnpm typecheck   → tsc -b --noEmit, exit 0
$ pnpm test        → Test Files 3 passed (3) | Tests 59 passed (59) | Duration 693ms
$ pnpm build       → tsc -b, exit 0
```

- 测试从 50 例增至 59 例：减少 8 例 sleep/fake-timer 用例，净增 17 例等待态用例。
- `goal_state.test.ts` 覆盖：阻塞在途登记/注销、异步闩锁跨 settle 保持、多来源合并到单条记录、release 幂等、`startGoal`/`stopGoal`/`finishGoal`/`onShutdown` 清态、`classifyToolCall` 正负例、`onBoundary` 抑制与恢复。
- `index.test.ts` 覆盖：只注册 `goal_finish`（断言 `goal_sleep` 不存在）、订阅 `rpiv:ask-user:blocked`、异步派发抑制 + `agent_start` 释放、`subagent({action})`/`async:false` 不抑制、`bg_wait`/`acp_delegate_wait` 在途抑制、`input` 释放、`/goal` 替换与 `/goal-stop` 清态、shutdown 清态。
- `prompts.test.ts` 覆盖：提示词只提及 `goal_finish`，且**不含** `ask_user_question`/`bg_wait`/`sleep`/`轮询`/`goal_sleep`。

## 6. Front-Door Routing Leak Detector（warning，非阻塞）

- [x] 无新增 front-door 文本：`goal_finish` 仍未设置 `promptSnippet`/`promptGuidelines`（`index.test.ts` 断言），等待感知不向系统提示词注入任何内容。

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

真实宿主上的 dogfood **未执行**（本机全局安装的旧版扩展仍持有 `goal_finish`/`goal_sleep` 工具名，`pi -e` 会冲突；`-ne` 路径需要交互会话，与本次改动无新增宿主事件面）。

等价性论证（对照自动化用例）：

| 真实场景 | 自动化等价 | 风险 |
| --- | --- | --- |
| rpiv 问卷弹出后循环应立即停手 | `index.test.ts` 直接向 `rpiv:ask-user:blocked` 发 `{active:true}` → settle 被抑制 | 事件名/负载形状来自 rpiv 源码与 README，未在运行中的 rpiv 上观测过 |
| `bg_wait` 在途期间不续跑 | `tool_execution_start("bg_wait")` → settle 抑制，`tool_execution_end` 后恢复 | 宿主 `tool_execution_start.args` 形状已按 pi 类型定义构造 |
| 异步 `subagent` 派发后不空转 | `subagent{async:默认}` → 闩锁；`agent_start` 解除 | 子 agent 完成是否**必然**触发 `agent_start` 依赖宿主 `triggerTurn` 唤醒，本次未在真机复验 |

结论：语义已由 59 例单测锁定；真实 rpiv / pi-subagents 联调留作 dogfood 待办（已记入 `retrospective.md` §3）。

## Overall Decision

**PASS**（附 1 项非阻塞待办：真机 dogfood 联调 rpiv 与 pi-subagents）。
