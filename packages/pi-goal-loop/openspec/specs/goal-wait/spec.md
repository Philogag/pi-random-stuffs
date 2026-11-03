# goal-wait Specification

## Purpose

定义**目标续跑的等待（wait）语义**：当本轮正在等待用户回答（`ask_user_question`）或后台/子 agent 结果（`bg_wait`、`acp_delegate_wait`、异步派发）时，扩展从宿主公开事件推导出“正在等”，并在等待期间抑制续跑。本 capability 规定等待信号的来源与分类、等待期抑制续跑、等待态的释放，以及等待期对目标生命周期与检索诊断的影响。它是旧 `goal-deferral`（`goal_sleep` 定时器）的替代：不再由模型声明“该等多久”。

## Requirements

### Requirement: 等待信号的观测

扩展 MUST 通过宿主的公开信号观测「本轮正在等待外部角色」的状态，且 MUST NOT 依赖读取其他扩展的工具结果文本。扩展 MUST 订阅跨扩展事件总线的 `rpiv:ask-user:blocked` 事件，并在 `active === true` 时登记一个等待中的问卷调用、在 `active === false` 时注销对应的调用。扩展 MUST 监听 `tool_execution_start` 与 `tool_execution_end`，用工具名与参数判定等待来源（规则见「等待来源的分类」）。当提供这些信号的兄弟扩展未安装时，扩展 MUST 保持可用，并退化为此前「无等待即续跑」的语义。

#### Scenario: 问卷阻塞被登记与注销

- **WHEN** 收到 `rpiv:ask-user:blocked` 且 `active === true`、`toolCallId === "ask-1"`
- **THEN** 扩展登记一个在途等待 `ask-1`；随后收到同一 `toolCallId` 的 `active === false` 时该在途等待被注销

#### Scenario: 兄弟扩展缺失时仍可用

- **WHEN** 会话中既没有 `rpiv:ask-user:blocked` 事件也没有任何等待类工具调用
- **THEN** 扩展正常工作，`agent_before_settle` 的续跑行为与旧版「无等待即续跑」一致

---

### Requirement: 等待来源的分类

扩展 MUST 把等待来源分为两类，并据此维护两种等待状态：

- **阻塞类**：`ask_user_question`、`bg_wait`、`acp_delegate_wait`。调用开始即登记为在途调用，调用结束即注销在途调用，MUST NOT 设置 latch。
- **异步派发类**：`subagent`、`acp_delegate`。当工具参数不含 `action` 且 `async` 不为 `false` 时，MUST 登记 latch（已把工作交给原生完成唤醒）。

未列入上述集合的工具名 MUST 被忽略。

#### Scenario: 阻塞类工具在途

- **WHEN** `tool_execution_start` 报告 `toolName === "bg_wait"`、`toolCallId === "w1"`
- **THEN** 扩展登记一个在途等待 `w1`，且不设置 latch

#### Scenario: 派发类调用登记 latch

- **WHEN** `tool_execution_start` 报告 `toolName === "subagent"`、`toolCallId === "s1"`，参数为 `{ agent: "worker", task: "…" }`
- **THEN** 扩展登记 latch

#### Scenario: 管理调用不登记

- **WHEN** `tool_execution_start` 报告 `toolName === "subagent"`，参数为 `{ action: "status", id: "run-1" }`
- **THEN** 扩展不登记任何等待状态

#### Scenario: 同步派发不登记

- **WHEN** `tool_execution_start` 报告 `toolName === "subagent"`，参数为 `{ agent: "worker", task: "…", async: false }`
- **THEN** 扩展不登记任何等待状态

#### Scenario: 未知工具被忽略

- **WHEN** `tool_execution_start` 报告 `toolName === "read"`
- **THEN** 扩展不登记任何等待状态

---

### Requirement: 等待期抑制续跑

当存在活动目标、`agent_before_settle` 的 `outcome` 为 `"completed"`、且等待态生效时（存在在途的阻塞类等待，或异步派发的 latch 尚未释放），扩展 MUST NOT 追加续跑提示条目，也 MUST NOT 请求后续模型请求（MUST NOT 返回 `continue: true`）。该抑制 MUST NOT 清除活动目标，也 MUST NOT 因该次 settle 而释放 latch（latch 只由「等待态的释放」列出的外部事件释放）。

#### Scenario: 异步派发后本轮结束不续跑

- **WHEN** 活动目标为 `重构 X 模块`，本轮以 `subagent` 异步派发结束并以 `outcome === "completed"` 到达 `agent_before_settle`
- **THEN** 扩展不追加任何条目、不请求续跑，且活动目标仍然存在

#### Scenario: 问卷在途时不续跑

- **WHEN** 存在活动目标且一个 `ask_user_question` 调用仍在途，随后以 `outcome === "completed"` 到达 `agent_before_settle`
- **THEN** 扩展不追加任何条目、不请求续跑

#### Scenario: 抑制不消费、可重复生效

- **WHEN** latch 生效期间连续两次以 `outcome === "completed"` 到达 `agent_before_settle`
- **THEN** 两次都不追加条目、都不请求续跑

---

### Requirement: 等待态的释放

latch MUST 仅由以下外部事件释放：用户输入触发的 `input` 事件、新一轮开始触发的 `agent_start`、带参数的 `/goal` 命令、`/goal-stop` 命令、`goal_finish` 工具、以及 `session_shutdown`。在途的阻塞类等待 MUST 在其工具调用结束（`tool_execution_end`，或对应的 `rpiv:ask-user:blocked` `active === false`）时注销。释放操作 MUST 是幂等的：重复释放、或在没有等待态时释放，MUST NOT 抛出错误。

#### Scenario: 新一轮开始释放 latch

- **WHEN** latch 生效，随后 `agent_start` 触发（例如子 agent 完成通知唤起了新一轮）
- **THEN** latch 被释放，该轮以 `outcome === "completed"` 到达 `agent_before_settle` 时照常续跑

#### Scenario: 用户输入释放 latch

- **WHEN** latch 生效，随后用户的 `input` 事件触发
- **THEN** latch 被释放

#### Scenario: 目标生命周期事件释放 latch

- **WHEN** latch 生效，随后用户执行 `/goal-stop`（或 agent 调用 `goal_finish`，或会话关闭）
- **THEN** 等待态被清除，且重复清除不抛出错误

#### Scenario: 工具调用结束注销在途

- **WHEN** 一个 `bg_wait` 调用在途，随后 `tool_execution_end` 报告同一 `toolCallId`
- **THEN** 该在途等待被注销，等待态在无 latch 时不再生效

---

### Requirement: 无等待时照常续跑

当不存在等待态时，`agent_before_settle` 的续跑行为 MUST 与本变更前一致：存在活动目标且 `outcome === "completed"` 时追加一条可见续跑提示并 `continue: true`；无活动目标、或 `outcome` 为 `"aborted"`/`"error"` 时不续跑。

#### Scenario: 无等待时续跑

- **WHEN** 存在活动目标、无任何等待态，一轮以 `outcome === "completed"` 到达 `agent_before_settle`
- **THEN** 追加一条 `customType === "goal-loop"` 的可见续跑提示并请求续跑

#### Scenario: 无目标时不续跑

- **WHEN** 不存在活动目标且到达 `agent_before_settle`
- **THEN** 扩展不追加任何条目，也不请求续跑

---

### Requirement: 不注册延迟工具、不使用定时器

扩展 MUST NOT 注册 `goal_sleep` 或任何其他用于推迟续跑的工具，MUST NOT 通过 `setTimeout`/`setInterval` 等定时器推迟或发起续跑，也 MUST NOT 保存以秒为单位的延迟参数。工具面 MUST 只包含 `goal_finish`（加上 `/goal`、`/goal-stop` 两个命令）。

#### Scenario: 工具面只剩 goal_finish

- **WHEN** 扩展完成加载
- **THEN** 已注册的工具只有 `goal_finish`，`goal_sleep` 不存在

#### Scenario: 不创建定时器

- **WHEN** 扩展加载、登记目标、发生异步派发与问卷等待
- **THEN** 扩展不创建任何定时器

#### Scenario: 不残留延迟状态

- **WHEN** 检查扩展内存状态
- **THEN** 状态中只有活动目标与等待态，没有 `seconds`/`until`/`timer` 等延迟字段
