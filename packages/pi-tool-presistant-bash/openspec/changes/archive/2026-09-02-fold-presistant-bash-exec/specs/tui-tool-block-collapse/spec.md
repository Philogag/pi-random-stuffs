<!--
Delta spec:fold-blocks 兼容 presistant-bash-exec 块
能力:tui-tool-block-collapse(既有)
-->
## ADDED Requirements

### Requirement: 对外折叠渲染兼容 API

fold-blocks 作为扩展激活时,MUST 提供可被其他扩展（presistant-bash）引用的命名导出 API（默认扩展工厂导出保持不变），用于复用折叠渲染能力：包括当前折叠配置的实时读取与变更订阅、激活状态查询与订阅、单行折叠块渲染核心（含隐藏空行语义与调用/结果槽归属判定）。该 API SHALL 不依赖任何 presistant-bash 类型或工具名。

#### Scenario: 扩展仍可作为纯扩展加载

- **WHEN** 只安装并启用 fold-blocks（不装 presistant-bash）
- **THEN** 其默认导出与内置工具折叠行为与新增导出前完全一致

#### Scenario: 提供配置实时读取与变更订阅

- **WHEN** 另一扩展读取当前折叠配置并订阅变更，随后用户在设置页切换模式
- **THEN** 读取方立即获得最新配置且收到变更通知

#### Scenario: 提供激活状态门控

- **WHEN** 另一扩展在 fold-blocks 激活前查询并订阅激活状态
- **THEN** 在 fold-blocks 扩展工厂执行后收到激活回调，可据此挂载折叠渲染

### Requirement: presistant-bash-exec 块折叠

当 `@philogag/pi-tool-presistant-bash` 已安装且 `@philogag/pi-tui-fold-blocks` 作为扩展激活时，`presistant-bash-exec` 工具块 MUST 遵循 fold-blocks 全局模式渲染：`fold` 模式 SHALL 渲染为与内置 bash 折叠行同形同构的恰好一行（图标、`exec` 标签、折叠后命令、统计与状态段、三态背景），`hide` 模式 SHALL 不渲染该块，`native` 模式 SHALL 呈现与未启用折叠时等价的 pi 默认渲染观感。执行语义 MUST 与未启用折叠时完全一致。

#### Scenario: fold 模式单行渲染

- **WHEN** exec 命令执行完成且全局模式为 fold
- **THEN** 该块渲染为一行，左侧为图标与 `exec` 标签与折叠命令，右侧为输出行数与退出码（失败时），整行带状态背景色

#### Scenario: 运行中黄色背景

- **WHEN** exec 命令正在执行且全局模式为 fold
- **THEN** 其块为单行折叠命令预览且背景为黄色

#### Scenario: 非零退出码失败态

- **WHEN** exec 命令以非零退出码结束且全局模式为 fold
- **THEN** 该行背景为红色，状态段显示 FAILED 及退出码，统计段含退出码

#### Scenario: 成功态

- **WHEN** exec 命令以零退出码结束且全局模式为 fold
- **THEN** 该行背景为绿色且状态段显示 SUCCESS

#### Scenario: 命令被取消

- **WHEN** exec 命令被超时或信号取消
- **THEN** 该行显示失败态（红色 FAILED，无退出码）

#### Scenario: hide 模式隐藏 exec 块

- **WHEN** 全局模式为 hide 且 exec 块执行完成
- **THEN** 不再渲染该工具块，其会话输出与 LLM 上下文保持不变

#### Scenario: native 模式使用默认渲染

- **WHEN** 全局模式为 native 且 exec 块执行完成
- **THEN** 该块呈现工具名标题与输出预览（展开时全量），与未启用折叠时的渲染等价

#### Scenario: 模式切换即时生效

- **WHEN** 用户在设置页切换全局模式且此前已有 exec 块渲染完成
- **THEN** 已渲染的 exec 块立即按新模式重渲染，无需等待新命令

#### Scenario: 行数与退出码来自会话执行结果

- **WHEN** exec 命令完成且输出包含尾部退出码标记
- **THEN** 折叠行的输出行数不包含该标记行，退出码以会话执行结果为准

### Requirement: 未激活时的回退契约

当 fold-blocks 未安装或未作为扩展激活时，`@philogag/pi-tool-presistant-bash` MUST 保持其既有行为与渲染：exec 块仍以 pi 默认方式渲染，扩展加载不报错，且 MUST 不依赖 fold-blocks 的包存在性。presistant-bash 的 create/create-container/list/destroy 工具块 SHALL 不受折叠能力影响（维持默认渲染）。

#### Scenario: 未安装 fold-blocks

- **WHEN** 只安装 presistant-bash 且未安装 fold-blocks 包
- **THEN** 扩展正常加载，exec 块以 pi 默认渲染，无任何报错或日志噪音

#### Scenario: 已安装但未激活

- **WHEN** fold-blocks 包存在但未注册为 pi 扩展
- **THEN** exec 块不折叠，与未安装时渲染一致

#### Scenario: 非 exec 工具不受影响

- **WHEN** 折叠能力可用且用户在 TUI 使用 create/create-container/list/destroy
- **THEN** 这些工具块维持各自默认渲染，不被折叠或隐藏
