<!--
Delta spec:工具提示词与设置覆盖契约
能力:prompt-contract(v1 新建)
说明:v1 初次确立（全部需求为新增），无 MODIFIED / REMOVED / RENAMED。
-->
## ADDED Requirements

### Requirement: 三个注入面各司其位

扩展 MUST 通过工具的 `promptSnippet` 注入工具可见性文案、通过 `promptGuidelines` 注入使用纪律、通过 `description` 声明参数契约。`promptSnippet` MUST 单行；宿主会折叠其中的换行与连续空白，归一化后为空则工具不进 `<tools>` 列表。`promptGuidelines` MUST 是字符串数组，每条 MUST 自洽可独立阅读；宿主按顺序渲染为 `<rules>` 段内的 `- ` 条目，并对完全相同的条目去重。`description` MUST NOT 承担"何时使用"的指导（那是 guidelines 的职责），也 MUST NOT 依赖它出现在 system prompt 中——它只进 provider 的工具 schema。

#### Scenario: snippet 进工具列表

- **WHEN** 检查注册结果
- **THEN** `promptSnippet` 为非空单行字符串
- **AND** 该字符串同时出现在系统提示的 `<tools>` 段的 `- todo: <snippet>` 行中

#### Scenario: guidelines 进 rules

- **WHEN** 检查注册结果
- **THEN** `promptGuidelines` 为字符串数组，每条渲染为 `<rules>` 段内一条 `- ` 规则
- **AND** 顺序与数组顺序一致

#### Scenario: description 不进 system prompt

- **WHEN** 检查系统提示全文
- **THEN** 其中不含工具 `description` 的正文内容（仅由 schema 提供）

---

### Requirement: description 必须声明五状态机

工具 `description` MUST 包含全部五个状态名（`pending`、`in_progress`、`waiting`、`completed`、`deleted`），MUST 说明 `blockedBy` 的语义，MUST 说明 `waiting` 需带 `waitReason`，且 MUST NOT 声明与状态迁移表（见 todo-task-graph）矛盾的能力。

#### Scenario: 状态名齐备

- **WHEN** 检查 `description` 文本
- **THEN** 五个状态名均出现，且 `blockedBy` 出现

#### Scenario: 与迁移表一致

- **WHEN** `description` 说明某状态可迁入某目标状态
- **THEN** 该迁移在 todo-task-graph 的迁移表中存在

---

### Requirement: 默认 guidelines 的覆盖主题与长度上界

默认 `promptGuidelines` MUST 恰好覆盖以下六个主题，一件事一条：何时建列表与何时不建；`in_progress` 的唯一性与"先置后做"；只在验证通过后 `completed`；外部阻塞时转 `waiting` 并附 `waitReason`；`status` 是唯一切换字段且空更新会被拒绝、`list` 默认隐藏墓碑；`blockedBy` 为增量合并且成环会被拒绝。默认条数 MUST NOT 超过 6 条，每条 MUST NOT 超过 400 字符，`promptSnippet` MUST NOT 超过 90 字符。默认文案中 MUST NOT 出现重复行。

#### Scenario: 条数与长度受约束

- **WHEN** 检查默认 guidelines
- **THEN** 恰为 6 条，每条长度不超过 400 字符，且 snippet 不超过 90 字符

#### Scenario: 六个主题均在位

- **WHEN** 把默认 guidelines 连接成文本检查
- **THEN** 文本包含 `Exactly one task is in_progress`、`verified`、`waiting`、`waitReason`、`addBlockedBy`、`includeDeleted:true`

#### Scenario: 无重复

- **WHEN** 对默认 guidelines 取集合
- **THEN** 集合大小等于数组长度

---

### Requirement: 用户覆盖取代默认值

用户 MUST 能通过 pi settings 中的包键覆盖这两个字段：`{"@philogag/pi-todo": {"guidance": {"promptSnippet": "...", "promptGuidelines": ["..."]}}}`。覆盖语义 MUST 为整字段替换（不是逐条合并）。覆盖值 MUST 先经清洗：字符串去首尾空白，空白或空串视为未提供；guidelines 中非字符串元素与空白行 MUST 被丢弃；清洗后无有效内容的字段 MUST 回退到内置默认值。settings 缺失或损坏 MUST 等价于全默认。

#### Scenario: 覆盖生效

- **WHEN** settings 提供 `guidance.promptSnippet = "custom snippet"` 与 `promptGuidelines = ["custom rule"]`
- **THEN** 注册的 snippet 与 guidelines 恰为上述覆盖值

#### Scenario: 畸形覆盖回退

- **WHEN** settings 提供 `guidance.promptGuidelines = "not-an-array"`
- **THEN** 注册的 guidelines 为内置默认值

#### Scenario: 空白覆盖回退

- **WHEN** settings 提供 `guidance.promptSnippet = "   "`
- **THEN** 注册的 snippet 为内置默认值

---

### Requirement: 三个注入面之间不得矛盾

`promptSnippet`、`promptGuidelines` 与 `description` MUST NOT 互相矛盾（例如 guidelines 禁止的行为在 description 中被描述为推荐做法），且 MUST NOT 出现与状态迁移表冲突的措辞。矛盾文案会被模型当作两种规范，行为退化为随机。

#### Scenario: waiting 描述一致

- **WHEN** guidelines 声称 `waiting` 不需要理由
- **THEN** 该文案违反本 requirement（`description` 要求 `waitReason`，迁移表在缺 reason 时拒绝）

#### Scenario: 参数表不复述

- **WHEN** 检查默认 guidelines
- **THEN** 其中不包含参数清单式的复述条目（参数契约由 schema 承担，复述会让每条规则的成本翻倍）
