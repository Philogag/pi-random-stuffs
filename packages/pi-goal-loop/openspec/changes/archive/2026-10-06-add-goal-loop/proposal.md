## Why

pi 目前只能「一轮一轮」地对话：agent 在 `agent_before_settle` 之后就会停下来等用户输入，即使用户已经交代了一个需要多轮才能完成的目标（例如「把 X 重构完并跑通测试」）。用户必须反复手动敲「继续」，多轮任务因此频繁中断。本次变更引入一个显式的「活动目标」概念：用户用 `/goal` 声明目标，扩展监听 pi 事件循环，在循环本应结束时自动注入一轮续跑提示词，直到 agent 明确调用 `goal_finish` 或用户调用 `/goal-stop`。同时，agent 在派发异步 subagent 后往往处于「等待中」，此时不该立刻续跑——`goal_sleep` 让 agent 主动声明延迟触发。为什么是现在：`agent_before_settle` 提供了官方认可的「请求一次后续模型请求」边界（`continue: true`），使自动续跑可以在不伪造 user 消息的前提下实现。

## What Changes

- 新增扩展包 `pi-goal-loop`（`packages/pi-goal-loop/`），导出默认扩展工厂。
- 新增用户命令 **`/goal <目标描述>`**：把该目标登记为**活动目标**（active goal）。无参数时展示当前目标状态。
- 新增用户命令 **`/goal-stop`**：**唯一**由用户侧结束目标的方式，清除活动目标。
- 新增模型可调用工具 **`goal_finish`**：**唯一**由 agent 侧结束目标的方式，清除活动目标。
- 新增模型可调用工具 **`goal_sleep({ seconds })`**：声明「等待中，先别续跑」。
- 新增事件监听 **`agent_before_settle`**：当存在活动目标时，向会话追加一条续跑提示（`custom_message`）并 `return { continue: true }`。

**Goal lifecycle**
- From: 无「目标」概念，agent 停下即结束。
- To: `/goal` 之后目标持续 active；仅 `goal_finish`（agent）或 `/goal-stop`（用户）使其变为 inactive。
- Reason: 让多轮任务可以无人值守地推进。
- Impact: non-breaking；仅新增能力，不修改既有包。

**Continuation guard**
- From: 无续跑。
- To: 仅在 `outcome === "completed"` 时才续跑；`aborted`（用户 Esc）/ `error` 一律不续跑，但目标保持 active。
- Reason: 尊重用户中断，且避免无条件续跑导致死循环（pi 文档明确警告）。
- Impact: non-breaking。

**Deferral (`goal_sleep`)**
- From: 无延迟机制。
- To: `goal_sleep({ seconds })` = 一次性抑制紧随其后的 settle 续跑 + 注册 `seconds` 后的定时器；定时器到点时若循环已被其他路径恢复，则跳过注入；超过超时上限（默认 15 分钟）未恢复则强制续跑。
- Reason: agent 派发异步 subagent 后处于等待态，立刻续跑会导致空转。
- Impact: non-breaking；定时器需在 `session_shutdown` 幂等清理。

## Capabilities

### New Capabilities

- `goal-lifecycle`: 活动目标的生命周期与自动续跑循环——`/goal` 发起、`/goal-stop` 与 `goal_finish` 终止、`agent_before_settle` 上的续跑守卫（`outcome === "completed"`）、中断/错误时的暂停语义、续跑提示词内容。
- `goal-deferral`: 续跑的延迟机制——`goal_sleep` 工具契约、一次性抑制的消费规则、定时器唤醒与「已恢复则跳过注入」去重、超时兜底、会话关闭时的定时器清理。

### Modified Capabilities

无。本变更为全新包，不修改 `openspec/specs/` 下任何既有能力的需求。

## Impact

- **新增包**：`packages/pi-goal-loop/`，含 `package.json`、`tsconfig.json`、`src/index.ts`（及拆分模块）、`test/*.test.ts`、`README.md`。
- **新增 OpenSpec 工作区**：`packages/pi-goal-loop/openspec/`（`config.yaml` + `schemas/superpowers-bridge-cn/`，已从 `packages/pi-tool-presistant-bash/` 复制，保持仓库「每包独立工作区」约定）。
- **peer 依赖**：`@earendil-works/pi-coding-agent`（`ExtensionAPI`/`ExtensionContext` 类型）、`typebox`（工具参数 schema）。
- **dev 依赖**：`typescript` `^5.6.3`、`vitest` `^4.1.11`（对齐 `pi-tool-presistant-bash` 的约定）。
- **依赖的 pi API**：`pi.registerCommand`、`pi.registerTool`、`pi.on("agent_before_settle")`、`pi.on("session_shutdown")`、`pi.sendMessage`。
- **不修改**：仓库根、其他 `packages/*`、任何既有 extension 行为。
- **运行风险**：扩展会在 pi 进程内自动注入模型请求，是「会自我循环」的行为；必须靠 `outcome === "completed"` 守卫与 `goal_finish` / `/goal-stop` 显式出口约束。
