## ADDED Requirements

### Requirement: 单块展开（单击）

`fold` 模式下，扩展 MUST 响应 pi 传入的单块展开状态：当某个工具块的 `expanded` 为真时，
该块 SHALL 按 `native` 观感渲染（原生工具标题 + 全量未截断内容），SHALL 保留该块的状态
背景色，且 MUST NOT 再输出折叠摘要行；`expanded` 为假时 SHALL 恢复为既有的单行折叠形态。

展开 MUST 是**单块粒度**：仅被交互的那个工具块改变形态，其它已渲染块 SHALL 保持原形态。
展开 MUST 仅影响渲染，MUST NOT 改变工具执行、session 内容或 LLM 上下文。

`hide` 模式下 `expanded` SHALL 被忽略（该块仍不渲染）；`native` 模式行为 MUST 保持不变。

#### Scenario: 单击已完成的块展开

- **WHEN** 全局模式为 fold，某工具块已获得最终结果，用户左键单击该块
- **THEN** 该块立即按原生观感展开：显示原生工具标题与全量内容（read 全量高亮文本、
  bash 全量输出），不再显示折叠摘要行

#### Scenario: 再次单击收起

- **WHEN** 某块处于展开态，用户再次左键单击该块
- **THEN** 该块恢复为既有的单行折叠形态（左侧概要 + 右侧统计 + 三态背景）

#### Scenario: 其它块不受影响

- **WHEN** 用户单击展开块 A
- **THEN** 同一会话中未被交互的块 B、C 仍保持单行折叠形态

#### Scenario: 展开态保留状态背景色

- **WHEN** 某 bash 块以非零退出码结束并被展开
- **THEN** 展开后的整块背景为错误（红）色；成功块为成功（绿）色；文件操作块恒为成功（绿）色

#### Scenario: 结果未就绪时不展开

- **WHEN** 某工具块仍在执行、尚无最终结果，用户单击该块
- **THEN** 该块维持单行折叠形态（单击展开仅在结果就绪后可用）

#### Scenario: hide 模式忽略展开

- **WHEN** 全局模式为 hide 且某块的 `expanded` 为真
- **THEN** 该块仍不渲染，折叠与展开均不产生可见行

#### Scenario: native 模式行为不变

- **WHEN** 全局模式为 native 且用户单击某块
- **THEN** 渲染完全由 pi 内置渲染器负责，本扩展不干预其展开行为

#### Scenario: 展开不改变会话与执行

- **WHEN** 任意块被展开或收起
- **THEN** 该工具调用的 session 记录、LLM 上下文与实际执行结果均保持原样

#### Scenario: 全局展开按键的连带效果

- **WHEN** 用户按下 pi 的 `app.tools.expand`（默认 ctrl+o）全局切换
- **THEN** 因该按键写入的是与单击相同的单块展开状态，所有已渲染块一并展开或收起（已知副作用，
  非缺陷）

---

## MODIFIED Requirements

### Requirement: 工作模式（native / fold / hide）

扩展 MUST 提供三种全局工作模式：`native`（不干预、使用内置渲染）、`fold`（折叠为单行，
且 SHALL 支持单块展开）与 `hide`（不渲染任何工具块），且 SHALL 默认使用 `fold`。
模式 SHALL 通过 `/tui-fold-blocks` 命令打开的配置页面选择，并 SHALL 持久化到 settings.json
供会话恢复。模式 SHALL NOT 影响展开状态的单块粒度语义（切换模式只改变默认形态）。

#### Scenario: 默认折叠

- **WHEN** 启用扩展且未指定模式
- **THEN** 所有覆盖的工具块以折叠单行渲染

#### Scenario: 切换到隐藏

- **WHEN** 用户执行 `/tui-fold-blocks` 并在配置页面选择 hide 模式
- **THEN** 不再渲染任何工具块，但其 session 内容保持不变

#### Scenario: 切换到原生

- **WHEN** 用户执行 `/tui-fold-blocks` 并在配置页面选择 native 模式
- **THEN** 工具块以 pi 内置方式渲染，扩展不干预

#### Scenario: fold 模式支持单块展开

- **WHEN** 全局模式为 fold 且用户单击某个已完成的工具块
- **THEN** 仅该块展开为原生观感，其余块保持单行，全局模式仍为 fold

---

### Requirement: 折叠块单行左右对齐布局

工具块在**折叠（未展开）**状态下 MUST 渲染为**恰好一行**，左侧概要 + 右侧统计（左右对齐）：
文件操作块（read/write/edit）左侧为 `工具名 文件名 (offset, limit 等参数)`、右侧为操作的行数；
bash 块左侧为 `exec 摘要`、右侧为输出行数、返回值等。SHALL 在窄终端对长内容（命令、路径、
行数）进行裁剪。

该单行不变式 MUST NOT 约束展开态：块处于展开状态时 SHALL 渲染为多行原生观感内容
（见「单块展开（单击）」需求）。

#### Scenario: 文件操作块折叠

- **WHEN** read/write/edit 块处于折叠态且成功执行
- **THEN** 渲染为一行，左侧显示工具名、文件名与参数，右侧显示操作的行数

#### Scenario: bash 块折叠

- **WHEN** bash 块处于折叠态且成功执行
- **THEN** 渲染为一行，左侧显示 exec 摘要，右侧显示输出行数与返回值

#### Scenario: 窄终端裁切

- **WHEN** 折叠行内容超出可用宽度
- **THEN** 长命令与路径被裁剪，行保持完整单行显示

#### Scenario: 展开态不受单行约束

- **WHEN** 某块处于展开态且内容超过终端宽度
- **THEN** 内容按原生渲染器的方式换行/截断展示，不再要求恰好一行

---

### Requirement: 对外折叠渲染兼容 API

fold-blocks 作为扩展激活时,MUST 提供可被其他扩展（presistant-bash）引用的命名导出 API（默认扩展工厂导出保持不变），用于复用折叠渲染能力：包括当前折叠配置的实时读取与变更订阅、激活状态查询与订阅、单行折叠块渲染核心（含隐藏空行语义与调用/结果槽归属判定）。该 API SHALL 不依赖任何 presistant-bash 类型或工具名。

渲染核心 MUST 同时响应单块展开状态：调用方传入的 `expanded` 为真时，核心 SHALL 在折叠摘要行之下
追加该块的展开体——调用方提供了展开体回调时 SHALL 使用该回调的输出，未提供时 SHALL 使用工具结果的
原始文本内容按行渲染。核心 MUST 提供结果文本提取的命名导出，使调用方可复用同一文本来源。

#### Scenario: 扩展仍可作为纯扩展加载

- **WHEN** 只安装并启用 fold-blocks（不装 presistant-bash）
- **THEN** 其默认导出与内置工具折叠行为与新增导出前完全一致

#### Scenario: 提供配置实时读取与变更订阅

- **WHEN** 另一扩展读取当前折叠配置并订阅变更，随后用户在设置页切换模式
- **THEN** 读取方立即获得最新配置且收到变更通知

#### Scenario: 提供激活状态门控

- **WHEN** 另一扩展在 fold-blocks 激活前查询并订阅激活状态
- **THEN** 在 fold-blocks 扩展工厂执行后收到激活回调，可据此挂载折叠渲染

#### Scenario: 外部块按默认原文展开

- **WHEN** 外部扩展用渲染核心渲染某块，该块 `expanded` 为真且调用方未提供展开体回调
- **THEN** 渲染结果为折叠摘要行 + 工具结果原始文本的逐行内容

#### Scenario: 外部块按调用方展开体展开

- **WHEN** 外部扩展提供了展开体回调且该块 `expanded` 为真
- **THEN** 渲染结果为折叠摘要行 + 回调产出的组件内容

#### Scenario: 未展开时保持单行

- **WHEN** 外部扩展渲染的块 `expanded` 为假
- **THEN** 渲染结果与新增展开支持前完全一致的折叠单行
