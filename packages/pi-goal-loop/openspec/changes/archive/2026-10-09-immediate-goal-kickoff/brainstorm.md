<!--
superpowers:brainstorming 产出的原始捕获（决策日志）。

轨迹：分类 → 项目上下文 → 逐个澄清问题 → 备选方案与取舍 → 确认的设计。
design.md 从本文件萃取并重组为结构化设计文档，不复制本文件。
-->

# Brainstorm — immediate-goal-kickoff

## 触发请求

> 当用户 `/goal <content>` 时，如果 loop 未在运行，立刻发送一次。

## 项目上下文（探索结论）

- 目标扩展已存在：`packages/pi-goal-loop`，纯状态机 `src/goal-state.ts` 与 pi 接线 `src/index.ts` 分离。
- 现状 `src/index.ts` 的 `/goal` 命令处理器**只做**两件事：`startGoal(state, text)` 与 `notify(...)`，
  它**不会**发起任何模型请求。
- 自动续跑的唯一入口是 `pi.on("agent_before_settle", ...)`：一轮以 `outcome === "completed"`
  结束、且存在活动目标、且无生效延迟抑制时，才追加续跑提示并 `continue: true`。
- 因此**空闲会话里执行 `/goal X` 之后，若用户不再发任何消息，就没有「一轮」可以 settle，
  循环永远不会启动**——这正是本请求要补的缺口。用户执行 `/goal X` 的常见心智是「现在就去做」。
- 宿主已提供的判定与发送能力：
  - `ExtensionContext.isIdle(): boolean`（`ExtensionCommandContext` 继承它，命令处理器可直接用）——
    「agent 是否空闲（未在 streaming）」。
  - `pi.sendMessage(msg, { triggerTurn: true })`：宿主文档明确 ——
    非 streaming 时追加条目并**开启新一轮**；streaming 时**排队**，由循环取队列时处理。
- 既有续跑提示有单一来源：`src/prompts.ts` 的 `buildContinuationPrompt(goal)`，
  条目类型常量 `GOAL_LOOP_CUSTOM_TYPE = "goal-loop"`，投递时 `display: true`。

## 分类

**bounded**：改动局限于一个既有扩展的接线层（`src/index.ts`），既有流程（`/goal` 命令、
settle 边界、状态机）都已在本仓库中可读。不新增子系统、不改对外接口形态。
在 chat 中给出简短设计并取得确认即可（本变更的提案阶段按 SDD 工作流仍产出完整 artifacts）。

## 决策链

### Q1 变更名称

候选：`immediate-goal-kickoff` / `kickoff-on-goal-command` / `pi-goal-loop`。
**决策：`immediate-goal-kickoff`**。
理由：`pi-goal-loop` 是包名，且已归档变更叫 `add-goal-loop`；用描述性动词短语避免歧义。

### Q2 「loop 未在运行」如何判定、哪些情况触发

候选：
1. 空闲即触发，含替换 —— 用宿主 `ctx.isIdle()` 判定；`/goal <content>` 执行时空闲就立刻注入一轮；
   替换已有目标且空闲时同样触发；streaming 时不额外发，交给 settle 边界。
2. 仅首次声明时触发 —— 只有此前无活动目标才立刻触发，替换不触发。
3. 无条件总是触发 —— 不检查运行状态，总是发一次（streaming 交给宿主排队）。

**决策：方案 1（空闲即触发，含替换）。**
理由：
- 「loop 未在运行」在宿主语义下最自然的映射就是 `ctx.isIdle()`，无需扩展自己造一个 running 标志。
- 替换目标时若空闲，其现状同样是「声明完什么都不发生」，应与首次声明一致地立刻启动。
- 方案 3 在 streaming 时会先把消息排队、随后该轮 settle 又触发 settle 边界续跑，
  造成连续两轮重复推进；方案 1 把 streaming 情形完全交给既有 settle 边界，语义更干净。

### Q3 立刻发送的内容

候选：复用 `buildContinuationPrompt(goal)` / 把目标原文用 `sendUserMessage` 发出 / 新增一条精简启动提示。
**决策：复用现有续跑提示。**
理由：
- 单一来源，首轮与后续自动续跑文案完全一致，agent 视角没有「两种开局」。
- `sendUserMessage` 会把目标原文再发一遍，与 `/goal` 已登记的文本重复，且绕过 `goal-loop` customType。
- 新增提示会让 `prompts.ts` 出现第二份几乎相同的文案，未来易漂移；YAGNI。

## 确认的设计（简短）

在 `src/index.ts` 的 `/goal` 带参分支中，`startGoal(state, text)` 与 `notify(...)` 之后，
当 `ctx.isIdle()` 为 true 时立刻执行一次：

```ts
pi.sendMessage(
  { customType: GOAL_LOOP_CUSTOM_TYPE, content: buildContinuationPrompt(text), display: true },
  { triggerTurn: true },
);
```

不新增状态、不改 `src/goal-state.ts`、不改 `/goal` 无参查询、`/goal-stop`、`goal_finish`、
`goal_sleep` 与 settle 边界行为。streaming 时跳过（covers 既有 settle 边界续跑）。

### 开销说明

该改动只影响 `/goal` 命令执行的那一瞬间，不改变每轮固定上下文（工具注册仍不写系统提示词），
不新增 token 常驻项。

## 取舍 / 风险

- **`ctx.isIdle()` 的语义边界**：非 goal 性质的 streaming（用户正在普通对话）时不会立刻发，
  但该轮 settle 时 settle 边界照常续跑——不会丢循环，只是晚一轮。
- **通知与提示的时序**：`notify` 是 UI 通知，`sendMessage(triggerTurn)` 开启新轮，二者互不干扰。
- **不可测部分**：`ctx.isIdle()` 来自宿主，扩展测试用 fake context 注入 true/false 覆盖两条分支。
