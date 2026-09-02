// test/container.test.ts
import { describe, expect, it, vi } from "vitest";
import { SessionRegistry, type SessionInfo } from "../src/session.js";
import { createContainerSession, detectRuntime, DEFAULT_SHELL } from "../src/container.js";

const FAKE_FULL_ID = "abc12345def6789abcdef"; // 21 chars
const FAKE_SHORT_ID = FAKE_FULL_ID.slice(0, 12); // "abc12345def6"

type SpawnSyncResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

function fakeSpawn(script: { run?: Partial<SpawnSyncResult>; rm?: Partial<SpawnSyncResult> } = {}) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const fn = vi.fn((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    if (cmd === "docker" && args[0] === "run") {
      return { status: 0, stdout: `${FAKE_FULL_ID}\n`, stderr: "", ...script.run };
    }
    if (cmd === "docker" && args[0] === "rm") {
      return { status: 0, stdout: "", stderr: "", ...script.rm };
    }
    return { status: 1, stdout: "", stderr: "unexpected command", error: undefined };
  });
  return { fn, calls };
}

function makeSession(id = "sess-1"): SessionInfo {
  return { id, command: "docker exec -i abc12345def6 bash", cwd: "/", createdAt: 0, alive: true };
}

describe("detectRuntime", () => {
  it("honors an explicit preferred runtime", () => {
    expect(detectRuntime("podman")).toBe("podman");
    expect(detectRuntime("docker")).toBe("docker");
  });
});

describe("createContainerSession", () => {
  it("runs docker run -d with keep-alive, then docker exec -i", () => {
    const reg = new SessionRegistry();
    const { fn, calls } = fakeSpawn();
    const { containerId, containerShortId, session } = createContainerSession(reg, {
      image: "node:22",
      runtime: "docker",
      args: ["-v", "/host:/ct"],
    }, { spawnSync: fn });

    expect(containerId).toBe(FAKE_FULL_ID);
    expect(containerShortId).toBe(FAKE_SHORT_ID);
    expect(session.id).toBeTruthy();

    const runCall = calls.find((c) => c.args[0] === "run")!;
    expect(runCall.args).toEqual([
      "run", "-d", "-v", "/host:/ct", "node:22", "tail", "-f", "/dev/null",
    ]);

    const rmCallBefore = calls.filter((c) => c.args[0] === "rm").length;
    expect(rmCallBefore).toBe(0); // rm happens on destroy, not at create

    // session command uses exec -i (no -t)
    expect(reg.get(session.id)!.info.command).toBe(`docker exec -i ${FAKE_SHORT_ID} bash`);

    // destroy triggers container cleanup
    reg.destroy(session.id);
    const rmCall = calls.find((c) => c.args[0] === "rm")!;
    expect(rmCall.args).toEqual(["rm", "-f", FAKE_SHORT_ID]);
  });

  it("uses a custom shell and keep-alive", () => {
    const reg = new SessionRegistry();
    const { fn } = fakeSpawn();
    createContainerSession(reg, {
      image: "alpine",
      shell: "sh",
      keepAlive: ["sleep", "infinity"],
    }, { spawnSync: fn });
    const runCall = fn.mock.calls.find(([cmd, args]) => cmd === "docker" && args[0] === "run")![1];
    expect(runCall).toContain("alpine");
    expect(runCall).toContain("sleep");
    expect(runCall).toContain("infinity");
  });

  it("records container metadata in the session", () => {
    const reg = new SessionRegistry();
    const { fn } = fakeSpawn();
    const { session } = createContainerSession(reg, { image: "alpine", runtime: "docker" }, { spawnSync: fn });
    expect(reg.get(session.id)!.info.meta).toMatchObject({
      runtime: "docker",
      image: "alpine",
      containerId: FAKE_FULL_ID,
      containerShortId: FAKE_SHORT_ID,
      shell: DEFAULT_SHELL,
    });
  });

  it("throws when docker run fails", () => {
    const reg = new SessionRegistry();
    const { fn } = fakeSpawn({ run: { status: 1, stdout: "", stderr: "no such image" } });
    expect(() => createContainerSession(reg, { image: "nope" }, { spawnSync: fn })).toThrow(/docker run failed: no such image/);
    expect(reg.list()).toHaveLength(0);
  });

  it("removes the container when the session is destroyed", () => {
    const reg = new SessionRegistry();
    const { fn, calls } = fakeSpawn();
    const { session } = createContainerSession(reg, { image: "alpine" }, { spawnSync: fn });
    const before = calls.filter((c) => c.args[0] === "rm").length;
    reg.destroy(session.id);
    const after = calls.filter((c) => c.args[0] === "rm").length;
    expect(after).toBe(before + 1);
  });
});
