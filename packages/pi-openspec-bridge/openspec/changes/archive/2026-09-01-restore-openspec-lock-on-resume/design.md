# Design: restore-openspec-lock-on-resume

## Context

`pi-tui-openspec-status` 是 pi 的 TUI 扩展，在底部状态栏渲染 openspec 变更进度。锁定机制有两类：

- **手动锁定**（`/tui-openspec-select` 选中）：固定显示某 change，bash 自动锁定失效。
- **自动锁定**（bash 工具执行 `openspec <locking-subcommand> --change X`）：自动追踪最近操作的 change。

pi 的会话生命周期：`/resume` 时 shutdown 旧扩展实例 → 重新加载扩展 → 触发 `session_start { reason: "resume" }`。扩展是全新实例，`render` 为 undefined，此前锁定的 spec/worktree/锁类型全部丢失。用户报告"resume 时无法正确自动选中"。

pi 提供官方持久化机制：`pi.appendEntry(customType, data)` 写入 session 文件（CustomEntry，**不参与 LLM context**），`ctx.sessionManager.getEntries()` 遍历读取。文档示例即"Restore on reload: 遍历 getEntries 按 customType 重建状态"。

## Goals

- `/resume`（以及 startup / new）后，状态栏恢复显示之前锁定的 change。
- 恢复**完整状态**：spec、worktree、锁类型（manual vs auto）。
- 手动锁恢复后保持固定显示；自动锁恢复后保持 auto-lock 语义（后续 bash openspec 命令仍可更新）。
- 恢复后立即重新查询 openspec status 并发布最新状态。

## Non-Goals

- 不实现跨 session/项目的全局锁定状态（状态属于各自 session 文件）。
- 不清理已累积的旧 entries（append-only 是 pi 的设计约定；恢复只取最新一条）。
- 不改动渲染管线、解析逻辑、worktree 合并等既有行为。
- 不引入新依赖。

## Decisions

### D1: 持久化机制 — `pi.appendEntry()`（而非独立 JSON 文件）

选择 `pi.appendEntry(LOCK_CUSTOM_TYPE, state)`：
- 官方文档推荐的扩展持久化 API；状态存 session 文件，随 session 存续，`/resume` 切换到目标 session 时 `getEntries()` 返回该 session 的 entries。
- CustomEntry 不参与 LLM context，不污染对话。
- 免去自建文件路径、多项目隔离、并发/清理逻辑。

备选（否）：
- **独立 JSON 状态文件**（`~/.pi/state/...`）：跨 session 共享全局状态，但要自己处理多项目冲突与清理；恢复语义不清晰。
- **不持久化**：维持现状，不解决用户问题。

### D2: 恢复程度 — 完整状态（含锁类型）

`PersistedLock = { spec: string; worktree?: string; manualLock: boolean; version: 1 }`。

恢复分支：
- `manualLock === true` → `render.lock(spec)`（固定显示，不随 bash 变化）。
- `manualLock === false` → `render.setSpec(spec)` + `render.setWorkTree(worktree)`（保持 auto-lock 语义）。

备选（否）：
- 仅恢复 spec 一律视为手动锁：破坏 auto-lock 语义（恢复后 bash 命令无法更新）。
- 仅手动锁持久化：bash 自动锁定的不恢复，resume 后回到空态，体验割裂。

### D3: 持久化时机 — 状态变更点全量写入

在 `setSpec` / `setWorkTree` / `lock` / `clearLock` / 自动解锁（renderText 中所有源消失分支）触发持久化。每次写入完整状态快照（非增量），恢复时取最后一条即是最新状态，天然幂等。

### D4: 恢复入口 — session_start 内恢复

`session_start` handler 中，创建 render 后调用恢复逻辑：
1. `ctx.sessionManager.getEntries()` 过滤 `type === "custom" && customType === LOCK_CUSTOM_TYPE`。
2. 取**最后一条**（getEntries 顺序即时间顺序）。
3. 校验 `data.version === 1` 且 `typeof data.spec === "string"`，否则忽略（容忍脏数据）。
4. 按 D2 分支恢复。`render.lock/setSpec` 内部 `refresh()` → 自动重新查询并渲染。

### D5: 解耦 — onStateChange 回调

`OpenSpecStatusRender` 增加 `onStateChange?: (state: PersistedLock | null) => void`，在状态变更点调用。index.ts 挂接 `(state) => pi.appendEntry(LOCK_CUSTOM_TYPE, state)`。render 类不直接依赖 pi API，职责分离、可单测。

- `clearLock` / 自动解锁 → 传 `null`（写入 `{ spec: undefined }` 语义的空状态，或由 appendEntry 写 `data: undefined` 标记清除）。

## Risks / Trade-offs

- **[Risk] entries 累积** → 每次锁定操作写一条，长会话可能积累数条 → 恢复只取最后一条，忽略旧数据；不主动删除（避免破坏 session 树 parentId 链）。
- **[Risk] 脏数据**（旧版本格式、损坏 JSON）→ 恢复时校验 `version` 与字段类型，不匹配则忽略，回退到空态。
- **[Risk] 恢复后 openspec CLI 不可用**（PATH 缺失等）→ 既有错误处理已覆盖：`runOpenspecStatus` 返回 null，渲染降级为 `spec-driven [] 0/0`，不抛错。
- **[Trade-off] appendEntry 每次全量快照** → 数据量小（几个字符串+布尔），无性能顾虑；换来恢复逻辑简单（取最后一条）。

## Migration Plan

1. 实现代码 + 测试（`test/state.test.ts`）。
2. 构建 `dist/`（`npm run build`）。
3. 用户重启 pi 或 `/reload` 加载新扩展。
4. 旧 session 无 entry 时恢复为空态——与升级前行为一致，无需迁移脚本。
5. 回滚：恢复旧版本即可（新 entry 字段对旧版本无害——旧版本不读取）。

## Open Questions

- 无（设计已与用户确认）。
