// test/project-schema.test.ts
//
// The status bar's fallback schema lookup. `openspec status --json` is the
// authoritative source; when that query fails the bar must not fabricate a
// schema name (it used to print a hardcoded `spec-driven`), so it reads the
// same YAML the CLI reads. These tests pin the file priority and the parser.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSchemaName, readSchemaName } from "../src/status/project-schema.js";

const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "openspec-schema-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("parseSchemaName", () => {
  it("reads a top-level scalar", () => {
    expect(parseSchemaName("schema: superpowers-bridge-cn\n")).toBe(
      "superpowers-bridge-cn",
    );
  });

  it("strips quotes and trailing comments' whitespace", () => {
    expect(parseSchemaName('schema: "spec-driven"  \n')).toBe("spec-driven");
    expect(parseSchemaName("schema: 'spec-driven'\n")).toBe("spec-driven");
  });

  it("ignores indented non-top-level noise and finds the scalar later", () => {
    expect(parseSchemaName("language: zh-CN\nschema: custom\n")).toBe("custom");
  });

  it("returns undefined without a schema key", () => {
    expect(parseSchemaName("language: zh-CN\n")).toBeUndefined();
    expect(parseSchemaName("")).toBeUndefined();
    expect(parseSchemaName("schema:\n")).toBeUndefined();
    expect(parseSchemaName("schemas: nope\n")).toBeUndefined();
  });
});

describe("readSchemaName", () => {
  it("prefers the change-level pin over the project default", async () => {
    const root = makeRoot({
      "openspec/config.yaml": "schema: superpowers-bridge-cn\n",
      "openspec/changes/demo/.openspec.yaml": "schema: spec-driven\n",
    });
    expect(await readSchemaName("demo", [root])).toBe("spec-driven");
  });

  it("falls back to the project default", async () => {
    const root = makeRoot({
      "openspec/config.yaml": "schema: superpowers-bridge-cn\n",
      "openspec/changes/demo/README.md": "# demo\n",
    });
    expect(await readSchemaName("demo", [root])).toBe("superpowers-bridge-cn");
  });

  it("tries every root before giving up", async () => {
    const main = makeRoot({ "openspec/changes/demo/README.md": "# demo\n" });
    const worktree = makeRoot({
      "openspec/changes/demo/.openspec.yaml": "schema: custom-wt\n",
    });
    expect(await readSchemaName("demo", [main, worktree])).toBe("custom-wt");
  });

  it("ignores missing/undefined roots and missing files", async () => {
    const root = makeRoot({});
    expect(await readSchemaName("demo", [undefined, root, ""])).toBeUndefined();
    expect(await readSchemaName("demo", [])).toBeUndefined();
  });
});
