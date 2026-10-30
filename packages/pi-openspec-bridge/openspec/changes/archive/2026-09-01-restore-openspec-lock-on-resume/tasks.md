# Tasks: restore-openspec-lock-on-resume

## 1. 持久化状态模型

- [ ] 1.1 在 `packages/pi-tui-openspec-status/src/state.ts` 定义 `PersistedLock` 类型 `{ spec: string; worktree?: string; manualLock: boolean; version: 1 }` 与 `LOCK_CUSTOM_TYPE = "pi-tui-openspec-status"` 常量
- [ ] 1.2 导出 `findLastPersistedLock(entries: SessionEntry[]): PersistedLock | null` 辅助函数:过滤 `type === "custom" && customType === LOCK_CUSTOM_TYPE`,取最后一条,校验 `version === 1 && typeof spec === "string"`,不匹配返回 null

## 2. 渲染类状态变更回调

- [ ] 2.1 `src/render.ts` 的 `OpenSpecStatusRender` 增加 `onStateChange?: (state: PersistedLock | null) => void` 构造参数
- [ ] 2.2 在 `setSpec` / `setWorkTree` / `lock` / `clearLock` 及自动解锁分支(renderText 中所有源消失)调用 `onStateChange` 传完整快照;`clearLock`/自动解锁传 `null` 表示空态

## 3. 持久化与恢复接线

- [ ] 3.1 `src/index.ts` 创建 render 时传入 `onStateChange: (state) => pi.appendEntry(LOCK_CUSTOM_TYPE, state ?? { spec: "", manualLock: false, version: 1 })`,全量快照写入
- [ ] 3.2 `session_start` handler 中创建 render 后,调用 `findLastPersistedLock(ctx.sessionManager.getEntries())`;命中时按 `manualLock` 分支恢复(`render.lock(spec)` 或 `render.setSpec(spec)` + `setWorkTree(worktree)`);未命中则维持空态
- [ ] 3.3 恢复路径遵循既有错误处理:所有调用包 try/catch,失败保留空态不抛错

## 4. 测试

- [ ] 4.1 `test/state.test.ts`:覆盖 `findLastPersistedLock` 取最后一条、过滤 customType、脏数据(version 错/非字符串 spec)返回 null、无 entry 返回 null
- [ ] 4.2 `test/index.test.ts` 增加 resume 恢复用例:构造带 custom entry 的 fake sessionManager,fire `session_start`,断言 render.lock / setSpec 被调用且状态栏发布恢复的 spec
- [ ] 4.3 `test/index.test.ts` 增加自动锁恢复后 bash 更新用例:恢复 auto-lock 后 fire bash `openspec status --change gamma` 断言锁定切换
- [ ] 4.4 `test/index.test.ts` 增加持久化写入用例:setSpec/lock/clearLock 后断言 `pi.appendEntry` 被调用且参数正确

## 5. 验证与文档

- [ ] 5.1 运行 `pnpm build`(tsc -b)与全部测试,确认通过
- [ ] 5.2 更新 `packages/pi-tui-openspec-status/README.md` 记录持久化恢复行为
