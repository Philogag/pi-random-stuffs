## Context

`pi-goal-loop` 是一个全新的 pi 扩展包。pi 扩展以默认导出的工厂函数形式加载，拿到 `ExtensionAPI`；
工厂内注册命令、工具与事件处理器。可用能力（来自 `@earendil-works/pi-coding-agent` 的
`docs/extensions.md` 与 `dist/core/extensions/types.d.ts`）：

- `pi.on("agent_before_settle", handler)` — 「最后一个可行动边界」：`AgentBeforeSettleEvent extends BoundaryState`
  （`entries`、`continue`、`context`、`outcome`），handler 可返回 `BoundaryResult { entries?, continue? }`，
  `continue: true` 请求**一次**后续模型请求。
- `AgentActivityOutcome = "completed" | "aborted" | "error"`。
- `CustomMessageEntryDraft { type: "custom_message", customType, content, display, details? }`
  是可追加的边界条目类型之一（会被写入会话并进入模型上下文）。
- `pi.registerCommand(name, { description?, getArgumentCompletions?, handler(args, ctx) })`。
- `pi.registerTool({ name, label, description, promptSnippet?, promptGuidelines?, parameters, execute })`；
  `execute()` 抛错即产生失败的工具结果。
- `pi.sendMessage(msg, { triggerTurn?: boolean, deliverAs? })` — `triggerTurn: true` 会开启新一轮。
- `pi.on("session_shutdown", handler)` — 会话级资源清理点。

**版本前提（实现期确认）**：`agent_before_settle` 自 **pi 0.87.0** 起提供。仓库原 `devDependencies` 解析到的
`@earendil-works/pi-coding-agent@0.84.3` **没有**该事件（`BoundaryState` / `BoundaryResult` /
`CustomMessageEntryDraft` 均不存在），直接按本设计编码会 typecheck 失败。因此本包必须声明
`peerDependencies: "@earendil-works/pi-coding-agent": ">=0.87.0"`，并将 `devDependencies` 提升到 `^0.87.1`。
已核对 **0.87.0** 与 **1.0.4** 的 `BoundaryState` / `BoundaryResult` / `CustomMessageEntryDraft` 形状一致。

文档中的两条硬约束：

1. 「Do not start processes, sockets, watchers, or timers in the factory... Start long-lived resources from
   `session_start` or from the command or tool that needs them. Close session-scoped resources from an
   idempotent `session_shutdown` handler.」→ 延迟定时器只能由工具调用创建，且必须清理。
2. 「Guard continuation conditions because an unconditional continuation can loop.」→ 续跑必须有守卫。

仓库约定：每个 package 自带独立 OpenSpec 工作区；包的 `package.json` 使用 `"type": "module"`、
`"pi": { "extensions": ["dist/index.js"] }`、`peerDependencies` 声明 `@earendil-works/pi-coding-agent` 与
`typebox`，`devDependencies` 使用 `typescript ^5.6.3` + `vitest ^4.1.11`，代码放在 `src/`、测试放在 `test/`。

干系人：使用 pi 做长时间多轮任务的用户（发起 `/goal`、必要时 `/goal-stop`），以及被 loop 驱动的 agent 自身。

## Goals / Non-Goals

**Goals:**

- 用户可用 `/goal <目标>` 声明一个活动目标，用 `/goal-stop` 结束它。
- agent 可用 `goal_finish` 结束目标；用 `goal_sleep({ seconds })` 声明「等待中，先别续跑」。
- 当且仅当存在活动目标且本轮 `outcome === "completed"` 时，在 `agent_before_settle` 追加一轮续跑提示并
  `return { continue: true }`。
- 只有 `goal_finish`（agent 侧）与 `/goal-stop`（用户侧）能结束目标；`aborted` / `error` 只暂停本轮续跑。
- `goal_sleep` 的延迟：一次性抑制紧随的 settle，叠加定时器唤醒、「已被其他路径恢复则跳过注入」去重、超时兜底。
- 状态机为纯函数，可在 vitest 中用假定时器做单元测试，不需要真实的 pi runtime。

**Non-Goals:**

- **不做持久化**：活动目标只存于内存（决策 D2）。`/reload`（扩展 runtime 重建）或进程重启后目标丢失。
- 不把「subagent 完成通知」或「用户新消息」作为显式唤醒信号接入（决策 D6/D8）；唤醒路径只有定时器与超时兜底。
- 不支持多个并行目标：任意时刻至多一个活动目标。
- 不做预算/轮数上限（token、成本、最大续跑次数）——「何时停」只由 `goal_finish` / `/goal-stop` 决定。
- 不做 TUI 进度组件、状态行、entry renderer。
- 不做自动归档、不写 goal 历史文件。

## Decisions

### D1：续跑通道用 `agent_before_settle` + `continue: true`

- **选择**：在 `agent_before_settle` handler 内追加一条 `custom_message` 条目并返回 `{ continue: true }`，
  续跑发生在**同一次 agent run 内**。
- **理由**：这是 pi 官方定义的「请求一次后续模型请求」边界，语义精确匹配「自动发送一轮提示词」；
  不伪造 user 消息；`BoundaryResult.entries` 是官方支持的、被写入会话并进入模型上下文的通道。
- **已考虑 alternative**：`agent_settled` + `pi.sendUserMessage()`（循环完全 settle 后开启新一轮）——
  被拒：会在会话里堆出大量真实 user 消息、语义噪声大、且需要额外去重；`agent_settled` 是 notification-only，
  语义上属于「已经结束」而非「请求继续」。双保险（两者都用）——被拒：可能重复触发。

### D2：活动目标状态存于内存

- **选择**：目标状态保存在工厂闭包内（模块级 per-runtime 单例），不写 `pi.appendEntry`，
  不在 `session_start` 从 `ctx.sessionManager.getBranch()` 重建。
- **理由**：用户明确选择最简实现；避免引入 entry renderer 与分支重建逻辑。
- **已考虑 alternative**：`appendEntry` + `getBranch()` 重建（参考 pi 的 `todo.ts` 示例）——
  被拒（用户决策）：实现与测试成本更高。代价已在 Non-Goals 中声明。

### D3：续跑守卫为 `outcome === "completed"`

- **选择**：`aborted`（用户 Esc）与 `error` 一律不注入续跑，但**保持目标 active**。
- **理由**：尊重用户中断，避免「按 Esc 后被立刻重新推进」；同时充当防死循环守卫（文档硬要求）。
- **已考虑 alternative**：严格按照「当且仅当 goal_finish / /goal-stop」字面，无论 outcome 都续跑——
  被拒：用户按 Esc 后立刻被续跑属于失控行为。`aborted`/`error` 时直接清空目标——被拒：与「当且仅当」冲突，
  且用户的中断不该等于放弃目标。
- **关键澄清**：「当且仅当」约束的是**目标生命周期**（只有两个出口能让目标变为 inactive）；
  `aborted` / `error` 只影响**本轮是否续跑**。

### D4：目标唯一性 —— `/goal` 在已有活动目标时替换并通知

- **选择**：`/goal <text>` 总是把目标设为给定文本（替换旧的），并 notify 说明旧目标已被替换；同时清除任何睡眠状态。
- **理由**：用户显式给出新目标即表达新意图，拒绝反而需要额外一轮交互；notify 保证可观测。
- **已考虑 alternative**：拒绝并要求先 `/goal-stop`——被拒：交互摩擦大。排队多目标——被拒：见 Non-Goals。

### D5：`goal_sleep` 语义 = 一次性抑制 + 定时器

- **选择**：`goal_sleep({ seconds })` 设置
  `sleep = { startedAt: now, until: now + seconds*1000, timer, suppressNextSettle: true, settlesDuringSleep: 0 }`。
  常量：`DEFAULT_SLEEP_SECONDS = 60`，`MAX_SLEEP_SECONDS = 900`；`seconds` 被 clamp 到 `[1, 900]`。
- **理由**：直接对应用户需求「等 subagent 时不立刻触发 goal，而是延迟触发」；
  「抑制」解决「立刻触发」，「定时器」解决「延迟触发」。
- **已考虑 alternative**：纯定时（无抑制）——被拒：抑制期间必然仍会立刻续跑一次。
  显式 `goal_wake`——被拒（用户决策）：多一个工具且可能忘调而永久挂死。
  `seconds` 可选（两种语义混合）——被拒（用户决策）：测试面与文档成本翻倍。

### D6：定时器唤醒用 `pi.sendMessage(..., { triggerTurn: true })`，并带去重

- **选择**：定时器回调里，若目标仍 active 且 `settlesDuringSleep === 0`，调用
  `pi.sendMessage({ customType: "goal-loop", content: <续跑提示>, display: true }, { triggerTurn: true })`
  开启新一轮；否则**跳过注入**，仅清除睡眠状态。
- **理由**：定时器触发时循环已 settle，`agent_before_settle` 的 `continue` 通道已不可用，
  只能用 `triggerTurn` 主动开启一轮。用户明确要求「当定时器触发时如果已被 subagent 回调等触发，则跳过注入」。
- **去重判定的精确定义**（这是本设计的核心规则）：
  - 睡眠期间每次 `agent_before_settle`（且 `outcome === "completed"`、目标 active）：
    若 `suppressNextSettle === true` → 置 `false`、**不**计数、返回 `undefined`（这一次被延迟消费）；
    否则 → `settlesDuringSleep += 1`、返回 `undefined`（仍然等待）。
  - 这样「第一次 settle」永远被抑制且不计数；若在定时器到点前循环被其他路径（如异步 subagent 完成原生唤醒会话）
    再次推进并 settle，则计数 > 0，定时器到点即判定「已被其他路径恢复」，跳过注入。
- **已考虑 alternative**：无条件注入——被拒：会与 subagent 唤醒的 run 叠加，造成重复推进。
  比较 `lastActiveAt` 时间戳——被拒：计数语义更直接、更易测。

### D7：超时兜底 —— `MAX_SLEEP_MS` 双重保险

- **选择**：(1) `seconds` clamp 到 ≤ 900s，定时器天然不会超过 15 分钟；
  (2) 在 `agent_before_settle` 内额外检查：若 `sleep !== null && now - sleep.startedAt > MAX_SLEEP_MS`，
  则清除睡眠状态并照常续跑（视为超时兜底），覆盖「定时器丢失/未触发」的情形。
- **理由**：用户要求「有超时兜底，避免永久挂死」。
- **已考虑 alternative**：仅依赖定时器——被拒：定时器被外力清除（如 `/goal` 替换、session 切换）后
  可能残留不一致状态。

### D8：唤醒来源只有定时器 + 超时兜底

- **选择**：不监听 subagent 完成、不把用户新消息作为显式唤醒信号；`settlesDuringSleep` 计数只用于
  **定时器到点时的去重判定**，不用于「提前唤醒」。
- **理由**：用户明确选择「无，基于定时器」。这样唤醒路径只有一条，状态机更小、更可测。
- **已考虑 alternative**：接入 `agent_settled`/子 agent 回调或用户消息清除睡眠标记——被拒（用户决策）。
- **副作用（需在文档中说明）**：若 subagent 在定时器到点前唤醒会话并推进了工作，定时器到点会跳过注入，
  续跑要等**下一次** settle 才发生。

### D9：工具/命令常驻注册 + 运行时校验（不做动态激活）

- **选择**：`goal_finish` 与 `goal_sleep` 始终注册且始终 active；在 `execute()` 内校验「存在活动目标」，
  否则返回失败的工具结果（抛错）。`/goal` 与 `/goal-stop` 始终注册。
- **理由**：`pi.setActiveTools()` 会改变工具集，pi 需要追加工具变更或下发完整 transcript checkpoint，
  可能使缓存的 prompt 前缀失效；换取的是实现简单与行为可预测。
- **已考虑 alternative**：在 `/goal` 时用 `setActiveTools([...existing, "goal_finish", "goal_sleep"])`、
  结束目标时移除——被拒：需要维护既有工具列表快照，且频繁改动工具集破坏前缀缓存。
- 代价：工具 schema 常驻占用少量 token。**不**设置 `promptSnippet` / `promptGuidelines`——根据 pi 的类型文档，
  两者分别被注入默认系统提示词的「Available tools」与「Guidelines」区段（`promptSnippet` 缺失时自定义工具
  干脆不出现在该区段），会改变系统提示词前缀；工具的 `description` 仍随工具 schema 一同下发，
  模型因此知道工具存在与用途。
- **工具用法的传达渠道**：仅通过续跑提示词条目（见 D11）告诉 agent 何时调用 `goal_finish` 与 `goal_sleep`。

### D10：模块拆分 —— 纯状态机与 pi 接线分离

- **选择**：
  - `src/goal-state.ts`：纯函数/纯状态机（无 pi 依赖）——`createGoalState()`、
    `startGoal(state, text, now)`、`stopGoal(state, reason)`、`finishGoal(state)`、
    `beginSleep(state, seconds, now, schedule)`、`onBoundary(state, outcome, now)` 返回
    `{ action: "none" | "continue" | "wake", prompt?: string }`、`onTimer(state, now)`、
    `onShutdown(state)`。定时器通过注入的 `schedule(delayMs, cb)` / `clear(id)` 接口抽象。
  - `src/prompts.ts`：续跑提示词文案构造（`buildContinuationPrompt(goal)`）。
  - `src/index.ts`：扩展工厂，把上述纯函数接到 `pi.on("agent_before_settle")`、
    `pi.on("session_shutdown")`、`pi.registerCommand`、`pi.registerTool`。
- **理由**：`ExtensionAPI` 不易在单测里构造；把决策逻辑抽成纯状态机后可用 vitest 假定时器
  完整覆盖（尤其 D6 的去重规则与 D7 的超时），与本仓库既有 `src/session.ts` / `test/session.test.ts`
  的分层方式一致。
- **已考虑 alternative**：全部写在 `src/index.ts`，测试里 mock `ExtensionAPI`——被拒：mock 面大、
  定时器语义难以断言。

### D11：续跑提示词以可见的 `custom_message` 注入

- **选择**：追加 `CustomMessageEntryDraft { type: "custom_message", customType: "goal-loop", content: buildContinuationPrompt(goal), display: true }`。
  文案包含：活动目标原文、「请继续推进」、「完成时调用 `goal_finish`」、
  「需要等待异步任务时调用 `goal_sleep({ seconds })`」、「用户可用 `/goal-stop` 结束」。
- **理由**：自动续跑必须对用户透明——否则「agent 为什么自己在跑」不可解释，`/goal-stop` 也不可发现。
- **补充**：该提示词条目是 agent 获知「何时调用 `goal_finish` / `goal_sleep`」的**唯一**渠道；
  扩展不就这两个工具向系统提示词注入任何内容（见 D9），以保持系统提示词前缀稳定。
- **已考虑 alternative**：`display: false` 静默注入——被拒：不可观测；`type: "custom"`（不进模型上下文）——
  不可行：模型必须看到提示才能继续。

## Risks / Trade-offs

- [Risk] 自动续跑造成无限循环与 token 消耗 → Mitigation: 仅 `outcome === "completed"` 才续跑；
  每次 settle 只请求一次 `continue`；停止出口显式（`goal_finish` / `/goal-stop`）且两者都会 notify；
  明确不做隐式预算上限是**有意**的设计（Non-Goals），需在 README 显著说明。
- [Risk] 用户 Esc 中断后以为已结束，但目标仍 active，下一条用户消息会让循环恢复
  → Mitigation: `aborted` / `error` 时不注入任何续跑（用户可安全接管）；`/goal` 的确认通知与每次续跑提示词
  都明确写出「`/goal-stop` 可结束目标」。
- [Risk] 定时器泄漏（会话关闭、扩展 reload、目标被替换） → Mitigation: `session_shutdown` 中幂等
  `clearTimeout`；`beginSleep` 覆盖前先清理旧定时器；定时器回调先校验 `sleep` 对象身份
  （generation/identity 检查），过期回调直接返回。
- [Risk] 「跳过注入」判定误伤：subagent 已推进但目标仍未完成，定时器到点却跳过 → Mitigation: 只跳过一次注入，
  下一次 settle 恢复续跑；这是有意的（Non-Goal 声明不接入 subagent 信号）。
- [Risk] pi API 漂移（`agent_before_settle` 的 `continue` 语义、`AgentActivityOutcome` 取值）
  → Mitigation: `peerDependencies` 用 `*`，在包 README 记录已验证的 pi 版本；
  类型从 `@earendil-works/pi-coding-agent` 导入而非自行声明。
- [Risk] 状态在 `/reload` 后丢失，用户以为目标还在 → Mitigation: 接受（D2）；在 README 与 `/goal` 输出中说明
  「活动目标仅存于内存，reload / 重启后需重新 `/goal`」。
- [Trade-off] 不做持久化 → 换取实现与测试的简单性，代价是 reload/重启丢目标。
- [Trade-off] 工具常驻激活且不注入系统提示词片段 → 换取 prompt 前缀缓存稳定，代价是常驻占用少量工具
  schema token，且「何时使用工具」只能靠续跑提示词传达。
- [Trade-off] 唤醒只靠定时器 → 换取更小的状态机，代价是延迟粒度由 `seconds` 决定、不响应 subagent 完成事件。

## Migration Plan

N/A — 本 change 是新包，不涉及部署、endpoint、DB 或配置迁移。没有既有行为被修改，因此没有运行时回滚需求
（禁用它即卸载扩展）。落地顺序：

1. 建包骨架：`package.json`（`"type": "module"`、`"pi": { "extensions": ["dist/index.js"] }`、peer/dev 依赖）、
   `tsconfig.json`、`src/index.ts` 空工厂。
2. 实现 `src/goal-state.ts` + `src/prompts.ts`（纯逻辑，先行，可独立单测）。
3. 编写 `test/goal-state.test.ts`（假定时器覆盖 D4–D8 的全部状态迁移）。
4. 接线 `src/index.ts`（命令 / 工具 / 事件 / shutdown 清理）。
5. `npm run typecheck && npm test` 通过；补 `README.md`（用法、内存态限制、停止出口、已验证 pi 版本）。

验收条件见 `verify.md`（由 tasks/plan 阶段派生）。

## Open Questions

- `DEFAULT_SLEEP_SECONDS = 60` 与 `MAX_SLEEP_SECONDS = 900` 的取值是否合适？是否需要做成可配置
  （例如通过 `pi.registerFlag`）？——本设计先取常量，避免过早增加配置面。
- 是否需要给 agent 一个只读的 `goal_status` 工具让它自查「当前是否有活动目标」？
  当前设计下 agent 靠 `goal_finish` / `goal_sleep` 的失败结果推断。
- `/goal` 是否要提供 `getArgumentCompletions`（例如补全 `/goal-stop`）？
- 中断（`aborted`/`error`）时是否应主动 notify 一次「目标仍活动，`/goal-stop` 可结束」？
  当前设计只在提示词与 `/goal` 确认里说明，避免额外打扰。
