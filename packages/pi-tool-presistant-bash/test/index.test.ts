// test/index.test.ts
import { describe, expect, it, vi } from "vitest";

// Stub the session module so index tests never spawn real processes.
vi.mock("../src/session.js", () => ({
  SessionRegistry: vi.fn(),
}));

// Stub the container module so create-container never shells out.
vi.mock("../src/container.js", () => ({
  createContainerSession: vi.fn(),
  detectRuntime: vi.fn(() => "docker"),
  DEFAULT_SHELL: "bash",
}));

import piToolPresistantBash, { createTools } from "../src/index.js";
import { attachExecFoldCompat } from "../src/fold-compat.js";
import { createContainerSession } from "../src/container.js";

const mockedCreateContainer = vi.mocked(createContainerSession);

type Handler = (event: unknown, ctx: unknown) => unknown;

function makePi() {
  const listeners: Record<string, Handler[]> = {};
  const tools: unknown[] = [];
  return {
    on(event: string, h: Handler) {
      (listeners[event] ??= []).push(h);
    },
    fire(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((h) => h(...args));
    },
    listenerCount(event: string) {
      return (listeners[event] ?? []).length;
    },
    registerTool(tool: unknown) {
      tools.push(tool);
    },
    tools,
    listeners,
  };
}

interface FakeRegistry {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  destroyAll: ReturnType<typeof vi.fn>;
}

function makeRegistry(): FakeRegistry {
  return {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    destroy: vi.fn(),
    destroyAll: vi.fn(),
  };
}

describe("pi-tool-presistant-bash — extension entry", () => {
  it("registers four tools + a session_shutdown cleanup handler", () => {
    const pi = makePi();
    piToolPresistantBash(pi as never);
    expect(pi.tools).toHaveLength(5);
    const names = (pi.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([
      "presistant-bash-create",
      "presistant-bash-create-container",
      "presistant-bash-exec",
      "presistant-bash-list",
      "presistant-bash-destroy",
    ]);
    expect(pi.listenerCount("session_shutdown")).toBe(1);
  });

  it("kills all sessions on session_shutdown", () => {
    const pi = makePi();
    const registry = makeRegistry();
    piToolPresistantBash(pi as never, { registry });
    pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, {});
    expect(registry.destroyAll).toHaveBeenCalledTimes(1);
  });

  it("默认路径(真 attach + stub loader 返回 null)→ 仍注册全部工具且不抛错", async () => {
    const pi = makePi();
    const attachSpy = vi.fn((p: unknown, ts: unknown) =>
      attachExecFoldCompat(p as never, ts as never, { loadCompat: async () => null }),
    );
    expect(() =>
      piToolPresistantBash(pi as never, { attachExecFoldCompat: attachSpy as never }),
    ).not.toThrow();
    expect(attachSpy).toHaveBeenCalledTimes(1);
    const names = (pi.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([
      "presistant-bash-create",
      "presistant-bash-create-container",
      "presistant-bash-exec",
      "presistant-bash-list",
      "presistant-bash-destroy",
    ]);
    // loader 返回 null → 装配不注册任何额外定义(回退契约)。
    expect(pi.tools).toHaveLength(5);
  });

  it("注入的 attach 拿到 createTools 输出;重建定义 execute 与原 exec execute 同一引用", () => {
    const pi = makePi();
    const registry = makeRegistry();
    let originalExecExecute: unknown;
    const attachSpy = vi.fn(async (p: unknown, ts: { name: string; execute: unknown }[]) => {
      const execTool = ts.find((t) => t.name === "presistant-bash-exec");
      expect(execTool).toBeDefined();
      originalExecExecute = execTool!.execute;
      (p as { registerTool(t: unknown): void }).registerTool({
        ...execTool,
        renderShell: "self",
        renderCall: () => ({ invalidate: () => {}, render: () => [] as string[] }),
        renderResult: () => ({ invalidate: () => {}, render: () => [] as string[] }),
      });
      return { disposed: () => {} };
    });
    piToolPresistantBash(pi as never, { registry, attachExecFoldCompat: attachSpy as never });
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(pi.tools).toHaveLength(6); // 5 原始 + 1 折叠重建
    const folded = pi.tools[5] as {
      name: string;
      renderShell?: string;
      execute: unknown;
      renderCall: unknown;
      renderResult: unknown;
    };
    expect(folded.name).toBe("presistant-bash-exec");
    expect(folded.renderShell).toBe("self");
    expect(typeof folded.renderCall).toBe("function");
    expect(typeof folded.renderResult).toBe("function");
    expect(folded.execute).toBe(originalExecExecute); // 同引用 → 行为不变
  });

  it("accepts an injected registry", async () => {
    const pi = makePi();
    const registry = makeRegistry();
    registry.create.mockReturnValue({
      id: "sess-x",
      command: "bash",
      cwd: "/",
      createdAt: 0,
      alive: true,
    });
    piToolPresistantBash(pi as never, { registry });
    const create = (pi.tools[0] as { execute: Function }).execute;
    await create("id", { label: "x" }, undefined, undefined, {});
    expect(registry.create).toHaveBeenCalledWith({ label: "x" });
  });
});

describe("createTools — tool behavior", () => {
  it("presistant-bash-create returns the session id", async () => {
    const registry = makeRegistry();
    registry.create.mockReturnValue({
      id: "sess-1",
      label: "docker",
      command: "docker exec -it c bash",
      cwd: "/",
      createdAt: 0,
      alive: true,
    });
    const [create] = createTools(registry);
    const result = await create.execute("tc1", { command: ["docker", "exec", "-it", "c", "bash"], label: "docker" });
    expect(registry.create).toHaveBeenCalledWith({
      command: ["docker", "exec", "-it", "c", "bash"],
      label: "docker",
    });
    expect(result.details).toMatchObject({ id: "sess-1" });
    expect((result.content[0] as { text: string }).text).toContain("sess-1");
  });

  it("presistant-bash-create-container delegates to createContainerSession", async () => {
    const registry = makeRegistry();
    mockedCreateContainer.mockReturnValue({
      containerId: "abc12345def6789abcdef",
      containerShortId: "abc12345def",
      session: { id: "sess-c", command: "docker exec -i abc12345def bash", cwd: "/", createdAt: 0, alive: true },
    });
    const tools = createTools(registry);
    const tool = tools.find((t) => t.name === "presistant-bash-create-container")!;
    const result = await tool.execute("tc1", {
      image: "node:22",
      runtime: "docker",
      args: ["-v", "/host:/ct"],
      shell: "bash",
    });
    expect(mockedCreateContainer).toHaveBeenCalledWith(registry, {
      image: "node:22",
      runtime: "docker",
      args: ["-v", "/host:/ct"],
      shell: "bash",
    });
    expect(result.details).toMatchObject({ containerShortId: "abc12345def" });
    expect((result.content[0] as { text: string }).text).toContain("abc12345def");
    expect((result.content[0] as { text: string }).text).toContain("sess-c");
  });

  it("presistant-bash-exec runs a command in the session", async () => {
    const registry = makeRegistry();
    const session = { exec: vi.fn().mockResolvedValue({ output: "hi\n", exitCode: 0, cancelled: false }) };
    registry.get.mockReturnValue(session);
    const tools = createTools(registry);
    const execTool = tools.find((t) => t.name === "presistant-bash-exec")!;
    const result = await execTool.execute("tc2", { sessionId: "s1", command: "echo hi" });
    expect(registry.get).toHaveBeenCalledWith("s1");
    expect(session.exec).toHaveBeenCalledWith("echo hi", expect.objectContaining({}));
    expect((result.content[0] as { text: string }).text).toContain("hi");
  });

  it("presistant-bash-exec rejects for unknown session", async () => {
    const registry = makeRegistry();
    registry.get.mockReturnValue(undefined);
    const tools = createTools(registry);
    const execTool = tools.find((t) => t.name === "presistant-bash-exec")!;
    await expect(execTool.execute("tc3", { sessionId: "nope", command: "echo hi" })).rejects.toThrow(/no such session/);
  });

  it("presistant-bash-list returns active sessions", async () => {
    const registry = makeRegistry();
    registry.list.mockReturnValue([
      { id: "s1", command: "bash", cwd: "/", createdAt: 0, alive: true },
    ]);
    const tools = createTools(registry);
    const listTool = tools.find((t) => t.name === "presistant-bash-list")!;
    const result = await listTool.execute("tc4", {});
    expect((result.content[0] as { text: string }).text).toContain("s1");
  });

  it("presistant-bash-destroy destroys the session", async () => {
    const registry = makeRegistry();
    registry.destroy.mockReturnValue({ destroyed: true });
    const tools = createTools(registry);
    const destroyTool = tools.find((t) => t.name === "presistant-bash-destroy")!;
    const result = await destroyTool.execute("tc5", { sessionId: "s1" });
    expect(registry.destroy).toHaveBeenCalledWith("s1");
    expect((result.content[0] as { text: string }).text).toContain("Destroyed");
  });
});
