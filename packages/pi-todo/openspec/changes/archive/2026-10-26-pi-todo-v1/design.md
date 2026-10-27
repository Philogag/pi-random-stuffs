## 决策 1：fork rpiv-todo，而不是从零写

**选择**：复制 `@juicesharp/rpiv-todo@2.13.8` 的 `package/` 源码进来改造。

**理由**：会话历史是硬兼容面。工具名 `todo`、state entry 类型 `pi-todo-state`
（fork 的 `rpiv-todo-state`）、`details` 快照形状三者一旦变化，旧分支的任务就再也
replay 不回来。fork 让这三样天然一致，改造面收敛到"我真正想改的部分"（状态机、
提示词、提醒）。

**代价**：继承了 fork 里我不需要的 `rpiv-*` SDK 依赖与 i18n 层。

**缓解**：`t(key, fallback)` 本地桥替掉 `rpiv-i18n`；`rpiv-config` 的 XDG `config.json`
换成 pi 的 `settings.json`；`locales/` 不复制（本轮只做英文文案）。

## 决策 2：新增 `waiting`，而不是复用 `in_progress`

**选择**：第五状态 `waiting`，必填 `waitReason`，离开时自动清空，不计入 open 集合。

**理由**：`in_progress` 同时承载"我正在做"和"我在等别人"，导致两个后果：停时提醒
对着一个不可能推进的任务反复催，以及 overlay 上"进行中"名不副实。

**被否决的替代**：给提醒加一个 mute 开关。它把问题从"状态建模"降级成"用户手动关
噪声"，而且 mute 是隐藏状态——忘了关就一直静默。`waiting` 是可逆的、可见的、自解释的。

**约束**：`waiting` 必须可逆（↔ `pending` / `in_progress`）且**不得**进入闭包终态，
否则"等到了"就无法记录。

## 决策 3：提醒预算按"用户提示"计，只在 `before_agent_start` 归零

**选择**：`reminders.max` 默认 3，夹紧到 `1..9`；计数器只在真正的用户提示开始时重置。

**理由**：`agent_before_settle` 自己触发的那一轮**不会**经过 `before_agent_start`，
所以自触发轮不能重置预算——否则"提醒→再提醒"无限续跑，正是这条策略要防的事。

**被否决的替代**：oracle 建议的"无上限 + `todo pause_reminder` 工具"。缺确定上界，
单独就足以否决：模型可以连续几十轮自我续跑，成本不可预测。

## 决策 4：单飞锁由"任意工具结果"解锁

**选择**：提醒投递后置锁，任意工具结果（`tool_execution_end`）清锁。

**理由**：锁的目的不是"限流"而是"要求证据驱动"——提醒之后模型必须**做**点什么
（读文件、跑命令、改任务）才可能再被提醒。纯文本回复不产生工具结果，因此不会换来
又一次提醒。

## 决策 5：三个提示词面各司其职，由 spec 钉死

**选择**：`promptSnippet` → `<tools>` 摘要；`promptGuidelines` → `<rules>`（重写为 6 条）；
`description` → provider-native schema，并**必须**声明五个状态。

**理由**：pi 把这三样注入到不同位置（`agent-session.js:2838-2851` 里 guidelines 进
`<rules>` 且去重、排在内置规则之前），职责混用会导致"同样的要求出现两次"或"模型
压根不知道 `waiting` 这个参数值合法"。模型只能从 schema 学到合法状态值，所以
description 不写 `waiting` 就等于没有这个状态。

## 决策 6：overlay 懒加载，且只在 `tui` 注册

**选择**：`import("./todo-overlay.js")` 动态加载；`session_start` 里用 `resolveMode(ctx) === "tui"`
门禁；预热定时器也由首个 TUI `session_start` 调度。

**理由**：`pi-tui` 依赖图不便宜，而 `pi -p`、`--mode json`、`--rpc` 三种宿主要么没有
widget 概念、要么直接丢弃 widget 工厂。注册了也用不上，还白付 import 成本。

**顺带修的 bug**：原 `agent_before_settle` 读的是 `getActiveRenderSession()`——那是
**前台渲染槽**，被启动第一个会话永久霸占。于是 RPC 下第二个会话永远收不到提醒。
改为读本会话自己的 `getState(id)`。

## 决策 7：配置进 pi 的 `settings.json`，不另开 XDG 文件

**选择**：`PACKAGE_KEY = "@philogag/pi-todo"`，扁平命名空间。

**理由**：单一真源。用户已经在 `settings.json` 里配别的扩展，多一个 `~/.config/pi-todo/config.json`
意味着"两处都可能错、都不报错"。畸形值一律回退默认而不是抛错——配置文件写错不该让
扩展装不上。

## 决策 8：`deleted` 只做墓碑，不物理删除

**选择**：`delete` 把 `status` 置为 `deleted` 并保留 id；`clear` 才重置 `nextId`。

**理由**：`blockedBy` 里可能引用已删任务；物理删除会让历史依赖变成悬空引用，
replay 出来的图和当时看到的不一致。墓碑保证"当时那一刻的引用仍然可解析"。

## 决策 9：文案默认值固定，但允许整字段覆盖

**选择**：默认 6 条 guidelines（≤400 字符）、`description`（≤90 字符摘要段），
`prompt.snippet` / `prompt.guidelines` 可整字段替换；畸形值（非字符串数组）回退默认。

**理由**：spec 需要可断言的默认文案（否则"提示词注入"无法被验证），用户又需要能按
自己的语言/团队习惯替换。逐条合并会造成"半套文案"，所以只做整体替换。
