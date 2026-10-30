# openspec-tool-collapse Delta Spec

## ADDED Requirements

### Requirement: openspec 工具折叠单行

在 `fold` 全局模式下，`@philogag/pi-tui-fold-blocks` MUST 将 `openspec` 工具（由 pi-openspec-bridge 注册）的块渲染为恰好一行，左侧为 `openspec - <subcommand> <args...> [--change X]`，右侧为执行状态；该渲染 MUST 仅通过 SDK 的渲染器覆盖实现（MUST 不修改 `openspec` 工具的 execute），且 MUST 不影响该工具的 session 记录与 LLM 上下文。

#### Scenario: fold 模式渲染单行
- **WHEN** 全局模式为 fold 且 `openspec` 工具块已获得最终结果
- **THEN** 该块渲染为恰好一行，左侧形如 `openspec - <subcommand> <args...> [--change X]`

#### Scenario: 仅显示 subcommand args change
- **WHEN** 某次 `openspec` 调用携带参数 `{ subcommand: "status", args: [], change: "add-user-auth" }`
- **THEN** 折叠行左侧为 `openspec - status --change add-user-auth`，不在行内显示 `root`/`json` 等其余参数

#### Scenario: 位置参数保留
- **WHEN** 某次调用携带 `{ subcommand: "new change", args: ["add-dark-mode"], change: undefined }`
- **THEN** 折叠行左侧为 `openspec - new change add-dark-mode`，且不追加 `--change`

#### Scenario: 右侧显示执行状态
- **WHEN** 折叠块对应的 `openspec` 调用成功（退出码 0）
- **THEN** 折叠行右侧显示成功状态（SUCCESS）

#### Scenario: 右侧显示失败状态
- **WHEN** 折叠块对应的 `openspec` 调用以非零退出码结束
- **THEN** 折叠行右侧显示失败状态并带退出码（如 FAILED(1)）

### Requirement: 遵循全局工作模式

`openspec` 的渲染器覆盖 MUST 遵循全局工作模式：`native` 模式 MUST 委托 pi 原生渲染器（不干预）且行为与未启用扩展一致；`hide` 模式 MUST 不渲染该块；`fold` 模式下 `expanded` 为真时 SHALL 展开为原生观感的完整输出（可委托底层原生渲染器，MUST NOT 仅显示折叠摘要行），`expanded` 为假时 SHALL 恢复单行折叠形态。该覆盖 MUST NOT 影响任何非 `openspec` 工具（对其 MUST 委托后续渲染所需逻辑）。

#### Scenario: 原生模式不变
- **WHEN** 全局模式为 native
- **THEN** `openspec` 块由 pi 原生渲染器渲染，扩展不干预

#### Scenario: 隐藏模式不渲染
- **WHEN** 全局模式为 hide
- **THEN** 不渲染任何 `openspec` 块

#### Scenario: 展开显示完整输出
- **WHEN** 全局模式为 fold 且某 `openspec` 块 `expanded` 为真（用户单击/全局按键）
- **THEN** 该块展开为原生观感的完整输出，不再显示折叠摘要行

#### Scenario: 再次单击收起
- **WHEN** 某 `openspec` 块处于展开态且用户再次单击
- **THEN** 该块恢复单行折叠形态

#### Scenario: 非 openspec 工具不受影响
- **WHEN** 渲染器覆盖已注册，且存在 `read`/`bash` 等其他工具块
- **THEN** 非 `openspec` 工具仍按各自的既有渲染逻辑渲染

### Requirement: 渲染覆盖不改变执行与上下文

`openspec` 的渲染器覆盖 MUST 只改变 TUI 中的块外观，MUST 不改变工具执行、session 内容或 LLM 上下文；`openspec` 工具未安装（pi-openspec-bridge 未注册）时该覆盖 MUST 对任何工具无副作用。

#### Scenario: 执行与上下文不变
- **WHEN** `openspec` 块被折叠或展开
- **THEN** 该工具调用的实际执行结果、session 记录与 LLM 上下文均保持原样

#### Scenario: 未安装 openspec-bridge 时无副作用
- **WHEN** `openspec` 工具未被注册（未安装 pi-openspec-bridge）
- **THEN** 渲染器覆盖对其它工具返回委托路径，不产生任何可见影响