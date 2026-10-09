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
  const sent: AnyArgs[] = [];
  const appendEntry = vi.fn();

  const pi = {
    registerCommand: (name: string, options: AnyArgs) => commands.set(name, options),
    registerTool: (tool: AnyArgs) => tools.set(tool.name, tool),
    on: (event: string, handler: AnyArgs) => {
      handlers.set(event, handler);
      return () => {};
    },
    sendMessage: (...args: AnyArgs) => sent.push(args),
    appendEntry,
  };

  return { pi: pi as never, commands, tools, handlers, sent, appendEntry };
}

function makeCtx(options: { idle?: boolean } = {}) {
  const notify = vi.fn();
  const isIdle = vi.fn(() => options.idle ?? false);
  return { ctx: { hasUI: true, ui: { notify }, isIdle } as never, notify, isIdle };
}

describe("pi-goal-loop wiring", () => {
  it("registers the two commands and two tools", () => {
    const { pi, commands, tools } = makeFakePi();
    goalLoop(pi);
    expect([...commands.keys()].sort()).toEqual(["goal", "goal-stop"]);
    expect([...tools.keys()].sort()).toEqual(["goal_finish", "goal_sleep"]);
  });

  it("registers the boundary and shutdown handlers", () => {
    const { pi, handlers } = makeFakePi();
    goalLoop(pi);
    expect(handlers.has("agent_before_settle")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
  });

  it("registers the tools without system-prompt guidance", () => {
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

    const result = handlers.get("agent_before_settle")!(
      { type: "agent_before_settle", outcome: "completed" },
      ctx,
    );

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

    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx),
    ).toBeUndefined();
  });

  it("stops continuing after /goal-stop", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    await commands.get("goal-stop")!.handler("", ctx);

    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx),
    ).toBeUndefined();
  });

  it("pauses (without clearing the goal) on aborted", async () => {
    const { pi, commands, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);

    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "aborted" }, ctx),
    ).toBeUndefined();
    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx),
    ).toEqual(expect.objectContaining({ continue: true }));
  });

  it("fails goal_finish and goal_sleep without an active goal", async () => {
    const { pi, tools } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await expect(tools.get("goal_finish")!.execute("id", {}, undefined, undefined, ctx)).rejects.toThrow();
    await expect(
      tools.get("goal_sleep")!.execute("id", { seconds: 60 }, undefined, undefined, ctx),
    ).rejects.toThrow();
  });

  it("goal_sleep defers the boundary and reports the clamped duration", async () => {
    const { pi, commands, tools, handlers } = makeFakePi();
    goalLoop(pi);
    const { ctx } = makeCtx();
    await commands.get("goal")!.handler("重构 X 模块", ctx);
    const result = await tools.get("goal_sleep")!.execute("id", { seconds: 99999 }, undefined, undefined, ctx);

    expect(JSON.stringify(result)).toContain("900");
    expect(
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx),
    ).toBeUndefined();
  });

  it("wakes with a triggered turn when the sleep timer fires", async () => {
    vi.useFakeTimers();
    try {
      const { pi, commands, tools, sent } = makeFakePi();
      goalLoop(pi);
      const { ctx } = makeCtx();
      await commands.get("goal")!.handler("重构 X 模块", ctx);
      await tools.get("goal_sleep")!.execute("id", { seconds: 60 }, undefined, undefined, ctx);

      vi.advanceTimersByTime(60_000);

      expect(sent).toHaveLength(1);
      expect(sent[0]![0]).toEqual(expect.objectContaining({ customType: "goal-loop", display: true }));
      expect(sent[0]![1]).toEqual({ triggerTurn: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the triggered turn when the loop already resumed", async () => {
    vi.useFakeTimers();
    try {
      const { pi, commands, tools, handlers, sent } = makeFakePi();
      goalLoop(pi);
      const { ctx } = makeCtx();
      await commands.get("goal")!.handler("重构 X 模块", ctx);
      await tools.get("goal_sleep")!.execute("id", { seconds: 60 }, undefined, undefined, ctx);
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx);
      vi.advanceTimersByTime(10_000);
      handlers.get("agent_before_settle")!({ type: "agent_before_settle", outcome: "completed" }, ctx);

      vi.advanceTimersByTime(60_000);

      expect(sent).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the timer on session shutdown", async () => {
    vi.useFakeTimers();
    try {
      const { pi, commands, tools, handlers, sent } = makeFakePi();
      goalLoop(pi);
      const { ctx } = makeCtx();
      await commands.get("goal")!.handler("重构 X 模块", ctx);
      await tools.get("goal_sleep")!.execute("id", { seconds: 60 }, undefined, undefined, ctx);
      handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);

      vi.advanceTimersByTime(120_000);

      expect(sent).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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
