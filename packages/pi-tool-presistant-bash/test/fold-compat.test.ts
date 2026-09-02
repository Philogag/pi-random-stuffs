// test/fold-compat.test.ts
import { describe, expect, it, vi } from "vitest";
import type { FoldBlocksConfig } from "@philogag/pi-tui-fold-blocks";
import { renderOwnedBlock, foldCommand } from "@philogag/pi-tui-fold-blocks";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  formatTimeoutMs,
  execOutputLineCount,
  execStatus,
  buildExecFoldLine,
  buildExecFoldRenderers,
  attachExecFoldCompat,
  type ExecFoldRenderers,
} from "../src/fold-compat.js";
import type { ExecResult } from "../src/session.js";

/** 去掉 ANSI SGR 与 OSC 链接标记(pi-tui compositeTuiLine 的 SEGMENT_RESET)。 */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

/** 无 ANSI 的主题 stub。 */
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

interface CtxLike {
  args: unknown;
  toolCallId: string;
  invalidate: () => void;
  isPartial: boolean;
  isError: boolean;
  cwd: string;
}

function renderCtx(args: unknown, partial: Partial<CtxLike> = {}): CtxLike {
  return {
    args,
    toolCallId: "tc-1",
    invalidate: () => {},
    cwd: "/home/u/p",
    isPartial: false,
    isError: false,
    ...partial,
  };
}

/** 与 fold-blocks DEFAULT_CONFIG 等值的测试配置(DEFAULT_CONFIG 未导出)。 */
function cfg(over: Partial<FoldBlocksConfig> = {}): FoldBlocksConfig {
  return {
    mode: "fold",
    nerdFont: true,
    fileBlocks: { collapse: true, pathStyle: "relative", foldGitWorktree: true },
    bashBlocks: { collapse: true, smart: true, showStatus: true },
    ...over,
  };
}

function makeCtx(args: unknown): Record<string, unknown> {
  return {
    args,
    toolCallId: "t1",
    invalidate: () => {},
    lastComponent: undefined,
    state: undefined,
    cwd: "/home/u/p",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
  };
}

const details = (over: Partial<ExecResult>): ExecResult => ({
  output: "",
  exitCode: 0,
  cancelled: false,
  ...over,
});

describe("formatTimeoutMs", () => {
  it("undefined → 空串", () => {
    expect(formatTimeoutMs(undefined)).toBe("");
  });
  it("15000 → '15s'(整数秒去掉 .0)", () => {
    expect(formatTimeoutMs(15000)).toBe("15s");
  });
  it("7500 → '7.5s'", () => {
    expect(formatTimeoutMs(7500)).toBe("7.5s");
  });
});

describe("execOutputLineCount", () => {
  it("空输出 → 0", () => {
    expect(execOutputLineCount("")).toBe(0);
  });
  it("a\\nb → 2", () => {
    expect(execOutputLineCount("a\nb")).toBe(2);
  });
  it("a\\n\\nb\\n → 3(末尾换行不计,空行计入)", () => {
    expect(execOutputLineCount("a\n\nb\n")).toBe(3);
  });
});

describe("execStatus", () => {
  it("exitCode 0 → {error:false, code:undefined}", () => {
    expect(execStatus(details({ exitCode: 0 }))).toEqual({ error: false, code: undefined });
  });
  it("exitCode 7 → {error:true, code:7}", () => {
    expect(execStatus(details({ exitCode: 7 }))).toEqual({ error: true, code: 7 });
  });
  it("cancelled → {error:true, code:undefined}(无退出码)", () => {
    expect(execStatus(details({ exitCode: undefined, cancelled: true }))).toEqual({
      error: true,
      code: undefined,
    });
    expect(execStatus(details({ exitCode: 0, cancelled: true }))).toEqual({
      error: true,
      code: undefined,
    });
  });
  it("exitCode undefined + 未取消 → {error:true, code:undefined}", () => {
    expect(execStatus(details({ exitCode: undefined, cancelled: false }))).toEqual({
      error: true,
      code: undefined,
    });
  });
  it("details 缺失 → {error:true, code:undefined}", () => {
    expect(execStatus(undefined)).toEqual({ error: true, code: undefined });
    expect(execStatus(null)).toEqual({ error: true, code: undefined });
  });
});

interface RenderFixture {
  renderers: ExecFoldRenderers;
  setConfig: (next: FoldBlocksConfig) => void;
}

/** 用真实 fold-blocks 渲染件 + 可变 live config 构造 renderer(2.3 三态分派)。 */
function makeRenderers(): RenderFixture {
  let current = cfg();
  return {
    renderers: buildExecFoldRenderers({
      getConfig: () => current,
      subscribeConfig: () => () => {},
      renderOwnedBlock,
      foldCommand,
    }),
    setConfig(next: FoldBlocksConfig) {
      current = next;
    },
  };
}

function renderLines(component: { render(width: number): string[] }, width = 80): string {
  return component.render(width).map(stripAnsi).join("\n");
}

function makePi() {
  const registered: unknown[] = [];
  return {
    registerTool(tool: unknown) {
      registered.push(tool);
    },
    registered,
  };
}

function makeExecTool() {
  const execute = vi.fn(async () => ({ content: [], details: { output: "", exitCode: 0, cancelled: false } }));
  const tool = {
    name: "presistant-bash-exec",
    label: "Run command in persistent bash session",
    description: "d",
    parameters: {},
    execute,
  };
  return { tool, execute };
}

interface FakeCompat {
  compat: {
    isFoldBlocksActive: () => boolean;
    subscribeFoldBlocksActive: (cb: () => void) => () => void;
    getFoldConfig: () => FoldBlocksConfig;
    subscribeFoldConfig: (cb: (cfg: FoldBlocksConfig) => void) => () => void;
    renderOwnedBlock: ReturnType<typeof vi.fn>;
    foldCommand: (command: string) => string;
  };
  activate: () => void;
  fireConfig: (cfg: FoldBlocksConfig) => void;
  configSubscribers: Array<(cfg: FoldBlocksConfig) => void>;
}

function makeFakeCompat(): FakeCompat {
  let active = false;
  const activeWaiters: Array<() => void> = [];
  const configSubscribers: Array<(cfg: FoldBlocksConfig) => void> = [];
  const compat = {
    isFoldBlocksActive: () => active,
    subscribeFoldBlocksActive: (cb: () => void) => {
      if (active) {
        cb();
        return () => {};
      }
      activeWaiters.push(cb);
      return () => {};
    },
    getFoldConfig: () => cfg(),
    subscribeFoldConfig: (cb: (next: FoldBlocksConfig) => void) => {
      configSubscribers.push(cb);
      return () => {
        const i = configSubscribers.indexOf(cb);
        if (i >= 0) configSubscribers.splice(i, 1);
      };
    },
    renderOwnedBlock: vi.fn(() => ({ invalidate: () => {}, render: () => [] as string[] })),
    foldCommand: (command: string) => command,
  };
  return {
    compat,
    activate() {
      active = true;
      activeWaiters.splice(0).forEach((cb) => cb());
    },
    fireConfig(next: FoldBlocksConfig) {
      configSubscribers.forEach((cb) => cb(next));
    },
    configSubscribers,
  };
}

describe("attachExecFoldCompat — 装配与回退契约", () => {
  it("loader 返回 null → 不 registerTool、不抛错", async () => {
    const pi = makePi();
    const { tool } = makeExecTool();
    const loadCompat = vi.fn(async () => null);
    await expect(attachExecFoldCompat(pi as never, [tool] as never, { loadCompat })).resolves.toBeDefined();
    expect(pi.registered).toHaveLength(0);
    expect(loadCompat).toHaveBeenCalledTimes(1);
  });

  it("loader reject(import 失败)→ 不 registerTool、不抛错、无噪音", async () => {
    const pi = makePi();
    const { tool } = makeExecTool();
    const loadCompat = vi.fn(async () => {
      throw new Error("module not found");
    });
    await expect(attachExecFoldCompat(pi as never, [tool] as never, { loadCompat })).resolves.toBeDefined();
    expect(pi.registered).toHaveLength(0);
  });

  it("loader 返回非空但 exec 工具不在 tools → 不注册", async () => {
    const pi = makePi();
    const fake = makeFakeCompat();
    const loadCompat = vi.fn(async () => fake.compat);
    await attachExecFoldCompat(pi as never, [{ name: "other", execute: vi.fn() }] as never, { loadCompat });
    expect(pi.registered).toHaveLength(0);
  });

  it("未激活 → 不注册;激活回调后注册一次,execute 同一引用,renderShell=self", async () => {
    const pi = makePi();
    const { tool, execute } = makeExecTool();
    const fake = makeFakeCompat();
    const loadCompat = vi.fn(async () => fake.compat);
    await attachExecFoldCompat(pi as never, [tool] as never, { loadCompat });
    expect(pi.registered).toHaveLength(0);

    fake.activate();
    expect(pi.registered).toHaveLength(1);
    const def = pi.registered[0] as {
      name: string;
      execute: typeof execute;
      renderShell?: string;
      renderCall?: unknown;
      renderResult?: unknown;
    };
    expect(def.name).toBe("presistant-bash-exec");
    expect(def.execute).toBe(execute); // 同一闭包引用,行为不变
    expect(def.renderShell).toBe("self");
    expect(typeof def.renderCall).toBe("function");
    expect(typeof def.renderResult).toBe("function");

    // 重复激活不二次装配(订阅一次性)
    fake.activate();
    expect(pi.registered).toHaveLength(1);
  });

  it("config 订阅触发已登记 invalidator(即时模式切换)", async () => {
    const pi = makePi();
    const { tool } = makeExecTool();
    const fake = makeFakeCompat();
    const loadCompat = vi.fn(async () => fake.compat);
    await attachExecFoldCompat(pi as never, [tool] as never, { loadCompat });
    fake.activate();
    expect(fake.configSubscribers).toHaveLength(1);

    const def = pi.registered[0] as {
      renderCall: (args: unknown, theme: unknown, ctx: Record<string, unknown>) => unknown;
      renderResult: (...args: unknown[]) => unknown;
    };
    const invalidate1 = vi.fn();
    def.renderCall({}, {}, {
      args: { command: "ls" },
      toolCallId: "tc-1",
      invalidate: invalidate1,
      isPartial: true,
      isError: false,
      cwd: "/",
    });
    const invalidate2 = vi.fn();
    def.renderResult(
      { content: [], details: { output: "x", exitCode: 0, cancelled: false } },
      { expanded: false, isPartial: false },
      {},
      { args: { command: "ls" }, toolCallId: "tc-2", invalidate: invalidate2, isPartial: false, isError: false, cwd: "/" },
    );
    expect(invalidate1).not.toHaveBeenCalled();
    expect(invalidate2).not.toHaveBeenCalled();

    fake.fireConfig(cfg({ mode: "hide" }));
    expect(invalidate1).toHaveBeenCalledTimes(1);
    expect(invalidate2).toHaveBeenCalledTimes(1);
  });

  it("disposed 取消 config 订阅后不再触发 invalidator", async () => {
    const pi = makePi();
    const { tool } = makeExecTool();
    const fake = makeFakeCompat();
    const loadCompat = vi.fn(async () => fake.compat);
    const handle = await attachExecFoldCompat(pi as never, [tool] as never, { loadCompat });
    fake.activate();
    const def = pi.registered[0] as {
      renderResult: (...args: unknown[]) => unknown;
    };
    const invalidate = vi.fn();
    def.renderResult(
      { content: [], details: { output: "x", exitCode: 0, cancelled: false } },
      { expanded: false, isPartial: false },
      {},
      { args: { command: "ls" }, toolCallId: "tc-x", invalidate, isPartial: false, isError: false, cwd: "/" },
    );
    handle.disposed();
    fake.fireConfig(cfg({ mode: "hide" }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("buildExecFoldRenderers — 三态分派", () => {
  it("renderShell 恒为 self", () => {
    expect(makeRenderers().renderers.renderShell).toBe("self");
  });

  it("fold + 成功两行输出 → 恰一行可见,含 'exec - <cmd>'、行数与 SUCCESS", () => {
    const { renderers } = makeRenderers();
    const ctx = renderCtx({ sessionId: "s1", command: "git status" });
    const comp = renderers.renderResult(
      {
        content: [{ type: "text", text: "a\nb\n[exit code: 0]" }],
        details: { output: "a\nb", exitCode: 0, cancelled: false },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    const lines = comp.render(80).map(stripAnsi).map((l) => l.trim());
    // BgPaddedBox padY=1 → 3 行(上下留白 + 内容行);折叠行恰为单行内容。
    const contentLines = lines.filter((l) => l.length > 0);
    expect(contentLines).toHaveLength(1);
    expect(contentLines[0]).toContain("exec - git status");
    expect(contentLines[0]).toContain("2 lines");
    expect(contentLines[0]).toContain("SUCCESS");
  });

  it("fold + exit 3 → 单行含 FAILED(3) 且 tips 含 exit 3", () => {
    const { renderers } = makeRenderers();
    const ctx = renderCtx({ sessionId: "s1", command: "make" });
    const comp = renderers.renderResult(
      {
        content: [{ type: "text", text: "boom\n[exit code: 3]" }],
        details: { output: "boom", exitCode: 3, cancelled: false },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    const line = renderLines(comp).trim();
    expect(line).toContain("FAILED(3)");
    expect(line).toContain("exit 3");
  });

  it("fold + cancelled → FAILED 无退出码", () => {
    const { renderers } = makeRenderers();
    const ctx = renderCtx({ sessionId: "s1", command: "sleep 100" });
    const comp = renderers.renderResult(
      {
        content: [{ type: "text", text: "partial\n(command cancelled)" }],
        details: { output: "partial", exitCode: undefined, cancelled: true },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    const line = renderLines(comp).trim();
    expect(line).toContain("FAILED");
    expect(line).not.toMatch(/FAILED\(\d+\)/);
  });

  it("fold + 成功空输出 → 不出现 '[ 0 lines' 片段", () => {
    const { renderers } = makeRenderers();
    const ctx = renderCtx({ sessionId: "s1", command: "true" });
    const comp = renderers.renderResult(
      {
        content: [{ type: "text", text: "\n[exit code: 0]" }],
        details: { output: "", exitCode: 0, cancelled: false },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    const joined = renderLines(comp);
    expect(joined).not.toContain("0 lines");
    expect(joined).toContain("SUCCESS");
  });

  it("fold + call 阶段(isPartial)→ 单行折叠命令预览,无 tips/result", () => {
    const { renderers } = makeRenderers();
    const ctx = renderCtx({ sessionId: "s1", command: "cd /tmp && ls -la" }, { isPartial: true });
    const comp = renderers.renderCall(ctx.args, theme, ctx as never);
    const contentLines = comp.render(80).map(stripAnsi).map((l) => l.trim()).filter(Boolean);
    expect(contentLines).toHaveLength(1);
    expect(contentLines[0]).toContain("exec - ls -la");
    expect(contentLines[0]).not.toContain("cd /tmp");
    expect(contentLines[0]).not.toContain("SUCCESS");
  });

  it("hide → render(width) 返回空(整块消失)", () => {
    const { renderers, setConfig } = makeRenderers();
    setConfig(cfg({ mode: "hide" }));
    const ctx = renderCtx({ sessionId: "s1", command: "ls" });
    const resultComp = renderers.renderResult(
      {
        content: [{ type: "text", text: "a\n[exit code: 0]" }],
        details: { output: "a", exitCode: 0, cancelled: false },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    expect(resultComp.render(80)).toHaveLength(0);
    const callComp = renderers.renderCall(ctx.args, theme, { ...ctx, isPartial: true } as never);
    expect(callComp.render(80)).toHaveLength(0);
  });

  it("native call 槽 → 含工具名标题文本", () => {
    const { renderers, setConfig } = makeRenderers();
    setConfig(cfg({ mode: "native" }));
    const ctx = renderCtx({ sessionId: "s1", command: "ls" }, { isPartial: true });
    const comp = renderers.renderCall(ctx.args, theme, ctx as never);
    expect(renderLines(comp)).toContain("presistant-bash-exec");
  });

  it("native result → 前 10 行预览;11+ 行输出含 '... (2 more lines'", () => {
    const { renderers, setConfig } = makeRenderers();
    setConfig(cfg({ mode: "native" }));
    const lines = Array.from({ length: 12 }, (_, i) => `line-${i + 1}`);
    const ctx = renderCtx({ sessionId: "s1", command: "ls" });
    const comp = renderers.renderResult(
      {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { output: lines.join("\n"), exitCode: 0, cancelled: false },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    const rendered = renderLines(comp);
    expect(rendered).toContain("line-1");
    expect(rendered).toContain("... (2 more lines");
    expect(rendered).not.toContain("line-11");
  });

  it("native result + expanded → 全量输出,无溢出提示", () => {
    const { renderers, setConfig } = makeRenderers();
    setConfig(cfg({ mode: "native" }));
    const lines = Array.from({ length: 12 }, (_, i) => `line-${i + 1}`);
    const ctx = renderCtx({ sessionId: "s1", command: "ls" });
    const comp = renderers.renderResult(
      {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { output: lines.join("\n"), exitCode: 0, cancelled: false },
      },
      { expanded: true, isPartial: false },
      theme,
      ctx as never,
    );
    const rendered = renderLines(comp);
    expect(rendered).toContain("line-1");
    expect(rendered).toContain("line-12");
    expect(rendered).not.toContain("more lines");
  });

  it("renderer 每次渲染都读 live config(模式切换对新渲染即时生效)", () => {
    const { renderers, setConfig } = makeRenderers();
    const ctx = renderCtx({ sessionId: "s1", command: "ls" });
    const result = {
      content: [{ type: "text", text: "a\n[exit code: 0]" }],
      details: { output: "a", exitCode: 0, cancelled: false },
    };
    expect(
      renderLines(renderers.renderResult(result, { expanded: false, isPartial: false }, theme, ctx as never)),
    ).toContain("exec - ls");
    setConfig(cfg({ mode: "hide" }));
    expect(
      renderers.renderResult(result, { expanded: false, isPartial: false }, theme, ctx as never).render(80),
    ).toHaveLength(0);
    setConfig(cfg({ mode: "native" }));
    expect(
      renderLines(renderers.renderResult(result, { expanded: false, isPartial: false }, theme, ctx as never)),
    ).toContain("a");
  });

  it("renderCall/renderResult 按 toolCallId 登记 invalidator", () => {
    const registerInvalidator = vi.fn();
    const renderers = buildExecFoldRenderers(
      {
        getConfig: () => cfg(),
        subscribeConfig: () => () => {},
        renderOwnedBlock,
        foldCommand,
      },
      { registerInvalidator },
    );
    const invalidate1 = vi.fn();
    const ctx1 = renderCtx({ sessionId: "s1", command: "ls" }, {
      toolCallId: "call-1",
      invalidate: invalidate1,
      isPartial: true,
    });
    renderers.renderCall(ctx1.args, theme, ctx1 as never);
    expect(registerInvalidator).toHaveBeenCalledWith("call-1", invalidate1);
    const invalidate2 = vi.fn();
    const ctx2 = renderCtx({ sessionId: "s1", command: "ls" }, {
      toolCallId: "result-1",
      invalidate: invalidate2,
    });
    renderers.renderResult(
      { content: [{ type: "text", text: "a\n[exit code: 0]" }], details: { output: "a", exitCode: 0, cancelled: false } },
      { expanded: false, isPartial: false },
      theme,
      ctx2 as never,
    );
    expect(registerInvalidator).toHaveBeenCalledWith("result-1", invalidate2);
  });
});

describe("buildExecFoldLine — 纯函数行文本", () => {
  it("call 阶段:智能折叠命令,tips/result 为空,nerdFont 开启时带 bash 图标", () => {
    const line = buildExecFoldLine(
      makeCtx({ sessionId: "s1", command: "cd /tmp && ls -la" }) as never,
      { stage: "call", config: cfg() },
    );
    expect(line.tool).toBe("exec");
    expect(line.icon).toBe("\uf489");
    expect(line.shown).toBe("ls -la");
    expect(line.shown).not.toContain("cd /tmp");
    expect(line.tips).toBe("");
    expect(line.result).toBe("");
  });
  it("plain 'git status' 不被折叠", () => {
    const line = buildExecFoldLine(makeCtx({ command: "git status" }) as never, {
      stage: "result",
      config: cfg(),
      result: { content: [], details: details({ output: "clean", exitCode: 0 }) },
    });
    expect(line.shown).toBe("git status");
  });
  it("nerdFont 关闭 → 无图标", () => {
    const line = buildExecFoldLine(makeCtx({ command: "ls" }) as never, {
      stage: "call",
      config: cfg({ nerdFont: false }),
    });
    expect(line.icon).toBe("");
  });
  it("失败 + 超时 + 多行输出 → tips 段序 [ 15s, 2 lines, exit 7 ],result FAILED(7)", () => {
    const line = buildExecFoldLine(
      makeCtx({ sessionId: "s1", command: "make", timeoutMs: 15000 }) as never,
      {
        stage: "result",
        config: cfg(),
        result: {
          content: [{ type: "text", text: "boom\nfail\n[exit code: 7]" }],
          details: details({ output: "boom\nfail", exitCode: 7 }),
        },
      },
    );
    expect(line.shown).toBe("make");
    expect(line.tips).toBe("[ 15s, 2 lines, exit 7 ]");
    expect(line.result).toBe("FAILED(7)");
  });
  it("取消 → FAILED 无退出码,tips 不含 exit", () => {
    const line = buildExecFoldLine(makeCtx({ command: "sleep 100" }) as never, {
      stage: "result",
      config: cfg(),
      result: {
        content: [{ type: "text", text: "partial\n(command cancelled)" }],
        details: details({ output: "partial", exitCode: undefined, cancelled: true }),
      },
    });
    expect(line.result).toBe("FAILED");
    expect(line.tips).not.toContain("exit");
    expect(line.tips).toBe("[ 1 lines ]");
  });
  it("成功 + 空输出 → SUCCESS,tips 为空(不显示 [ 0 lines ])", () => {
    const line = buildExecFoldLine(makeCtx({ command: "true" }) as never, {
      stage: "result",
      config: cfg(),
      result: {
        content: [{ type: "text", text: "\n[exit code: 0]" }],
        details: details({ output: "", exitCode: 0 }),
      },
    });
    expect(line.result).toBe("SUCCESS");
    expect(line.tips).toBe("");
    expect(line.tips).not.toContain("0 lines");
  });
  it("成功 + 两行输出 → SUCCESS 且 tips [ 2 lines ],行数不含 doneText 标记行", () => {
    const line = buildExecFoldLine(makeCtx({ command: "ls" }) as never, {
      stage: "result",
      config: cfg(),
      result: {
        content: [{ type: "text", text: "a\nb\n[exit code: 0]" }],
        details: details({ output: "a\nb", exitCode: 0 }),
      },
    });
    expect(line.result).toBe("SUCCESS");
    expect(line.tips).toBe("[ 2 lines ]");
  });
  it("details 缺失 → 从 content 文本回退解析 exit code(兼容 presistant 自带 '[exit code: N]' 格式)", () => {
    const line = buildExecFoldLine(makeCtx({ command: "make" }) as never, {
      stage: "result",
      config: cfg(),
      result: { content: [{ type: "text", text: "boom\n[exit code: 3]" }] },
    });
    expect(line.result).toBe("FAILED(3)");
    expect(line.tips).toContain("exit 3");
  });
});
