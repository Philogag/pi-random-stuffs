// test/discover.test.ts
// Unit tests for listActiveChanges: stable-sorted directory names under
// `<openspecRoot>/openspec/changes/`, excluding `archive`; returns []
// when the directory is missing or unreadable.

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { listActiveChanges } from "../src/discover.js";

describe("listActiveChanges", () => {
  let root: string;

  const setup = () => {
    root = mkdtempSync(path.join(tmpdir(), "pi-tui-openspec-discover-"));
    return root;
  };
  const teardown = () => rmSync(root, { recursive: true, force: true });

  it("returns sorted active change dirs, excluding archive", async () => {
    setup();
    try {
      mkdirSync(path.join(root, "openspec", "changes", "beta"), {
        recursive: true,
      });
      mkdirSync(path.join(root, "openspec", "changes", "alpha"), {
        recursive: true,
      });
      mkdirSync(
        path.join(root, "openspec", "changes", "archive", "2026-01-01-old"),
        { recursive: true },
      );
      writeFileSync(path.join(root, "openspec", "changes", "not-a-dir.md"), "x");
      expect(await listActiveChanges(root)).toEqual(["alpha", "beta"]);
    } finally {
      teardown();
    }
  });

  it("returns [] when changes dir is missing", async () => {
    setup();
    try {
      expect(await listActiveChanges(root)).toEqual([]);
    } finally {
      teardown();
    }
  });

  it("returns [] when changes dir is unreadable", async () => {
    setup();
    try {
      // Point `changes` at a FILE so readdir rejects (ENOTDIR).
      mkdirSync(path.join(root, "openspec"), { recursive: true });
      writeFileSync(path.join(root, "openspec", "changes"), "x");
      expect(await listActiveChanges(root)).toEqual([]);
    } finally {
      teardown();
    }
  });
});
