// test/session.test.ts
import { describe, expect, it } from "vitest";
import { SessionRegistry } from "../src/session.js";

const BASH = ["bash", "--norc", "--noprofile"];

describe("PresistantBashSession — state persistence", () => {
  it("keeps export state across commands", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH });
    const s = reg.get(info.id)!;
    const r1 = await s.exec('export FOO=hello; echo "FOO=$FOO"');
    expect(r1.output.trim()).toBe("FOO=hello");
    expect(r1.exitCode).toBe(0);
    const r2 = await s.exec('echo "still $FOO"');
    expect(r2.output.trim()).toBe("still hello");
    reg.destroyAll();
  });

  it("keeps cwd across commands", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH, cwd: "/" });
    const s = reg.get(info.id)!;
    await s.exec("cd /tmp");
    const r = await s.exec("pwd");
    expect(r.output.trim()).toBe("/tmp");
    reg.destroyAll();
  });

  it("keeps virtualenv-style PATH changes across commands", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH });
    const s = reg.get(info.id)!;
    await s.exec('export PATH="/opt/venv/bin:$PATH"');
    const r = await s.exec('echo "$PATH"');
    expect(r.output.trim()).toMatch(/^\/opt\/venv\/bin:/);
    reg.destroyAll();
  });
});

describe("PresistantBashSession — output & exit codes", () => {
  it("captures stdout and stderr in order", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH });
    const s = reg.get(info.id)!;
    const r = await s.exec("echo out; echo err >&2; echo last");
    expect(r.output).toBe("out\nerr\nlast\n");
    expect(r.exitCode).toBe(0);
    reg.destroyAll();
  });

  it("reports non-zero exit codes and survives them", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH });
    const s = reg.get(info.id)!;
    const r1 = await s.exec("false");
    expect(r1.exitCode).toBe(1);
    expect(r1.output).toBe("");
    // session still usable
    const r2 = await s.exec("echo ok");
    expect(r2.output.trim()).toBe("ok");
    expect(r2.exitCode).toBe(0);
    reg.destroyAll();
  });

  it("handles multi-line commands", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH });
    const s = reg.get(info.id)!;
    const r = await s.exec("for i in 1 2 3; do echo line$i; done");
    expect(r.output).toBe("line1\nline2\nline3\n");
    reg.destroyAll();
  });

  it("handles output containing the marker text", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH });
    const s = reg.get(info.id)!;
    const r = await s.exec('echo "__pi_presistant_done_fake__"');
    // The fake marker must not confuse completion detection; output intact.
    expect(r.output).toBe("__pi_presistant_done_fake__\n");
    expect(r.exitCode).toBe(0);
    reg.destroyAll();
  });
});

describe("SessionRegistry", () => {
  it("create returns unique ids and lists sessions", async () => {
    const reg = new SessionRegistry();
    const a = reg.create({ command: BASH, label: "a" });
    const b = reg.create({ command: BASH });
    expect(a.id).not.toBe(b.id);
    expect(a.label).toBe("a");
    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(list.every((s) => s.alive)).toBe(true);
    reg.destroyAll();
  });

  it("destroy removes session and kills process", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH });
    expect(reg.get(info.id)?.isAlive).toBe(true);
    const res = reg.destroy(info.id);
    expect(res.destroyed).toBe(true);
    expect(reg.get(info.id)).toBeUndefined();
    // destroying twice is a no-op
    expect(reg.destroy(info.id).destroyed).toBe(false);
  });

  it("destroyAll kills every session", async () => {
    const reg = new SessionRegistry();
    reg.create({ command: BASH });
    reg.create({ command: BASH });
    const n = reg.destroyAll();
    expect(n).toBe(2);
    expect(reg.list()).toHaveLength(0);
  });

  it("exec on a destroyed session rejects", async () => {
    const reg = new SessionRegistry();
    const info = reg.create({ command: BASH });
    const s = reg.get(info.id)!;
    reg.destroy(info.id);
    await expect(s.exec("echo hi")).rejects.toThrow(/not alive/);
    // registry no longer returns the session
    expect(reg.get(info.id)).toBeUndefined();
  });
});
