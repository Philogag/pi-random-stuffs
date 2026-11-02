// test/render-degraded.test.ts
//
// End-to-end checks of the status bar when the `openspec status` query fails
// for every alive source (missing CLI, timeout, non-zero exit, bad JSON).
//
// Regression: the bar used to render a fabricated line —
// `<change> (spec-driven) [] Tasks: …` — for every failure, which made a
// broken query look like a working status bar on projects with a custom
// schema. The contract now: schema from the project YAML (or `?`), artifact
// slots as `–`, tasks still merged from disk.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/status/openspec.js", () => ({
  runOpenspecStatus: vi.fn(async () => null),
}));

import { runOpenspecStatus } from "../src/status/openspec.js";
import { OpenSpecStatusRender } from "../src/status/render.js";

const mockedStatus = vi.mocked(runOpenspecStatus);
const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "openspec-degraded-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return root;
}

function makeRender(cwd: string) {
  const ctx = { cwd, ui: { setStatus: () => {} } } as never;
  return new OpenSpecStatusRender("ext", ctx, 0);
}

beforeEach(() => {
  mockedStatus.mockResolvedValue(null);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("degraded status line (query failed)", () => {
  it("uses the project schema instead of hardcoding spec-driven", async () => {
    const root = makeRoot({
      "openspec/config.yaml": "schema: superpowers-bridge-cn\n",
      "openspec/changes/demo/tasks.md": "- [x] 1. one\n- [ ] 2. two\n",
    });
    const render = makeRender(root);
    render.setSpec("demo");

    expect(await render.renderText()).toBe(
      "demo (superpowers-bridge-cn) [P– D– S– T–] Tasks: █████░░░░░ 1/2",
    );
  });

  it("prefers the change-level pin", async () => {
    const root = makeRoot({
      "openspec/config.yaml": "schema: superpowers-bridge-cn\n",
      "openspec/changes/demo/.openspec.yaml": "schema: spec-driven\n",
    });
    const render = makeRender(root);
    render.setSpec("demo");

    expect(await render.renderText()).toContain("(spec-driven)");
  });

  it("renders (?) when no schema is readable", async () => {
    const root = makeRoot({ "openspec/changes/demo/README.md": "# demo\n" });
    const render = makeRender(root);
    render.setSpec("demo");

    const line = await render.renderText();
    expect(line.startsWith("demo (?) [P– D– S– T–]")).toBe(true);
    expect(line).not.toContain("spec-driven");
  });

  it("keeps tasks at 0/0 when tasks.md is absent", async () => {
    const root = makeRoot({
      "openspec/config.yaml": "schema: x\n",
      "openspec/changes/demo/README.md": "# demo\n",
    });
    const render = makeRender(root);
    render.setSpec("demo");

    expect(await render.renderText()).toContain("Tasks: ░░░░░░░░░░ 0/0");
  });

  it("never renders an empty artifact group", async () => {
    const root = makeRoot({
      "openspec/changes/demo/README.md": "# demo\n",
    });
    const render = makeRender(root);
    render.setSpec("demo");

    expect(await render.renderText()).not.toContain("[]");
  });
});
