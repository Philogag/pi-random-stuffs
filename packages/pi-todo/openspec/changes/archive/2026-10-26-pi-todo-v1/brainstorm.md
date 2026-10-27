# Brainstorm — 自有 todo 插件

## 原始诉求

> "在我的 pi-random-stuffs 中规划一个属于我自己的 todo 插件"

此前已对比过两个参照实现（`oh-my-pi` 内置 todo 与 `@juicesharp/rpiv-todo` v2.13.8）：

| 维度 | omp 内置 todo | rpiv-todo |
| --- | --- | --- |
| 工具定义 | 单文件 `tools/todo.ts`，状态机全写在 `description` | 独立 `tool/` 目录，参数用 typebox 描述 |
| 提示词注入 | 只有 `description`（进 provider schema），无 guidelines | `promptSnippet` → `<tools>`，`promptGuidelines` → `<rules>`（8 条） |
| 状态 | 4（含 `deleted`？否——仅 pending/in_progress/completed） | 4（pending/in_progress/completed/deleted） |
| 持久化 | 无 entry 快照 | `pi-todo-state` entry + replay |
| overlay | 有（omp 自绘） | widget `rpiv-todos` |
| 停时提醒 | 有（TodoTracker.checkCompletion，带守卫与轨迹） | 无 |

结论：omp 的**提醒**值得学，rpiv 的**提示词注入与持久化**值得学，两者都没有第五状态。

## 目标与约束

- 目标：可长期自用的 todo 扩展，能记录"我在等什么"，且不会无限自我续跑。
- 约束：会话历史必须还能读（工具名 / entry 类型 / details 形状不变）。
- 约束：不引入 fork 的 `rpiv-*` SDK 依赖。
- 约束：中文环境使用，但代码与文案用英文（仓库既有包的习惯），配置可覆盖。

## 方案比较

| 方案 | 判断 |
| --- | --- |
| A. fork rpiv-todo 后改造 | **选定**。兼容面天然一致，改造面收敛。 |
| B. 从零手写 | 否。会话历史兼容面（entry 类型、details 形状、replay 语义）要重造并重测。 |
| C. 在 rpiv-todo 之上加提醒 | 否。改不到状态机与工具 schema，`waiting` 无处安放。 |

## 关键提问（自问自答）

1. **要不要提醒？** 要。但必须有硬上界，且"提醒之后没有进展"不能换来第二次提醒。
2. **`waiting` 进不进 open 集合？** 不进。停泊中的任务不该被催，这正是它存在的意义。
3. **给不给静音开关？** 不给。静音是隐藏状态，`waiting` 是可见状态。
4. **overlay 要不要懒加载？** 要。`pi-tui` 图不便宜，无头模式完全用不到。
5. **无头模式还要不要提醒？** `rpc` 要（人类在客户端看着），`json`/`print` 不要（一次性问答）。
6. **配置放哪？** pi 的 `settings.json`，单一真源。

## 由此确立的验收口径

- `todo` 在四种模式下行为一致（工具与快照不依赖 UI）。
- overlay 只在 `tui` 出现，且其模块在其它模式**不被 import**。
- 提醒在 `tui`/`rpc` 触发、在 `json`/`print` 静默，且可被 `reminders.modes` 覆盖。
- 每条行为都能落到一份 spec 的 WHEN/THEN 上。
