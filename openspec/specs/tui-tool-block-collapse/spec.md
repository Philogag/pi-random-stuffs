# tui-tool-block-collapse Spec

## Purpose

扩展 `@philogag/pi-tui-fold-blocks` 提供的能力：拦截 pi TUI 的工具调用块渲染，
在不改动 session 内容与工具执行行为的前提下，以折叠/隐藏形式重绘 read / write /
edit / bash 四类工具块，并支持通过命令与设置子页面控制全局工作模式。

## Requirements

### Requirement: 工作模式（native / fold / hide）

扩展 MUST 提供三种全局工作模式：`native`（不干预、使用内置渲染）、`fold`（折叠为单行）与 `hide`（不渲染任何工具块），且 SHALL 默认使用 `fold`。模式 SHALL 通过 `/tui-fold-blocks` 命令打开的配置页面选择，并 SHALL 持久化到 settings.json 供会话恢复。

#### Scenario: 默认折叠
- **WHEN** 启用扩展且未指定模式
- **THEN** 所有覆盖的工具块以折叠单行渲染

#### Scenario: 切换到隐藏
- **WHEN** 用户执行 `/tui-fold-blocks` 并在配置页面选择 hide 模式
- **THEN** 不再渲染任何工具块，但其 session 内容保持不变

#### Scenario: 切换到原生
- **WHEN** 用户执行 `/tui-fold-blocks` 并在配置页面选择 native 模式
- **THEN** 工具块以 pi 内置方式渲染，扩展不干预

### Requirement: 折叠块单行左右对齐布局

折叠态下，工具块 MUST 渲染为**恰好一行**，左侧概要 + 右侧统计（左右对齐）：文件操作块（read/write/edit）左侧为 `工具名 文件名 (offset, limit 等参数)`、右侧为操作的行数；bash 块左侧为 `exec 摘要`、右侧为输出行数、返回值等。SHALL 在窄终端对长内容（命令、路径、行数）进行裁剪。

#### Scenario: 文件操作块折叠
- **WHEN** read/write/edit 块处于折叠态且成功执行
- **THEN** 渲染为一行，左侧显示工具名、文件名与参数，右侧显示操作的行数

#### Scenario: bash 块折叠
- **WHEN** bash 块处于折叠态且成功执行
- **THEN** 渲染为一行，左侧显示 exec 摘要，右侧显示输出行数与返回值

#### Scenario: 窄终端裁切
- **WHEN** 折叠行内容超出可用宽度
- **THEN** 长命令与路径被裁剪，行保持完整单行显示

### Requirement: 状态背景色

工具块 MUST 保留状态背景色：文件操作块（read/write/edit）SHALL 始终使用成功（绿）背景；bash 块 SHALL 运行时使用黄色、成功绿色、失败红色，并与执行状态关联。

#### Scenario: 文件块常绿
- **WHEN** read/write/edit 块完成（无论成功或失败）
- **THEN** 其背景始终为成功绿

#### Scenario: bash 运行中黄色
- **WHEN** bash 命令执行进行中
- **THEN** 其背景为黄色

#### Scenario: bash 失败红色
- **WHEN** bash 命令以非零退出码结束
- **THEN** 其背景为红色

### Requirement: nerd font 图标

扩展 MUST 支持 nerd font 工具图标，且 SHALL 默认启用；用户 SHALL 能通过设置关闭。图标 SHALL 依据工具类型（read/write/edit/bash）显示对应符号，关闭时 SHALL 使用纯文本标签。

#### Scenario: 图标启用
- **WHEN** 设置启用 nerd font 且终端支持
- **THEN** 折叠块左侧显示对应工具的 nerd font 图标

#### Scenario: 图标关闭
- **WHEN** 用户关闭 nerd font
- **THEN** 折叠块改用纯文本工具名标签，不使用图标

### Requirement: 路径折叠器 foldPath

扩展 MUST 提供路径折叠函数 `foldPath`：按配置的路径样式（absolute / relative / basename，默认 relative）显示路径，且 SHALL 支持 git worktree 目录折叠（默认开启）。折叠 MUST 仅影响显示，不改动工具实际操作的目标路径。

#### Scenario: 相对路径样式
- **WHEN** 配置路径样式为 relative 且目标文件位于仓库内
- **THEN** 折叠行显示相对当前工作目录的短路径

#### Scenario: basename 样式
- **WHEN** 配置路径样式为 basename
- **THEN** 折叠行仅显示文件名

#### Scenario: git worktree 折叠
- **WHEN** 目标文件位于 git worktree 子目录且 worktree 折叠开启
- **THEN** 折叠行显示裁剪掉 worktree 前缀的路径

### Requirement: Bash 命令折叠器 foldCommand

扩展 MUST 提供 bash 命令折叠函数 `foldCommand`：对命令执行**智能识别**，剥离常见包装前缀（如 `cd X &&`、`source … &&`、`export … &&`）后取有效命令；识别复杂时 SHALL 至少显示首 token。行为 SHALL 受 `smart` 开关控制（默认开）。

#### Scenario: 剥离包装前缀
- **WHEN** 命令形如 `cd build && npm test`
- **THEN** exec 摘要显示 `npm test`（已剥离 `cd build &&`）

#### Scenario: 默认截首词
- **WHEN** 命令为复杂复合命令且无法稳定识别
- **THEN** 至少显示命令首 token 作为摘要

#### Scenario: smart 关闭
- **WHEN** 用户关闭 smart
- **THEN** 折叠摘要仅使用简单规则（如首 token），不做包装剥离

### Requirement: 配置存储与命令入口

扩展 MUST 将全部设置读写入 `settings.json` 的 `<包名>` 块，并在缺失/损坏时 SHALL 回退到默认值且不阻塞渲染。扩展 MUST 注册 `/tui-fold-blocks` 命令，SHALL 通过 pi 内置 `SettingsList` 组件（`ctx.ui.custom` 内嵌）打开英文配置页面。

#### Scenario: settings.json 缺失回退
- **WHEN** settings.json 中无 `<包名>` 块或内容损坏
- **THEN** 扩展使用默认配置渲染，不报错、不中断

#### Scenario: 命令进入设置
- **WHEN** 用户执行 `/tui-fold-blocks`
- **THEN** 展示由 `SettingsList` 构成的单一英文配置页面，空格切换即写回 settings.json

### Requirement: 覆盖工具与执行委托

扩展 MUST 覆盖 read / write / edit / bash 四类工具块的自绘渲染，且 MUST 委托原始执行逻辑（execute 行为不变）。覆盖 MUST 仅影响 TUI 显示，不改动 session 内容、LLM 上下文或存储历史。

#### Scenario: 执行行为不变
- **WHEN** 覆盖后的 read/write/edit/bash 工具被调用
- **THEN** 其实际执行与内置版本一致，仅渲染层被替换

#### Scenario: 会话内容不变
- **WHEN** 工具块以折叠/隐藏形态显示
- **THEN** session 与 LLM 上下文中该工具调用的内容保持原样

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
