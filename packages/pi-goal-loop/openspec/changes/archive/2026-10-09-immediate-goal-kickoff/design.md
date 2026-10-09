## Context

`packages/pi-goal-loop` 把「用户声明的持续目标」跨轮推进：`src/goal-state.ts` 是不依赖 pi 的纯状态机，
`src/index.ts` 只做 pi 接线。自动续跑的唯一入口是 `agent_before_settle` 处理器 —— 当存在活动目标、
无生效延迟抑制、且本轮 `outcome === "completed"` 时，追加一条可见的 `goal-loop` custom message
（`src/prompts.ts` 的 `buildContinuationPrompt(goal)`）并返回 `continue: true`。

当前缺口：`/goal <content>` 命令处理器只做 `startGoal` + `notify`，不发起任何请求。空闲会话中
「声明完就结束」，没有可供 settle 的一轮，循环永不启动。

宿主已提供本变更所需的两项能力（pi `>=0.87.0`，即现有 peer 下限之内）：

- `ExtensionContext.isIdle(): boolean` —— 命令处理器所在的 `ExtensionCommandContext` 继承它，
  含义是「agent 当前是否未在 streaming」。
- `pi.sendMessage(msg, { triggerTurn: true })` —— 宿主文档明确：非 streaming 时追加条目并**开启新一轮**；
  streaming 时**排队**，由循环取队列时处理。

约束（来自 OpenSpec，不在本文件重定义）：
- 目标生命周期的唯一出口仍是 `goal_finish` 与 `/goal-stop`（`openspec/specs/goal-lifecycle`）。
- 唤醒来源仅定时器与超时兜底（`openspec/specs/goal-deferral`）—— 本变更不新增唤醒来源，只补
  `/goal` 命令的首次启动。

## Goals / Non-Goals

**Goals:**

- 用户在执行 `/goal <content>` 且 agent 空闲时，当场开启一轮执行，而无需再发一条消息。
- 首次声明与替换既有目标行为一致（替换后同样当场启动）。
- 复用唯一的续跑提示来源，使「首轮」与「后续自动续跑」在 agent 视角完全一致。
- 不引入新状态、不改变既有出口语义、不改变每轮固定上下文占用。

**Non-Goals:**

- 不改变 `/goal` 无参查询、`/goal-stop`、`goal_finish`、`goal_sleep` 的行为。
- 不改变 `agent_before_settle` 的续跑/抑制/延迟语义。
- 不为「running」引入扩展自有的状态标志或新事件监听。
- 不在流式中强行插队：streaming 情形交由既有 settle 边界处理。

## Decisions

### D1：以宿主 `ctx.isIdle()` 作为「loop 未在运行」的判定

- **选择**：在 `/goal` 带参分支中读取 `ctx.isIdle()`；为 true 才立刻投递。实现上加 `typeof ctx.isIdle === "function"` 守卫，宿主缺失该方法时退化为既有 settle 行为，而不是让 `/goal` 直接报错。
- **理由**：宿主已提供权威的「是否 streaming」信号，无需扩展自造 running 标志，也就不会与宿主
  的真实运行状态发生漂移；命令处理器可直接访问该方法。
- **已考虑 alternative**：
  - *扩展内维护 running 标志（agent_start/agent_settled 置位）*：多一份需与宿主对齐的状态，
    且要 extra 监听事件；收益为零，拒绝。
  - *无条件总是投递*：streaming 时消息先排队、该轮 settle 又触发 settle 边界续跑，造成连续重复推进；
    拒绝（见 D4）。

### D2：复用既有续跑提示与条目类型

- **选择**：`pi.sendMessage({ customType: GOAL_LOOP_CUSTOM_TYPE, content: buildContinuationPrompt(text), display: true }, { triggerTurn: true })`。
- **理由**：`buildContinuationPrompt` 是续跑提示的单一来源（含目标原文与 `goal_finish` / `goal_sleep`
  两个 agent 出口说明；用户侧的 `/goal-stop` 只出现在 started/status 通知中，见 `src/prompts.ts:17`、`:27`）；
  `display: true` 保持对用户可见，与自动续跑一致；
  `triggerTurn: true` 是「立刻开始」的机制。
- **已考虑 alternative**：
  - *`sendUserMessage(goal)` 把目标原文当普通用户消息发出*：与 `/goal` 已登记的文本重复，
    且绕过 `goal-loop` customType 与渲染路径；拒绝。
  - *新增一条精简「开始执行」提示*：`prompts.ts` 会出现第二份近似文案，未来易漂移；YAGNI，拒绝。

### D3：首次声明与替换共用同一条路径

- **选择**：在 `/goal` 带参分支里统一处理（`startGoal` 与 `clearSleep` 已由 `startGoal` 完成），
  不对「此前是否有活动目标」分支。
- **理由**：替换目标后若空闲，其现状同样是「声明完什么都不发生」，应与首次声明一致；
  且 `startGoal` 已负责清除进行中的延迟状态，无需额外清理。
- **已考虑 alternative**：*仅首次声明立刻触发，替换不触发* —— 行为不一致且无正当理由；拒绝。

### D4：streaming 时不投递

- **选择**：`ctx.isIdle()` 为 false 时不做任何额外动作。
- **理由**：正在进行的这一轮结束时，`agent_before_settle` 会因活动目标存在而正常续跑，循环不会丢失，
  只是晚一轮；而强行投递会与 settle 边界续跑叠加成连续两轮。
- **已考虑 alternative**：*用 deliverAs 排队* —— 仍需额外判断与去重，收益不明确；拒绝。

### D5：状态机零改动

- **选择**：`src/goal-state.ts` 不新增 API、不改语义；改动只在 `src/index.ts` 的 `/goal` 处理器。
- **理由**：启动时机属于接线层关注点，状态机只负责「有无目标 / 是否有生效延迟」。这让新增行为可以
  用「命令处理器 + fake ctx」单测覆盖，无需触碰已稳定的状态机测试。

## Risks / Trade-offs

- [Risk] 用户在普通对话 streaming 中执行 `/goal`，此时不会立刻启动。→ Mitigation: 该轮 settle 时
  settle 边界照常续跑，循环不丢；仅延后一轮，且这是 D4 的既定取舍。
- [Risk] 命令处理器内 `ctx.isIdle()` 或 `sendMessage(triggerTurn: true)` 的宿主行为与文档不符
  （例如仍返回 false、或未开启新一轮）。→ Mitigation: 实现阶段以真实 pi 会话端到端验证一次；
  分支失败时退化为既有 settle 行为，不产生错误状态。
- [Risk] `notify` 与 `sendMessage` 的调用顺序影响用户观感。→ Mitigation: 先 `notify` 后 `sendMessage`，
  保证「已设置活动目标」通知先于新一轮开始。
- [Trade-off] 立刻启动会当场消耗 token（用户可能只是想先登记目标）。→ 接受：这正是请求意图；
  两个出口（`goal_finish` / `/goal-stop`）与停止语义完全不变。
- [Trade-off] 不改变每轮固定上下文占用（工具仍不设 `promptSnippet` / `promptGuidelines`）。→ 接受：
  保持 prompt 前缀缓存友好是既有硬约束。

> **实现期宿主观测记录（2026-10-09，pi 1.1.0）**：本实现的宿主机对扩展注入的 custom message 发
> `message_start` / `message_end`（`role: "custom"`），而非更早宿主（0.87.x）的 `entry_appended`；
> print 模式（`-p --mode json`）在扩展命令返回后即 `disposeRuntime()` 并 abort 该轮，无法观测命令触发的运行。
> 因此端到端检查改用 RPC 模式完成。详见 `plan.md`「实现期偏差记录」与 README 的
> 「`/goal` 空闲时立即启动(2026-10-09)」小节。

## Migration Plan

N/A — 本 change 不涉及部署、数据或持久化变更，仅扩展运行时行为。回滚即 revert 对应提交；
扩展状态本来就仅存于内存，无残留状态需要清理。

## Open Questions

- 无阻塞性未知项。实现阶段需验证一点：宿主是否保证在扩展命令处理器中调用
  `sendMessage(..., { triggerTurn: true })` 且 `isIdle()` 为 true 时确实开启新一轮
  （宿主文档已如此声明，端到端再确认一次即可）。
