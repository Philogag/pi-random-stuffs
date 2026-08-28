# tui-tool-block-collapse Spec (delta)

Delta for change `align-fold-blocks-settings-ui` against `openspec/specs/tui-tool-block-collapse/spec.md`.

## ADDED Requirements

### Requirement: 原生 select 交互对齐

配置页面 MUST 采用 pi 原生 settings 交互模型：单一英文 `SettingsList` 页面（通过 `ctx.ui.custom` 内嵌），全部配置项在同一可滚动 select 列表中，↑/↓ 导航，空格/回车激活当前行，ESC 关闭。所有提示与标签 MUST 使用英文。

#### Scenario: 单一列表呈现全部配置项
- **WHEN** 用户执行 `/tui-fold-blocks`
- **THEN** 所有配置项（mode、nerd font、pathStyle、git worktree 折叠、bash smart、状态提示）在同一 select 列表中展示，无需进入子菜单

#### Scenario: 空格循环切换枚举
- **WHEN** 用户选中枚举项（mode / pathStyle）并按空格
- **THEN** 该选项内联循环到下一个值（mode: fold→hide→native→fold；pathStyle: relative→absolute→basename→relative），并立即生效

#### Scenario: 空格切换布尔
- **WHEN** 用户选中布尔项（nerd font / git worktree 折叠 / bash smart / 状态提示）并按空格
- **THEN** 该选项在 on/off 之间切换，并立即生效

#### Scenario: 即时保存
- **WHEN** 用户通过空格切换任意配置项
- **THEN** 新值立即写入 settings.json 并生效（mode 变更同步触发实时渲染）

#### Scenario: ESC 关闭
- **WHEN** 用户在配置页面按 ESC
- **THEN** 页面关闭且不产生额外写入（此前切换已即时保存）

### Requirement: 英文提示

配置页面所有可见文案 MUST 使用英文：页面标题、配置项标签、操作提示（hint）均不得包含中文。

#### Scenario: 全英文界面
- **WHEN** 用户打开配置页面
- **THEN** 页面标题、行标签与操作提示均为英文

## MODIFIED Requirements

### Requirement: 配置存储与命令入口

扩展 MUST 将全部设置读写入 `settings.json` 的 `<包名>` 块，并在缺失/损坏时 SHALL 回退到默认值且不阻塞渲染。扩展 MUST 注册 `/tui-fold-blocks` 命令，SHALL 通过 pi 内置 `SettingsList` 组件（`ctx.ui.custom` 内嵌）打开英文配置页面。

#### Scenario: settings.json 缺失回退
- **WHEN** settings.json 中无 `<包名>` 块或内容损坏
- **THEN** 扩展使用默认配置渲染，不报错、不中断

#### Scenario: 命令进入设置
- **WHEN** 用户执行 `/tui-fold-blocks`
- **THEN** 展示由 `SettingsList` 构成的单一英文配置页面，空格切换即写回 settings.json
