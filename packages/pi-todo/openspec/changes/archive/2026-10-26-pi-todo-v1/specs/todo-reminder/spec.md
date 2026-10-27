<!--
Delta spec:停时提醒策略
能力:todo-reminder(v1 新建)
说明:v1 初次确立（全部需求为新增），无 MODIFIED / REMOVED / RENAMED。
-->
## ADDED Requirements

### Requirement: 唯一的续跑来源

扩展 MUST NOT 通过任何其他事件请求续跑。请求续跑 MUST 只发生在 `agent_before_settle`，且 MUST 以返回 `{ continue: true, entries: [...] }` 的形式提出。注入条目 MUST 为 `custom_message`，其 `customType` MUST 为 `pi-todo-reminder`，`display` MUST 为 `true`——用户看不见的提醒与"agent 自言自语"无从区分，也无法计量。

#### Scenario: 提醒以可见条目注入

- **WHEN** 一次 settle 满足了全部提醒条件
- **THEN** 扩展返回一条 `custom_message` 条目，`customType` 为 `pi-todo-reminder`、`display` 为 `true`，并带 `continue: true`

#### Scenario: 其他事件不续跑

- **WHEN** 会话发生用户消息、工具结果、紧凑化等事件而无人触发 settle
- **THEN** 扩展不请求续跑

---

### Requirement: 预算按用户提示计

每个**用户提示** MUST 拥有独立预算：默认上限 3 次提醒，可通过 `reminders.max` 调整，读取时 MUST 取整并夹紧到 `[1, 9]`；非有限值 MUST 回退默认值。已用次数 MUST 只在新的用户提示到达时归零——具体地，只在 `before_agent_start` 归零，MUST NOT 在 `agent_start` 归零（该事件同样由扩展自身的续跑触发，在此归零会让天花板失效并退化为无限循环）。工具结果、紧凑化与分支切换 MUST NOT 扩充预算。次数达到上限后 MUST 跳过且 MUST NOT 消耗请求。

#### Scenario: 上限后静默

- **WHEN** 预算为 3 且本提示已提醒 3 次，仍有未完成任务，一轮正常结束
- **THEN** 扩展跳过本次提醒（原因 `budget-exhausted`），不请求续跑

#### Scenario: 新提示重置预算

- **WHEN** 上一提示的预算已用尽，用户发送新消息并到达 `before_agent_start`
- **THEN** 已用次数归零，后续首次达标 settle 可以再次提醒

#### Scenario: 自身续跑不重置预算

- **WHEN** 扩展刚因提醒请求了续跑，该轮随后以 `completed` 结束
- **THEN** 已用次数保持已增加的值，不因该轮的 `agent_start` 归零

#### Scenario: 配置越界被夹紧

- **WHEN** `reminders.max` 配置为 `0`、`12` 或非数字
- **THEN** 生效上限分别为 1、9、默认 3

---

### Requirement: 单飞锁

一次提醒发出后，扩展 MUST 进入"等待进展"状态，并在该状态下跳过后续 settle。**任意**工具结果（不限 `todo` 工具）MUST 解除该状态——只有把 `todo` 当作进展信号，会让一整段有效的非 todo 工作被误判为空转，从而在下一次 settle 无故提醒。该状态 MUST 与预算同时持久于本次用户提示的作用域内。

#### Scenario: 提醒后无进展则静默

- **WHEN** 提醒已发出且此后没有任何工具结果，又一轮以 `completed` 结束
- **THEN** 扩展跳过（原因 `awaiting-progress`）

#### Scenario: 任意工具解除

- **WHEN** 提醒已发出，随后 `bash` 工具返回结果
- **THEN** 等待进展状态被解除，后续达标 settle 可再次提醒（仍受预算约束）

---

### Requirement: 未完成任务的判定

参与判定的集合 MUST 恰为 `pending` 与 `in_progress`。`waiting` MUST 被结构性排除：一个停泊在外部事件上的任务不是模型"欠着"的工作。`completed` 与 `deleted` MUST 不参与。

#### Scenario: waiting 不触发提醒

- **WHEN** 唯一未终结的任务状态为 `waiting`，一轮正常结束
- **THEN** 扩展跳过（原因 `no-open-tasks`）

#### Scenario: pending 触发提醒

- **WHEN** 存在一个 `pending` 任务，一轮正常结束且其余条件满足
- **THEN** 扩展发出提醒

---

### Requirement: 跳过条件（全局与轮次）

判定 MUST 先检查以下三条，任一命中 MUST 静默跳过：

| 顺序 | 条件 | 原因标识 |
| --- | --- | --- |
| 1 | 会话以打印模式运行（`ctx.mode === "print"`） | （不入策略，直接返回） |
| 2 | `reminders.enabled` 为 false | `disabled` |
| 3 | settle 结果非 `completed` | `not-completed` |

中断轮（`aborted`）与错误轮 MUST NOT 被提醒介入：它们要么是用户自己的打断，要么是真的失败了。

#### Scenario: 中断轮不提醒

- **WHEN** settle 结果为 `aborted` 且仍有未完成任务
- **THEN** 扩展跳过（原因 `not-completed`）

#### Scenario: 打印模式不提醒

- **WHEN** 会话模式为打印模式且存在未完成任务
- **THEN** 扩展不注入任何条目（每次提醒都是一整个额外请求，而无人在场处理）

---

### Requirement: 跳过条件（预算与上下文）

全局条件未命中后，扩展 MUST 再依次检查以下五条，任一命中 MUST 静默跳过并 MUST 记录对应原因：

| 顺序 | 条件 | 原因标识 |
| --- | --- | --- |
| 4 | 处于单飞等待状态 | `awaiting-progress` |
| 5 | 已用次数达到上限 | `budget-exhausted` |
| 6 | 无未完成任务 | `no-open-tasks` |
| 7 | 本轮以向用户提问结束且 `skipWhenAwaitingUser` 为真 | `awaiting-user` |
| 8 | 宿主报告无法续跑（`canContinue` 为假） | `no-continuation` |

顺序的意义仅在于记录哪一条最先命中；每一条都是硬跳过，MUST NOT 有"降低强度继续提醒"的中间态。

#### Scenario: 无法续跑时不尝试

- **WHEN** 宿主报告 `canContinue` 为假
- **THEN** 扩展跳过（原因 `no-continuation`）且不返回续跑请求

#### Scenario: 预算耗尽优先于集合判定

- **WHEN** 已用次数达上限、同时存在 `pending` 任务
- **THEN** 记录的原因为 `budget-exhausted`

---

### Requirement: 提问启发式

当 `skipWhenAwaitingUser` 为真（默认）时，扩展 MUST 只在**最后一个非空行**上判定本轮是否在向用户提问：该行以 `?` 或 `？` 结尾，或匹配 `would you like`、`do you want`、`shall i`、`should i`、`which one`、`which option`、`let me know` 之一（不区分大小写）时，MUST 视为提问。判定刻意窄：假阳性只静音一次提醒，假阴性却会花掉一次请求去催一个已经问出口的问题。

#### Scenario: 结尾问句静音

- **WHEN** 最后一条助手消息的最后非空行为 `Should I proceed with the migration?`
- **THEN** 扩展跳过（原因 `awaiting-user`）

#### Scenario: 关闭该守卫后仍提醒

- **WHEN** `reminders.skipWhenAwaitingUser` 为 false 且本轮以问句结束、其余条件满足
- **THEN** 扩展发出提醒

#### Scenario: 中间行问句不静音

- **WHEN** 助手消息中间出现问句，但最后一行是陈述句
- **THEN** 该守卫不命中（是否提醒由其余条件决定）

---

### Requirement: 提醒文案

提醒内容 MUST 包含：序号与预算（`<attempt>/<max>`）、未完成任务数量、至多 6 条任务行（超出部分合并为一行 `- … and N more`）、以及四个可选动作（继续并更新、验证后标完成、转 `waiting` 并给出理由、删除）。文案 MUST 说明 `waiting` 不触发提醒且可逆，MUST 告知本次提醒消耗一次额外请求且预算用尽后不再提醒，MUST 允许"确实被阻塞则保持沉默"这一合法结局。任务行 MUST 形如 `- #id [status] subject[ — activeForm]`。

#### Scenario: 超量任务被折叠

- **WHEN** 存在 9 个未完成任务且提醒触发
- **THEN** 文案列出前 6 条，并追加一行说明另有 3 条

#### Scenario: 文案含预算与逃生阀

- **WHEN** 提醒触发且 `max` 为 3、本次为第 2 次
- **THEN** 首行包含 `2/3`，且文案包含 `waiting` 与 `waitReason` 的说明

---

### Requirement: 不提供静音开关

扩展 MUST NOT 提供"本次跳过提醒""暂停提醒"之类的操作或参数，也 MUST NOT 让模型通过任何调用把提醒静音。抑制提醒的唯一结构性途径 MUST 是把任务转入 `waiting`：该状态在 overlay 与 `/todos` 中可见、带理由、且可逆。**理由**：无痕的静音比把活干完更便宜，一旦存在，模型就会选它。

#### Scenario: 无 pause 操作

- **WHEN** 检查工具参数面与全部命令
- **THEN** 不存在任何暂停/忽略提醒的操作

#### Scenario: 停泊是唯一出口

- **WHEN** 模型确实被外部事件阻塞
- **THEN** 把任务转为 `waiting`（附 `waitReason`）后，下一轮 settle 不再提醒

---

### Requirement: 审计与调试

扩展 MUST 为每次评估的 settle 记录一条决策（提醒或跳过、次数、估算的输出 token、原因、时间戳），并 MUST 把该轨迹限制在最近 12 条。当环境变量 `PI_TODO_DEBUG=1` 时，每次跳过 MUST 以包含跳过原因的单行日志输出到 stderr。该轨迹 MUST 是纯数据，不得影响判定结果。

#### Scenario: 轨迹上限

- **WHEN** 连续评估 20 次 settle
- **THEN** 轨迹中仅保留最近 12 条决策

#### Scenario: 调试输出原因

- **WHEN** `PI_TODO_DEBUG=1` 且某次 settle 因预算耗尽被跳过
- **THEN** 日志中出现含 `budget-exhausted` 的一行

---

### Requirement: 会话隔离与清理

提醒状态 MUST 按会话独立保存。会话关闭时 MUST 清除该会话的提醒状态与其他数据槽。过期或失效的会话上下文 MUST 被视为"无预算可消耗"并静默返回，MUST NOT 抛出异常。

#### Scenario: 会话独立

- **WHEN** 两个会话各自消耗提醒预算
- **THEN** 一个会话的已用次数不影响另一个会话

#### Scenario: 关闭后清理

- **WHEN** 会话关闭
- **THEN** 其提醒状态被移除，之后的重复清理不抛出错误

---

### Requirement: 运行模式策略

提醒 MUST 只在 `reminders.modes` 列出的模式中触发，默认 MUST 为 `["tui", "rpc"]`。理由：一次提醒消耗一次完整 provider 请求，且需要有人能据此行动——终端用户（`tui`）或 RPC 客户端（`rpc`）都算在其中；`json` 与 `print` 是无人的一次性管道，注入续跑会让客户端收到未预期的额外回合并静默加倍成本。覆盖值 MUST 为数组，未知模式名 MUST 被丢弃，去重后按 `tui`→`rpc`→`json`→`print` 排序；若覆盖值不含任何可用模式 MUST 回退默认策略，MUST NOT 视为"全部关闭"（关闭提醒 MUST 用 `reminders.enabled: false`）。

模式 MUST 取自 `ctx.mode`。当宿主未提供该字段或取值未知时 MUST 用 `ctx.hasUI` 回退：有 UI 视为 `tui`，无 UI 视为 `print`（两个维度上都最保守的一侧）。

#### Scenario: json 模式静默

- **WHEN** 在 `json` 模式下仍有未完成任务且一轮正常结束
- **THEN** 扩展不请求续跑，也不注入任何条目

#### Scenario: rpc 模式仍然提醒

- **WHEN** 在 `rpc` 模式下仍有未完成任务且一轮正常结束
- **THEN** 扩展按常规返回 `{ continue: true }` 与提醒条目

#### Scenario: 覆盖生效

- **WHEN** `reminders.modes` 为 `["json"]`
- **THEN** `json` 模式会提醒，而 `tui` 模式静默

#### Scenario: 无效覆盖回退

- **WHEN** `reminders.modes` 只含未知模式名
- **THEN** 使用默认模式集合，提醒不会被整体关闭
