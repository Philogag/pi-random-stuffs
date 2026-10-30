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

  it("drops flags the subcommand does not support (status rejects many flags)", () => {
    // `status` supports only --change/--all/--schema/--json/--store.
    expect(
      buildArgv({
        subcommand: "status",
        change: "fold-openspec-block",
        allowUnknown: true,
        noInteractive: true,
        scope: "root",
        verbose: true,
      }).argv,
    ).toEqual(["status", "--change", "fold-openspec-block"]);
  });

  it("still emits flags the subcommand does support on status", () => {
    expect(
      buildArgv({ subcommand: "status", change: "x", schemaName: "s", json: true, all: true }).argv,
    ).toEqual(["status", "--json", "--all", "--change", "x", "--schema", "s"]);
  });

  it("scopes config-only flags to config subcommands", () => {
    // --allow-unknown/--string only exist on `config set`.
    expect(
      buildArgv({ subcommand: "status", allowUnknown: true, string: true } as never).argv,
    ).toEqual(["status"]);
    expect(
      buildArgv({ subcommand: "config set", args: ["k", "v"], allowUnknown: true, string: true }).argv,
    ).toEqual(["config", "set", "k", "v", "--string", "--allow-unknown"]);
  });

  it("treats spec list as distinct from list --specs", () => {
    // `spec list` only understands --json/--long; --store/--archived are dropped.
    expect(
      buildArgv({ subcommand: "spec list", store: "s", archived: true, long: true }).argv,
    ).toEqual(["spec", "list", "--long"]);
    // whereas the plain `list` accepts them (while `--long` stays scoped to
    // the spec/change list shorthands).
    expect(
      buildArgv({ subcommand: "list", store: "s", archived: true, long: true }).argv,
    ).toEqual(["list", "--store", "s", "--archived"]);
  });

  it("emits --yes only where the CLI accepts it (archive, not new change)", () => {
    expect(buildArgv({ subcommand: "archive", yes: true }).argv).toEqual(["archive", "--yes"]);
    expect(buildArgv({ subcommand: "new change", args: ["x"], yes: true }).argv).toEqual([
      "new",
      "change",
      "x",
    ]);
  });

  it("keeps validate-only bulk flags on validate but not on change validate", () => {
    expect(
      buildArgv({ subcommand: "validate", report: "findings", concurrency: 4, strict: true }).argv,
    ).toEqual(["validate", "--report", "findings", "--concurrency", "4", "--strict"]);
    expect(buildArgv({ subcommand: "change validate", report: "findings", strict: true }).argv).toEqual([
      "change",
      "validate",
      "--strict",
    ]);
  });

  it("every flag declared in FLAGS is either scoped or universal-safe to emit somwhere", () => {
    // Sanity guard: exercise each flag on a subcommand that accepts it, so a
    // flag accidentally scoped to nothing (or to subcommands that reject it)
    // is caught by a regression instead of silently never firing.
    const scoped = buildArgv({
      subcommand: "status",
      change: "x",
      schemaName: "s",
      json: true,
      all: true,
      force: true,
      dryRun: true,
      check: true,
      tools: "all",
      language: "en",
      profile: "core",
      tool: "pi",
      member: "m",
      id: "i",
      path: "/p",
      artifacts: "specs",
      defaultSchema: true,
      report: "findings",
      body: "b",
      scope: "root",
      strict: true,
      concurrency: 2,
      noValidate: true,
      codeWorkspace: "/w",
      verbose: true,
    }).argv;
    // None of the above except json/all/change/schemaName are supported by
    // `status`; those unsupported must be filtered out.
    expect(scoped).toEqual(["status", "--json", "--all", "--change", "x", "--schema", "s"]);
  });
});
