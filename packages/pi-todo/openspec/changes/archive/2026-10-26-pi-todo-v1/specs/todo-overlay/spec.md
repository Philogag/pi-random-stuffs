<!--
Delta spec:TUI 覆盖层与 /todos 命令
能力:todo-overlay(v1 新建)
说明:v1 初次确立（全部需求为新增），无 MODIFIED / REMOVED / RENAMED。
-->
## ADDED Requirements

### Requirement: widget 的注册与自动隐藏

overlay MUST 以 pi 的 widget 契约注册：键名 MUST 为 `pi-todos`，位置 MUST 为编辑器上方（`aboveEditor`），并 MUST 使用工厂形式（渲染时才取主题与宽度）。当没有可见任务时扩展 MUST 注销该 widget（把键设为 `undefined`）以免占用屏幕；此后再出现可见任务时 MUST 重新注册。列表更新 MUST 触发一次重绘而非重新注册。

#### Scenario: 空列表隐藏

- **WHEN** 最后一个可见任务被删除或清理
- **THEN** 名为 `pi-todos` 的 widget 被注销

#### Scenario: 重新出现后恢复

- **WHEN** widget 已注销后新建一个任务
- **THEN** widget 被重新注册并显示该任务

---

### Requirement: 行预算与溢出规则

overlay MUST 受行预算约束：内容行上限来自 `maxWidgetLines`（默认 12，小于 3 的配置值 MUST 回退默认），正文可用槽位为上限减 1（留给标题行），并额外保留一个汇总位。溢出时 MUST 按下列顺序取舍：先丢弃 `completed` 任务，若仅保留非 `completed` 任务仍超预算，则截断非 `completed` 的尾部；被丢弃或截断的数量 MUST 以汇总行体现。当 pi 的工具输出处于展开模式时，扩展 MUST 放弃正文预算并显示全部任务（用户的明确展开意图优先于压缩）。overlay MUST NOT 引入滚动。

#### Scenario: 先丢已完成

- **WHEN** 上限为 12（正文 11 槽）且存在 3 个未完成任务与 15 个已完成任务
- **THEN** 三个未完成任务全部可见，已完成任务被折叠进汇总行

#### Scenario: 再截断尾部

- **WHEN** 未完成任务数量本身超过正文槽位
- **THEN** 只显示前若干条未完成任务，其余以"另有 N 条"汇总

#### Scenario: 展开模式显示全部

- **WHEN** pi 的工具输出展开模式为真
- **THEN** overlay 显示全部可见任务，不受 `maxWidgetLines` 限制

---

### Requirement: 折叠键

折叠/展开快捷键 MUST 来自 `collapseKey`，默认 `ctrl+shift+t`。若配置为 `off`，扩展 MUST NOT 绑定该快捷键。配置值 MUST 按 pi-tui 的按键语法校验（修饰键限于 `ctrl`/`shift`/`alt`/`super`，基础键为单字符或受支持的特殊键，禁止空段与重复修饰键）；校验失败 MUST 回退默认键。绑定 MUST 在加载时完成一次，修改配置需要 `/reload` 才生效——这一点 MUST 在配置文档中说明。快捷键触发时若不存在已注册的 widget 或处于无 UI 会话，MUST 为空操作。折叠态 MUST 渲染为"标题 + 折叠提示（含当前键名）"，且 MUST 在折叠与展开间切换时强制整块重绘（高度变化）。

#### Scenario: off 不绑定

- **WHEN** `collapseKey` 为 `off`
- **THEN** 不注册任何折叠快捷键

#### Scenario: 非法键回退

- **WHEN** `collapseKey` 为 `ctr+]`
- **THEN** 使用默认键 `ctrl+shift+t`

#### Scenario: 折叠态渲染

- **WHEN** 用户按下折叠键且 widget 已注册
- **THEN** overlay 只剩标题与带键名的折叠提示行

---

### Requirement: 状态字形与计数

overlay MUST 使用固定字形：`○` 待办、`◐` 进行中、`◍` 等待中、`✓` 已完成、`✗` 已删除。已完成与已删除 MUST 以暗淡并带删除线呈现。`waiting` 任务 MUST 在同一行以暗淡文本追加其 `waitReason`（`⏸ <reason>`）：停泊的任务必须显示它在等什么，这正是 `waiting` 与静音按钮的区别。标题 MUST 显示 `当前/总数` 已完成计数，并按需附上进行中与等待中的数量；标题的重音色 MUST 只在存在 `pending` 或 `in_progress` 时启用——`waiting` 不计入"仍在进行"，与提醒集合的定义保持一致。

#### Scenario: waiting 显示理由

- **WHEN** 存在 `waiting` 任务 `#8`，理由为 `waiting on the integration job`
- **THEN** overlay 的该行显示 `◍ #8 <subject> ⏸ waiting on the integration job`

#### Scenario: 仅 waiting 不加重音

- **WHEN** 所有未终结任务均为 `waiting`
- **THEN** 标题不使用进行中重音色

---

### Requirement: 任务 id 的显示门控

overlay MUST 仅在至少一个可见任务携带 `blockedBy` 时显示行首 `#id`。**理由**：没有依赖信息时，逐行 id 没有锚点，只是噪声。

#### Scenario: 无依赖隐藏 id

- **WHEN** 所有可见任务的 `blockedBy` 均为空
- **THEN** 行内不出现 `#id` 前缀

#### Scenario: 有依赖显示 id

- **WHEN** 某个可见任务带 `blockedBy`
- **THEN** 所有可见行显示 `#id`，并以 `⛓ #N` 标注依赖

---

### Requirement: 只有前台会话能刷新 overlay

overlay MUST 只由前台会话（持有渲染会话身份的那个会话）刷新与绑定。子会话或非前台会话产生的事件 MUST NOT 改写 overlay，但 MUST 仍写入其自身的数据槽。前台身份 MUST 由首个带 UI 的会话取得并保持，直到该会话关闭。

#### Scenario: 子会话不刷屏

- **WHEN** 后台子会话创建了任务
- **THEN** 前台的 overlay 不变，子会话自身的 `list` 仍能看到该任务

#### Scenario: 前台切换

- **WHEN** 前台会话关闭而另一个 UI 会话仍在运行
- **THEN** 后续的 overlay 刷新不再指向已关闭的会话

---

### Requirement: 生命周期与重放

`session_start` MUST 从当前分支重放状态，MUST 记录前端 UI 上下文，并在该会话为前台时刷新 overlay。`session_compact` 与 `session_tree` MUST 重放并（仅当前台时）刷新。`session_shutdown` MUST 清除该会话的数据槽，并在其为前台时销毁 overlay（注销 widget）、清空 UI 上下文与前台指针；即使销毁过程中抛错，MUST 仍完成指针清理。失效的会话上下文（紧凑化与销毁竞态产生的死代理）MUST 被容忍：重放相关处 MUST 保留现状并依赖后继会话的 `session_start` 重放，MUST NOT 把该类错误当作普通错误抛出；其余错误 MUST 照常抛出。

#### Scenario: 紧凑化后不丢列表

- **WHEN** 会话发生紧凑化
- **THEN** 扩展从分支重放任务集并刷新 overlay

#### Scenario: 销毁时清理

- **WHEN** 前台会话关闭
- **THEN** widget 被注销、前台指针被清空，后续重放不会把旧会话状态复活

#### Scenario: 死上下文不报错

- **WHEN** 紧凑化事件携带一个已失效的会话上下文
- **THEN** 扩展保持现状返回，不抛出用户可见错误

---

### Requirement: 跨轮隐藏已完成任务

当一轮开始（`agent_start`）或提醒发出时，扩展 MUST 把上一轮中被标记为完成的已完成任务移出可见集合，使 overlay 聚焦于当前轮的工作；该隐藏 MUST 在会话重新绑定或重放被重置时清空。隐藏 MUST NOT 修改任务状态或持久化数据。

#### Scenario: 新一轮隐藏上轮成果

- **WHEN** 一个任务在上轮被标记 `completed`，随后新一轮开始
- **THEN** 该任务不再出现在 overlay 中，但仍存在于状态与 `/todos` 数据里

#### Scenario: 数据不受影响

- **WHEN** 已完成任务被跨轮隐藏
- **THEN** `todo` 工具返回的 `details` 中该任务仍为 `completed`

---

### Requirement: `/todos` 命令

扩展 MUST 注册 `/todos` 命令，用于输出当前分支上的任务（按状态分组）。在无 UI 会话中调用 MUST 以错误级别通知代替输出。列表为空时 MUST 通知无任务。分组顺序 MUST 为 `Pending` → `In Progress` → `Waiting` → `Completed`；标题计数段顺序 MUST 为已完成（`n/m`）→ 进行中 → 等待中 → 待办，零计数的段 MUST 省略。每行 MUST 形如 `  <glyph> #id subject[(activeForm)][    ⏸ reason][    ⛓ #dep,…]`，其中 `activeForm` 仅在 `in_progress`、`reason` 仅在 `waiting` 且存在理由时出现。

#### Scenario: 分组与段序

- **WHEN** 存在各状态的任务并执行 `/todos`
- **THEN** 输出按 Pending、In Progress、Waiting、Completed 顺序分段
- **AND** 首行计数按 已完成、进行中、等待中、待办 顺序拼接

#### Scenario: 空列表

- **WHEN** 当前分支没有可见任务并执行 `/todos`
- **THEN** 以信息级别通知"没有任务"，不打印分组

#### Scenario: 无 UI 场景

- **WHEN** 在无 UI 会话中执行 `/todos`
- **THEN** 以错误级别通知说明需要交互式会话

#### Scenario: waiting 行带理由

- **WHEN** `waiting` 任务带有理由并出现在 `/todos` 的 Waiting 段
- **THEN** 该行以 `⏸ <reason>` 呈现理由

---

### Requirement: widget 只在 TUI 模式注册

overlay MUST 只在 `ctx.mode === "tui"` 的会话绑定 UI 上下文并注册 widget。其它模式 MUST NOT 注册：RPC 宿主的 `setWidget` 只接受字符串数组、会静默丢弃组件工厂；JSON 与 print 的 UI 上下文是 no-op。在非 TUI 模式注册只会白烧渲染遍历，且让"widget 已注册"这一状态与现实不符。

延迟模块预热（`PREWARM_DELAY_MS`）MUST 同样受模式约束——MUST 由首个 TUI 会话启动，MUST NOT 在无 UI 或 RPC 会话中导入 overlay 模块图。

非 TUI 模式 MUST 仍然重放本会话的任务状态，使 `/todos`（RPC 经扩展 UI 子协议转发 `notify`）与提醒（读本会话数据槽）照常工作——被省略的只是 widget 这一条通路。

#### Scenario: RPC 不注册 widget

- **WHEN** 会话在 `rpc` 模式下启动并发生 `todo` 工具调用
- **THEN** 扩展不调用 `setWidget`，overlay 模块不被导入

#### Scenario: RPC 仍可查看列表

- **WHEN** 在 `rpc` 模式下执行 `/todos`
- **THEN** 列表文本经 `notify` 以扩展 UI 请求形式发出

#### Scenario: json 模式不预热

- **WHEN** 会话在 `json` 模式下启动并超过预热延迟
- **THEN** overlay 模块仍未被导入

#### Scenario: TUI 首个会话认领前台

- **WHEN** 第一个 `tui` 会话启动
- **THEN** 它认领前台渲染槽，并启动延迟预热
