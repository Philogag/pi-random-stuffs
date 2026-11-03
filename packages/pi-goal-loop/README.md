# @philogag/pi-goal-loop

pi 扩展:给 agent 一个**持续目标**。

一次 `/goal` 声明目标后,pi 会在每轮循环结束而目标仍未完成时**自动注入下一轮提示词**继续推进;若声明时会话**空闲**,还会**立刻开始第一轮**(见「空闲时立即启动」)。只有 agent 调用 `goal_finish` 或用户执行 `/goal-stop` 才会真正结束。适合「做完为止」的长任务,agent 中途收尾过早时由本扩展把它推回去。

> 版本 **0.1.2** · 测试 **59 例** · 已验证宿主 **pi 1.1.0**(kickoff 复验)/ **pi 0.87.1**(端到端)· 最后更新 **2026-10-10**
>
> **0.1.2 起不再提供 `goal_sleep`**:循环会主动识别宿主侧的「等待态」(`ask_user_question` 问卷阻塞、`bg_wait` / `acp_delegate_wait` 等待中、异步派发在途),等待期间自动暂停续跑。

## 安装

```bash
pi install npm:@philogag/pi-goal-loop
```

- 安装后扩展自动启用,无需额外配置;用 `pi config` 可启用 / 禁用。
- 项目级安装加 `-l`(`pi install -l npm:@philogag/pi-goal-loop`,写入 `.pi/settings.json`,可随仓库共享)。
- 卸载:`pi remove npm:@philogag/pi-goal-loop`。
- 快速体验:`pi -e npm:@philogag/pi-goal-loop`(仅本次运行,不写入配置)。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/goal <目标>` | 发起目标并**在空闲时立刻开始一轮**;已有目标时**替换**它(并清除等待态) |
| `/goal` | 无参数:显示当前目标,并提示「仅存于内存」与 `/goal-stop` |
| `/goal-stop` | 结束目标并停止自动续跑 |

### 空闲时立即启动

`/goal <目标>` 在**会话空闲**时会立刻开启一轮,而不是等到下一个循环结束事件:

| 触发场景 | 行为 |
| --- | --- |
| 会话空闲,且当前无活动目标 | 注入目标 → **立即开始一轮** |
| 会话空闲,但已有活动目标 | 替换目标 → **立即开始一轮**(等待态一并清除) |
| 正在跑一轮 / 子 agent 运行中 | 只记录目标,不插队;等本轮结束事件按既有规则续跑 |

实现上由命令处理器在设置目标后判定 `ctx.isIdle()` 并调用 `wakeNow()`,宿主随即以 `triggerTurn: true` 注入一条 `goal-loop` custom message 驱动该轮。复验证据见下文「`/goal` kickoff 的复验记录」。

## 工具(agent 视角)

| 工具 | 作用 |
| --- | --- |
| `goal_finish` | 声明目标**已达成**:结束目标、停止续跑。无活动目标时调用失败 |

这是本扩展**唯一**的 agent 侧工具,且**不出现在系统提示词**里(`promptSnippet` / `promptGuidelines` 均未设置)。它的用法只通过续跑提示词传达,因此不占用每轮固定上下文。

## 等待感知(0.1.2)

不再需要 agent 自己 `sleep` 或轮询:扩展监听宿主事件,识别三类「正在等外部输入」的情形,期间**不再注入续跑提示**。

| 来源 | 触发 | 解除 |
| --- | --- | --- |
| `ask_user_question`(@juicesharp/rpiv-ask-user-question) | 事件总线 `rpiv:ask-user:blocked` 的 `{ active: true }` | 同一事件 `{ active: false }`,或 `tool_execution_end` |
| 阻塞式等待工具 `bg_wait` / `acp_delegate_wait` | `tool_execution_start`(参数里带 id / runId) | `tool_execution_end` |
| 异步派发 `subagent` / `acp_delegate` | `tool_execution_start`(默认 `async: true`) | 闩锁保持,直到**下一轮开始**(`agent_start`)或用户新输入(`input`) |

语义要点:

1. **阻塞类**是「在途」语义:工具还没返回就算在等,返回即恢复。ask 问卷的阻塞事件用 `active` 标志,同时用 `toolCallId` 关联,事件丢失时 `tool_execution_end` 仍能兜底。
2. **异步派发**是「闩锁」语义:派发返回不等于工作完成,所以工具返回后仍保持等待;子 agent 完成会原生唤醒新一轮,该轮开始(`agent_start`)时闩锁自动解除,随后按常规续跑判定继续。
3. **解除宁可提前不可滞后**:用户任意新输入、`/goal` 重新声明、`/goal-stop`、`goal_finish`、会话关闭都会清空等待态——最坏情况是多注入一轮提示(agent 会调用 `bg_wait` 等),而不是永久卡死。
4. **不额外占上下文**:等待态完全靠事件驱动,不需要 agent 调用工具声明「我在等」。

## 停止出口(重点)

只有两个出口会结束目标:

- agent 调用 `goal_finish`
- 用户执行 `/goal-stop`

**`aborted`(按 Esc 中断)与 `error` 只暂停「本轮」续跑,目标仍然 active**;下一条普通消息即可让循环恢复。

## 限制

- **活动目标仅存于内存**:`/reload`、重启 pi、或切换会话后目标丢失,需要重新 `/goal`。扩展刻意不把目标写入 session entry。
- **自动续跑会持续消耗 token**:一个宽泛的目标可能循环很多轮。请用 `/goal-stop` 或让 agent 调用 `goal_finish` 及时收口。
- **等待感知依赖宿主命名约定**:事件频道 `rpiv:ask-user:blocked` 由 `@juicesharp/rpiv-ask-user-question` 公开,工具名 `bg_wait` / `subagent`(pi-subagents)与 `acp_delegate_wait` / `acp_delegate` 也写在 `src/goal-state.ts` 的 `classifyToolCall` 里。这些名字变化时需要同步更新。
- **缺失时是 fail-safe**:事件频道没人发、或工具被改名时,扩展不会卡死——退化为「不等,继续续跑」,最坏情况是多消耗几轮 token。

## 已验证的 pi 版本

- 构建、测试与端到端验证均基于 **pi 0.87.1**(`npm ls @earendil-works/pi-coding-agent` → `0.87.1`);`/goal` kickoff 的复验另在 **pi 1.1.0** 上完成(见本节末)。
- 本扩展依赖 `agent_before_settle` 扩展事件,该事件自 **pi 0.87.0** 起提供;`peerDependencies` 因此要求 `@earendil-works/pi-coding-agent: >=0.87.0`。

端到端验证记录(`pi -e ./src/index.ts -p --mode json "/goal …" "Begin now."`,真实会话,scratch 目录):

| 轮次 | 观察到的宿主事件 |
| --- | --- |
| 1 | agent 完成工作但**未**调用 `goal_finish` → `agent_end` 后宿主 `entry_appended`(`customType: "goal-loop"`) |
| 2 | 仍未收口 → 第二次 `entry_appended`(`goal-loop`) |
| 3 | agent 调用 `goal_finish` → 目标清除,不再注入 → `agent_settled` 后进程正常退出(exit 0) |

即:自动续跑与 `goal_finish` 收口均已通过真实 pi 会话验证;续跑提示词内容包含目标原文与 agent 出口 `goal_finish`(面向用户的 `/goal-stop` 不在该提示词中;旧版提示词里的 `goal_sleep` 已在 0.1.2 删除)。

### `/goal` kickoff 的复验记录(2026-10-09)

本次复验的宿主为 **pi 1.1.0**,扩展源码为已提交的 `src/index.ts`(当时 `src/prompts.ts` 的续跑提示词文案改动尚未提交,现也已包含在 `dd0b37d` 中;该改动只影响提示词文案,不涉及 kickoff 路径)。因本机已全局安装同名扩展(`~/.pi/agent/npm/node_modules/@philogag/pi-goal-loop/dist/index.js`),直接 `-e` 会因 `goal_finish` 工具名冲突而无法加载,故加了 `-ne` 并显式加载 provider 扩展:

```bash
pi -ne \
  -e /home/philogag/.pi/agent/npm/node_modules/@philogag/pi-provider-omniroute/src/index.ts \
  -e <repo>/packages/pi-goal-loop/src/index.ts \
  -p --mode json "/goal 用一句话说明你已经收到目标"
```

| 观察项 | 结果 |
| --- | --- |
| `/goal` 处理器 | 命中,`isIdle()` 返回 `true`(命令处理器内被调用)ⓘ |
| `-p --mode json` 事件流 | 仅 `session` + `agent_start`,随后进程退出;**未**出现 goal-loop custom message,也**未**出现回复 |
| 原因 | print 模式在扩展命令返回 `disposition: "handled"` 后立即 `disposeRuntime()` 并 abort agent;而扩展经 `pi.sendMessage(..., { triggerTurn: true })` 触发的运行是 fire-and-forget(宿主 `sendMessage` 丢弃其 Promise,扩展无法 await),故该轮在产生 `turn_start`/回复前即被中止 |

ⓘ 该行来自 `/tmp` 中一份**插桩临时副本**(在命令处理器内加日志打印 `isIdle()` 返回值),**不是**上方干净 `-p` 运行的结果——干净 `-p` 运行只产出 `session` + `agent_start` 两行事件,无法观测 `isIdle()`。

因此改用**同一未修改源码**的 RPC 模式(`pi --mode rpc --no-session -ne -e …`)复验同一条 `/goal 用一句话说明你已经收到目标`,全程无任何额外用户消息,事件序列为:

| 序号 | 事件(关键字段) |
| --- | --- |
| 1 | `agent_start` |
| 2 | prompt 响应 `disposition: "handled"` |
| 3 | `turn_start` |
| 4 | `message_start` / `message_end`:`role: "custom"`、`customType: "goal-loop"`、`display: true`、内容含目标原文 |
| 5 | assistant 回复 + `goal_finish` 工具调用 → 第二轮 `turn_start` → 最终回复 → `agent_settled` |

即:空闲时 `/goal X` 无需任何额外用户消息即开启一轮,agent 有实际回复并调用 `goal_finish` 收口(全程无 `role: "user"` 消息)。

- **streaming 路径:未验证(需人工交互会话)**。
- 在 pi 1.1.0 下,扩展注入的 custom message 以 `message_start` / `message_end`(`role: "custom"`)呈现,不再发 `entry_appended`;上方「已验证的 pi 版本」的端到端记录基于宿主 0.87.1,其中的 `entry_appended` 观察仅适用于该版本。

## 开发

```bash
pnpm install                 # 安装依赖(弱依赖来自宿主 pi,devDeps 供本地构建)
pnpm --filter @philogag/pi-goal-loop test        # 测试(59 例)
pnpm --filter @philogag/pi-goal-loop typecheck
pnpm --filter @philogag/pi-goal-loop build       # 产出 dist/
```

> pnpm 11 会拦截依赖的 postinstall 脚本,并**要求对每个含脚本的依赖显式给出布尔决定**,否则
> `pnpm install` 会以 `ERR_PNPM_IGNORED_BUILDS` 退出 1。注意该检查会在**每次** pnpm 命令前重跑
> (`runDepsStatusCheck` 会重新执行 install),因此未登记的决定会阻塞**全仓库**所有 pnpm 命令,
> 而非仅本包。
>
> 本变更已把决定登记在仓库根的 `pnpm-workspace.yaml`:`allowBuilds.esbuild: false`
> —— esbuild 只是 vitest 的传递依赖,其平台二进制经由 optionalDependencies 分发,阻断 postinstall
> 不影响测试与构建(已本地验证:50 项测试用例与 build 命令)。这与该文件既有的
> `'@google/genai'` / `protobufjs` 条目是同一机制。

### 依赖说明

运行时依赖(`@earendil-works/pi-coding-agent` / `typebox`)声明为 **peerDependencies(弱依赖)**:宿主 pi 环境已内置这些包,插件不重复打包;`devDependencies` 中保留同名依赖供本地 typecheck / test。

## 设计要点

- **纯状态机与接线分离**:`src/goal-state.ts` 是不依赖 pi 的纯状态机(时间戳与事件均注入,不内置定时器,便于用普通对象测试),`src/index.ts` 只做 pi 接线。
- **唯一出口**:`finishGoal` / `stopGoal` 是清除目标的唯一两条路径;`aborted` / `error` 只影响本轮续跑判定。
- **唤醒来源只有一个**:`agent_before_settle` 边界注入续跑提示;`/goal` 空闲时另有一次主动 kickoff。子 agent 完成会由宿主原生唤醒新一轮,不需要本扩展做任何事。
- **等待态不靠工具**:等待由宿主事件推导(见「等待感知」),扩展不再提供 `sleep` 类工具,因此不需要定时器、也不会因定时器泄漏而影响退出。
