## 1. 包骨架与工程配置

- [x] 1.1 创建 `packages/pi-goal-loop/package.json`：`name` `@philogag/pi-goal-loop`、`"type": "module"`、`main`/`types` 指向 `dist/index.js`、`"pi": { "extensions": ["dist/index.js"] }`、`scripts`（`build`/`typecheck`/`test`/`lint`）、`peerDependencies`（`@earendil-works/pi-coding-agent`、`typebox`）、`devDependencies`（`typescript ^5.6.3`、`vitest ^4.1.11`）
- [x] 1.2 创建 `packages/pi-goal-loop/tsconfig.json`，对齐 `packages/pi-tool-presistant-bash/tsconfig.json`（继承 `tsconfig.base.json`、输出到 `dist/`、覆盖 `src/` 与 `test/`），并在根 `tsconfig.json` 的 `references` 中登记新包
- [x] 1.3 创建 `src/index.ts` 最小扩展工厂（默认导出 `function (pi: ExtensionAPI)`）并确认目录被 pnpm workspace（`pnpm-workspace.yaml` 的 `packages/*`）识别，`pnpm --filter @philogag/pi-goal-loop typecheck` 可跑通

## 2. 纯状态机（`src/goal-state.ts`）

- [x] 2.1 定义 `GoalState`、`SleepState` 类型与常量 `DEFAULT_SLEEP_SECONDS = 60`、`MIN_SLEEP_SECONDS = 1`、`MAX_SLEEP_SECONDS = 900`，以及注入式定时器接口 `schedule(delayMs, cb)` / `cancel(id)`
- [x] 2.2 实现 `createGoalState()`、`startGoal(state, text, now)`、`finishGoal(state)`、`stopGoal(state)`：三个变更路径都清除延迟状态并取消定时器
- [x] 2.3 实现 `beginSleep(state, seconds, now)`：校验存在活动目标、把 `seconds` clamp 到 `[1, 900]`、覆盖前先取消旧定时器、建立 `{ startedAt, until, seconds, timer, suppressNextSettle: true, settlesDuringSleep: 0 }`
- [x] 2.4 实现 `onBoundary(state, outcome, now)`：无目标或 `outcome !== "completed"` 时返回 `none`；延迟生效时消费一次抑制（不计数）或累加 `settlesDuringSleep` 并返回 `none`；超过 `MAX_SLEEP_MS` 时清除延迟并照常续跑；否则返回 `continue`
- [x] 2.5 实现 `onTimer(state, sleepRef)`：校验 `sleepRef` 仍为当前延迟状态（过期回调直接返回）；按 `settlesDuringSleep === 0` 决定返回 `wake` 还是 `none`，两种情况都清除延迟状态
- [x] 2.6 实现 `clearSleep(state)` 与 `onShutdown(state)`：幂等取消定时器并置空延迟状态，无延迟状态时不抛错

## 3. 提示词与文案（`src/prompts.ts`）

- [x] 3.1 实现 `buildContinuationPrompt(goal)`：包含目标原文、「继续推进」、`goal_finish`、`goal_sleep({ seconds })`、`/goal-stop` 四要素
- [x] 3.2 实现命令/工具的通知与结果文案构造（`/goal` 确认与替换通知、`/goal-stop` 结果、`goal_finish`/`goal_sleep` 的成功与失败结果、延迟确认含预计恢复时间）

## 4. 状态机单元测试（`test/goal-state.test.ts`）

- [x] 4.1 目标生命周期：登记、替换（旧目标被替换）、查询不改状态、`finishGoal` 与 `stopGoal` 是唯二出口、`aborted`/`error` 后目标仍 active
- [x] 4.2 续跑守卫：`completed` 返回 `continue`；`aborted`/`error` 返回 `none` 且不清目标；无目标返回 `none`
- [x] 4.3 延迟抑制与计数：第一次 `completed` settle 被抑制且 `settlesDuringSleep` 仍为 0；第二次 `completed` settle 累加到 1 且仍返回 `none`
- [x] 4.4 定时器唤醒（`vi.useFakeTimers()`）：到点且计数为 0 → `wake` + 清除延迟；到点且计数 > 0 → `none`（跳过注入）+ 清除延迟；到点时目标已结束 → `none`
- [x] 4.5 时长边界与超时兜底：`seconds` 越界被 clamp 到 1 / 900；伪造「已超过 900s 未清除」时下一次 `completed` settle 清除延迟并返回 `continue`
- [x] 4.6 清理：`/goal` 替换、`clearSleep`、`onShutdown` 都取消定时器；重复清理不抛错；已清除后的旧定时器回调无副作用

## 5. pi 接线（`src/index.ts`）

- [x] 5.1 `pi.registerCommand("goal", ...)`：带参数登记/替换目标并 notify；无参数展示状态（含「仅存于内存」与 `/goal-stop` 提示）
- [x] 5.2 `pi.registerCommand("goal-stop", ...)`：清除目标与延迟状态，无目标时提示而不抛错
- [x] 5.3 `pi.registerTool(goal_finish)`：清除目标与延迟状态；无活动目标时抛错产生失败结果
- [x] 5.4 `pi.registerTool(goal_sleep)`：参数 `seconds`（TypeBox，必填）；无活动目标时抛错产生失败结果；成功时返回含预计恢复时间的结果
- [x] 5.5 `pi.on("agent_before_settle", ...)`：调用 `onBoundary`，`continue` 时追加 `{ type: "custom_message", customType: "goal-loop", content, display: true }` 并返回 `{ continue: true }`，其余返回 `undefined`
- [x] 5.6 定时器回调接线：`onTimer` 返回 `wake` 时调用 `pi.sendMessage({ customType: "goal-loop", content, display: true }, { triggerTurn: true })`
- [x] 5.7 `pi.on("session_shutdown", ...)`：调用 `onShutdown` 做幂等清理
- [x] 5.8 确认两个工具的注册定义**不**带 `promptSnippet` / `promptGuidelines`（工具用法只由续跑提示词传达），并补一条断言两者注册定义中没有这两个字段的测试

## 6. 文档与验证

- [x] 6.1 编写 `packages/pi-goal-loop/README.md`：`/goal`、`/goal-stop`、`goal_finish`、`goal_sleep` 用法，内存态/reload 丢失限制，停止出口说明，以及已验证的 pi 版本
- [x] 6.2 `pnpm --filter @philogag/pi-goal-loop typecheck`、`pnpm --filter @philogag/pi-goal-loop test`、`pnpm --filter @philogag/pi-goal-loop build` 全部通过，且 `openspec validate add-goal-loop --strict` 通过（typecheck 0、46/46 测试通过、build 0、`Change 'add-goal-loop' is valid`）
- [~] 6.3 手动验收（**部分完成**）：
  - **已验证（真实 pi 0.87.1 会话，`pi -e ./src/index.ts -p --mode json "/goal …" "Begin now."`）**：`/goal` 成功登记目标；边界自动续跑两次（宿主 `entry_appended`，`customType: "goal-loop"`、`display: true`，内容含目标原文与出口）；agent 调用 `goal_finish` 成功后不再注入并正常退出（exit 0）。
  - **仍待人工交互验收**：`/goal-stop`；`goal_sleep` 的一次性抑制与到点唤醒；Esc 中断后不续跑且目标保留；`/reload` 后目标丢失。

## 7. 实现期修正（实现时发现，已落地）

- [x] 7.1 **pi 版本前提**：`agent_before_settle` 自 pi **0.87.0** 起提供，仓库原解析版本 0.84.3 无此 API（typecheck 必然失败）→ `devDependencies` 由 `^0.84.3` 提升到 `^0.87.1`，`peerDependencies` 由 `*` 收紧为 `>=0.87.0`（已同步到 `design.md` Context 与 `plan.md` Global Constraints）
- [x] 7.2 **boundary handler 必须同步返回**：`plan.md` Task 8 Step 3 原写 `async (event) =>`，与 Task 7 断言同步返回值的测试矛盾 → 已改为同步 handler（`ExtensionHandler` 允许 `R | void`）
- [x] 7.3 **锁文件刷新**：pi 版本提升使 pnpm 重新解析 vitest 的 peer 依赖并物化 `esbuild` 平台包；其被 pnpm 11 拦截的 postinstall 使 `pnpm install` 以 `ERR_PNPM_IGNORED_BUILDS` 退出 1 → 用 `pnpm install --config.strict-dep-builds=false` 完成安装并提交 `pnpm-lock.yaml`；**未改动** `pnpm-workspace.yaml` 与 `.npmrc`，仅在 README 记录该一次性操作
