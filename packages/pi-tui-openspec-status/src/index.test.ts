import { describe, expect, it } from "vitest";
import piTuiOpenspecStatus from "./index.js";

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
  };
}

describe("piTuiOpenspecStatus — TUI-mode gate", () => {
  it("registers handlers when ctx.mode === 'tui'", () => {
    const pi = makePi();
    const ctx = {
      mode: "tui" as const,
      hasUI: true,
      cwd: "/repo",
      ui: { setStatus: () => {} },
    };
    piTuiOpenspecStatus(pi as never, ctx);
    expect(pi.listenerCount("session_start")).toBe(1);
    expect(pi.listenerCount("tool_call")).toBe(1);
    expect(pi.listenerCount("tool_result")).toBe(1);
  });

  it.each(["print", "json", "rpc"] as const)(
    "registers NO handlers when ctx.mode === '%s' (even if hasUI=true)",
    (mode) => {
      const pi = makePi();
      const ctx = {
        mode,
        hasUI: true, // rpc sets hasUI=true; we still must not activate
        cwd: "/repo",
        ui: { setStatus: () => {} },
      };
      piTuiOpenspecStatus(pi as never, ctx);
      expect(pi.listenerCount("session_start")).toBe(0);
      expect(pi.listenerCount("tool_call")).toBe(0);
      expect(pi.listenerCount("tool_result")).toBe(0);
    },
  );

  it("does not touch ctx.ui.setStatus in non-tui modes", () => {
    const pi = makePi();
    const calls: unknown[] = [];
    const ctx = {
      mode: "print" as const,
      hasUI: false,
      cwd: "/repo",
      ui: { setStatus: (...a: unknown[]) => calls.push(a) },
    };
    piTuiOpenspecStatus(pi as never, ctx);
    // No listener can fire because none registered.
    pi.fire("session_start");
    pi.fire("tool_call", { input: { type: "bash", command: "openspec status --change foo --json" } });
    pi.fire("tool_result", {});
    expect(calls).toEqual([]);
  });

  it("is defensive when pi loads via -e and ctx is undefined", () => {
    const pi = makePi();
    // Must NOT throw "Cannot read properties of undefined (reading 'mode')".
    expect(() => piTuiOpenspecStatus(pi as never, undefined)).not.toThrow();
    expect(pi.listenerCount("session_start")).toBe(0);
    expect(pi.listenerCount("tool_call")).toBe(0);
    expect(pi.listenerCount("tool_result")).toBe(0);
  });
});