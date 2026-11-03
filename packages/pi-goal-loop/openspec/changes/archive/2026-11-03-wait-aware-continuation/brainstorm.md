# Brainstorm — wait-aware-continuation

## 背景

`packages/pi-goal-loop` 当前用 `goal_sleep({ seconds })` 处理「这一轮不该续跑」：agent 调它 → 下一次
`agent_before_settle` 被抑制一次 → 900s 上限的定时器到点后主动 `triggerTurn` 开一轮。

实践中有三个问题：

1. **定时器与真实唤醒竞争**。pi-subagents 的异步派发已经有原生完成唤醒；rpiv-ask-user-question
   在等用户回答。定时器到点往往正好落在「用户正在看问卷」或「子 agent 刚完成」的时刻，白烧一轮
   token，并在问卷打开时插入一条续跑提示。
2. **抑制只消费一次**，所以 `goal_sleep` 必须反复调用；agent 因此要自己算时长，猜错就空转。
3. **工具面对模型多一个必须学的东西**，而「不要 sleep/poll」正是 pi-subagents 自己在异步派发的
   工具结果里写的话（`src/runs/background/async-execution.js:153`："Detached. Return control now:
   native completion wakes you, so do not sleep, poll, or call bg_wait for it."）。

## 探索到的宿主与兄弟扩展事实

- pi 扩展有跨扩展事件总线 `pi.events`（`EventBus.on/emit`）。
- @juicesharp/rpiv-ask-user-question v2.15.0 在 `ask-user-question.ts:61,66` 用
  `pi.events.emit(ASK_USER_BLOCKED_EVENT, { active, toolCallId })` 广播 `rpiv:ask-user:blocked`，
  `active: true` 表示正在等用户输入，`active: false` 表示等待结束；工具名
  `ASK_USER_QUESTION_TOOL_NAME = "ask_user_question"`。
- pi-subagents 的 `bg_wait`（`src/runs/background/wait-tool.js:41`）在轮内阻塞；异步派发
  （`subagent`/`acp_delegate`，默认 `async: true`）立即返回并由原生完成通知唤起新一轮。
- pi 扩展 API 提供 `tool_execution_start`（含 `toolName`/`args`/`toolCallId`）、
  `tool_execution_end`、`agent_start`、`input`、`agent_before_settle`。

## 决策日志

### Q1 删掉 goal_sleep 后，边界靠什么判断「该等」？

候选：
- (A) 看本轮收尾的等待类工具（尾部工具名匹配）。
- (B) 看在途状态：`rpiv:ask-user:blocked` 事件 + 未结束的等待类工具调用。
- (C) 不做抑制，只把提示词改成「用 bg_wait / ask_user_question」。

**选定 (B)**。理由：不用猜「哪个工具算收尾」，也不需要解析别人的工具结果文本；
`tool_execution_start/end` 与 rpiv 的 blocked 事件都是稳定的公开信号。
(A) 的问题是把「刚调用过」当成「还在等」，`bg_wait` 超时返回后会被误判；
(C) 等于放弃这类等待，`bg_wait` 超时后仍会立刻续跑。

### Q2 抑制之后如果原生唤醒没来，循环怎么恢复？

- (A) 抑制只对下一次边界生效一次。
- (B) 抑制持续到出现外部事件（用户消息 / 完成通知带来的新轮 / 目标生命周期事件）。
- (C) 保留一个隐藏的兜底定时器。

**选定 (B)**。理由：一次性的抑制在「异步派发 + 完成通知」路径上不够——派发后本轮结束，
完成通知可能几十秒后才来，中间任何一次 settle 都不该续跑；而 (C) 正是本次要拆掉的定时器。

### Q3 哪些等待来源要纳入兼容？

**选定：核心两个 + acp_delegate 系**：

- 阻塞类（轮内阻塞，等外部角色）：`ask_user_question`、`bg_wait`、`acp_delegate_wait`
- 异步派发类（立即返回，靠原生完成通知续上）：`subagent`、`acp_delegate`
  （仅当参数里没有 `action` 且 `async !== false`）

### Q4 落地方式

**选定：走 OpenSpec 变更**（brainstorm → proposal → design → specs → tasks → plan → 实现 → verify
→ retrospective），并按仓库既有习惯在主分支单次提交（含归档）。

## 设计取舍

**in-flight 与 latch 的区别（关键取舍）**

- 阻塞类等待在轮内解决：`ask_user_question` 拿到答案、`bg_wait` 返回结果后，本轮**继续**执行，
  settle 时已经没有等待。若也给它们加 latch，用户答完问卷、agent 干完活、本轮结束时循环会
  静默挂住，直到用户说话。所以只做 in-flight 判定（不 latch）。
- 异步派发立即返回，工作仍在别处进行：settle 时没有任何 in-flight 调用，**只有 latch 能抑制**。
  这就是 Q2 选 (B) 的动机。

**latch 的释放集合**：`input`（用户说话）、`agent_start`（任何新一轮开始，涵盖子 agent 完成通知
的 `triggerTurn` 唤醒与 `/goal` 的 kickoff）、带参 `/goal`、`/goal-stop`、`goal_finish`、
`session_shutdown`。前者是「外部角色回来了」，后者是「目标换了/结束了」。

**能力名**：`goal-deferral` 描述的是「agent 主动请求延迟」，机制被删后名不符实，改名为 `goal-wait`
（等待感知的续跑抑制），旧能力按 REMOVED 处理并在归档时删除 `openspec/specs/goal-deferral/`。

## 未采纳的方向

- 读取别人工具结果文本判断「是否真的等到了」（脆弱，且要跟随兄弟扩展的文案变化）。
- 保留隐藏兜底定时器（本次的核心诉求就是去掉定时器竞争）。
- 按 `agent_settled` 释放 latch（此时已结算，等价于「抑制从不生效」）。
