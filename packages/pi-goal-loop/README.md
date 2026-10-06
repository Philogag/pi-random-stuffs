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
| `/goal <目标>` | 发起目标;已有目标时**替换**它(并重置延迟状态) |
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

即:自动续跑与 `goal_finish` 收口均已通过真实 pi 会话验证;续跑提示词内容包含目标原文与三个出口。

## 开发

```bash
pnpm install                 # 安装依赖(弱依赖来自宿主 pi,devDeps 供本地构建)
pnpm --filter @philogag/pi-goal-loop test        # 测试(46 例)
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
> 不影响测试与构建(已本地验证:46 项测试与 build 均通过)。这与该文件既有的
> `'@google/genai'` / `protobufjs` 条目是同一机制。

### 依赖说明

运行时依赖(`@earendil-works/pi-coding-agent` / `typebox`)声明为 **peerDependencies(弱依赖)**:宿主 pi 环境已内置这些包,插件不重复打包;`devDependencies` 中保留同名依赖供本地 typecheck / test。

## 设计要点

- **纯状态机与接线分离**:`src/goal-state.ts` 是不依赖 pi 的纯状态机(注入式定时器接口,便于用 fake timers 测试),`src/index.ts` 只做 pi 接线。
- **唯一出口**:`finishGoal` / `stopGoal` 是清除目标的唯一两条路径;`aborted` / `error` 只影响本轮续跑判定。
- **唤醒来源仅有两个**:定时器到点、超时兜底。避免「子 agent 一结束就误触发新一轮」。
- **抑制只消费一次**:`goal_sleep` 后的第一次 settle 被抑制,之后若继续 settle 则说明未推进,交由续跑逻辑处理。
