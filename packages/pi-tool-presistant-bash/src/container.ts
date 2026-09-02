// src/container.ts
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { SessionRegistry, type SessionInfo } from "./session.js";

export const DEFAULT_SHELL = "bash";

/** Runtime detection: use podman when the container CLI is podman. */
export function detectRuntime(preferred?: string): "docker" | "podman" {
  if (preferred === "docker" || preferred === "podman") return preferred;
  // Default to docker; fall back to podman only when docker is missing.
  try {
    const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
      timeout: 5000,
    });
    if (r.status === 0) return "docker";
  } catch {
    // ignore; fall through to podman
  }
  return "podman";
}

export interface ContainerCreateParams {
  /** Container runtime: "docker" (default when available) or "podman". */
  runtime?: string;
  /** Container image, e.g. "node:22" or "alpine". */
  image: string;
  /**
   * Extra `docker run` args, e.g. ["-v", "/host:/container", "-p", "3000:3000"].
   * Do NOT include `-it`, `-d`, or the image/tail-keepalive — those are managed.
   */
  args?: string[];
  /** Shell inside the container (default "bash"). */
  shell?: string;
  /**
   * Command to keep the container alive. Defaults to `tail -f /dev/null`:
   * a detached `docker run -d` needs a foreground process; `tail -f` idles
   * forever and lets us `docker exec -i` into the container later.
   */
  keepAlive?: string[];
  /** Label for the resulting session. */
  label?: string;
}

export interface ContainerCreateResult {
  /** Backing container id (full). */
  containerId: string;
  /** Container id prefix (first 12 chars), safe to pass to docker commands. */
  containerShortId: string;
  /** The session created against this container. */
  session: SessionInfo;
}

export interface ContainerToolDeps {
  /** spawnSync wrapper; default is node:child_process spawnSync. */
  spawnSync?: typeof spawnSync;
}

/**
 * Create a docker/podman container and attach a persistent bash session to it.
 *
 * Two hard-won gotchas are handled here (both verified against real docker):
 *
 * 1. `docker run -it <image> bash` exits immediately when stdin is a pipe
 *    (no TTY). The fix: run the container in the background with
 *    `docker run -d` and keep it alive with a foreground `tail -f /dev/null`
 *    (or the caller's keepAlive command).
 *
 * 2. `docker exec -it <container> bash` requires a TTY even when stdin is a
 *    pipe, so it fails inside this extension. The fix: use `docker exec -i`
 *    (no `-t`) — stdin stays piped to the session, stdout/stderr stream back.
 */
export function createContainerSession(
  registry: SessionRegistry,
  params: ContainerCreateParams,
  deps: ContainerToolDeps = {},
): ContainerCreateResult {
  const run = deps.spawnSync ?? spawnSync;
  const runtime = detectRuntime(params.runtime);
  const image = params.image;
  const shell = params.shell ?? DEFAULT_SHELL;
  const keepAlive = params.keepAlive ?? ["tail", "-f", "/dev/null"];
  const extraArgs = params.args ?? [];

  // 1. Start the container detached, keep-alive process in the foreground.
  const runResult = run(
    runtime,
    ["run", "-d", ...extraArgs, image, ...keepAlive],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (runResult.error || runResult.status !== 0) {
    const err = runResult.error?.message ?? runResult.stderr?.trim() ?? "unknown error";
    throw new Error(
      `${runtime} run failed: ${err}\n` +
        `(invoked: ${runtime} run -d ${extraArgs.join(" ")} ${image} ${keepAlive.join(" ")})`,
    );
  }
  const containerId = (runResult.stdout ?? "").trim();
  if (!containerId) {
    throw new Error(`${runtime} run returned no container id`);
  }
  const containerShortId = containerId.slice(0, 12);

  // 2. Attach a persistent session via `docker exec -i` (NOT `-it`).
  const info = registry.create({
    label: params.label ?? `container:${image}`,
    command: [runtime, "exec", "-i", containerShortId, shell],
    meta: { runtime, image, containerId, containerShortId, shell },
    onDestroy: () => {
      // Best-effort container cleanup; ignore failures (container may
      // already be gone).
      try {
        run(runtime, ["rm", "-f", containerShortId], { stdio: "ignore", timeout: 30_000 });
      } catch {
        // ignore
      }
    },
  });

  return { containerId, containerShortId, session: info };
}
