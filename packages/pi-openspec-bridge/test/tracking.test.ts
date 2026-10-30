// test/tracking.test.ts
import { describe, expect, it } from "vitest";
import { trackTarget } from "../src/status/tracking.js";

describe("trackTarget", () => {
  it("tracks the positional name of a creating command", () => {
    expect(trackTarget({ subcommand: "new change", args: ["add-dark-mode"] }).change).toBe("add-dark-mode");
  });

  it("tracks `--change` for status, which takes no positional", () => {
    expect(trackTarget({ subcommand: "status", change: "add-dark-mode" }).change).toBe("add-dark-mode");
  });

  it("prefers the --change flag over a positional", () => {
    expect(trackTarget({ subcommand: "show", args: ["other"], change: "wanted" }).change).toBe("wanted");
  });

  it("does not track read-only or global commands", () => {
    expect(trackTarget({ subcommand: "list" }).change).toBeUndefined();
    expect(trackTarget({ subcommand: "store list" }).change).toBeUndefined();
    expect(trackTarget({ subcommand: "config get", args: ["defaultSchema"] }).change).toBeUndefined();
    expect(trackTarget({ subcommand: "spec list" }).change).toBeUndefined();
  });

  it("reports the spec root when one was passed", () => {
    expect(trackTarget({ subcommand: "list", root: "/elsewhere" }).root).toBe("/elsewhere");
    expect(trackTarget({ subcommand: "list", root: "  " }).root).toBeUndefined();
  });

  it("ignores an empty positional", () => {
    expect(trackTarget({ subcommand: "archive", args: [""] }).change).toBeUndefined();
  });

  it("tracks spec show/validate by their spec id", () => {
    expect(trackTarget({ subcommand: "spec show", args: ["auth"] }).change).toBe("auth");
    expect(trackTarget({ subcommand: "spec validate", args: ["auth"] }).change).toBe("auth");
  });
});
