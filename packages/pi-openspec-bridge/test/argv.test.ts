// test/argv.test.ts
import { describe, expect, it } from "vitest";
import { buildArgv, isKnownSubcommand, OpenspecArgvError } from "../src/cli/argv.js";
import { OPENSPEC_SUBCOMMANDS } from "../src/cli/schema.js";

describe("buildArgv", () => {
  it("emits subcommand tokens, then positionals, then flags", () => {
    const { argv, subcommand } = buildArgv({
      subcommand: "new change",
      args: ["add-dark-mode"],
      description: "Add dark mode",
      json: true,
    });
    expect(subcommand).toBe("new change");
    expect(argv).toEqual([
      "new",
      "change",
      "add-dark-mode",
      "--json",
      "--description",
      "Add dark mode",
    ]);
  });

  it("keeps positionals in CLI order for two-arg commands", () => {
    expect(buildArgv({ subcommand: "config set", args: ["defaultSchema", "spec-driven"] }).argv).toEqual([
      "config",
      "set",
      "defaultSchema",
      "spec-driven",
    ]);
  });

  it("omits flags the caller did not pass (no default sneaks in)", () => {
    expect(buildArgv({ subcommand: "list" }).argv).toEqual(["list"]);
    expect(buildArgv({ subcommand: "list", json: false }).argv).toEqual(["list"]);
  });

  it("emits negated flags with their literal spelling", () => {
    expect(
      buildArgv({ subcommand: "archive", args: ["add-dark-mode"], noValidate: true, yes: true, skipSpecs: true })
        .argv,
    ).toEqual(["archive", "add-dark-mode", "--yes", "--skip-specs", "--no-validate"]);
  });

  it("treats --schema as schemaName so it cannot collide with the subcommand name", () => {
    expect(buildArgv({ subcommand: "status", change: "x", schemaName: "spec-driven" }).argv).toEqual([
      "status",
      "--change",
      "x",
      "--schema",
      "spec-driven",
    ]);
  });

  it("stringifies finite numbers and rejects the rest", () => {
    expect(buildArgv({ subcommand: "validate", concurrency: 4 }).argv).toEqual([
      "validate",
      "--concurrency",
      "4",
    ]);
    expect(() => buildArgv({ subcommand: "validate", concurrency: Number.NaN })).toThrow(OpenspecArgvError);
  });

  it("drops empty-string flags instead of emitting a dangling flag", () => {
    expect(buildArgv({ subcommand: "list", store: "" }).argv).toEqual(["list"]);
  });

  it("rejects an unknown subcommand", () => {
    expect(() => buildArgv({ subcommand: "frobnicate" as never })).toThrow(/Unknown openspec subcommand/);
  });

  it("rejects unknown parameters instead of silently forwarding them", () => {
    expect(() => buildArgv({ subcommand: "list", jsonn: true } as never)).toThrow(/Unknown parameter: jsonn/);
  });

  it("does not emit `root` (bridge-only: it becomes the child cwd)", () => {
    expect(buildArgv({ subcommand: "list", root: "/specs" }).argv).toEqual(["list"]);
  });

  it("every subcommand in the enum produces a non-empty argv", () => {
    for (const subcommand of OPENSPEC_SUBCOMMANDS) {
      expect(isKnownSubcommand(subcommand)).toBe(true);
      const { argv } = buildArgv({ subcommand });
      expect(argv.length).toBeGreaterThanOrEqual(subcommand.split(" ").length);
      expect(argv).not.toContain("undefined");
    }
  });
});
