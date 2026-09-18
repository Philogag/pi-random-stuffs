# tui-openspec-status Specification (Delta)

## ADDED Requirements

### Requirement: 锁定状态持久化与恢复

扩展 MUST 使用 pi 官方持久化机制 `pi.appendEntry(customType, data)` 将锁定状态写入 session 文件,并在 `session_start` 时从 `ctx.sessionManager.getEntries()` 恢复。持久化的状态 MUST 包含完整锁定快照:锁定 spec 名、effective worktree 路径(如有)、锁类型(手动锁 `manualLock: true` 或自动锁 `manualLock: false`),以及一个 `version` 字段用于格式迁移。customType MUST 为固定字符串 `"pi-tui-openspec-status"`。

状态变更时(手动锁定、自动锁定、worktree 变更、清除锁定、全部源消失自动解锁)扩展 MUST 立即持久化最新完整快照。恢复时扩展 MUST 从 entries 中选取**最后一条** `type === "custom" && customType === "pi-tui-openspec-status"` 的 entry,校验 `version` 与字段类型(容忍脏数据,不匹配则忽略并回退到空态),然后按锁类型重建渲染:

- `manualLock === true` → 调用 `render.lock(spec)`,固定显示该 change(不随后续 bash openspec 命令变化);
- `manualLock === false` → 调用 `render.setSpec(spec)`,并调用 `render.setWorkTree(worktree)`(如存在),保持 auto-lock 语义(后续 bash openspec 命令仍可更新锁定 change)。

恢复 MUST 触发重新查询 `openspec status --json` 并发布最新状态栏文本(resume/startup/new 后状态栏不再为空)。持久化数据 MUST 不参与 LLM context(CustomEntry 语义),不污染对话。

#### Scenario: resume 后恢复手动锁定的 spec
- **WHEN** 用户手动锁定 change `alpha`,随后 `/resume` 切换会话(触发 `session_start`,新扩展实例)
- **THEN** 扩展从 session entries 读取最后一条持久化状态 `{ spec: "alpha", manualLock: true }`,调用 `render.lock("alpha")`,状态栏立即显示 `alpha` 的进度,且后续 `openspec status --change beta --json` 不改变锁定

#### Scenario: resume 后恢复自动锁定的 spec
- **WHEN** bash 自动锁定 change `beta`,随后 `/resume` 切换会话
- **THEN** 扩展恢复 `{ spec: "beta", manualLock: false }`,调用 `render.setSpec("beta")`,状态栏显示 `beta` 进度;此后 bash 执行 `openspec status --change gamma --json` 时锁定切换为 `gamma`(auto-lock 语义保持)

#### Scenario: resume 后恢复 worktree
- **WHEN** 锁定 `beta` 时 effective cwd 为 `/repo/.worktrees/feat/x`,随后 `/resume`
- **THEN** 扩展恢复 `{ spec: "beta", worktree: "/repo/.worktrees/feat/x", manualLock: false }`,调用 `render.setWorkTree(...)`,状态栏按主仓+worktree 合并结果渲染

#### Scenario: 无持久化状态时回退空态
- **WHEN** session entries 中不存在 `customType === "pi-tui-openspec-status"` 的 entry(如全新 session 或升级前旧 session)
- **THEN** 扩展不恢复任何锁定,状态栏保持为空,行为与升级前一致

#### Scenario: 脏数据被忽略
- **WHEN** 最后一条持久化 entry 的 `data.version` 不是 `1`,或 `data.spec` 不是字符串
- **THEN** 扩展忽略该 entry,回退到空态,不抛错不弹窗

#### Scenario: 清除锁定后持久化空状态
- **WHEN** 用户手动锁定后选择 `None`(或所有源消失自动解锁),随后 `/resume`
- **THEN** 扩展在清除时持久化空状态,resume 后不恢复任何锁定,状态栏为空
