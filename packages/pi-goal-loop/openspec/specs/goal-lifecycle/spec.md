# goal-lifecycle Specification

## Purpose

定义 pi 的**目标生命周期**：用户通过 `/goal` 声明一个持续目标后，pi 在每轮循环结束而目标仍未达成时自动注入下一轮提示词继续推进，直到 agent 调用 `goal_finish` 或用户执行 `/goal-stop`。本 capability 规定目标的登记、替换、查询与终止，自动续跑的触发条件与抑制条件，中断/错误时的暂停语义，以及活动目标仅存于内存、宿主版本下限等约束。

## Requirements

### Requirement: 目标登记命令（`/goal`）

扩展 MUST 注册用户命令 `/goal`。带参数执行时，扩展 SHALL 把参数文本登记为**活动目标**并清除任何进行中的延迟状态；不带参数执行时，扩展 SHALL 仅展示当前目标状态（有目标则显示目标原文，无目标则提示未设置），且 MUST NOT 改变目标状态。当已存在活动目标时，再次带参数执行 SHALL 用新文本替换旧目标，并 MUST 通知用户旧目标已被替换。扩展 MUST 在通知中说明活动目标仅保存在内存中，以及 `/goal-stop` 可结束目标。

带参数执行时，若宿主报告 agent 空闲（`ctx.isIdle()` 为 true），扩展 SHALL 在登记与通知之后**立刻**投递一条可见的续跑提示条目并请求开启新一轮模型请求；该提示 MUST 使用与自动续跑相同的续跑提示词内容（含目标原文）。若宿主报告 agent 非空闲，扩展 MUST NOT 额外投递任何条目或请求新一轮。该「立即启动」行为 MUST 对首次声明与替换既有目标一致适用，且 MUST NOT 改变 `/goal` 无参查询、目标清除出口或自动续跑边界的既有语义。

#### Scenario: 发起新目标

- **WHEN** 用户执行 `/goal 重构 X 模块并跑通全部测试` 且当前没有活动目标
- **THEN** 该文本被登记为活动目标，且用户收到包含该目标原文与 `/goal-stop` 提示的确认通知

#### Scenario: 空闲时立刻开始执行

- **WHEN** 用户执行 `/goal 重构 X 模块`，且先前没有活动目标、宿主报告 agent 空闲
- **THEN** 扩展立刻投递一条包含 `重构 X 模块` 的可见续跑提示，并请求开启新一轮模型请求

#### Scenario: 非空闲时不额外投递

- **WHEN** 用户执行 `/goal 给 Y 补集成测试`，且宿主报告 agent 非空闲（正在 streaming）
- **THEN** 扩展不额外投递续跑提示、也不额外请求新一轮，目标仍被登记为活动目标

#### Scenario: 替换已有目标

- **WHEN** 活动目标为 `重构 X 模块`，用户执行 `/goal 给 Y 补集成测试`
- **THEN** 活动目标变为 `给 Y 补集成测试`，且用户收到「旧目标已被替换」的通知

#### Scenario: 替换目标且空闲时立刻开始执行

- **WHEN** 活动目标为 `重构 X 模块`、宿主报告 agent 空闲，用户执行 `/goal 给 Y 补集成测试`
- **THEN** 活动目标变为 `给 Y 补集成测试`，用户收到「旧目标已被替换」的通知，且扩展立刻投递一条包含 `给 Y 补集成测试` 的可见续跑提示并请求开启新一轮模型请求

#### Scenario: 无参数查询状态

- **WHEN** 用户执行 `/goal` 且已存在活动目标 `重构 X 模块`
- **THEN** 扩展显示该目标原文与「仅存于内存」说明，且目标状态保持不变

#### Scenario: 无参数且无目标

- **WHEN** 用户执行 `/goal` 且当前没有活动目标
- **THEN** 扩展提示当前没有活动目标，且不产生任何状态变更

---

### Requirement: 目标终止命令（`/goal-stop`）

扩展 MUST 注册用户命令 `/goal-stop`。执行时 SHALL 使活动目标变为 inactive，并 SHALL 清除任何进行中的延迟状态与其定时器。当没有活动目标时，扩展 MUST 给出提示而 MUST NOT 抛出错误。

#### Scenario: 停止活动目标

- **WHEN** 存在活动目标且用户执行 `/goal-stop`
- **THEN** 活动目标被清除，且用户收到已停止的通知

#### Scenario: 无目标时停止

- **WHEN** 没有活动目标且用户执行 `/goal-stop`
- **THEN** 扩展提示当前没有活动目标，且不抛出错误

---

### Requirement: 目标完成工具（`goal_finish`）

扩展 MUST 向 agent 注册名为 `goal_finish` 的工具。该工具的执行 SHALL 使活动目标变为 inactive 并清除任何进行中的延迟状态。当不存在活动目标时，该工具 MUST 返回失败的工具结果而不是成功。

#### Scenario: agent 声明目标完成

- **WHEN** 存在活动目标且 agent 调用 `goal_finish`
- **THEN** 活动目标被清除，且工具结果为成功并说明目标已结束

#### Scenario: 无目标时调用

- **WHEN** 不存在活动目标且 agent 调用 `goal_finish`
- **THEN** 工具返回失败结果，内容说明当前没有活动目标

---

### Requirement: 自动续跑边界

扩展 MUST 监听 `agent_before_settle` 事件。当且仅当存在活动目标、没有生效的延迟抑制、且事件 `outcome` 为 `"completed"` 时，扩展 SHALL 向会话追加一条可见的续跑提示条目，并 SHALL 返回请求一次后续模型请求的结果（`continue: true`）。除该条件外，扩展 MUST NOT 请求续跑。

#### Scenario: 完成一轮后自动续跑

- **WHEN** 存在活动目标、无延迟抑制，且一轮以 `outcome === "completed"` 结束并到达 `agent_before_settle`
- **THEN** 会话中追加一条可见的续跑提示，且该边界返回 `continue: true` 以请求一次后续模型请求

#### Scenario: 无活动目标时不续跑

- **WHEN** 不存在活动目标且到达 `agent_before_settle`
- **THEN** 扩展不追加任何条目，也不请求续跑

---

### Requirement: 中断与错误时暂停续跑

当 `agent_before_settle` 的 `outcome` 为 `"aborted"`（用户中断）或 `"error"` 时，扩展 MUST NOT 追加续跑提示，也 MUST NOT 请求续跑；同时扩展 MUST 保持活动目标为 active，不得因中断或错误清除目标。

#### Scenario: 用户中断后不自动推进

- **WHEN** 存在活动目标且一轮以 `outcome === "aborted"` 结束
- **THEN** 不注入任何续跑提示、不请求续跑，且活动目标仍然存在

#### Scenario: 出错后不自动重试

- **WHEN** 存在活动目标且一轮以 `outcome === "error"` 结束
- **THEN** 不注入任何续跑提示、不请求续跑，且活动目标仍然存在

#### Scenario: 中断后用户消息恢复循环

- **WHEN** 目标因上一轮中断而暂停，随后用户发送一条新消息并再次到达 `agent_before_settle` 且 `outcome === "completed"`
- **THEN** 扩展恢复正常续跑行为

---

### Requirement: 目标生命周期的唯一出口

活动目标 MUST 只能由 `goal_finish`（agent 侧）或 `/goal-stop`（用户侧）变为 inactive。任何其他事件——包括 `aborted`、`error`、`agent_settled`、一轮结束、或 `/goal` 查询——MUST NOT 清除活动目标。

#### Scenario: 其他事件不清除目标

- **WHEN** 活动目标存在且一轮以 `aborted` 或 `error` 结束
- **THEN** 活动目标在事件处理后仍然 active

#### Scenario: 两个出口都能清除目标

- **WHEN** agent 调用 `goal_finish` 或用户执行 `/goal-stop`
- **THEN** 活动目标变为 inactive

---

### Requirement: 续跑提示词内容

续跑提示条目 MUST 包含当前活动目标的原文，SHALL 指示 agent 继续推进该目标，并 SHALL 说明完成后调用 `goal_finish`、需要等待异步任务时调用 `goal_sleep`、以及用户可用 `/goal-stop` 结束目标。该条目 MUST 以可见形式（写入会话并可被用户看到）投递，且 MUST 进入模型上下文。

#### Scenario: 提示词包含目标与出口说明

- **WHEN** 扩展在活动目标 `重构 X 模块` 上注入续跑提示
- **THEN** 提示文本包含 `重构 X 模块`，并提及 `goal_finish`、`goal_sleep` 与 `/goal-stop`

#### Scenario: 提示对用户可见

- **WHEN** 扩展注入续跑提示
- **THEN** 该条目以可见形式出现在会话中，而不是静默注入

---

### Requirement: 工具引导不经过系统提示词

扩展 MUST 在扩展加载时即注册 `goal_finish` 与 `goal_sleep`，使工具列表在会话生命周期内保持稳定（MUST NOT 通过 `pi.setActiveTools` 动态增删），以保持 prompt 前缀缓存的命中率。扩展 MUST NOT 为这两个工具设置 `promptSnippet` 或 `promptGuidelines`，也 MUST NOT 以其他方式把工具用法写入系统提示词；工具用法仅由续跑提示词条目传达。工具的 `description` SHALL 随工具 schema 一同下发。

#### Scenario: 工具在加载时即注册

- **WHEN** 扩展被加载并完成初始化
- **THEN** `goal_finish` 与 `goal_sleep` 均已注册且可用，无需等待 `/goal`

#### Scenario: 不注入系统提示词片段

- **WHEN** 检查 `goal_finish` 与 `goal_sleep` 的注册定义
- **THEN** 两者都没有 `promptSnippet`，也没有 `promptGuidelines`

---

### Requirement: 目标状态仅存于内存

扩展 MUST 将活动目标与延迟状态仅保存在扩展运行时的内存中，MUST NOT 通过 `pi.appendEntry` 写入会话条目、也 MUST NOT 写入磁盘文件。当扩展 runtime 被重建（例如 `/reload`）后，扩展 SHALL 处于「无活动目标」状态。

#### Scenario: reload 后目标丢失

- **WHEN** 存在活动目标且扩展 runtime 被重建
- **THEN** 重建后的扩展报告当前没有活动目标

#### Scenario: 不写入会话条目

- **WHEN** 用户执行 `/goal 某个目标`
- **THEN** 不产生任何目标相关的自定义会话条目写入

---

### Requirement: 运行环境版本下限

由于自动续跑依赖 `agent_before_settle` 扩展事件，扩展 MUST 在 `package.json` 的 `peerDependencies` 中声明
`@earendil-works/pi-coding-agent` 的下限为 `>=0.87.0`（该事件自 pi `0.87.0` 起提供）。用于本地
typecheck 与测试的 `devDependencies` SHALL 解析到不低于 `0.87.1` 的同一包版本。

#### Scenario: 声明版本下限

- **WHEN** 检查 `packages/pi-goal-loop/package.json`
- **THEN** `peerDependencies["@earendil-works/pi-coding-agent"]` 的下限不低于 `0.87.0`，
  且 `devDependencies` 中同一包不低于 `0.87.1`
