## 1. 配置页面重构（settings.ts）

- [x] 1.1 重写 `src/settings.ts`：`openSettings` 改用 `ctx.ui.custom` + `SettingsList`；签名保持 `openSettings(ui, config, onSave)` 不变
- [x] 1.2 构造 `SettingItem[]`：mode（values `["fold","hide","native"]`）、nerdFont（`["on","off"]`）、pathStyle（`["relative","absolute","basename"]`）、foldGitWorktree（`["on","off"]`）、bash smart（`["on","off"]`）、showStatus（`["on","off"]`）；`currentValue` 由 config 映射（boolean → on/off）
- [x] 1.3 实现 `onChange(id, newValue)`：on/off → boolean 反映射；更新对应 config 字段；调用 `onSave(updatedCfg)`
- [x] 1.4 ESC/关闭处理：`SettingsList` `onCancel` → `done(undefined)`（即时保存已由 onChange 完成）
- [x] 1.5 删除 `nextMode()` 死代码函数

## 2. 命令入口接线（index.ts）

- [x] 2.1 更新 `/tui-fold-blocks` handler：调用新 `openSettings(ctx.ui, config, onSave)`（内部 custom + SettingsList）；onSave 沿用现有 `config = next; modeState.setMode(...); saveConfig(config)`

## 3. 测试更新

- [x] 3.1 新增/更新 `test/settings.test.ts`：验证 on/off 与 boolean 双向映射、mode/pathStyle values 声明、onChange 触发 onSave 回调、ESC 不额外写入
- [x] 3.2 删除 `nextMode` 相关单测（若存在）；`test/index.test.ts` 若引用旧 openSettings 行为则同步更新
- [x] 3.3 全量验证：`pnpm -F @philogag/pi-tui-fold-blocks test`、`build`、`typecheck` 均通过

## 4. 文档

- [x] 4.1 更新 `packages/pi-tui-fold-blocks/README.md` 配置小节：英文 SettingsList 交互（空格循环、即时保存、ESC 关闭）

## 5. 存量测试修复（scope addition — user-approved）

- [x] 5.1 重写 `test/render.test.ts`：对齐当前 render API（buildReadBlockText/buildBashBlockText/renderBlock 等），保留有效的 contentExitCode 用例
- [x] 5.2 修复 `test/index.test.ts`：非 TUI 模式下 registerTool 已被急切调用（4 次），仅 registerCommand 不注册
- [x] 5.3 全量测试通过并提交 `test(pi-tui-fold-blocks): fix stale render and index tests`
