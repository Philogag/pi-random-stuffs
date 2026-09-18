# Design — align-fold-blocks-settings-ui

## Context

`@philogag/pi-tui-fold-blocks`（monorepo `packages/pi-tui-fold-blocks/`，TypeScript ES2022 + NodeNext，vitest）通过 `/tui-fold-blocks` 命令打开配置页面。当前 `src/settings.ts` 的 `openSettings` 是多步 `ctx.ui.select` 菜单：顶层 7 项中文菜单 + 2 个枚举子菜单 + 显式"保存并退出"。`src/index.ts` 在 `session_start` 事件中（`ctx.mode === "tui"` 守卫）注册该命令，handler 回调 `openSettings(ctx.ui, config, onSave)`，`onSave` 内做 `config = next; modeState.setMode(...); saveConfig(config)`。

pi 宿主已内置 `@earendil-works/pi-tui`（v0.84.3）与 `@earendil-works/pi-coding-agent`（v0.84.3），fold-blocks 的 package.json 已把两者声明为 peerDependencies（`"latest"`）。pi 的扩展文档（tui.md）提供官方交互组件：`SelectList` / `SettingsList` / `BorderedLoader`，以及 `ctx.ui.custom<T>(factory)` 获取键盘焦点的方法。pi 原生 `pi config` 页（`ConfigSelectorComponent`）的交互模型：单一列表、↑/↓ 导航、空格/回车激活当前行、ESC 关闭、切换即时生效。

干系人：用户（交互一致性、全英文）；本包维护者（保持渲染与存储层不动）。

## Goals

- 将配置页面改为单一英文 `SettingsList` 页面（`ctx.ui.custom` 内嵌），全部选项在同一可滚动 select 列表
- 所有选项通过空格循环切换：布尔项 `on`/`off`，枚举项（mode / pathStyle）内联循环
- 每次空格切换立即持久化并生效；ESC 仅关闭页面
- 保留现有 config 类型、settings.json 读写、mode 实时同步（`modeState.setMode`）与渲染逻辑

## Non-Goals

- 不实现搜索（`SettingsList` `enableSearch` 保持关闭）
- 不实现子菜单（`submenu` 机制不用——枚举走 values 循环）
- 不自绘 checkbox 组件（不做 `pi config` 的 `[x]`/`[ ]` 样式——用户明确选 on/off 文本）
- 不改 config 类型结构、不改存储格式、不改渲染/覆盖逻辑
- 不做多页面/向导式配置

## Decisions

### D1: 用 `SettingsList` 组件而非自绘 checkbox 列表
- 选择：`SettingsList`（`@earendil-works/pi-tui`） + `getSettingsListTheme()`（`@earendil-works/pi-coding-agent`），通过 `ctx.ui.custom` 挂载。
- 理由：tui.md 明确 "Use existing components - SelectList, SettingsList, BorderedLoader cover 90% of cases. Don't rebuild them"；`SettingsList` 自带 ↑/↓ 导航、空格/回车激活（`data === " "` 分支）、ESC 取消、可选搜索、主题化渲染，满足全部交互需求。
- 备选：照搬 `ConfigSelectorComponent` 自绘 checkbox 列表——与"布尔用 on/off 文本循环"的用户决策冲突，且需维护自定义组件，YAGNI。
- 备选：继续用 `ctx.ui.select` 弹多个菜单——无空格循环能力（select 是回车确认单选），无法满足需求。

### D2: 枚举项用 `values` 内联循环，布尔项用 `["on","off"]` 循环
- `SettingItem { id, label, currentValue, values }`：mode 项 `values: ["fold","hide","native"]`，pathStyle 项 `values: ["relative","absolute","basename"]`，布尔项 `values: ["on","off"]` 且 `currentValue` 由 config 映射（`true → "on"`）。`SettingsList.activateItem()` 对无 submenu 且有 values 的项执行循环（`onChange(id, newValue)`）。
- `onChange` 回调把 `"on"/"off"` 反映射回 boolean 并更新对应 config 字段。
- 备选：submenu 机制弹子列表——用户否决（Q1）。

### D3: 即时保存，`onChange` 即写盘
- `onChange(id, newValue)` → 更新内存 config → `saveConfig(cfg)` → 若 `id === "mode"` 额外 `modeState.setMode(newMode)`（沿用现有 P1-1 实时同步）。
- ESC 关闭（`SettingsList` 的 `onCancel`）不保存（已即时保存，无需额外写入）。
- 理由：用户决策 Q3；与原生 toggle 即时生效一致；config 对象小、写盘开销可忽略，无需防抖。

### D4: 全英文提示
- 页面标题、行标签、hint（`keyHint("tui.select.confirm", "toggle")` / `keyHint("tui.select.cancel", "close")` 风格）全英文。`SettingsList` 主题自带 hint 渲染（`theme.hint`）。
- 行标签建议：`Mode`、`Nerd font icons`、`Path style`、`Fold git worktree`、`Bash smart detection`、`Show status`、`Collapse file blocks`（fileBlocks.collapse 目前 UI 未暴露——保持现状或按需补充，见 Open Questions）。

### D5: 删除 `nextMode()` 死代码
- `settings.ts` 的 `nextMode(mode)` 是旧循环逻辑（fold→hide→native→fold），新实现用 items values 声明循环，`nextMode` 不再被引用。删除函数及其单测（`test/` 中若存在）。
- 备选：保留标记 unused——dead code 应删，避免误导。

## Risks / Trade-offs

- [R1: `ctx.ui.custom` 仅 TUI 模式可用] → Mitigation: 命令已在 `session_start` 内以 `ctx.mode === "tui"` 守卫注册，非 TUI 不会触发；custom 调用点无需额外守卫，但可断言 `ctx.hasUI` 以防未来重构破坏守卫。
- [R2: `SettingsList` onChange 高频触发（每次空格一次写盘）] → Mitigation: 写盘为同步小文件写（`writeFileSync`），单次 <1ms；不引入防抖（复杂度不值）。
- [R3: on/off 文本与 pi 原生 checkbox 视觉差异] → Mitigation: 用户明确选择；README 记录。
- [R4: `SettingsList` 版本兼容（peer `"latest"`）] → Mitigation: 用已安装的 0.84.3 验证 API（`SettingItem`/`SettingsList`/`getSettingsListTheme` 均已确认存在于 0.84.3）；README 标注 peer 要求。
- [R5: 删除 nextMode 影响既有测试] → Mitigation: 同步删除/更新 `test/settings.test.ts`（若有该函数单测）；跑全量 vitest 确认。

## Migration Plan

1. 实现：重写 `src/settings.ts`（导出 `openSettings(pi, config, onSave)` 签名不变或改为 `openSettings(ui, config, onSave)`，内部用 `ctx.ui.custom` + `SettingsList`）；`src/index.ts` 命令 handler 改调新实现；删除 `nextMode`。
2. 测试：更新/新增 `test/settings.test.ts`（on/off 映射、values 声明、onChange 触发保存回调）；跑 `pnpm -F @philogag/pi-tui-fold-blocks test`、`build`、`typecheck`。
3. 冒烟：`pi -p` 模式确认命令不注册（TUI 守卫不变）；TUI 手动验证空格循环、ESC 关闭、即时保存。
4. 回滚：单一提交内完成，`git revert` 即可；存储格式未变，旧配置向后兼容。

## Open Questions

- **OQ1**: 是否在配置页面暴露 `fileBlocks.collapse` 与 `bashBlocks.collapse`（当前 UI 未列出，config 默认 true）？默认：跟随现状不暴露（避免扩大 scope），除非用户要求。
- **OQ2**: 页面标题/标签的具体英文文案是否需要与 pi 原生用词对齐（如 pi config 用 "Global Resources" 风格）？默认：使用描述性短标签，无硬性对齐要求。
