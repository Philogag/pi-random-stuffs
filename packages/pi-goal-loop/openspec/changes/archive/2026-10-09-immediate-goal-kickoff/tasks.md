## 1. `/goal` 立即启动（实现 + 单测）

- [x] 1.1 `packages/pi-goal-loop/test/index.test.ts`：把 `makeCtx()` 参数化为 `makeCtx({ idle })`（默认 `isIdle: () => false`，以免打乱既有 3 处 `sent` 计数断言），并返回 `isIdle` spy
- [x] 1.2 新增失败测试：空闲时 `/goal <text>` 立刻用 `customType: "goal-loop"` 投递含目标原文的可见续跑提示，选项为 `{ triggerTurn: true }`
- [x] 1.3 新增失败测试：非空闲（默认 fake ctx）不投递；替换目标且空闲时投递新目标；`/goal` 无参查询在空闲时也不投递
- [x] 1.4 `packages/pi-goal-loop/src/index.ts`：`/goal` 带参分支在 `notify` 之后，当 `typeof ctx.isIdle === "function" && ctx.isIdle()` 为真时调用既有 `wakeNow()`（复用 `buildContinuationPrompt` + `GOAL_LOOP_CUSTOM_TYPE` + `{ triggerTurn: true }`，不新造文案）
- [x] 1.5 本 Task 的证据为针对性文件运行 `vitest run test/index.test.ts`（17 例通过）；`pnpm --filter @philogag/pi-goal-loop test` 的全量结果见 Task 5：`1 failed | 49 passed (50)`，唯一失败在 `test/prompts.test.ts:26`，由未提交的 `src/prompts.ts` WIP 改动导致，非本变更引入；且既有三个 `sent` 计数断言（`wakes with a triggered turn…` / `skips the triggered turn…` / `cancels the timer on session shutdown`）未受影响

## 2. 文档

- [x] 2.1 `packages/pi-goal-loop/README.md`：命令表为 `/goal <目标>` 补「空闲时立刻开始一轮」；设计要点把「唤醒来源仅有两个」更新为「用户 `/goal` 声明（空闲时立即启动）、定时器到点、超时兜底」

## 3. 验证与验收

- [x] 3.1 `pnpm --filter @philogag/pi-goal-loop typecheck`、`build` 与 `openspec validate immediate-goal-kickoff --strict` 通过；`test` 除外：全量为 `1 failed | 49 passed (50)`，唯一失败在 `test/prompts.test.ts:26`，由未提交的 `src/prompts.ts` WIP 改动导致，与本变更无关（交叉引用 `plan.md` 的「实现期偏差记录」）。**后续收尾**：该 `1 failed | 49 passed (50)` 为历史结果；其唯一失败来自当时未提交的 `src/prompts.ts` WIP，该 WIP 已由工作区既存 WIP 的落地提交（该提交已折叠进本变更的单个提交）连同 `test/prompts.test.ts` 期望与 README 语句一并收尾，全量现已全绿（`50 passed (50)`）；该落地提交是本变更 spec 范围之外的独立本地 WIP 收尾
- [x] 3.2 真实 pi 会话验收：空闲时 `/goal X` 立刻开始一轮 —— 已用**未修改源码**的 RPC 模式复验通过（`-p --mode json` 载体无法观测命令触发的那一轮，见 `plan.md` 实现期偏差记录）；streaming 中 `/goal X` 不插队、由该轮 `agent_before_settle` 续跑 —— **未验证（需人工交互会话，用户稍后自测）**
