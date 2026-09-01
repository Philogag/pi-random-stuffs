# Proposal: restore-openspec-lock-on-resume

## Why

`pi-tui-openspec-status` 扩展在 TUI 底部渲染 openspec 变更状态栏。用户可通过 `/tui-openspec-select` 手动锁定一个 change，或让 bash 工具中的 `openspec <subcommand> --change X` 自动锁定。

当前缺陷：`/resume`（恢复会话）时，pi 会 shutdown 旧扩展实例、重新加载扩展、触发 `session_start { reason: "resume" }`。新实例状态全空——锁定的 spec、worktree、锁类型全部丢失。resume 后状态栏为空，用户必须重新手动选择或用 bash 命令重新锁定，体验割裂。

## What Changes

扩展将把锁定状态（spec、worktree、锁类型）通过 `pi.appendEntry()` 持久化到 session 文件中，并在 `session_start`（startup/new/resume）时从 `ctx.sessionManager.getEntries()` 恢复：

1. **状态变更即持久化**：每次 `setSpec` / `setWorkTree` / `lock` / `clearLock` / 自动解锁时，写入一条 custom entry。
2. **session_start 恢复**：创建 render 后，遍历 entries 取最后一条匹配 `customType` 的 entry，按锁类型恢复：手动锁 → `render.lock(spec)`（固定显示）；自动锁 → `render.setSpec(spec)` + `setWorkTree(worktree)`（保持 auto-lock 语义）。
3. **恢复即刷新**：恢复后立即重新查询 `openspec status --json` 并发布最新状态。

## Capabilities

### Modified Capabilities

- **tui-openspec-status** — 既有能力，新增"锁定状态持久化与恢复"需求：
  - 锁定状态（spec / worktree / manualLock）在变更时持久化；
  - `session_start` 时从 session entries 恢复锁定状态并按锁类型重建渲染；
  - 恢复后立即刷新状态栏。

## Impact

- **代码**：`packages/pi-tui-openspec-status/`（仅此包，无其它包受影响）。
  - `src/state.ts`（新）：`PersistedLock` 类型 + `LOCK_CUSTOM_TYPE` 常量。
  - `src/render.ts`：`OpenSpecStatusRender` 增加 `onStateChange` 回调，在状态变更点触发。
  - `src/index.ts`：状态变更时 `pi.appendEntry()` 持久化；`session_start` 时从 entries 恢复。
  - `test/state.test.ts`（新）：覆盖 lock/clear/resume 恢复。
- **API**：使用 `ExtensionAPI.appendEntry()` 与 `ctx.sessionManager.getEntries()`（均已在 pi 中可用，无新增依赖）。
- **行为**：resume/restart 后状态栏恢复，不再为空；auto-lock 与 manual-lock 语义在恢复后保持。
- **风险**：entries 会累积（append-only），恢复取最新一条即可，无需清理。
