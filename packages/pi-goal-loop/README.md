# @philogag/pi-goal-loop

pi 扩展:给 agent 一个**持续目标**。

一次 `/goal` 声明目标后,pi 会在每轮循环结束而目标仍未完成时**自动注入下一轮提示词**继续推进;只有 agent 调用 `goal_finish` 或用户执行 `/goal-stop` 才会真正结束。适合「做完为止」的长任务,agent 中途收尾过早时由本扩展把它推回去。

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
| `/goal <目标>` | 发起目标并**在空闲时立刻开始一轮**;已有目标时**替换**它(并重置延迟状态) |
| `/goal` | 无参数:显示当前目标,并提示「仅存于内存」与 `/goal-stop` |
| `/goal-stop` | 结束目标并停止自动续跑 |

## 工具(agent 视角)

| 工具 | 作用 |
| --- | --- |
| `goal_finish` | 声明目标**已达成**:结束目标、停止续跑。无活动目标时调用失败 |
| `goal_sleep({ seconds })` | 推迟下一次自动续跑(例如正在等待异步 subagent)。`seconds` 必填,会被 clamp 到 `1–900`;无活动目标时调用失败 |

这两个工具**不出现在系统提示词**里(`promptSnippet` / `promptGuidelines` 均未设置)。它们的用法只通过续跑提示词传达,因此不占用每轮固定上下文。

### `goal_sleep` 的语义

用于「本轮结束但工作还没做完,等一会儿再叫我」:

1. 调用后**第一个**循环结束事件被抑制一次(不计数)——此时通常异步工作已返回并推进了进度。
2. 若之后仍发生循环结束事件(说明工作没推进),计数 +1,继续抑制。
3. 定时器到点时:计数为 `0` → 注入续跑提示并**触发新一轮**(`triggerTurn`);计数 `> 0` → 跳过注入。
4. 超时兜底:延迟状态若生效超过 `MAX_SLEEP_MS`(900s)仍未清除,下一次循环结束视作正常续跑并清除延迟状态。

## 停止出口(重点)

只有两个出口会结束目标:

- agent 调用 `goal_finish`
- 用户执行 `/goal-stop`

**`aborted`(按 Esc 中断)与 `error` 只暂停「本轮」续跑,目标仍然 active**;下一条普通消息即可让循环恢复。

## 限制

- **活动目标仅存于内存**:`/reload`、重启 pi、或切换会话后目标丢失,需要重新 `/goal`。扩展刻意不把目标写入 session entry。
- **自动续跑会持续消耗 token**:一个宽泛的目标可能循环很多轮。请用 `/goal-stop` 或让 agent 调用 `goal_finish` 及时收口。

## 已验证的 pi 版本

- 构建、测试与端到端验证均基于 **pi 0.87.1**(`npm ls @earendil-works/pi-coding-agent` → `0.87.1`)。
- 本扩展依赖 `agent_before_settle` 扩展事件,该事件自 **pi 0.87.0** 起提供;`peerDependencies` 因此要求 `@earendil-works/pi-coding-agent: >=0.87.0`。

端到端验证记录(`pi -e ./src/index.ts -p --mode json "/goal …" "Begin now."`,真实会话,scratch 目录):

| 轮次 | 观察到的宿主事件 |
| --- | --- |
| 1 | agent 完成工作但**未**调用 `goal_finish` → `agent_end` 后宿主 `entry_appended`(`customType: "goal-loop"`) |
| 2 | 仍未收口 → 第二次 `entry_appended`(`goal-loop`) |
| 3 | agent 调用 `goal_finish` → 目标清除,不再注入 → `agent_settled` 后进程正常退出(exit 0) |

即:自动续跑与 `goal_finish` 收口均已通过真实 pi 会话验证;续跑提示词内容包含目标原文与两个 agent 出口 `goal_finish` / `goal_sleep`(面向用户的 `/goal-stop` 不在该提示词中)。

### `/goal` 空闲时立即启动(2026-10-09)

本次复验的宿主为 **pi 1.1.0**,扩展源码为工作树中的 `src/index.ts`(与已提交版本一致;工作树 `src/prompts.ts` 另有一处与本变更无关的未提交改动,仅影响续跑提示词文案,不涉及 kickoff 路径)。因本机已全局安装同名扩展(`~/.pi/agent/npm/node_modules/@philogag/pi-goal-loop/dist/index.js`),直接 `-e` 会因 `goal_finish` / `goal_sleep` 工具名冲突而无法加载,故加了 `-ne` 并显式加载 provider 扩展:

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
pnpm --filter @philogag/pi-goal-loop test        # 测试(50 例)
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

- **纯状态机与接线分离**:`src/goal-state.ts` 是不依赖 pi 的纯状态机(注入式定时器接口,便于用 fake timers 测试),`src/index.ts` 只做 pi 接线。
- **唯一出口**:`finishGoal` / `stopGoal` 是清除目标的唯一两条路径;`aborted` / `error` 只影响本轮续跑判定。
- **唤醒来源有三个**:用户 `/goal` 声明(agent 空闲时立即启动)、定时器到点、超时兜底。注意子 agent 结束**不会**触发新一轮,避免误触发。
- **抑制只消费一次**:`goal_sleep` 后的第一次 settle 被抑制,之后若继续 settle 则说明未推进,交由续跑逻辑处理。
