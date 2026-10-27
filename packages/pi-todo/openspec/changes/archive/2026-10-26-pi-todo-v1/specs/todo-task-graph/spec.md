<!--
Delta spec:任务图、状态机、快照与重放
能力:todo-task-graph(v1 新建)
说明:v1 初次确立（全部需求为新增），无 MODIFIED / REMOVED / RENAMED。
-->
## ADDED Requirements

### Requirement: 工具身份与参数面

扩展 MUST 注册名为 `todo` 的工具，其参数 schema MUST 接受 `action` ∈ {`create`, `update`, `list`, `get`, `delete`, `clear`}。工具名 `todo` MUST NOT 被改名：会话历史中的工具调用以此名记录，改名会使既有 transcript 的头像与重放失配。参数面 MUST 覆盖 `id`、`subject`、`description`、`activeForm`、`status`、`waitReason`、`owner`、`metadata`、`blockedBy`、`addBlockedBy`、`removeBlockedBy`、`includeDeleted`。

#### Scenario: 六个 action 各自可用

- **WHEN** agent 以 `{"action":"create","subject":"x"}` 调用工具
- **THEN** 调用成功并返回新任务的快照
- **AND** 同一工具接受另外五个 action 且不因 action 名未知而崩溃（未知 action MUST 被 schema 拒绝）

#### Scenario: 工具名稳定

- **WHEN** 检查注册的工具名与状态条目类型常量
- **THEN** 工具名为 `todo`，状态条目类型为 `pi-todo-state`

---

### Requirement: 五状态迁移表

`status` MUST 只能是 `pending`、`in_progress`、`waiting`、`completed`、`deleted` 之一。迁移 MUST 按下列表判定；`from === to` MUST 视为合法且被报告为无变化：

| From | 允许迁入 |
| --- | --- |
| `pending` | `in_progress`, `completed`, `waiting`, `deleted` |
| `in_progress` | `pending`, `completed`, `waiting`, `deleted` |
| `waiting` | `pending`, `in_progress`, `completed`, `deleted` |
| `completed` | `deleted` |
| `deleted` | （终态，无出边） |

非法迁移 MUST 返回 `illegal transition <from> → <to>` 且 MUST NOT 修改状态。

#### Scenario: completed 不能回退

- **WHEN** 一个 `completed` 任务被 `update` 为 `status: "in_progress"`
- **THEN** 调用失败，错误内容为 `illegal transition completed → in_progress`
- **AND** 该任务仍为 `completed`

#### Scenario: deleted 是终态

- **WHEN** 一个 `deleted` 任务被 `update` 为任意其他状态
- **THEN** 调用失败，任务仍为 `deleted`

#### Scenario: 同态更新被接受

- **WHEN** 一个 `in_progress` 任务被 `update` 为 `status: "in_progress"` 且没有其他字段变化
- **THEN** 调用成功，内容为 `No change: #N already matches the requested values (status: in_progress)`

---

### Requirement: `waiting` 是可逆的停泊状态

进入 `waiting` MUST 要求非空 `waitReason`（去首尾空白后非空），且该 `waitReason` MUST 持久化在任务上。缺少 reason 时 MUST 拒绝，错误内容为 `status: waiting requires waitReason (what external event are you waiting for?)`。离开 `waiting` MUST 清除 `waitReason`。`waiting` MUST 可迁回 `pending` 或 `in_progress`：**可逆性是本状态的成立条件**——单向门会让模型改用 `completed` 作为停泊点。

#### Scenario: 无理由的停泊被拒绝

- **WHEN** agent 发送 `{"action":"update","id":2,"status":"waiting"}`
- **THEN** 调用失败，错误内容包含 `requires waitReason`
- **AND** 该任务原状态未变

#### Scenario: 带理由停泊

- **WHEN** agent 发送 `{"action":"update","id":2,"status":"waiting","waitReason":"CI run"}`
- **THEN** 调用成功，任务状态为 `waiting` 且 `waitReason` 为 `CI run`
- **AND** 该任务不再计入 `open` 集合（见 todo-reminder）

#### Scenario: 恢复时清除理由

- **WHEN** 一个 `waitReason` 为 `CI run` 的 `waiting` 任务被 `update` 为 `status: "in_progress"`
- **THEN** 任务状态为 `in_progress` 且 `waitReason` 字段被移除

---

### Requirement: create 的语义

`create` MUST 要求非空 `subject`（去空白后非空），否则返回 `subject required for create`。新任务 MUST 以 `pending` 创建，`id` MUST 取当前 `nextId`，且 `nextId` MUST 自增 1。`blockedBy` 中的每个依赖 MUST 存在且 MUST NOT 已 `deleted`，否则 MUST 拒绝（`blockedBy: #N not found` / `blockedBy: #N is deleted`）且 MUST NOT 创建任务。

#### Scenario: 创建即 pending

- **WHEN** agent 发送 `{"action":"create","subject":"Write tests"}`
- **THEN** 返回 `Created #1: Write tests (pending)`
- **AND** 任务状态为 `pending`

#### Scenario: 缺 subject 被拒绝

- **WHEN** agent 发送 `{"action":"create","subject":"   "}`
- **THEN** 调用失败，错误内容为 `subject required for create`，且不产生新任务

#### Scenario: 依赖已删除任务被拒绝

- **WHEN** `#1` 已 `deleted` 且 agent 以 `blockedBy: [1]` 创建任务
- **THEN** 调用失败，错误内容为 `blockedBy: #1 is deleted`

---

### Requirement: update 的可变字段与空更新拒绝

`update` MUST 要求 `id`。若未提供任何一个可变字段（`subject`、`description`、`activeForm`、`status`、`waitReason`、`owner`、`metadata`、非空 `addBlockedBy`、非空 `removeBlockedBy`），调用 MUST 被拒绝，错误内容 MUST 列出这些字段名。该规则的存在理由：只带 `id` 的 update 是最常见的协议错误，静默成功会让模型认为操作已生效。

#### Scenario: 只带 id 的更新被拒绝

- **WHEN** agent 发送 `{"action":"update","id":3}`
- **THEN** 调用失败，错误内容以 `update requires at least one mutable field:` 开头并列举可变字段

#### Scenario: 未知 id

- **WHEN** agent 发送 `{"action":"update","id":99,"status":"completed"}`
- **THEN** 调用失败，错误内容为 `#99 not found`

---

### Requirement: 无效果更新必须可辨识

一次 `update` 若未实际改变任务的任何字段（同态 `status`、重复发送相同值），响应 MUST 报告 `No change`，且该调用 MUST NOT 写入持久化条目。**理由**：把无效果更新报告为 `Updated #N` 会让模型无法区分"命令已接受"与"状态已改变"，从而重复发起同一调用。

#### Scenario: 重复发送相同值

- **WHEN** 任务 `#2` 的 `subject` 已是 `Deploy` 且 agent 再次 `update` 为 `subject: "Deploy"`
- **THEN** 响应为 `No change: #2 already matches the requested values (status: <当前状态>)`
- **AND** 不追加持久化条目

#### Scenario: 真实变化被报告

- **WHEN** 任务 `#2` 由 `pending` 改为 `in_progress`
- **THEN** 响应为 `Updated #2 (pending → in_progress)`

---

### Requirement: 依赖图是增量合并且无环

`blockedBy` MUST 以增量方式维护：`addBlockedBy` 追加、`removeBlockedBy` 移除，二者 MUST NOT 要求调用方重发整个数组。追加时 MUST 拒绝自阻塞（`cannot block #N on itself`）、不存在的依赖（`addBlockedBy: #N not found`）、已删除的依赖（`addBlockedBy: #N is deleted`），且 MUST 在合并后的图上做环检测；成环时 MUST 拒绝，错误内容为 `addBlockedBy would create a cycle in the blockedBy graph`。合并 MUST 保持插入顺序并去重。环检测 MUST 覆盖整张图（含未直接参与本次更新的节点）。

#### Scenario: 增量追加

- **WHEN** `#3` 已有 `blockedBy: [1]`，agent 发送 `addBlockedBy: [2]`
- **THEN** `#3` 的 `blockedBy` 为 `[1, 2]`

#### Scenario: 自阻塞被拒绝

- **WHEN** agent 对 `#4` 发送 `addBlockedBy: [4]`
- **THEN** 调用失败，错误内容为 `cannot block #4 on itself`

#### Scenario: 成环被拒绝

- **WHEN** `#1` 被 `#2` 阻塞，且 agent 对 `#1` 发送 `addBlockedBy: [2]`
- **THEN** 调用失败，错误内容包含 `would create a cycle`
- **AND** `#1` 与 `#2` 的 `blockedBy` 均未改变

---

### Requirement: metadata 的合并语义

`metadata` MUST 按键合并进既有元数据：值为 `null` MUST 删除该键；合并后为空对象 MUST 归一为"无 metadata"。未提供 `metadata` 时 MUST 保持原值。

#### Scenario: null 删除键

- **WHEN** 任务有 `metadata: {"a":1,"b":2}`，agent 发送 `metadata: {"b":null}`
- **THEN** 任务 `metadata` 为 `{"a":1}`

#### Scenario: 清空归一

- **WHEN** 任务只有 `metadata: {"a":1}`，agent 发送 `metadata: {"a":null}`
- **THEN** 任务不再携带 `metadata` 字段

---

### Requirement: 删除即墓碑

`delete` MUST 把任务置为 `deleted` 而非物理移除，以便历史 `blockedBy` 引用仍可解析。对已 `deleted` 的任务再次 `delete` MUST 失败（`#N is already deleted`）。`list` MUST 默认隐藏墓碑，仅在 `includeDeleted: true` 时包含。

#### Scenario: 墓碑仍可解析

- **WHEN** `#5` 被 `delete`，且 `#6` 的 `blockedBy` 含 `5`
- **THEN** `get` 对 `#6` 仍能报告其依赖 `#5`

#### Scenario: 默认隐藏

- **WHEN** 存在一个 `deleted` 任务且 agent 发送 `{"action":"list"}`
- **THEN** 输出中不含该任务

---

### Requirement: clear 重置编号

`clear` MUST 清空任务集合并把 `nextId` 重置为 `1`，响应 MUST 报告被清除的任务数量。

#### Scenario: 清理后编号重新开始

- **WHEN** 存在 3 个任务且 agent 发送 `{"action":"clear"}`
- **THEN** 响应为 `Cleared 3 tasks`
- **AND** 随后 `create` 得到 `#1`

---

### Requirement: 工具结果信封

每次调用 MUST 返回单条 `text` 内容与一个 `details` 快照；`details` MUST 包含 `action`、`params`、`tasks`、`nextId`，失败时额外包含 `error`。`list` 的每行 MUST 形如 `[status] #id subject [(activeForm)] [⛓ #dep,…]`，其中 `activeForm` 仅在 `in_progress` 时显示。`get` 的行序 MUST 固定为 `description`、`activeForm`、`blockedBy`、`blocks`、`owner`。所有用户/模型可控文本 MUST 先经控制字符清洗再进入输出。

#### Scenario: list 行格式

- **WHEN** 存在 `#1` 为 `pending` 的 `Write tests` 且被 `#2` 依赖
- **THEN** `list` 输出包含 `[pending] #1 Write tests`
- **AND** 依赖信息以 `⛓ #N` 形式出现在依赖方所在行

#### Scenario: 控制字符被清洗

- **WHEN** `subject` 含 ESC 等控制字符
- **THEN** 输出中不出现裸控制字符，而显示为可读转义

---

### Requirement: 快照持久化与分支重放

任务状态 MUST 只通过"工具结果 `details` + 自定义条目"恢复：每次状态真实变化（`create`/`delete`/`clear`、以及 `changed` 为真的 `update`）MUST 追加类型为 `pi-todo-state` 的自定义条目；读操作与失败调用 MUST NOT 追加。该追加 MUST 独立于工具调用是否以独立 `toolResult` 落地（例如经 `ctx.executeTool` 的编码模式调用）。重放 MUST 从当前分支的历史条目还原状态，并 MUST 同时接受历史遗留类型 `rpiv-todo-state`；`session_start`、`session_compact`、`session_tree` MUST 触发重放。每个会话 MUST 拥有独立状态槽：一个会话不得读写另一个会话的任务集。

#### Scenario: 重放还原

- **WHEN** 一个分支上先后存在两次 `create` 的条目，随后会话重新开始
- **THEN** 任务集包含这两个任务且 `nextId` 为 3

#### Scenario: 读操作不写历史

- **WHEN** agent 连续调用 `list` 与 `get`
- **THEN** 分支上不新增 `pi-todo-state` 条目

#### Scenario: 会话隔离

- **WHEN** 两个会话各自创建任务
- **THEN** 一个会话的 `list` 不包含另一会话的任务

---

### Requirement: 渲染钩子不得崩溃或串号

`renderCall` MUST 在找不到调用会话的任务时回退为 `#<id>` 纯文本，而 MUST NOT 到兄弟会话槽中搜索同名 id。**理由**：每会话 id 从 1 起，跨槽查找会显示错误的主体文本；回退是刻意行为而非缺口。`renderResult` 与 `renderCall` MUST NOT 抛出异常中断 transcript 渲染。

#### Scenario: 未知 id 回退

- **WHEN** 渲染一个当前状态中不存在的 `#7` 的 update 调用
- **THEN** 显示 `#7`（无主体文本），不抛出异常

#### Scenario: 空状态渲染

- **WHEN** 在空任务集上渲染 `list` 结果
- **THEN** 渲染为无任务态文本，不抛出异常
