# Retrospective: wait-aware-continuation

> Written: 2026-10-10 (after verify passed)
> Commit range: `e5d281d1f8d41d82cfb472e281e0aceee5190fda..HEAD`（本变更以 `master` 上的单个提交交付）
> Worktree: main workspace（未创建独立 git worktree）

---

## 0. Evidence

- **Commit range**: 单个 `master` 提交，父提交即 fork point `e5d281d1f8d41d82cfb472e281e0aceee5190fda`（1 commit）
- **Diff size**: 实现本体 ≈ +161 / −155 行（`git diff --numstat` 限于 `src/`）；测试 ≈ +362 / −287；README +28/−17；`package.json` +1/−1（版本 `0.1.1` → `0.1.2`）
- **Tasks done**: 17/17（`grep -c '^- \[x\]' tasks.md` → 17；无 `- [ ]` 剩余）
- **Tests**: 50 → 59 例全绿（`pnpm test` → 3 files / 59 passed / 693ms）；`typecheck`、`build` 均 exit 0
- **OpenSpec**: `validate --all --json` → 3/3 valid；`validate wait-aware-continuation --strict` → valid
- **Subagent dispatches**: 0（用户直接指派实现，主会话内联完成）
- **New external dependencies**: none（`peerDependencies` 未改；对 rpiv / pi-subagents 的耦合是**字符串约定**，不加依赖）
- **Bugs encountered post-merge**: 0

## 1. Wins

- **删除比新增多**：净减约 100 行实现（sleep 机制、定时器、clamp、超时兜底整片消失），换来的等待感知只用了 `Set<string> + boolean` 两个字段。
- **纯状态机保住了可测性**：`createGoalState()` 变成无参无依赖，`onBoundary(state, outcome)` 去掉 `now`，测试彻底不需要 fake timers——这直接消掉了旧测试里最容易 flake 的部分。
- **安全失败方向选对了**：`classifyToolCall` 对未知工具返回 `null`、释放路径宁可多放（`input` / 新轮 / 生命周期命令都清态），最坏情况是多注入一轮提示而非死锁。这条在 spec 里写成明确条款，而不是"实现细节"。
- **公开信号而非内部读取**：用 `pi.events` 的 `rpiv:ask-user:blocked` 与宿主 `tool_execution_*`，没有去读其他扩展的工具结果文本，也没有 hack 任何私有 API。

## 2. Misses

- **契约靠字符串，没有编译期保护**：`rpiv:ask-user:blocked`、`bg_wait`、`subagent`、`acp_delegate` 全是字面量。任一上游改名都会静默退化为"不等"——有测试兜住本仓库，但兜不住上游漂移。
- **布尔启发式**：`subagent`/`acp_delegate` 用 `args.action` 是否存在 + `args.async !== false` 判定派发；上游若新增别的管理类 action 或改默认值，判定会失准。
- **真实联调缺位**：59 例全是单测，rpiv 事件与 pi-subagents 完成唤醒都没有在真机上跑过一次（详见 `verify.md` §7）。

## 3. Plan deviations

- **dogfood 未执行**（计划 §6 的隐含项）：本机全局安装的旧版扩展占用了 `goal_finish`/`goal_sleep` 工具名，`pi -e` 直接冲突；`-ne` 路径需要交互会话，而本次改动未新增宿主事件面。改用"单测锁定语义 + 等价性论证"结案，并把 dogfood 列为遗留待办。
- **README 额外新增两条「限制」**（命名约定依赖、fail-safe 语义），proposal 里没写——但这两条正是上面 §2 的两个 miss，落在文档里比留在实现者脑子里有用。
- **`GOAL_RETROSPECTIVE` 场景迁移**：`goal-deferral` 删除时该场景需要新家，放进了 `goal-wait` 的「等待态的释放」，没有新建第四个 capability。

## 4. Skill / workflow compliance

- 走了 OpenSpec 全流程：`brainstorm → proposal → design → (goal-lifecycle/goal-deferral/goal-wait deltas) → tasks → plan → 实现 → verify → retrospective → archive`，产出物齐备且 `--strict` 通过。
- **未走 TDD 红绿循环**：先改写 `src/` 三个文件，再重写三个测试文件，最后 `pnpm test` 一次跑绿。这是本变更最大的流程偏离——测试是"照着实现写"而不是"照着规格写"，好在 spec delta 在实现之前就已定稿（场景先写死，测试再对齐场景），所以断言仍然是规格驱动的。
- **未派发子 agent**：用户直接指派实现，任务规模（3 个文件 + 3 个测试文件）也不需要拆分。

### Deliberately Skipped Skills

| Skill | 跳过理由 |
| --- | --- |
| `using-git-worktrees` | 单包、单分支的小改动，与主工作区无并发冲突 |
| `subagent-driven-development` | 无可独立并行的任务；拆出去反而增加上下文搬运成本 |
| `test-driven-development` | 见 §4 第二点（记为 miss 而非无关项） |

## 5. Surprises

- **删除一个工具比新增一个工具省事得多**：`goal_sleep` 一删，`SleepParams`/`sleepFailure`/`sleepScheduledNotice`/`clampSleepSeconds`/`MAX_SLEEP_MS`/定时器接口/超时兜底全部连锁消失，测试也从 8 例 fake-timer 用例缩成 0 例。
- **旧 `prompts.test.ts` 是唯一没被预料的破坏面**：`src/` 改完后 `typecheck` 一次过，`test` 只在 `prompts.test.ts` 报 `sleepFailure is not a function`——提醒了"删除导出"的破坏性在测试里比在实现里更晚暴露。
- **「闩锁」语义是被异步派发逼出来的**：最初只想做"在途即等待"，但 `subagent` 派发后工具立刻返回、工作还在跑，逼出了"工具返回后仍保持等待，直到新一轮开始"的设计。这个设计反而成了 rpiv 问卷路径之外最重要的一条。
- **`agent_start` 是天然的闩锁释放点**：子 agent 完成的 `triggerTurn` 唤醒、用户新输入触发的轮次，最终都会走到 `agent_start`，所以一条订阅覆盖了两种恢复来源。

## 6. Promote candidates → long-term learning

1. **「等待感知」范式**：需要等外部角色的循环类扩展，优先用宿主事件推导"在等"，不要给模型一个 `sleep(seconds)` 工具。可推广到任何 `auto-continue` 类扩展（goal-loop 之外还有 review-loop、watch-loop）。
2. **两条释放原则**：阻塞类用「在途集合」，异步派发用「闩锁 + 下一轮开始释放」；释放源宁多不少（用户输入 / 新轮 / 生命周期命令 / shutdown 全清）。可直接复用为 `src/goal-state.ts` 的 `WaitState` 模板。
3. **纯状态机必须无时钟**：把 `now` 从状态机签名里彻底删掉（而不是注入 fake clock），能让"定时器相关测试"归零，而不只是变快。
4. **跨扩展契约要有 fail-safe 条款**：依赖字面量事件名/工具名时，spec 里写明"上游缺失时退化为无等待续跑"，并在 README 的「限制」里点明依赖的具体字符串。
5. **删导出前先跑测试**：`typecheck` 抓不到测试文件里的旧导出使用，删除公开导出的第一件事是 `pnpm test`，不是 `pnpm build`。
