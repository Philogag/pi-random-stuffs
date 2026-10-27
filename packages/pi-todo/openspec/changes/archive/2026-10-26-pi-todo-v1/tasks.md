## 1. 包骨架与去依赖

- [x] 1.1 复制 `@juicesharp/rpiv-todo@2.13.8` 的 `package/` 到 `packages/pi-todo`，改名 `@philogag/pi-todo`，复用仓库 `tsconfig.base.json`（`tsc -b` 产出 `dist/`）
- [x] 1.2 移除 `rpiv-i18n` / `rpiv-config` 等 SDK 依赖；新增 `src/i18n.ts`（`t(key, fallback)` 桥），把所有调用点改为本地 key
- [x] 1.3 配置源从 XDG `config.json` 切到 pi `settings.json`，`PACKAGE_KEY = "@philogag/pi-todo"`（证据：`src/config.ts` 的 `getReminderSettings()` 单测覆盖默认值/覆盖值/畸形回退）
- [x] 1.4 不复制 `locales/`；本轮文案只做英文

## 2. 状态机：加 `waiting`

- [x] 2.1 `src/tool/types.ts`：`TaskStatus` 增加 `"waiting"`，`Task` 增加可选 `waitReason`
- [x] 2.2 `src/state/state-reducer.ts`：parking 缺 `waitReason` 报 `status: waiting requires waitReason (what external event are you waiting for?)`；离开 `waiting` 时清空 `waitReason`（证据：`test/task-graph.test.ts` 5 例 + `test/waiting.test.ts`）
- [x] 2.3 `src/state/selectors.ts`：open 集合排除 `waiting`（`selectHasActive` / 提醒的 open 判断）；`selectTodoCounts` 增加 `waiting` 维度
- [x] 2.4 `src/view/format.ts`：overlay 字形定为 `✓` completed / `✗` deleted / `◍` waiting；`waiting` 理由与 `⛓` 依赖链同行追加

## 3. 提示词三面

- [x] 3.1 `src/prompts.ts`：重写 6 条 `guidelines`（验证、状态选择、`waiting` 出口、收尾、依赖、批量清理），`description` 声明五个状态
- [x] 3.2 `src/config.ts` 支持 `prompt.snippet` / `prompt.guidelines` 整字段覆盖，畸形值回退默认（证据：`test/prompt-contract.test.ts`）

## 4. 停时提醒

- [x] 4.1 `src/reminders.ts`：`planReminder()` 纯函数实现 8 条守卫，返回可审计的 `SkipReason`；`buildReminderPrompt()` 生成 12 条轨迹上限的提示（证据：`test/reminders.test.ts`）
- [x] 4.2 `src/reminder-controller.ts`：按会话维护预算与单飞锁，`before_agent_start` 归零、`tool_execution_end` 解锁、轨迹落 `PI_TODO_DEBUG`
- [x] 4.3 `src/index.ts`：`agent_before_settle` 投递 `customType: "pi-todo-reminder"` 的 `custom_message` 并要求 `continue`；不提供任何静音开关
- [x] 4.4 oracle 裁决：`reminders.max` 默认 3、夹紧 `1..9`，否决"无上限 + pause 工具"（证据：`design.md` 决策 3）

## 5. Overlay 与 `/todos`

- [x] 5.1 `src/todo-overlay.ts`：widget key `pi-todos`，`maxWidgetLines` 默认 12，折叠键 `ctrl+shift+t`（`typer.register(..., "🔖")`）
- [x] 5.2 `src/overlay-host.ts` + `src/index.ts`：改 `import("./todo-overlay.js")` 懒加载，`session_start` 内 `overlaySupported(resolveMode(ctx))` 门禁 + 首个 TUI 会话调度预热（证据：`test/modes.test.ts` 用 fake timers 断言 rpc/json/print 的 import 计数恒为 0）
- [x] 5.3 `src/todo.ts` 的 `/todos` 命令：头部四段序（completed → in progress → waiting → pending），空组省略，tombstone 不渲染（证据：`test/todo-command.test.ts`）

## 6. 持久化与重放

- [x] 6.1 `src/state/state.ts` + `replay.ts`：每次 mutating 调用 append 一条 `pi-todo-state` 全量快照；replay 时 entry 优先于 `toolResult` details，且接受 legacy `rpiv-todo-state`（证据：`test/envelope.test.ts` 6 例 + `test/replay.test.ts` 9 例）
- [x] 6.2 快照深拷贝，避免 replay 结果与分支数据互为别名

## 7. 文档

- [x] 7.1 `README.md`（能力、与 fork 的差异表、四种运行模式矩阵、配置、开发与 spec 索引）
- [x] 7.2 `docs/tool-schema.md`、`docs/prompt-injection.md`、`docs/reminders.md`、`docs/overlay.md`、`docs/configuration.md`、`docs/formatting.md`
- [x] 7.3 按源码复核并修正 `docs/` 中 `waiting` 理由"换行"的错误描述

## 8. 规格

- [x] 8.1 `openspec/` 骨架（`config.yaml` + `schemas/superpowers-bridge-cn/` 从 `pi-goal-loop` 逐字复制，`diff -r` 一致）
- [x] 8.2 四份 capability spec：`todo-task-graph`(13) / `prompt-contract`(5→6) / `todo-reminder`(11→12) / `todo-overlay`(9→10)，共 40 需求 / 99 场景
- [x] 8.3 `openspec validate --specs` 通过（4 passed, 0 failed）；消除所有 requirement 长度 INFO

## 9. 测试

- [x] 9.1 `test/{prompt-contract,reminders,waiting}.test.ts`（fork 期既有 41 例）
- [x] 9.2 新增 `test/{task-graph,envelope,replay,overlay-format,todo-command}.test.ts`（37 例）
- [x] 9.3 新增 `test/modes.test.ts`（18 例）：模式解析、overlay 门禁、提醒门禁、rpc 回归守卫

## 10. 验证与验收

- [x] 10.1 `npx tsc -b` → exit 0；`npx vitest run` → 9 files / 149 tests passed；`openspec validate --specs` → 4 passed / 0 failed
- [x] 10.2 加载烟测：`node -e "import('./dist/index.js').then(m => m.default)"` 无异常
- [x] 10.3 人工验收项已登记在 `verify.md` 的「未验证项（残留风险）」三条中（双 TUI 会话的前台门禁、`pi --rpc` 实机提醒可见性、`/todos` 无头分支），不在本变更内视为已完成；单测以 fake ctx 覆盖其逻辑分支
