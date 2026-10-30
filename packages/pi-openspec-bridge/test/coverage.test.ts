// test/coverage.test.ts
//
// Fidelity guard: the tool's subcommand enum must match the real OpenSpec
// command tree that this extension bundles. This is what backs the
// "100% subcommand bridging" claim — if a future @fission-ai/openspec adds,
// renames, or removes a command, this test fails instead of silently leaving
// the agent with a stale surface.
//
// The bundled package's `exports` map hides `./dist/cli/index.js`, but Node
// lets us import an absolute path, which is exactly what we need here.

import { existsSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBundledBin } from "../src/cli/resolve.js";
import { FLAGS, OPENSPEC_SUBCOMMANDS } from "../src/cli/schema.js";

const bin = resolveBundledBin();
const cliEntry = bin ? path.join(path.dirname(bin), "..", "dist", "cli", "index.js") : undefined;
const HAVE_BUNDLE = Boolean(cliEntry && existsSync(cliEntry));

interface CommanderLike {
  name(): string;
  commands: CommanderLike[];
  options: Array<{ flags: string }>;
  _hidden?: boolean;
}

/** Flatten the commander tree into "a b c" subcommand paths. */
function flatten(cmd: CommanderLike, prefix = ""): string[] {
  const out: string[] = [];
  for (const sub of cmd.commands) {
    if (sub._hidden) continue;
    const name = prefix ? `${prefix} ${sub.name()}` : sub.name();
    const hasChildren = sub.commands.some((c) => !c._hidden);
    if (hasChildren) {
      out.push(...flatten(sub, name));
    } else {
      out.push(name);
    }
  }
  return out;
}

describe.skipIf(!HAVE_BUNDLE)("subcommand coverage vs the bundled OpenSpec CLI", () => {
  it("every real leaf command is exposed by the tool enum", async () => {
    const mod = (await import(cliEntry as string)) as { program: CommanderLike };
    const real = flatten(mod.program).sort();
    const ours = [...OPENSPEC_SUBCOMMANDS].sort();

    expect(real.length).toBeGreaterThan(30);
    // Missing = the agent cannot reach a real command. Extra = we advertise
    // something the binary does not have.
    expect(ours).toEqual(real);
  });

  it("exposes the flags each real command actually accepts", async () => {
    const mod = (await import(cliEntry as string)) as { program: CommanderLike };
    const realFlags = new Set<string>();
    const walk = (cmd: CommanderLike) => {
      for (const o of cmd.options) {
        for (const flag of o.flags.split(",").map((f) => f.trim())) {
          if (flag.startsWith("-") && flag.length > 1) realFlags.add(flag.split(" ")[0]!);
        }
      }
      cmd.commands.forEach(walk);
    };
    walk(mod.program);

    const ours = new Set(FLAGS.filter((f) => f.flag).map((f) => f.flag));
    // Every flag we expose must exist on the real CLI (no invented flags)…
    for (const flag of ours) expect(realFlags.has(flag)).toBe(true);

    // …and the high-traffic ones must all be covered. Short aliases (-y, -r)
    // are intentionally skipped: long forms are what the schema exposes.
    const mustHave = [
      "--json",
      "--store",
      "--change",
      "--schema",
      "--skip-specs",
      "--no-validate",
      "--deltas-only",
      "--requirements",
      "--no-scenarios",
      "--skip-specs",
      "--concurrency",
      "--code-workspace",
      "--dry-run",
      "--init-git",
      "--allow-unknown",
    ];
    for (const flag of mustHave) expect(ours.has(flag)).toBe(true);
  });
});
