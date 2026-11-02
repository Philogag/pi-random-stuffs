// test/status-query.test.ts
//
// Regression guard for the status bar's `openspec status …` query.
//
// History: the query hardcoded `--no-interactive`, a flag `openspec status`
// does not accept. The CLI then exited 1 with "unknown option
// '--no-interactive'", `runOpenspecStatus()` returned null, and the bar fell
// back to a lying line — schema `(spec-driven)` and an empty `[]` artifact
// list — no matter which schema the project used. Two layers protect this:
//
//   1. argv fidelity: every flag the query builds must exist on the real
//      `status` command of the bundled CLI (fast, no subprocess);
//   2. an end-to-end query against a throwaway spec root, which fails if the
//      CLI rejects the invocation for any other reason.

import { existsSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveBundledBin } from "../src/cli/resolve.js";
import { runOpenspecStatus, statusQueryArgv } from "../src/status/openspec.js";

const bin = resolveBundledBin();
const cliEntry = bin
  ? path.join(path.dirname(bin), "..", "dist", "cli", "index.js")
  : undefined;
const HAVE_BUNDLE = Boolean(cliEntry && existsSync(cliEntry));

interface CommanderLike {
  name(): string;
  commands: CommanderLike[];
  options: Array<{ flags: string }>;
  _hidden?: boolean;
}

const specRoot = mkdtempSync(path.join(tmpdir(), "openspec-status-query-"));

afterAll(() => {
  rmSync(specRoot, { recursive: true, force: true });
});

describe.skipIf(!HAVE_BUNDLE)("status bar query — argv fidelity", () => {
  it("only passes flags the real `status` command accepts", async () => {
    const mod = (await import(cliEntry as string)) as { program: CommanderLike };
    const status = mod.program.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();

    const accepted = new Set<string>();
    for (const option of status!.options) {
      for (const flag of option.flags.split(",").map((f) => f.trim())) {
        if (flag.startsWith("-") && flag.length > 1) {
          accepted.add(flag.split(" ")[0]!);
        }
      }
    }

    const used = statusQueryArgv("add-dark-mode").filter((t) =>
      t.startsWith("--"),
    );
    // The query must actually ask for JSON (`--change` is a value flag, so it
    // shows up here too — both are expected).
    expect(used).toContain("--json");
    expect(used).toContain("--change");
    for (const flag of used) expect(accepted.has(flag)).toBe(true);
  });

  it("drops `--no-interactive`, which `status` rejects", () => {
    // Flag order follows the FLAGS registry (json → change), which is what
    // buildArgv emits; only the absence of `--no-interactive` matters here.
    expect(statusQueryArgv("add-dark-mode")).toEqual([
      "status",
      "--json",
      "--change",
      "add-dark-mode",
    ]);
  });
});

describe.skipIf(!HAVE_BUNDLE)("status bar query — against a real spec root", () => {
  it("returns schema + artifact statuses instead of null", async () => {
    // Minimal spec root: a project schema and one change folder. `openspec
    // status` reads the schema from the change's .openspec.yaml, so no
    // `openspec new change` (and no git) is needed.
    mkdirSync(path.join(specRoot, "openspec", "changes", "demo"), {
      recursive: true,
    });
    writeFileSync(
      path.join(specRoot, "openspec", "config.yaml"),
      "schema: spec-driven\n",
    );
    writeFileSync(
      path.join(specRoot, "openspec", "changes", "demo", ".openspec.yaml"),
      "schema: spec-driven\n",
    );

    const status = await runOpenspecStatus("demo", specRoot);

    expect(status).not.toBeNull();
    expect(status?.schemaName).toBe("spec-driven");
    expect(status?.artifacts?.map((a) => a.id)).toEqual([
      "proposal",
      "specs",
      "design",
      "tasks",
    ]);
  }, 20_000);

  it("returns null for an unknown change (no throw)", async () => {
    await expect(runOpenspecStatus("does-not-exist", specRoot)).resolves.toBeNull();
  }, 20_000);
});
