import { describe, expect, it } from "vitest";
import piTuiOpenspecStatus from "../src/index.js";

function makePi() {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  const commands: string[] = [];
  return {
    on(event: string, h: (...a: unknown[]) => void) {
      (listeners[event] ??= []).push(h);
    },
    fire(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((h) => h(...args));
    },
    listenerCount(event: string) {
      return (listeners[event] ?? []).length;
    },
    registerCommand(name: string, _opts: unknown) {
      commands.push(name);
    },
    commands,
  };
}

describe("piTuiOpenspecStatus — extension entry registration", () => {
  it("registers handlers + command unconditionally (factory receives only pi)", () => {
    const pi = makePi();
    // Docs contract: the factory gets ONLY ExtensionAPI — no ctx at
    // load time. Handlers are registered up front; the TUI gate runs
    // inside session_start, the first event that carries ctx.
    piTuiOpenspecStatus(pi as never);
    expect(pi.listenerCount("session_start")).toBe(1);
    expect(pi.listenerCount("tool_call")).toBe(1);
    expect(pi.listenerCount("tool_result")).toBe(1);
    expect(pi.commands).toEqual(["tui-openspec-select"]);
  });

  it("is defensive when loaded with no ctx at all (pi -e) — does not throw", () => {
    const pi = makePi();
    expect(() => piTuiOpenspecStatus(pi as never, undefined)).not.toThrow();
  });

  it("publishes setStatus(undefined) only after a tui session_start", () => {
    const pi = makePi();
    const calls: unknown[] = [];
    const ctx = {
      mode: "tui" as const,
      hasUI: true,
      cwd: "/repo",
      ui: { setStatus: (...a: unknown[]) => calls.push(a) },
    };
    piTuiOpenspecStatus(pi as never);
    // tool events before any tui session_start are no-ops (no render).
    pi.fire("tool_call", { toolName: "bash", input: { command: "openspec status --change foo --json" } });
    pi.fire("tool_result", {});
    expect(calls).toEqual([]);
    pi.fire("session_start", {}, ctx);
    expect(calls).toEqual([["pi-tui-openspec-status", undefined]]);
  });

  it.each(["print", "json", "rpc"] as const)(
    "does nothing in non-tui modes (session_start with mode '%s')",
    (mode) => {
      const pi = makePi();
      const calls: unknown[] = [];
      const ctx = {
        mode,
        hasUI: mode === "rpc", // rpc sets hasUI=true; still must not activate
        cwd: "/repo",
        ui: { setStatus: (...a: unknown[]) => calls.push(a) },
      };
      piTuiOpenspecStatus(pi as never);
      pi.fire("session_start", {}, ctx);
      pi.fire("tool_call", { toolName: "bash", input: { command: "openspec status --change foo --json" } });
      pi.fire("tool_result", {});
      expect(calls).toEqual([]);
    },
  );

  it("session_start with no ctx (undefined) does not throw and publishes nothing", () => {
    const pi = makePi();
    const calls: unknown[] = [];
    piTuiOpenspecStatus(pi as never);
    pi.fire("session_start", {}, undefined);
    expect(calls).toEqual([]);
  });
});
