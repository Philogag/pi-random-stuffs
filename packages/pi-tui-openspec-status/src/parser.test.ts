// src/parser.test.ts
import { describe, expect, it } from "vitest";
import { extractChangeName, isLockingSubcommand, parseBashCommand } from "./parser.js";

describe("isLockingSubcommand", () => {
  it.each([
    "new", "status", "apply", "archive", "verify",
    "sync", "instructions", "show", "validate", "context", "view",
  ])("returns true for %s", (sub) => {
    expect(isLockingSubcommand(sub)).toBe(true);
  });

  it.each(["list", "doctor", "schemas", "init", "help"])(
    "returns false for %s",
    (sub) => {
      expect(isLockingSubcommand(sub)).toBe(false);
    },
  );

  it("is case-sensitive and rejects uppercase", () => {
    expect(isLockingSubcommand("STATUS")).toBe(false);
  });
});

describe("extractChangeName", () => {
  it("prefers --change flag", () => {
    expect(
      extractChangeName(["status", "--change", "add-foo", "--json"]),
    ).toBe("add-foo");
  });

  it("falls back to first non-flag positional", () => {
    expect(extractChangeName(["show", "add-bar"])).toBe("add-bar");
  });

  it("returns undefined when no change can be found", () => {
    expect(extractChangeName(["status", "--json"])).toBeUndefined();
  });

  it("ignores unknown flags as positional fallback when --change missing", () => {
    expect(extractChangeName(["show", "baz", "--json"])).toBe("baz");
  });
});

describe("parseBashCommand - non-openspec", () => {
  it("returns null for ls / pnpm / unrelated", () => {
    expect(parseBashCommand("ls -la")).toBeNull();
    expect(parseBashCommand("pnpm test")).toBeNull();
  });
});

describe("parseBashCommand - cd rewrite", () => {
  it("extracts effective cwd from 'cd X && ...'", () => {
    const r = parseBashCommand(
      "cd .worktrees/feat/x && openspec status --change foo --json",
    );
    expect(r?.effectiveCwd).toBe(".worktrees/feat/x");
    expect(r?.isWorktree).toBe(true);
    expect(r?.subcommand).toBe("status");
    expect(r?.changeName).toBe("foo");
    expect(r?.isLocking).toBe(true);
  });

  it("uses last cd in a chain", () => {
    const r = parseBashCommand(
      "cd /tmp && cd .worktrees/feat/x && openspec status --change foo",
    );
    expect(r?.effectiveCwd).toBe(".worktrees/feat/x");
  });

  it("ignores non-cd prefix", () => {
    const r = parseBashCommand(
      "echo hi && openspec status --change foo --json",
    );
    expect(r?.subcommand).toBe("status");
    expect(r?.changeName).toBe("foo");
  });
});

describe("parseBashCommand - locking semantics", () => {
  it("marks 'list' as non-locking", () => {
    const r = parseBashCommand("openspec list --json");
    expect(r?.subcommand).toBe("list");
    expect(r?.isLocking).toBe(false);
  });

  it("marks 'doctor' as non-locking", () => {
    const r = parseBashCommand("openspec doctor");
    expect(r?.subcommand).toBe("doctor");
    expect(r?.isLocking).toBe(false);
  });

  it("uses first positional when no --change", () => {
    const r = parseBashCommand("openspec show add-foo");
    expect(r?.changeName).toBe("add-foo");
    expect(r?.isLocking).toBe(true);
  });
});
