# Brainstorm — align-fold-blocks-settings-ui

## 背景

`@philogag/pi-tui-fold-blocks` 现有配置页面（`packages/pi-tui-fold-blocks/src/settings.ts` 的 `openSettings`）是一个多步 `ctx.ui.select` 菜单：

- 顶层菜单（中文标签 + `[x]`/`[ ]` 前缀手动勾选）：`tui-fold-blocks 设置`、`模式:fold`、`nerd font 图标`、`路径样式:relative`、`git worktree 折叠`、`bash 智能识别`、`状态提示`、`保存并退出`
- 枚举项再弹子 select（`显示模式` → native/fold/hide；`路径样式` → relative/absolute/basename）
- 布尔项靠"再次选中同一行"翻转，交互不直观；退出时才保存

用户要求：**与 pi 原生 settings 交互逻辑对齐** —— pi 内置的 `pi config` 页面（`ConfigSelectorComponent`）与扩展文档 tui.md Pattern 3（`SettingsList`，来自 `@earendil-works/pi-tui`，主题 `getSettingsListTheme()` 来自 `@earendil-works/pi-coding-agent`）提供：单一可滚动的 select 列表、↑/↓ 导航、**空格/回车激活当前行**、ESC 取消关闭、可选搜索。要全部使用英文提示、全部使用 select、通过空格切换选中项。

## 澄清问题与决策

### Q1 枚举项（mode / pathStyle）空格如何切换？
- 决策：**内联循环**。与 `SettingsList` 原生 `values` 语义一致：选中该项按空格直接循环到下一个值（fold→hide→native→fold；relative→absolute→basename→relative），不进入子页面。最贴合"全部使用 select + 空格切换"。
- 备选（否决）：子菜单选择（SettingsList `submenu` 机制）——层级更深，但同一时刻能看全所有选项；不必要。

### Q2 布尔项如何渲染与切换？
- 决策：**on/off 文本循环**。右侧显示 `on`/`off`，空格在两者间循环（`SettingItem { id, label, currentValue: "on"|"off", values: ["on","off"] }`）。
- 备选（否决）：`[x]`/`[ ]` 勾选框样式（对齐 `pi config` 的 checkbox）——更"原生感"，但与 SettingsList 的 `values` 循环模型不一致，需要自绘组件；用户明确选了文本循环。

### Q3 配置何时写入 settings.json？
- 决策：**即时保存**。每次空格切换立即 `saveConfig` 持久化并生效（与原生 `pi config` toggle 行为一致）；ESC 仅关闭页面。现有 `index.ts` 已有 `onSave` 回调路径（`config = next; modeState.setMode(...); saveConfig(config)`），改动最小。
- 备选（否决）：显式"保存并退出"——保留撤销余地但违背原生交互。

## 设计取舍

- **组件选择**：`SettingsList`（`@earendil-works/pi-tui`）+ `getSettingsListTheme()`（`@earendil-works/pi-coding-agent`）+ `ctx.ui.custom<T>()`（获得键盘焦点），而非自绘 `ConfigSelectorComponent` 副本。理由：tui.md 明确"Use existing components - SelectList, SettingsList, BorderedLoader cover 90% of cases. Don't rebuild them"；`custom()` 是官方文档给的扩展交互入口（`ctx.mode === "tui"` 时才可用）。
- **保存/生效链路**：`SettingsList onChange(id, newValue)` → 更新内存 config → 立即 `saveConfig`；mode 变更额外同步 `modeState.setMode`（沿用 `index.ts` 现有 P1-1 实时同步逻辑）。
- **英文提示**：全部提示/标签用英文（Settings 页标题、行标签、ESC hint 等）。
- **scope**：只改 `settings.ts`（`openSettings` 重写）与 `index.ts`（`/tui-fold-blocks` 命令 handler 改用 `ctx.ui.custom`）；不动 `config.ts` 类型/读写、不动渲染逻辑。
- **YAGNI**：不做搜索（SettingsList `enableSearch` 可选，默认关）、不做子菜单、不做 checkbox 自绘、不改 `nextMode` 辅助函数（枚举循环在 items.values 中声明，不再需要它，可删）。

## 风险

- `SettingsList` 的 `onChange` 是 `(id, newValue) => void` —— 每次切换都触发，需防抖？不需要：config 小、写盘快，直接写。
- `ctx.ui.custom` 仅在 TUI 模式可用 —— 命令已在 `session_start` 里以 `ctx.mode === "tui"` 守卫，天然满足。
- 旧的 `nextMode()` 若被删除需同步删除其单测；若保留则标记 unused —— 倾向删除（dead code）。
