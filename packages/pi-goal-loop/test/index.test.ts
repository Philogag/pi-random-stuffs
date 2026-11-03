import { describe, expect, it, vi } from "vitest";
import goalLoop from "../src/index.js";

type AnyArgs = any[];

function makeFakePi() {
  const commands = new Map<string, { handler: (args: string, ctx: AnyArgs) => Promise<void> }>();
  const tools = new Map<
    string,
    {
      execute: (...a: AnyArgs) => Promise<AnyArgs>;
      promptSnippet?: string;
      promptGuidelines?: string[];
    }
  >();
  const handlers = new Map<string, (event: AnyArgs, ctx: AnyArgs) => AnyArgs>();
  const bus = new Map<string, (data: unknown) => void>();
  const sent: AnyArgs[] = [];
  const appendEntry = vi.fn();

  const pi = {
    registerCommand: (name: string, options: AnyArgs) => commands.set(name, options),
    registerTool: (tool: AnyArgs) => tools.set(tool.name, tool),
    on: (event: string, handler: AnyArgs) => {
      handlers.set(event, handler);
      return () => {};
    },
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        bus.set(channel, handler);
        return () => {};
      },
      emit: (channel: string, data: unknown) => bus.get(channel)?.(data),
    },
    sendMessage: (...args: AnyArgs) => sent.push(args),
    appendEntry,
  };

  return { pi: pi as never, commands, tools, handlers, bus, sent, appendEntry };
}

function makeCtx(options: { idle?: boolean } = {}) {
  const notify = vi.fn();
  const isIdle = vi.fn(() => options.idle ?? false);
  return { ctx: { hasUI: true, ui: { notify }, isIdle } as never, notify, isIdle };
}

const SETTLE = (outcome = "completed") => ({ type: "agent_before_settle", outcome });

function startTool(
  handlers: Map<string, (event: AnyArgs, ctx: AnyArgs) => AnyArgs>,
  ctx: never,
  toolName: string,
  args: AnyArgs,
  toolCallId = `${toolName}-1`,
) {
  handlers.get("tool_execution_start")!(
    { type: "tool_execution_start", toolCallId, toolName, args },
    ctx,
  );
  return toolCallId;
}

function endTool(
  handlers: Map<string, (event: AnyArgs, ctx: AnyArgs) => AnyArgs>,
  ctx: never,
  toolName: string,
  toolCallId: string,
) {
  handlers.get("tool_execution_end")!(
    { type: "tool_execution_end", toolCallId, toolName, result: {}, isError: false },
    ctx,
  );
}

describe("pi-goal-loop wiring", () => {
  it("registers the two commands and only goal_finish", () => {
    const { pi, commands, tools } = makeFakePi();
    goalLoop(pi);
    expect([...commands.keys()].sort()).toEqual(["goal", "goal-stop"]);
    expect([...tools.keys()]).toEqual(["goal_finish"]);
    expect(tools.has("goal_sleep")).toBe(false);
  });

  it("registers the boundary, lifecycle and wait handlers", () => {
    const { pi, handlers } = makeFakePi();
    goalLoop(pi);
    for (const event of [
      "agent_before_settle",
      "agent_start",
      "input",
      "tool_execution_start",
      "tool_execution_end",
      "session_shutdown",
    ]) {
      expect(handlers.has(event)).toBe(true);
    }
  });

  it("subscribes to the rpiv ask-blocked channel", () => {
    const { pi, bus } = makeFakePi();
    goalLoop(pi);
    expect(bus.has("rpiv:ask-user:blocked")).toBe(true);
  });

  it("registers the tool without system-prompt guidance", () => {
    const { pi, tools } = makeFakePi();
    goalLoop(pi);
    for (const tool of tools.values()) {
      expect(tool.promptSnippet).toBeUndefined();
      expect(tool.promptGuidelines).toBeUndefined();
    }
  });

  it("does not persist goal state to session entries", async () => {
    const { pi, commands, appendEntry } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("continues at the boundary while a goal is active", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    const result = handlers.get("agent_before_settle")!(SETTLE(), ctx);

    expect(result).toEqual({
      entries: [
        expect.objectContaining({
          type: "custom_message",
          customType: "goal-loop",
          display: true,
        }),
      ],
      continue: true,
    });
  });

  it("stops continuing after goal_finish", async () => {
    const { pi, commands, tools, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await tools.get("goal_finish")!.execute("id", {}, undefined, undefined, ctx);

    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toBeUndefined();
  });

  it("stops continuing after /goal-stop", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await commands.get("goal-stop")!.handler("", ctx);

    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toBeUndefined();
  });

  it("pauses (without clearing the goal) on aborted", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    expect(handlers.get("agent_before_settle")!(SETTLE("aborted"), ctx)).toBeUndefined();
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );
  });

  it("fails goal_finish without an active goal", async () => {
    const { pi, tools } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await expect(tools.get("goal_finish")!.execute("id", {}, undefined, undefined, ctx)).rejects.toThrow();
  });

  it("suppresses the boundary after an async dispatch until a new turn starts", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    const callId = startTool(handlers, ctx, "subagent", { agent: "worker", task: "x" }, "s1");
    endTool(handlers, ctx, "subagent", callId);

    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toBeUndefined();

    handlers.get("agent_start")!({ type: "agent_start" }, ctx);

    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );
  });

  it("does not suppress for subagent management or synchronous calls", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    const statusId = startTool(handlers, ctx, "subagent", { action: "status", id: "run-1" }, "s1");
    endTool(handlers, ctx, "subagent", statusId);
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );

    const syncId = startTool(handlers, ctx, "subagent", { agent: "worker", task: "x", async: false }, "s2");
    endTool(handlers, ctx, "subagent", syncId);
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );
  });

  it("suppresses while bg_wait is in flight and resumes when it ends", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    const callId = startTool(handlers, ctx, "bg_wait", { id: "run-1" }, "w1");
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toBeUndefined();

    endTool(handlers, ctx, "bg_wait", callId);
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );
  });

  it("suppresses while acp_delegate_wait is in flight", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    startTool(handlers, ctx, "acp_delegate_wait", { runId: "del_1" }, "d1");
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toBeUndefined();
  });

  it("suppresses while the rpiv questionnaire is blocked", async () => {
    const { pi, commands, handlers, bus } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    bus.get("rpiv:ask-user:blocked")!({ active: true, toolCallId: "ask-1" });
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toBeUndefined();

    bus.get("rpiv:ask-user:blocked")!({ active: false, toolCallId: "ask-1" });
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );
  });

  it("releases the latch on user input", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    const callId = startTool(handlers, ctx, "acp_delegate", { agent: "worker", task: "x" }, "a1");
    endTool(handlers, ctx, "acp_delegate", callId);
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toBeUndefined();

    handlers.get("input")!({ type: "input", text: "继续", source: "user" }, ctx);

    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );
  });

  it("clears the wait state when the goal is replaced or stopped", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    const callId = startTool(handlers, ctx, "subagent", { agent: "worker", task: "x" }, "s1");
    endTool(handlers, ctx, "subagent", callId);
    await commands.get("goal")!.handler("给 Y 补集成测试", ctx);
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );

    const secondId = startTool(handlers, ctx, "subagent", { agent: "worker", task: "y" }, "s2");
    endTool(handlers, ctx, "subagent", secondId);
    await commands.get("goal-stop")!.handler("", ctx);
    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toBeUndefined();
  });

  it("clears the wait state on session shutdown", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    const callId = startTool(handlers, ctx, "subagent", { agent: "worker", task: "x" }, "s1");
    endTool(handlers, ctx, "subagent", callId);
    handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);

    expect(handlers.get("agent_before_settle")!(SETTLE(), ctx)).toEqual(
      expect.objectContaining({ continue: true }),
    );
  });

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
});
