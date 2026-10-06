## ADDED Requirements

### Requirement: 延迟续跑工具（`goal_sleep`）

扩展 MUST 向 agent 注册名为 `goal_sleep` 的工具，其参数 MUST 包含以秒为单位的等待时长。当存在活动目标时，该工具 SHALL 建立延迟状态并返回成功结果，结果 MUST 说明下一次自动续跑已被推迟以及预计恢复时间。当不存在活动目标时，该工具 MUST 返回失败的工具结果而不是成功。

#### Scenario: agent 请求延迟

- **WHEN** 存在活动目标且 agent 调用 `goal_sleep({ seconds: 120 })`
- **THEN** 工具返回成功结果，说明下一次续跑已被推迟且延迟状态已建立

#### Scenario: 无目标时调用

- **WHEN** 不存在活动目标且 agent 调用 `goal_sleep({ seconds: 60 })`
- **THEN** 工具返回失败结果，内容说明当前没有活动目标

#### Scenario: 缺少时长参数

- **WHEN** agent 调用 `goal_sleep` 但未提供时长参数
- **THEN** 调用被拒绝，且不建立延迟状态

---

### Requirement: 一次性抑制第一次 settle

`goal_sleep` 被调用后，紧随的**第一次**以 `outcome === "completed"` 结束的 `agent_before_settle` MUST NOT 注入续跑提示、也 MUST NOT 请求续跑；该次抑制 MUST 只消费一次，且 MUST NOT 被计入「延迟期间的恢复次数」。

#### Scenario: 第一次 settle 被抑制

- **WHEN** agent 调用 `goal_sleep({ seconds: 60 })`，随后一轮以 `completed` 结束并到达 `agent_before_settle`
- **THEN** 不注入续跑提示、不请求续跑，且延迟状态仍然有效

#### Scenario: 抑制只生效一次

- **WHEN** 抑制已被第一次 settle 消费，延迟尚未到点，随后又有一轮以 `completed` 结束
- **THEN** 这一次被计入「延迟期间的恢复次数」，且仍然不注入续跑提示

---

### Requirement: 定时器唤醒与「已恢复则跳过注入」

延迟状态 SHALL 注册一个在请求时长后触发的定时器。定时器触发时，若活动目标仍存在且延迟期间没有任何一轮以 `completed` 结束（恢复次数为 0），扩展 SHALL 注入一轮续跑提示并 SHALL 主动开启新一轮（`triggerTurn`）；若延迟期间已至少有一轮以 `completed` 结束（恢复次数大于 0），扩展 MUST 跳过本次注入。无论是否注入，定时器触发后 SHALL 清除延迟状态。

#### Scenario: 到点且期间未恢复则唤醒

- **WHEN** 延迟时长到点，期间没有任何一轮以 `completed` 结束，且活动目标仍存在
- **THEN** 扩展注入一轮续跑提示并开启新一轮，随后清除延迟状态

#### Scenario: 已被 subagent 等触发则跳过注入

- **WHEN** 延迟期间已被其他路径推进（至少一轮以 `completed` 结束并到达 `agent_before_settle`），随后延迟到点
- **THEN** 扩展跳过本次注入，仅清除延迟状态

#### Scenario: 到点时目标已结束

- **WHEN** 延迟到点时活动目标已被 `goal_finish` 或 `/goal-stop` 清除
- **THEN** 扩展不注入任何续跑提示

---

### Requirement: 时长边界与超时兜底

扩展 MUST 把请求时长限制在 1 秒至 900 秒之间（越界值按边界截断）。扩展 MUST 实现超时兜底：若延迟状态自建立起已超过 900 秒仍未被清除，则下一次以 `completed` 结束的 `agent_before_settle` SHALL 清除延迟状态并照常注入续跑提示。超时兜底 MUST 在定时器丢失或未触发的情况下仍然生效。

#### Scenario: 超长时长被截断

- **WHEN** agent 调用 `goal_sleep({ seconds: 100000 })`
- **THEN** 实际延迟被限制为 900 秒

#### Scenario: 超时后强制续跑

- **WHEN** 延迟状态存在已超过 900 秒仍未被清除，且一轮以 `completed` 结束
- **THEN** 延迟状态被清除，且该次 settle 照常注入续跑提示

---

### Requirement: 延迟状态的清理

目标被替换（`/goal`）、目标被结束（`/goal-stop` 或 `goal_finish`）、以及会话关闭（`session_shutdown`）时，扩展 MUST 清除延迟状态并取消其定时器。清理操作 MUST 是幂等的：重复清理、或在没有延迟状态时清理，MUST NOT 抛出错误。定时器回调 MUST 校验其所绑定的延迟状态是否仍然有效，过期的回调 MUST 直接返回且 MUST NOT 注入任何提示或开启新一轮。

#### Scenario: 目标结束清除延迟

- **WHEN** 存在延迟状态且用户执行 `/goal-stop`（或 agent 调用 `goal_finish`）
- **THEN** 延迟状态被清除，其定时器被取消，之后到点也不会触发注入

#### Scenario: 会话关闭清除延迟

- **WHEN** 存在延迟状态且会话关闭
- **THEN** 定时器被取消，且之后的重复清理不抛出错误

#### Scenario: 过期定时器回调无副作用

- **WHEN** 延迟状态已被清除后，其旧定时器回调被触发
- **THEN** 回调直接返回，不注入提示、不开启新一轮

---

### Requirement: 唤醒来源仅为定时器与超时兜底

扩展 MUST NOT 把子 agent 完成通知、`agent_settled`、用户新消息或其他会话事件作为**唤醒**信号。「延迟期间的恢复次数」SHALL 仅用于定时器到点时的跳过注入判定，MUST NOT 用于提前结束延迟状态。

#### Scenario: 子 agent 完成不提前清除延迟

- **WHEN** 延迟期间异步子 agent 完成并唤起新一轮，而延迟尚未到点
- **THEN** 延迟状态保持有效，不因该事件被提前清除

#### Scenario: 用户消息不提前清除延迟

- **WHEN** 延迟期间用户发送新消息，而延迟尚未到点
- **THEN** 延迟状态保持有效，仅恢复次数可能因随后的 `completed` settle 增加
