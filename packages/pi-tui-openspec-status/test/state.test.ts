// test/state.test.ts
import { describe, expect, it } from "vitest";
import { LOCK_CUSTOM_TYPE, findLastPersistedLock } from "../src/state.js";
import type { CustomEntry } from "@earendil-works/pi-coding-agent";

function customEntry(
  data?: unknown,
  customType: string = LOCK_CUSTOM_TYPE,
): CustomEntry {
  return {
    type: "custom",
    id: "e1",
    parentId: null,
    timestamp: "t",
    customType,
    data,
  };
}

describe("findLastPersistedLock", () => {
  it("returns null when no entries", () => {
    expect(findLastPersistedLock([])).toBeNull();
  });

  it("returns the last matching entry", () => {
    const entries = [
      customEntry({ spec: "alpha", manualLock: false, version: 1 }),
      customEntry({ spec: "beta", manualLock: true, version: 1 }),
    ] as CustomEntry[];
    const got = findLastPersistedLock(entries);
    expect(got).toEqual({ spec: "beta", manualLock: true, version: 1 });
  });

  it("ignores non-matching customType", () => {
    const entries = [
      customEntry({ spec: "alpha", manualLock: false, version: 1 }, "other-ext"),
    ] as CustomEntry[];
    expect(findLastPersistedLock(entries)).toBeNull();
  });

  it("ignores dirty data: wrong version", () => {
    const entries = [
      customEntry({ spec: "alpha", manualLock: false, version: 2 }),
    ] as CustomEntry[];
    expect(findLastPersistedLock(entries)).toBeNull();
  });

  it("ignores dirty data: non-string spec", () => {
    const entries = [
      customEntry({ spec: 42, manualLock: false, version: 1 }),
    ] as CustomEntry[];
    expect(findLastPersistedLock(entries)).toBeNull();
  });
});
