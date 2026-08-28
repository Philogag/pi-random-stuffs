# Tasks — add-tui-openspec-select

## 1. 活动 change 发现模块

- [ ] 1.1 新增 `src/discover.ts`：`listActiveChanges(openspecRoot: string): Promise<string[]>`，`readdir(openspecRoot/changes/)` 过滤目录且排除 `archive`，排序稳定返回；目录不存在时返回空数组
- [ ] 1.2 新增 `src/discover.test.ts`：覆盖目录存在/不存在、排除 archive、忽略文件项、排序稳定四类场景

## 2. /tui-openspec-select 命令与手动锁定

- [ ] 2.1 在 `src/index.ts` TUI 激活分支内用 `pi.registerCommand("tui-openspec-select", { description, handler })` 注册命令；handler 调用 `listActiveChanges` + `ctx.ui.select`，按 D4 处理选中 / None / 取消三分支
- [ ] 2.2 新增 `manualLock: boolean` 状态；选中 change 时置 `lockedChange` 与 `manualLock = true` 并走现有 `render()`；选 None 时清空两者并按现有规则清空状态栏；取消时无副作用
- [ ] 2.3 `tool_call` 处理器：`manualLock === true` 时跳过自动锁定 change 名更新，但 worktree 检测（`effectiveCwd` 更新）照常
- [ ] 2.4 `render()` 解锁分支（所有 source 文件夹消失）：同时重置 `manualLock = false`
- [ ] 2.5 `PiLike` 接口扩展 `registerCommand` 类型签名（与 pi 扩展 API 对齐）

## 3. 集成测试

- [ ] 3.1 新增 `src/select.test.ts`：mock `ctx.ui.select` 与 `listActiveChanges`，覆盖 6 个场景——选择锁定、选 None 清空、取消无副作用、手动覆盖自动、手动锁定下 worktree 检测仍生效、归档自动解锁并重置 manualLock
- [ ] 3.2 回归：`pnpm exec vitest run` 全绿（既有 78 个测试不破坏，总数增加）

## 4. 文档

- [ ] 4.1 更新 `packages/pi-tui-openspec-status/README.md`：新增 `/tui-openspec-select` 命令用法（选择器、None 清空、手动覆盖自动语义）
