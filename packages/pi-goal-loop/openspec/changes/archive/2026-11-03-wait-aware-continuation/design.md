## Context

`packages/pi-goal-loop` 是 pi 扩展：用户 `/goal <目标>` 登记目标后，扩展在每次 `agent_before_settle`
（`outcome === "completed"`）注入续跑提示并 `continue: true`，直到 `goal_finish` 或 `/goal-stop`。

当前 `src/goal-state.ts` 里除了目标，还维护 `SleepState`（`startedAt/until/seconds/timer/
suppressNextSettle/settlesDuringSleep`）与一个 `Scheduler`（`setTimeout` 包装）。`src/index.ts` 注册
`goal_sleep` 工具并把它写进续跑提示词。

外部世界（本次要兼容的两套机制）：

- @juicesharp/rpiv-ask-user-question v2.15.0：工具名 `ask_user_question`；等答案期间在
  `pi.events` 上广播 `rpiv:ask-user:blocked`（`{ active, toolCallId }`），`active: false` 结束。
- pi-subagents：`bg_wait`（轮内阻塞）；`subagent` / `acp_delegate` 异步派发（默认 `async: true`）
  立即返回，完成通知通过 `pi.sendMessage(..., { triggerTurn: true })` 原生唤起新一轮。

宿主 API 事实（`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`）：
`pi.events: EventBus`（`types.d.ts:1406`）；`ToolExecutionStartEvent { toolCallId, toolName, args }`
（`types.d.ts:853-860`）；`ToolExecutionEndEvent { toolCallId, toolName, result, isError }`；
`agent_start`、`input`（`types.d.ts:910-920`）、`agent_before_settle`（`types.d.ts:797-799`）。

## Goals / Non-Goals

**Goals:**

- 扩展内不再有任何定时器；续跑的恢复完全由外部事件（用户输入、原生完成唤醒、目标生命周期命令）驱动。
- 等待期（in-flight 阻塞等待 / 异步派发后未收到外部事件）不注入续跑提示、不 `continue`。
- 两个兄弟扩展都不存在时，行为与本变更前的「纯续跑」一致（没有 `goal_sleep`，其余不变）。

**Non-Goals:**

- 不实现自己的后台任务跟踪（不列 pi-subagents 的 run 列表、不读别人的工具结果文本）。
- 不为 `ask_user_question` 做 UI/答题桥接；只观测它的事件。
- 不改 `/goal` 的 kickoff 语义、不改 `goal_finish` / `/goal-stop` 的出口语义。
- 不新增显式工具（不出现 `goal_wait` 之类），避免再给模型一个「该等多久」的学习负担。

## Decisions

### D1：用「在途 + latch」两段式代替「抑制一次 + 定时器」

- **选择**：等待态分两部分——`inFlight: Set<toolCallId>`（阻塞类等待未结束）与 `latched: boolean`
  （异步派发已把工作交给原生唤醒）。`agent_before_settle` 在 `inFlight.size > 0 || latched` 时抑制。
- **理由**：`inFlight` 覆盖「正在等用户/等结果」，`latched` 覆盖「派发后本轮已结束但工作在别处」。
  两者都不需要时长参数，也不需要定时器。
- **已考虑 alternative**：只看本轮尾部工具名（会把 `bg_wait` 超时返回误判成「还在等」）；只看 latch
  （问卷打开时理论上会 settle 的边界没有覆盖）；定时器（本次要拆掉的东西）。

### D2：阻塞类等待不 latch，异步派发才 latch

- **选择**：`ask_user_question` / `bg_wait` / `acp_delegate_wait` 只贡献 `inFlight`；`subagent` /
  `acp_delegate` 的异步派发贡献 `latched`。
- **理由**：阻塞类等待在轮内解决（拿到答案/结果后本轮继续执行），settle 时已无等待；若也 latch，
  用户答完问卷、agent 干完活、本轮结束时循环会静默挂住。异步派发则在 settle 时没有任何在途调用，
  只有 latch 才能抑制。
- **已考虑 alternative**：全部 latch（会挂死）；全都不 latch（异步派发路径退化，等于没做）。

### D3：latch 的释放集合

- **选择**：`input`（用户说话）、`agent_start`（任何新一轮开始）、带参 `/goal`、`/goal-stop`、
  `goal_finish`、`session_shutdown`。
- **理由**：`agent_start` 同时覆盖 pi-subagents 完成通知的 `triggerTurn` 唤醒与其他扩展的唤醒路径，
  比去识别「哪条通知是子 agent 完成」更稳。`input` 覆盖「用户直接插话」。
- **已考虑 alternative**：`agent_settled` 释放（结算后才释放 ≈ 从不抑制）；解析完成通知的
  `customType`（耦合 pi-subagents 的内部命名）。

### D4：异步派发的识别规则（含 `action` 排除）

- **选择**：工具名 ∈ {`subagent`, `acp_delegate`} 且 `args.action === undefined` 且
  `args.async !== false` 时 latch。`subagent({ action: "status" })` 这类管理调用不算等待。
- **理由**：两个扩展的 `async` 默认都是 `true`，而 `action` 字段专用于管理/查询，不派发新工作。
- **已考虑 alternative**：读 `tool_execution_end` 的结果文本找 "Detached"（脆弱）；只识别
  `bg_wait`（会漏掉最主要的异步派发路径）。

### D5：`rpiv:ask-user:blocked` 走 `pi.events`，并容忍缺失

- **选择**：`pi.events.on("rpiv:ask-user:blocked", …)`，`active: true` → 加入 `inFlight`（key 为
  `toolCallId`，缺省用 `"ask_user_question"`），`active: false` → 移除。payload 未知字段一律容忍。
- **理由**：该包在 `ask-user-question.ts:66` 用 `finally` 保证 `active: false`，是唯一能区分
  「阻塞在人类身上」与「在干活」的公开信号；事件总线不存在该扩展时只是没有事件。
- **已考虑 alternative**：只靠 `tool_execution_start/end`（问卷被 Esc 取消与正常返回不可区分，
  但都能覆盖——两条路径都保留，R1 里都要求）。

### D6：能力改名 `goal-deferral` → `goal-wait`

- **选择**：新增 `goal-wait` 能力；旧 `goal-deferral` 的 6 条 Requirement 全部 REMOVED（带 Reason
  与 Migration）；归档时删除 `openspec/specs/goal-deferral/`。
- **理由**：旧能力的名字与 Purpose 都围绕「agent 主动请求延迟」；机制删除后名不符实。OpenSpec 的
  delta 只支持改 Requirement 名，不支持改能力名，所以按「新能力 + REMOVED 旧能力」处理。
- **已考虑 alternative**：保留 `goal-deferral` 名字并整体 MODIFY（历史意图会被误读）。

### D7：`State` 去依赖注入

- **选择**：`createGoalState()` 不再接收 `{ scheduler, wake }`；`onBoundary(state, outcome)` 去掉
  `now` 参数；删除 `Scheduler`/`systemScheduler`/`TimerHandle`/`clampSleepSeconds`/`onTimer`。
  `wakeNow()` 仍留在 `src/index.ts`（只被 `/goal` kickoff 使用）。
- **理由**：没有定时器就没有调度器依赖，单测不再需要 fake timers。

### D8：提示词同时列出三类出口

- **选择**：续跑提示包含「完成 → `goal_finish`」「需要用户决策 → `ask_user_question`」
  「等后台/子 agent → `bg_wait` 或原生唤醒，不要 sleep/poll」。不提及 `goal_sleep`。
- **理由**：把等待语义放在唯一进入模型上下文的提示词里（工具 `promptSnippet` 仍为空，保持前缀缓存
  稳定）；并且与 pi-subagents 自己的工具结果指引一致。

## Risks / Trade-offs

- [异步派发的完成通知丢失时，latch 一直不放，循环静默暂停] → 释放集合含 `input` 与 `/goal`，
  用户说任何一句话即恢复；这是 Q2 明确选择的取舍（不引入兜底定时器）。
- [`subagent` 的 `async` 默认为 true，普通委派也会 latch 一轮] → 完成通知本来就会唤起新一轮，
  `agent_start` 立即释放，净效果是「不额外插一条续跑提示」。
- [兄弟扩展改了工具名或事件名] → 常量化 `WAIT_TOOL_NAMES` / `ASYNC_DISPATCH_TOOL_NAMES` /
  `ASK_BLOCKED_EVENT`，未知名称静默忽略，不会报错。
- [问卷打开时仍有 settle] → `inFlight` 二次兜底（rpiv 事件 + 工具执行两条路径都覆盖）。
- [`goal_sleep` 消失属 breaking] → README 与提示词同步；`package.json` 版本按仓库习惯在收尾提交时
  原定升 minor（0.2.0）；**最终按用户决定以 patch 号 `0.1.2` 交付**（工具删除的 breaking 影响改由 README 顶部显著说明承担）。

## Migration Plan

1. 删除 `goal_sleep` 工具与所有延迟/定时器代码；导出名（`beginSleep` 等）一并移除。
2. 目标状态机改为等待态；`onBoundary` 语义不变（无等待即续跑）。
3. `src/index.ts` 增订阅：`pi.events` 的 `rpiv:ask-user:blocked`、`tool_execution_start`、
   `tool_execution_end`、`agent_start`、`input`；`/goal`、`/goal-stop`、`goal_finish`、
   `session_shutdown` 里释放等待态。
4. 更新 README 与提示词。回滚策略：`git revert` 单个提交即可（状态全在内存，无数据迁移）。

## Open Questions

- 无。（`acp_delegate` 系的 `acp_delegate` 工具是否也带 `action` 参数已在 D4 里按「有 `action` 即不
  视为派发」保守处理。）
