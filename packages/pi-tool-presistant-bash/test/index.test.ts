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
