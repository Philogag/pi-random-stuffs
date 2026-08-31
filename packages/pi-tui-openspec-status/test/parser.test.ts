// test/parser.test.ts
import { describe, expect, it } from "vitest";
import { extractChangeName, isLockingSubcommand, parseBashCommand } from "../src/parser.js";

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

describe("parseBashCommand - `new` depth-2 verb", () => {
  it("extracts change name from `openspec new change <name>`", () => {
    const r = parseBashCommand("openspec new change add-foo");
    expect(r).toEqual({
      subcommand: "new",
      changeName: "add-foo",
      effectiveCwd: "",
      isWorktree: false,
      isLocking: true,
    });
  });

  it("extracts change name from `openspec new change <name>` with --description flag", () => {
    const r = parseBashCommand(
      'openspec new change add-foo --description "hello world"',
    );
    expect(r?.subcommand).toBe("new");
    expect(r?.changeName).toBe("add-foo");
    expect(r?.isLocking).toBe(true);
  });

  it("extracts spec name from `openspec new spec <name>`", () => {
    const r = parseBashCommand("openspec new spec my-spec");
    expect(r?.subcommand).toBe("new");
    expect(r?.changeName).toBe("my-spec");
    expect(r?.isLocking).toBe(true);
  });

  it("returns undefined changeName for `openspec new change --help`", () => {
    const r = parseBashCommand("openspec new change --help");
    expect(r?.subcommand).toBe("new");
    expect(r?.changeName).toBeUndefined();
    // still flagged locking? No — without a name there's nothing to lock on.
    // (handler in index.ts gates on `parsed.changeName` anyway, so this is OK)
  });

  it("returns undefined changeName for `openspec new --help`", () => {
    const r = parseBashCommand("openspec new --help");
    expect(r?.subcommand).toBe("new");
    expect(r?.changeName).toBeUndefined();
  });

  it("does not regress flat verbs: `openspec archive <name>` still works", () => {
    const r = parseBashCommand("openspec archive add-foo");
    expect(r?.subcommand).toBe("archive");
    expect(r?.changeName).toBe("add-foo");
    expect(r?.isLocking).toBe(true);
  });
});

describe("extractChangeName - new verb unit cases", () => {
  it("skips sub-verb for new change", () => {
    expect(extractChangeName(["new", "change", "foo"])).toBe("foo");
  });
  it("skips sub-verb for new spec", () => {
    expect(extractChangeName(["new", "spec", "bar"])).toBe("bar");
  });
  it("returns undefined when new has only --help after sub-verb", () => {
    expect(extractChangeName(["new", "change", "--help"])).toBeUndefined();
  });
  it("returns undefined for bare `new --help`", () => {
    expect(extractChangeName(["new", "--help"])).toBeUndefined();
  });
  it("does not skip a non-sub-verb token for new", () => {
    // If someone writes `openspec new foo` (missing change/spec), treat
    // `foo` as the change name rather than ignoring it.
    expect(extractChangeName(["new", "foo"])).toBe("foo");
  });
});
