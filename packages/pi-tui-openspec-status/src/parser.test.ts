// src/parser.test.ts
import { describe, expect, it } from "vitest";
import { isLockingSubcommand } from "./parser.js";

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
