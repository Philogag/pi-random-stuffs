## REMOVED Requirements

### Requirement: 延迟续跑工具（`goal_sleep`）

**Reason**: 该工具把「该等多久」的判断推给模型，猜错即空转；它依赖的定时器还会与 pi-subagents 的原生完成唤醒、以及 rpiv-ask-user-question 的问卷等待竞争，在等待中途插入多余续跑提示。续跑抑制改由 goal-wait 的「等待期抑制续跑」承担。

**Migration**: `goal_sleep` 不再注册，调用它会导致未知工具错误。等待语义改为：需要用户决策时调用 `ask_user_question`；等待后台工作或子 agent 时调用 `bg_wait`，或让异步派发完成通知原生唤醒。扩展在这类等待生效期间自动不续跑，不需要显式声明延迟。

### Requirement: 一次性抑制第一次 settle

**Reason**: 抑制改为等待态驱动，只要 latch 未释放就在每次 settle 上生效，不再区分「第一次」与后续。一次性的抑制在异步派发路径上不够——派发后本轮结束，完成通知可能几十秒后才到。

**Migration**: 无调用方需要改动；`goal_sleep` 消失后不会再有「抑制已被消费」的状态。等待态的可观测行为见 goal-wait 的「等待期抑制续跑」与「等待态的释放」。

### Requirement: 定时器唤醒与「已恢复则跳过注入」

**Reason**: 定时器机制被整体删除。恢复完全由外部事件驱动：pi-subagents 完成通知的 `triggerTurn` 唤醒、用户输入、以及目标生命周期命令。

**Migration**: 不再存在「到点唤醒」。若等待的完成通知未能到达，循环停在原处等待任一外部事件（用户发言、`/goal`、新一轮 `agent_start`）。需要强行推进时可发送任意消息或重新执行 `/goal`。

### Requirement: 时长边界与超时兜底

**Reason**: 不再有以秒为单位的时长参数，因此没有 1–900 秒的截断，也没有 `MAX_SLEEP_MS` 超时兜底。

**Migration**: 无。删除 `MIN_SLEEP_SECONDS` / `MAX_SLEEP_SECONDS` / `MAX_SLEEP_MS` / `clampSleepSeconds` 等导出。

### Requirement: 延迟状态的清理

**Reason**: 延迟状态（含定时器句柄）不复存在；清理对象改为等待态，且仍遵循「目标替换/结束/会话关闭即清理且幂等」的要求。

**Migration**: 清理语义改由 goal-wait 的「等待态的释放」与 goal-lifecycle 的 `/goal`、`/goal-stop`、`goal_finish` 需求承载；没有定时器需要取消。

### Requirement: 唤醒来源为定时器、超时兜底与 /goal 命令

**Reason**: 唤醒来源收敛为「外部事件」：用户输入、原生完成唤醒带来的新轮、以及 `/goal` 声明。定时器与超时兜底两条来源随机制一并删除。

**Migration**: 无调用方需要改动。等待期不再由扩展主动唤醒；需要推进时由 pi-subagents 完成通知、用户消息或 `/goal` 触发。

> 备注：本文件原为 `specs/goal-deferral/spec.md` 的 delta。因 `goal_sleep` 是该 capability 的唯一内容，删除全部 requirement 后 spec 无法存续，`openspec archive` 要求先手工删除主 spec；删除后本 delta 也不再参与合并，故移到这里作为**移除理由与迁移指引**的存档。
