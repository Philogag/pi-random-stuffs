## 澄清阶段（brainstorm）

1. 目标确认：要**自有**插件，不是"配置现成的"；落点在 `pi-random-stuffs/packages/`。
2. 候选三条路：A 复制 rpiv-todo 再改；B 从零写；C 只在 rpiv-todo 之上加提醒。
   C 被否（改不到状态机，`waiting` 无从落地）；B 被否（会话历史兼容面要重造）。
   选定 **A**。
3. 借鉴清单：从 omp 取"提醒守卫的先后顺序"与"description 里声明状态"；从 rpiv 取
   "guidelines 走 `<rules>`"、overlay 行预算与 `/todos` 分组。

## Phase 1 复制与去依赖

- 源 `/tmp/rpiv-todo/package` → `packages/pi-todo`；替换包名、README、`docs/`。
- 去掉 `rpiv-i18n` / `rpiv-config` / `rpiv-*` SDK：新增 `src/i18n.ts` 的
  `t(key, fallback)` 桥；配置改读 pi `settings.json`。
- `pi-tui` 改 lazy：新增 `src/todo-overlay.ts` + `src/overlay-host.ts`，
  `index.ts` 只持有 `import()`。

## Phase 2 状态机改造

- `TaskStatus` 加 `waiting`；`waitReason` 进 `Task`；`applyTaskMutation` 加
  "parking 必须有理由"与"离开时清空理由"两条规则。
- `selectors` 的 open 集合排除 `waiting`（否则提醒会对着停泊任务催）。

## Phase 3 提醒

- 新增 `src/config.ts`（`getReminderSettings`：`max` 默认 3、夹紧 `1..9`）、
  `src/reminders.ts`（`planReminder` 纯函数 + 8 条守卫 + `buildReminderPrompt`）、
  `src/reminder-controller.ts`（预算/锁/轨迹）。
- oracle 裁决：选硬上限（默认 3），拒"无上限 + pause 工具"。

## Phase 4 验证

- 单测 → `tsc -b` → 加载烟测（`node -e "import('./dist/index.js')"`）→ 文档 → OpenSpec。
- 发现 `docs/` 与源码不一致（`waiting` 理由的换行 vs 同行），按源码修正。

## Phase 5 规格与测试补全

- 4 份 capability spec（40 需求 / 99 场景），抄 `pi-goal-loop/openspec/` 的 schema 与结构。
- 测试补齐 `task-graph` / `envelope` / `replay` / `overlay-format` / `todo-command` 五个文件。

## Phase 6 运行模式兼容

- 新增 `src/mode.ts`（`resolveMode` / `parseModes` / `overlaySupported`），
  修掉"提醒读前台渲染槽"的 bug，overlay 门禁从 `hasUI` 换成 `mode === "tui"`。
- 新增 `test/modes.test.ts`（18 例）作为该 bug 的回归守卫。

## Phase 7 归档

- `openspec/changes/archive/2026-10-26-pi-todo-v1/`：proposal / design / plan / tasks /
  verify / retrospective / brainstorm + 4 份 delta spec（全部为 ADDED）。

## 实现期偏差记录

- **oracle 的 B 方案被否决**：原建议"无上限 + `todo pause_reminder` 暂停一次"，
  因缺确定上界被硬上限替代；`pause` 语义未实现。
- **`waiting` 的字形**：fork 的 overlay 用 `-` 表示 completed、`✓` 表示 active；本包
  反转为 `✓` completed、`✗` deleted、`◍` waiting（后者为新造）。`/todos` 复用同一套。
- **测试计数笔误**：README 曾写 "8 files / 131 tests"，实测 78，已按实测修正。
- **预热时机**：原实现无条件 `setTimeout(prewarm, 2000)`，无头模式白加载 overlay；
  改为由首个 TUI `session_start` 调度。
