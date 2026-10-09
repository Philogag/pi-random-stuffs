## RENAMED Requirements

- FROM: `### Requirement: 唤醒来源仅为定时器与超时兜底`
- TO: `### Requirement: 唤醒来源为定时器、超时兜底与 /goal 命令`

---

## MODIFIED Requirements

### Requirement: 唤醒来源为定时器、超时兜底与 /goal 命令

扩展 MUST NOT 把子 agent 完成通知、`agent_settled`、用户新消息或其他会话事件作为**唤醒**信号。**唤醒**信号 SHALL 仅来自三个来源：延迟定时器到点、超时兜底，以及用户执行带参数的 `/goal` 命令且宿主报告 agent 空闲时触发的立即启动（语义见 goal-lifecycle 的「目标登记命令（`/goal`）」）。「延迟期间的恢复次数」SHALL 仅用于定时器到点时的跳过注入判定，MUST NOT 用于提前结束延迟状态。

带参数的 `/goal` 命令 SHALL 按 goal-lifecycle 的登记语义清除进行中的延迟状态；该清除 MUST NOT 由其他会话事件触发。不带参数的 `/goal` 查询命令 MUST NOT 作为唤醒信号，也 MUST NOT 改变延迟状态。

#### Scenario: 子 agent 完成不提前清除延迟

- **WHEN** 延迟期间异步子 agent 完成并唤起新一轮，而延迟尚未到点
- **THEN** 延迟状态保持有效，不因该事件被提前清除

#### Scenario: 用户消息不提前清除延迟

- **WHEN** 延迟期间用户发送新消息，而延迟尚未到点
- **THEN** 延迟状态保持有效，仅恢复次数可能因随后的 `completed` settle 增加

#### Scenario: `/goal` 声明是允许的唤醒来源

- **WHEN** 延迟期间用户执行 `/goal 新目标`，且宿主报告 agent 空闲
- **THEN** 延迟状态按登记语义被清除，且扩展立刻投递续跑提示并开启新一轮（该唤醒来自 `/goal` 命令本身，而非会话事件）

#### Scenario: `/goal` 无参查询不唤醒

- **WHEN** 延迟期间用户执行不带参数的 `/goal`
- **THEN** 延迟状态保持有效，且扩展不投递续跑提示、不开启新一轮
