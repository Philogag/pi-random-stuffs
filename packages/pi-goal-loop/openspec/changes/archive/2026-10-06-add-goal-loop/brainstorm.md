# brainstorm — pi-goal-loop

> 本文件是 superpowers:brainstorming 的原始捕获（决策日志），不做结构化重排。
> 结构化设计见 `design.md`（由本文件萃取重组，两者互补不重叠）。

## 背景

仓库 `pi-random-stuffs` 维护若干 pi 扩展包。现状约定：**每个 package 自带独立的 openspec 工作区**
（根级 `openspec/` 已废弃，参考 `packages/pi-tool-presistant-bash/openspec/`）。
因此本次变更在 `packages/pi-goal-loop/openspec/` 新建工作区，并复制了
`config.yaml` 与 `schemas/superpowers-bridge-cn/`。

pi 扩展可用能力（来自 `@earendil-works/pi-coding-agent` docs/extensions.md 与 `dist/core/extensions/types.d.ts`）：

- `agent_before_settle`：**最后一个可行动边界**，可追加 `custom` / `custom_message` / `context_edit` /
  `compaction` 条目，并返回 `{ continue: true }` 请求**一次**后续模型请求。
- `agent_settled`：最终态，**只通知，不可行动**。
- `turn_end`：同为可行动边界（`BoundaryState`）。
- `BoundaryState.outcome: AgentActivityOutcome = "completed" | "aborted" | "error"`。
- `pi.registerCommand(name, { description, handler(args, ctx) })`
- `pi.registerTool({ name, label, description, parameters: TypeBox, execute(...) })`
- `pi.sendMessage(msg, { triggerTurn?, deliverAs? })`、`pi.sendUserMessage(content, { deliverAs? })`
- `pi.appendEntry(customType, data)`（不进模型上下文）
- 文档明确警告：「Guard continuation conditions because an unconditional continuation can loop.」

## 需求（用户原话）

> 新建一个插件 pi-goal-loop，提供一个 command /goal 来让用户发起一个目标，并监听 pi 事件循环，
> 当整个 pi 循环结束但仍有活动 goal 时，自动发送一轮提示词来继续推进，注册一个 goal_finish tool
> 给 agent，当且仅当 agent 调用 goal_finish 或 用户调用 /goal-stop 时，不再自动发送提示词

追加需求：

> 另外需要增加 tool goal_sleep 用于让 agent 在等待 subagent 时不立刻触发 goal，而是延迟触发

## 决策链

### Q1 变更的 OpenSpec 工作区放在哪里？

- 备选 A：新建 `packages/pi-goal-loop/openspec/`。
- 备选 B：挂在既有某包（如 pi-tool-presistant-bash）工作区。
- 备选 C：恢复仓库根级 `openspec/`。

**决策：A（新建 packages/pi-goal-loop 工作区）。**
理由：pi-goal-loop 是全新插件，与既有包职责无关；B 会让 spec 归档串包；C 与 README 已声明
的「已拆分、每包独立」约定冲突。apply 阶段再补 `package.json` / `src/` / `test/`。

### Q2 「整个 pi 循环结束仍有活动 goal」用哪种 pi 机制续跑？

- 备选 A：`agent_before_settle` 注入条目 + `return { continue: true }`。
- 备选 B：`agent_settled` + `pi.sendUserMessage()` 开启新一轮。
- 备选 C：A + B 双保险。

**决策：A（agent_before_settle + continue）。**
理由：这是 pi 官方认可的「最后一次续跑」边界；续跑发生在**同一次 agent run 内**，不伪造 user 消息；
`continue` 是「请求一次后续模型请求」，语义精确匹配「自动发送一轮提示词」。
B 会在会话里堆出大量真实 user 消息、语义噪声大且需额外去重；C 实现复杂且可能重复触发。
风险：文档警告无条件续跑会死循环 → 必须用 `outcome === "completed"` 作为守卫（见 Q4）。

### Q3 活动 goal 的状态如何存储？

- 备选 A：`pi.appendEntry` 写入自定义条目，`session_start` 时从 `ctx.sessionManager.getBranch()` 重建。
- 备选 B：扩展工厂闭包内的内存变量。

**决策：B（仅内存）。**
理由：用户选择最简实现。代价（已接受）：`/reload`（扩展 runtime 重建）或进程重启后活动 goal 丢失。
影响：本变更**不需要** entry renderer，也不需要在 `session_start` 重建分支状态。

### Q4 用户 Esc 中断（aborted）或本轮 error 时，goal 仍活动，是否继续自动续跑？

用户原话是「当且仅当 goal_finish 或 /goal-stop 时不再自动发送提示词」，字面上倾向「一律继续」。

- 备选 A：中断即暂停续跑、保留 goal（仅 `outcome === "completed"` 才续跑）。
- 备选 B：严格当且仅当，completed/aborted/error 都续跑。
- 备选 C：aborted/error 直接清空 goal。

**决策：A（outcome === "completed" 才续跑）。**
理由：尊重用户的 Esc 中断，避免「按 Esc 后被立刻重新推进」的失控体验；
`outcome === "completed"` 同时充当防死循环守卫。
关键澄清：「当且仅当」约束的是 **goal 的生命周期**——只有 `goal_finish` / `/goal-stop` 才让 goal
变为 inactive；aborted/error 只影响**本轮是否续跑**，goal 保持 active，下一条用户消息后循环恢复。

### Q5 `goal_sleep` 被调用后，循环具体如何推迟？

- 备选 A：一次性抑制续跑（跳过下一次 settle），等外部唤醒。
- 备选 B：`goal_sleep({ seconds })` 纯定时延迟。
- 备选 C：挂起直到显式 `goal_wake`。
- 备选 D：A/B 兼容（可选 seconds）。

**决策（用户自定义答案）：一次性抑制 + 定时器唤醒。**
原话：「一次性抑制，定时器唤醒，当定时器触发时如果已被 subagent 回调等触发，则跳过注入」。

即：`goal_sleep({ seconds })` 同时做两件事——(1) 抑制紧随其后的 settle 续跑；
(2) 注册一个 `seconds` 后的定时器，到点若尚未恢复则注入一轮续跑提示。
若定时器触发时发现循环**已经**被别的路径（如 subagent 完成回调唤起的新的 run）恢复过，
则**跳过注入**，避免重复推进。

### Q6 哪些事件应清除「睡眠」状态、恢复自动续跑？

**决策（用户自定义答案）：无，基于定时器。**
不把「subagent 完成通知」或「用户新消息」显式接入唤醒逻辑；唤醒路径只有定时器。
但「已被 subagent 回调等触发」的**去重判定**仍然成立：若在定时器到点前循环已因其他原因恢复
（例如异步 subagent 完成原生唤醒了会话并进入了新 run），定时器到点应跳过注入。

### Q7 「睡眠」后始终等不到唤醒，是否超时兜底？

**决策：有超时兜底。**
记录 `sleptAt`；若超过上限（默认 15 分钟，可配）仍未恢复，下次 settle 或定时器一律继续续跑，
避免 goal 永久挂死。

## 方案取舍

- 续跑通道唯一：`agent_before_settle`。`agent_settled` 只用于观测/清理，不参与推进。
- 抑制与唤醒解耦：抑制是「跳过下一次 settle」的瞬时状态；唤醒是「定时器 + 去重 + 超时兜底」。
- 定时器必须可在 `session_shutdown` 幂等清理（pi 文档：不在工厂里起 timer；
  该 timer 由 tool 调用触发，属允许范围，但仍需会话级清理）。

## 开放问题 / 待 apply 阶段确认

- `goal_sleep` 的 `seconds` 默认值与上限取值（默认 60s？上限 15min？）需在 design 中定死。
- 续跑提示词的具体文案（需包含 goal 原文 + 「完成后调用 goal_finish」指令）。
- `goal_finish` / `goal_sleep` 是否需要在 `promptSnippet` / `promptGuidelines` 中声明（影响系统提示）。
