## Why

`@philogag/pi-tui-fold-blocks` 的配置页面（`/tui-fold-blocks` 命令入口）目前是一个多步中文 `ctx.ui.select` 菜单：顶层菜单带 `[x]`/`[ ]` 手动前缀、枚举项再弹子菜单、布尔项需"再次选中同一行"翻转、退出时才保存。交互与 pi 原生 settings 不一致——pi 内置 `pi config` 页面（及扩展文档 tui.md Pattern 3 的 `SettingsList` 组件）的交互是：单一 select 列表、↑/↓ 导航、**空格/回车激活当前行**、ESC 关闭、切换即时生效。我们希望配置页面改用这套原生交互，统一为英文提示，让用户无需学习两套设置逻辑。

## What Changes

**<配置页面交互模型>**
- From: 多步中文 select 菜单（顶层菜单 + 枚举子菜单 + `[x]` 手动勾选 + "保存并退出"）
- To: 单一英文 `SettingsList` 页面（`ctx.ui.custom` 内嵌）：全部选项在同一可滚动 select 列表，↑/↓ 导航，空格激活当前行，ESC 关闭
- Reason: 与 pi 原生 settings 交互逻辑对齐；减少认知负担
- Impact: 非破坏性；仅改 TUI 交互层，config 类型/读写/session 内容不变

**<选项切换方式>**
- From: 布尔靠再次选中翻转、枚举靠子菜单选择
- To: 所有选项通过**空格循环切换**：布尔项 `on`/`off` 文本循环；枚举项（mode / pathStyle）内联循环（fold→hide→native、relative→absolute→basename）
- Reason: 用户明确要求"全部使用 select，通过空格切换选中项"
- Impact: 非破坏性；`nextMode()` 辅助函数成为 dead code（可删除）

**<保存时机>**
- From: 仅在用户选择"保存并退出"时写入 settings.json
- To: 每次空格切换立即持久化并生效（`saveConfig` 即时调用；mode 变更同步 `modeState.setMode`）
- Reason: 与原生 `pi config` toggle 即时生效行为一致；现有 `index.ts` 已有 `onSave` 即时路径
- Impact: 非破坏性；settings.json 写入频率升高（每次切换一次，写盘开销可忽略）

**<提示语言>**
- From: 中文提示（"tui-fold-blocks 设置"、"保存并退出"、"显示模式" 等）
- To: 全部英文提示（页面标题、行标签、操作 hint）
- Reason: 用户明确要求"全部使用英文提示"
- Impact: 非破坏性；仅显示文案

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tui-tool-block-collapse`：需求变更集中在配置页面交互——新增"原生 select 交互对齐"需求（单一 SettingsList 页面、空格循环切换、ESC 关闭、即时保存、英文提示），并相应更新既有"工作模式"需求中关于配置页面选择的措辞（从"选择"改为"循环切换"）。增量 spec 将标注 ADDED + MODIFIED。

## Impact

- **代码**：`packages/pi-tui-fold-blocks/src/settings.ts`（重写 `openSettings` 为 SettingsList 模型）、`src/index.ts`（命令 handler 改用 `ctx.ui.custom`）、删除 `src/settings.ts` 中 `nextMode()`（及其单测，若有）；`test/` 相应更新
- **依赖**：新增运行时 peer 依赖 `@earendil-works/pi-tui`（已在 pi 宿主内置，fold-blocks package.json 已声明 peer 依赖 pi-tui——需确认版本范围）
- **API**：无公共 API 变更（内部实现重构）
- **文档**：`packages/pi-tui-fold-blocks/README.md` 配置小节同步更新
