## 验证环境

- 仓库：`pi-random-stuffs`（pnpm workspace，`tsc -b` 复合构建）
- 包：`packages/pi-todo`（`@philogag/pi-todo`，无运行时依赖）
- 日期：2026-10-26

## 命令与实测结果

```
$ npx tsc -b
exit 0（无输出）

$ npx vitest run
Test Files  9 passed (9)
     Tests  149 passed (149)

$ openspec validate --specs
✓ spec/prompt-contract
✓ spec/todo-overlay
✓ spec/todo-reminder
✓ spec/todo-task-graph
Totals: 4 passed, 0 failed (4 items)

$ node -e "import('./dist/index.js').then(m => console.log(typeof m.default))"
function
```

规格计数（`grep -c` 实测）：

| Capability | Requirement | Scenario |
| --- | --- | --- |
| `todo-task-graph` | 13 | 30 |
| `prompt-contract` | 6 | 13 |
| `todo-reminder` | 12 | 27 |
| `todo-overlay` | 10 | 29 |
| **合计** | **40** | **99** |

## 测试 ↔ 规格映射

| 文件 | 例数 | 覆盖的 capability |
| --- | --- | --- |
| `test/task-graph.test.ts` | 27 | `todo-task-graph` |
| `test/envelope.test.ts` | 18 | `todo-task-graph`（信封 / 错误文案 / 持久化 seam / 渲染钩子） |
| `test/replay.test.ts` | 9 | `todo-task-graph`（分支重放优先级） |
| `test/overlay-format.test.ts` | 19 | `todo-overlay`（行、预算、`#id` 门控、计数） |
| `test/todo-command.test.ts` | 5 | `todo-overlay`（`/todos` 分组与序） |
| `test/reminders.test.ts` | 41 | `todo-reminder` |
| `test/waiting.test.ts` | 12 | `todo-task-graph`（`waiting` 不变量） |
| `test/prompt-contract.test.ts` | 18 | `prompt-contract` |
| `test/modes.test.ts` | 18 | `prompt-contract` / `todo-overlay` / `todo-reminder`（模式） |

## 逐条验收（对 proposal 的承诺）

| 承诺 | 证据 | 结论 |
| --- | --- | --- |
| 工具名 / entry 类型 / details 形状与 fork 一致 | `test/envelope.test.ts` 断言 `customType: "pi-todo-state"` 与全量快照；`test/replay.test.ts` 断言 legacy `rpiv-todo-state` 仍被接受 | 通过 |
| 五状态，`waiting` 必填理由且可逆 | `test/task-graph.test.ts` 的 `waiting` 5 例 + `test/waiting.test.ts` | 通过 |
| `waiting` 不计入 open（不触发提醒） | `test/reminders.test.ts` 的 open 集合用例 + `test/overlay-format.test.ts` 的 `selectHasActive` | 通过 |
| 提醒预算默认 3、夹紧 1..9、只在用户提示归零 | `test/reminders.test.ts` | 通过 |
| 单飞锁由任意工具结果解锁 | `test/reminders.test.ts` | 通过 |
| 无静音开关 | 代码中不存在此类配置项；`test/reminders.test.ts` 断言只有 `enabled` 一个总开关 | 通过 |
| 三个提示词面各司其职 | `test/prompt-contract.test.ts` | 通过 |
| overlay 只 TUI 注册、模块懒加载 | `test/modes.test.ts`（fake timers 推进 60s，断言 rpc/json/print 的 import 计数为 0） | 通过 |
| 提醒在 tui/rpc 触发、json/print 静默、可覆盖 | `test/modes.test.ts` | 通过 |
| 墓碑不渲染、可解析历史依赖 | `test/task-graph.test.ts` + `test/overlay-format.test.ts` | 通过 |

## 未验证项（残留风险）

1. **前台会话门禁的真实行为**：`ctx.mode === "tui"` 与 ticker 的 `isForeground()` 在单测里都是
   stub。真实场景需人工开两个 TUI 会话，让后台会话跑完一个工具调用，确认后台不写 overlay。
2. **RPC 实机提醒**：单测用 fake ctx 断言 `agent_before_settle` 触发，但"客户端能否看到这条
   `custom_message`"只能在真实 `pi --rpc` 会话里观察。
3. **`/todos` 无头模式**：代码在 `!ctx.hasUI` 时 notify 错误并返回，但无头宿主没有 notify 通道，
   该分支的实际呈现未验证（不影响工具本身）。
