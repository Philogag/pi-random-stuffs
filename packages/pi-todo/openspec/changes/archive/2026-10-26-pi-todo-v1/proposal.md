## Why

`pi-random-stuffs` 里没有自己的 todo 能力，而现有两个可选实现都不合用：

- **oh-my-pi 内置 todo**：把状态机描述直接塞进 tool `description`，没有 `guidelines`
  注入，也没有持久化 overlay；模型只在第一次读到工具时被提示，之后每一轮都不再被提醒。
- **`@juicesharp/rpiv-todo`**：v2.13.8 有 8 条 `guidelines`（走 `<rules>` 注入），比 omp
  更"每轮都在场"，但状态只有 4 个（`pending` / `in_progress` / `completed` / `deleted`），
  **没有"停在外部事件上"的表达**，于是"等 CI / 等用户决定"只能硬塞进 `in_progress`
  或干脆不记录；同时它没有任何停时提醒——一轮结束时若任务还开着，回合就静静结束了。

本变更是把 rpiv-todo fork 进本仓库并改造为自有的 `@philogag/pi-todo`：保留它在会话历史
层面的兼容性（工具名、state entry 类型、`details` 形状），补上第五个状态 `waiting`、
带预算的停时提醒、以及 TUI/无头模式的分野。

## What Changes

**包与依赖**
- From: 仓库中无 todo 包；需要从 npm 安装 `@juicesharp/rpiv-todo`（并连带其 `rpiv-i18n`、
  `rpiv-config` 等 SDK 依赖）。
- To: `packages/pi-todo`，`name: @philogag/pi-todo`，零运行时依赖（去掉 `rpiv-*` SDK，
  改为本地 `t(key, fallback)` 桥），`pi-coding-agent` / `pi-tui` / `pi-ai` 走 peer。
- Reason: 自有实现才能改状态机与提示词；去掉 SDK 才能让 `pi-tui` 变成**懒加载**。
- Impact: 新增包，不影响既有四个包。

**状态机：4 → 5**
- To: `pending` / `in_progress` / `waiting` / `completed` / `deleted`；`waiting` 必须带
  `waitReason`，离开时自动清空，且不计入"open"。
- Reason: 让"停在外部事件上"可被记录、可被看见、并且**不触发停时提醒**。

**停时提醒（本变更的核心新增）**
- To: 一轮结束时若有 open 任务，`agent_before_settle` 投递一条 `custom_message`
  并要求再跑一轮；预算默认 3 次/用户提示（上限 9），单飞锁，8 条跳过守卫，
  `waiting` 任务不算 open，且**不提供静音开关**。
- Reason: 只有"回合结束时"才是补做的时机；而无限续跑会烧钱，所以必须有硬上界。

**提示词三面**
- To: `promptSnippet`（→ `<tools>`）、`promptGuidelines`（→ `<rules>`，重写为 6 条）、
  `description`（→ provider schema，声明五个状态）；三者都可由 settings 覆盖。
- Reason: 三面被 pi 注入到不同位置，各自承担不同职责，必须由 spec 固定分工。

**运行模式**
- To: overlay 仅 `tui` 注册且模块懒加载；提醒默认只在 `tui` + `rpc` 触发。
- Reason: `rpc`（多会话、人类在客户端看流式输出）与 `json`/`print`（一次性问答）语义不同。

## Capabilities

### New Capabilities

- `todo-task-graph` — 工具参数面、五状态迁移、`waiting` 语义、`blockedBy` 依赖图、
  结果信封、权威快照与分支重放。
- `prompt-contract` — 三个注入面的分工、默认文案约束、settings 覆盖、运行模式解析。
- `todo-reminder` — 停时提醒的预算、单飞锁、跳过守卫、提示文案与模式门禁。
- `todo-overlay` — widget 注册与懒加载、行预算、折叠键、`#id` 门控、`/todos` 命令。

### Modified Capabilities

（无。本包为新建能力，不修改既有包的任何 spec。）

## Impact

- 代码：新增 `packages/pi-todo/`（`src/` 20 个模块 + `test/` 9 个文件）。
- 依赖：无新增运行时依赖；`pi-tui`/`pi-ai` 保持 `peerDependencies: "*"`，
  dev 侧固定到 `^0.84.4` 与既有包一致。
- 会话数据：新增 entry 类型 `pi-todo-state`；`rpiv-todo-state` 仍被 replay 接受，
  因此从 rpiv-todo 迁移过来的会话分支不会丢任务。
- 文档：`packages/pi-todo/README.md` + `docs/{tool-schema,prompt-injection,reminders,overlay,configuration,formatting}.md`。
- 测试：`test/` 9 文件 / 149 例；规格 `openspec/specs/` 4 能力 / 40 需求 / 99 场景。
