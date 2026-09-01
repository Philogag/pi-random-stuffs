<!--
superpowers:brainstorming 产出的原始捕获。

本文件原样捕捉 brainstorming skill 的产出，不强制结构。
Skill 的自然产出通常是 decision log 格式（背景 → 决策链 Q1-Qn → 设计取舍），
但依对话内容可能有不同的组织方式。

design.md 从本文件萃取并重新整理为结构化设计文档。

不要将本文件的内容复制到 design.md — design.md 是独立的重组产物，
两者互补但不重叠。
-->

# Brainstorm 原始捕获 — restore-openspec-lock-on-resume

## 背景

`pi-tui-openspec-status` 扩展在 TUI 底部渲染 openspec 变更的状态栏：
- **手动锁定**：用户通过 `/tui-openspec-select` 选中一个 change，固定显示其状态。
- **自动锁定**：bash 工具执行 `openspec <locking-subcommand> --change X` 时自动追踪 X。

问题：`/resume`（恢复会话）时，pi 会 shutdown 旧 extension 实例、重新加载扩展、触发 `session_start { reason: "resume" }`。新实例是全新的，`render` 变量为 undefined，锁定的 spec 状态全部丢失 → resume 后 status bar 无法自动选中/恢复之前的 spec，显示为空。

## 决策链

### Q1: resume 后应该恢复到什么程度？

用户选择：**恢复完整状态（含锁类型）**。
- 手动锁 → resume 后继续固定显示该 spec（不随 bash 命令变化）。
- 自动锁 → resume 后保持 auto-lock 语义（后续 bash openspec 命令仍可更新它）。

备选（被否）：
- 仅恢复 spec 显示，一律视为手动锁 — 会破坏 auto-lock 语义。
- 仅手动锁持久化 — bash 自动锁定的不恢复，resume 后回到未锁定状态，体验割裂。

### Q2: 锁定状态存储在哪里？

用户选择：**pi.appendEntry()**（官方 session 持久化 API）。

```typescript
pi.appendEntry("my-state", { count: 42 });   // persist
// Restore on reload/session_start:
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      // Reconstruct from entry.data
    }
  }
});
```

优点：
- 官方文档推荐的扩展持久化机制，状态存入 session 文件，随 session 存续。
- 恢复用 `ctx.sessionManager.getEntries()` 遍历，无需自建文件路径/多项目/并发管理。
- `/resume` 切换到目标 session 时，getEntries 返回该 session 的 entries。
- CustomEntry **不参与 LLM context**（`buildSessionContext` 忽略），不会污染对话。

备选（被否）：
- 独立 JSON 状态文件（~/.pi/state/...）：跨 session/项目共享一个全局状态，但要自己处理多项目、并发、清理。
- 不持久化：维持现状，不解决用户问题。

### Q3: appendEntry 累积的旧 entry 如何处理？

`appendEntry` 每次写入一条新 entry，会累积。恢复策略：**取最后一条匹配 customType 的 entry**（getEntries 返回顺序即时间顺序，CustomEntry 带 timestamp/id）。不主动删除旧 entry（session 文件由 pi 管理，append-only 是设计约定；删除可能破坏 session 树结构 parentId 链）。

### Q4: 何时持久化？

在以下状态变更点调用 `pi.appendEntry(LOCK_CUSTOM_TYPE, lockState)`：
- `setSpec`（自动锁定新 spec）
- `setWorkTree`（工作树变更 — 也持久化，因为 worktree 是恢复的一部分）
- `lock`（手动锁定）
- `clearLock`（清除手动锁 → 写 `{ spec: undefined }` 或空状态）
- 渲染管线内 unlock（全部源消失自动解锁 → 写空状态）

### Q5: 恢复后是否立即重新渲染？

是。`render.lock(spec)` / `render.setSpec(spec)` 内部都会调用 `refresh()` → debounce 后重新执行 `renderText()` → 重新查询 `openspec status --json` 并发布最新状态。恢复即刷新，保证 resume 后 status bar 立即显示当前真实状态。

## 设计取舍

- **onStateChange 回调**：OpenSpecStatusRender 增加可选回调，在状态变更点触发，由 index.ts 挂接 appendEntry。保持 render 类对持久化机制无感知（不直接 import pi），职责分离、可测试。
- **版本字段**：PersistedLock 带 `version: 1`，为未来迁移留余地。
- **不删除旧 entries**：append-only 约定，恢复取最新一条。

## 待确认/未决

- 无。设计已与用户确认。
