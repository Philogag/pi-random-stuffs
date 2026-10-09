# `/goal` 立即启动（immediate-goal-kickoff）实现计划

> **给 agentic worker 使用：** 用 superpowers:subagent-driven-development 逐任务实现本计划。

---
change: immediate-goal-kickoff
design-doc: openspec/changes/immediate-goal-kickoff/design.md
base-ref: 1249f648684fe9b8b48b171c6891bac78e11a85f
---

**Goal:** 用户执行 `/goal <content>` 且 agent 空闲时，当场开启一轮续跑，而不是静默等下一次 settle。

**Architecture:** 改动只落在接线层：`packages/pi-goal-loop/src/index.ts` 的 `/goal` 命令处理器，在登记 + 通知之后，若宿主 `ctx.isIdle()` 为真则调用该扩展内既有的 `wakeNow()`（它已封装 `pi.sendMessage({ customType: GOAL_LOOP_CUSTOM_TYPE, content: buildContinuationPrompt(goal), display: true }, { triggerTurn: true })`）。纯状态机 `packages/pi-goal-loop/src/goal-state.ts` 零改动；streaming 情形不插队，交给既有 `agent_before_settle` 边界续跑（design.md D1–D5）。

**Tech Stack:** TypeScript 5.6（ESM）、pi extension API（`@earendil-works/pi-coding-agent >=0.87.0`：`ExtensionContext.isIdle()`、`pi.sendMessage(msg, { triggerTurn: true })`）、vitest 4、pnpm workspace。

---

## Global Constraints

- 所有命令在仓库根执行：`pnpm --filter @philogag/pi-goal-loop <script>`。
- MUST NOT 修改 `packages/pi-goal-loop/src/goal-state.ts`。
- MUST NOT 改变 `agent_before_settle` 处理器、`/goal-stop`、`goal_finish`、`goal_sleep` 的既有语义。
- 续跑文案只有一个来源：`buildContinuationPrompt()`（`packages/pi-goal-loop/src/prompts.ts`）。禁止在 `src/index.ts` 里内联第二份提示文本。
- 两个工具注册定义 MUST NOT 出现 `promptSnippet` / `promptGuidelines`（既有测试 `registers the tools without system-prompt guidance` 断言）。
- 不新增运行时依赖，不改 `peerDependencies` 下限。
- **工作树注意（重要）**：本变更开始前 `packages/pi-goal-loop/src/prompts.ts` 已有**未提交**修改（`buildContinuationPrompt` 措辞改动、删除 `/goal-stop` 那一行）。它不属于本变更：MUST NOT revert、MUST NOT 纳入本变更的提交。提交本变更时只 add `src/index.ts`、`test/index.test.ts`、`README.md`（以及 `openspec/changes/immediate-goal-kickoff/`）。
- 提交信息用中文祈使句，一次提交一个 Task。

---

## Task 1: 让 fake ctx 支持 `isIdle`

**Files:** `packages/pi-goal-loop/test/index.test.ts`

- [ ] **Step 1:** 把 `makeCtx()` 改造成可参数化，默认**非空闲**，以保持既有断言不变：

```ts
function makeCtx(options: { idle?: boolean } = {}) {
  const notify = vi.fn();
  const isIdle = vi.fn(() => options.idle ?? false);
  return { ctx: { hasUI: true, ui: { notify }, isIdle } as never, notify, isIdle };
}
```

- [ ] **Step 2:** 运行 `pnpm --filter @philogag/pi-goal-loop test`，确认仍全绿（默认 `idle: false` 时行为与本变更前一致）。
- [ ] **Step 3:** 提交：`git add packages/pi-goal-loop/test/index.test.ts && git commit -m "test(goal-loop): fake ctx 支持 isIdle"`。

---

## Task 2: 先写失败测试（TDD）

**Files:** `packages/pi-goal-loop/test/index.test.ts`

- [ ] **Step 1:** 在 `describe("pi-goal-loop wiring")` 末尾追加：空闲时立刻投递。

```ts
  it("starts a turn immediately when /goal is declared while idle", async () => {
    const { pi, commands, sent } = makeFakePi();
    goalLoop(pi);
    const { ctx, notify } = makeCtx({ idle: true });

    await commands.get("goal")!.handler("重构 X 模块", ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toContain("重构 X 模块");
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toEqual(
      expect.objectContaining({
        customType: "goal-loop",
        content: expect.stringContaining("重构 X 模块"),
        display: true,
      }),
    );
    expect(sent[0]![1]).toEqual({ triggerTurn: true });
  });
```

- [ ] **Step 2:** 追加：非空闲不投递 + 无参查询不投递 + 替换目标时空闲投递新目标。

```ts
  it("does not start a turn when /goal is declared while streaming", async () => {
    const { pi, commands, sent } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();

    await commands.get("goal")!.handler("给 Y 补集成测试", ctx);

    expect(sent).toHaveLength(0);
  });

  it("does not start a turn for the no-argument status query", async () => {
    const { pi, commands, sent } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx({ idle: true });

    await commands.get("goal")!.handler("   ", ctx);

    expect(sent).toHaveLength(0);
  });

  it("starts a turn immediately when replacing a goal while idle", async () => {
    const { pi, commands, sent } = makeFakePi();
    goalLoop(pi);
    const { ctx, notify } = makeCtx({ idle: true });

    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await commands.get("goal")!.handler("给 Y 补集成测试", ctx);

    expect(notify.mock.calls[1]![0]).toContain("已被替换");
    expect(sent).toHaveLength(2);
    expect(sent[1]![0]).toEqual(
      expect.objectContaining({ content: expect.stringContaining("给 Y 补集成测试") }),
    );
    expect(sent[1]![1]).toEqual({ triggerTurn: true });
  });
```

- [ ] **Step 3:** 运行 `pnpm --filter @philogag/pi-goal-loop test`，确认**新测试失败**（前 2 个断言 `sent` 长度为 0、后 1 个为 1），既有测试仍绿。若新测试没有失败，说明测试没测到位，先修正测试。
- [ ] **Step 4:** 提交：`git add packages/pi-goal-loop/test/index.test.ts && git commit -m "test(goal-loop): 覆盖 /goal 空闲时立刻启动"`。

---

## Task 3: 实现立即启动

**Files:** `packages/pi-goal-loop/src/index.ts`

- [ ] **Step 1:** 在 `/goal` 命令处理器带参分支的末尾（`notify(...)` 之后）加入一行；`wakeNow()` 是本文件已存在、已被 `createGoalState({ scheduler, wake: wakeNow })` 使用的函数，无需新增发送逻辑：

```ts
      const previous = getGoal(state);
      startGoal(state, text);
      notify(ctx, previous === null ? goalStartedNotice(text) : goalReplacedNotice(text));
      // 空闲时立刻开启一轮（streaming 中交给 agent_before_settle 边界续跑，不插队）
      if (typeof ctx.isIdle === "function" && ctx.isIdle()) wakeNow();
```

- [ ] **Step 2:** 运行 `pnpm --filter @philogag/pi-goal-loop test`，确认**全部通过**（含 Task 2 新增 4 例与既有 3 处 `sent` 计数断言）。
- [ ] **Step 3:** 运行 `pnpm --filter @philogag/pi-goal-loop typecheck`，确认 0 错误（`ctx.isIdle` 来自 `ExtensionCommandContext`，无需类型断言）。
- [ ] **Step 4:** 提交：`git add packages/pi-goal-loop/src/index.ts && git commit -m "feat(goal-loop): /goal 空闲时立刻开启一轮"`。

---

## Task 4: 更新 README

**Files:** `packages/pi-goal-loop/README.md`

- [ ] **Step 1:** 命令表首行 `| `/goal <目标>` | 发起目标;已有目标时**替换**它(并重置延迟状态) |` 改为说明「发起目标并**在空闲时立刻开始一轮**;已有目标时**替换**它(并重置延迟状态)」。
- [ ] **Step 2:** 设计要点中 `- **唤醒来源仅有两个**:定时器到点、超时兜底。避免「子 agent 一结束就误触发新一轮」。` 改为「**唤醒来源有三个**:用户 `/goal` 声明(agent 空闲时立即启动)、定时器到点、超时兜底。注意子 agent 结束**不会**触发新一轮,避免误触发。」——`无参数 /goal`、`goal_finish`、`goal_sleep` 的说明保持不变。
- [ ] **Step 3:** 提交：`git add packages/pi-goal-loop/README.md && git commit -m "docs(goal-loop): 说明 /goal 空闲时立刻启动"`。

---

## Task 5: 静态验证

- [x] **Step 1:** `pnpm --filter @philogag/pi-goal-loop typecheck && pnpm --filter @philogag/pi-goal-loop test && pnpm --filter @philogag/pi-goal-loop build` —— 三者均须 exit 0（记录实际测试用例数，若与 README「测试(46 例)」不符则同步更新该数字）。实测 `typecheck` / `build` exit 0；`test` exit 1（`1 failed | 49 passed (50)`），唯一失败在 `test/prompts.test.ts:26`，由未提交的 `src/prompts.ts` WIP 改动导致，与本变更无关；用例数已同步为 50。**后续收尾**：该 `1 failed | 49 passed (50)` 为历史结果，其唯一失败来自当时未提交的 `src/prompts.ts` WIP；该 WIP 已由工作区既存 WIP 的落地提交（该提交已折叠进本变更的单个提交）连同 `test/prompts.test.ts` 期望与 README 语句一并收尾，全量现已全绿（`50 passed (50)`）；该落地提交是本变更 spec 范围之外的独立本地 WIP 收尾。
- [x] **Step 2:** `cd packages/pi-goal-loop && openspec validate immediate-goal-kickoff --strict` —— 须输出 `Change 'immediate-goal-kickoff' is valid`。
- [x] **Step 3:** 在 `openspec/changes/immediate-goal-kickoff/tasks.md` 勾选 1.1–3.1，并提交 `git commit -am "chore(goal-loop): 勾选任务与验证结果"`（只 commit tasks.md 与必要文档）。

---

## Task 6: 真实 pi 端到端验收

- [ ] **Step 1（空闲路径，可脚本化）:** 在临时 scratch 目录运行
  `pi -e /home/philogag/workspace/pi-exts/pi-random-stuffs/packages/pi-goal-loop/src/index.ts -p --mode json "/goal 用一句话说明你已经收到目标"`，
  在 JSON 事件流中须看到：命中 `/goal` 命令后**紧接着**出现 `entry_appended`（`customType: "goal-loop"`、`display: true`、内容含目标原文），且 agent 有实际回复 —— 即无需额外用户消息就已开启一轮。
- [ ] **Step 2（streaming 路径，需人工）:** 交互会话中让 agent 正在工作时执行 `/goal X`，确认当轮**没有**立刻插入 goal 提示，而是在该轮 `agent_before_settle` 时正常续跑（可用 `/goal` 无参命令确认目标已登记）。 —— **未验证（需人工交互会话，用户稍后自测）**

> Step 1 与 Step 2 仍未勾选（因此 Step 3 中的 tasks.md 3.2 亦保持未勾选）：原因见文末「实现期偏差记录」——`-p --mode json` 载体无法观测命令触发的一轮（Step 1），streaming 路径需人工交互会话（Step 2）。后续：tasks.md 3.2 的勾选及其 `-p --mode json` 载体说明，记录在「实现期偏差记录」的 2026-10-09 验收决策行；Step 1 / Step 2 的 `- [ ]` 仍保持未勾选（Step 2 仍归人工且未验证）。

- [x] **Step 3:** 把 Task 6 结果（命令、观察到的宿主事件、日期）追加到 `README.md` 的「端到端验证记录」小节，勾选 tasks.md 3.2，提交。

---

## 实现期偏差记录（发现时补充）

- （待补）若宿主行为与 `design.md` 假设不符（例如 `isIdle()` 在命令处理器中恒为 false，或 `sendMessage(triggerTurn: true)` 未开启新一轮），在此记录偏差、影响与调整，并同步修订 `design.md` / `README.md`。

- **2026-10-09 实测偏差（Task 6 / Step 1）:**
  1. **brief 命令在本机无法直接运行**:`pi -e <packages/pi-goal-loop/src/index.ts> -p --mode json "/goal …"` 退出码 1,报 `Tool "goal_finish"/"goal_sleep" conflicts with …/src/index.ts` —— 因为本机已全局安装同名扩展 `~/.pi/agent/npm/node_modules/@philogag/pi-goal-loop/dist/index.js`。必须改为 `pi -ne -e <provider 扩展> -e <src/index.ts>` 才能加载被测源码。
  2. **`-p --mode json` 无法观测到命令触发的回复**:加 `-ne` 后可运行,`isIdle()` 确为 `true`,`wakeNow()` 也执行了 `pi.sendMessage(..., { triggerTurn: true })`,但 JSON 流只有 `session` + `agent_start` 后进程即退出:既无 goal-loop custom message,也无 agent 回复。根因:print 模式在扩展命令返回 `disposition: "handled"` 后立即 `disposeRuntime()` 并 abort agent(`dist/modes/print-mode.js`),而宿主 `sendMessage` 是 fire-and-forget(`dist/core/extensions/loader.js` 丢弃其返回的 Promise),扩展无法 await 该轮完成。
  3. **同源码 RPC 复验证实功能正常**:用**未修改**的 `src/index.ts` 以 `pi --mode rpc --no-session -ne -e …` 发送同一条 `/goal 用一句话说明你已经收到目标`,全程无额外用户消息,事件序列为 `agent_start → turn_start → message_start/end(role:"custom", customType:"goal-loop", display:true, 含目标原文) → assistant 回复 + goal_finish → 第二轮 turn_start → 最终回复 → agent_settled`。
- **影响与处理**:功能本身无缺陷,`design.md` 与 `src/index.ts` 均无需修改;偏差仅在于 brief 指定的 `-p --mode json` 验收载体不足以观测“命令触发的一轮”。因此 **tasks.md 3.2 未勾选**(Step 1 未按其定义在 `-p` 流中通过,且 Step 2 streaming 路径仍为 未验证（需人工交互会话）)。
- **宿主版本/事件形态差异**:本次宿主机为 pi 1.1.0(`@earendil-works/pi-coding-agent` 1.1.0);该版本对扩展 custom message **不发** `entry_appended`,而是 `message_start`/`message_end`(`role:"custom"`)。brief 与既有 README 中 `entry_appended` 的表述基于更早版本(0.87.x)。
- **本轮未修改任何源码**(证据 + 文档)。

- **2026-10-09 验收决策（Task 6 / tasks.md 3.2）**:用户接受上述 RPC 模式的空闲路径证据,并按 tasks.md 3.2 的车辆（载体）限制勾选该项——即 3.2 以「RPC 模式复验通过 + `-p --mode json` 载体无法观测命令触发的一轮」的表述标记完成;streaming 路径仍未验证,由用户稍后以人工交互会话自测（本决策超越前面那句「3.2 亦保持未勾选」）。附带事项:本变更范围之外、仓库中原有的 `src/prompts.ts` WIP(续跑提示词措辞 + 移除 `/goal-stop` 出口)已作为独立提交收尾,不进入本 change 的 spec 范围。

- **2026-10-09 收尾折叠**:本计划各 Step 中列出的逐次 `git commit` 命令在执行时确以独立提交落地,收尾阶段按操作者要求全部折叠为 `master` 上的**单个提交**(父提交为 fork point,即变更开始前的 `master` tip);因此上文与 `verify.md` / `retrospective.md` 中不再出现任何过程提交 SHA,过程历史仅存于本地 reflog。
