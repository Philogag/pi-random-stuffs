// src/session.ts
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface SessionInfo {
  id: string;
  /** Human-readable label chosen by the agent. */
  label?: string;
  /** The shell/command the session was started with (e.g. "bash", "docker exec -it ..."). */
  command: string;
  /** Working directory the session was started in. */
  cwd: string;
  /** Created at (epoch ms). */
  createdAt: number;
  /** True when the underlying process is still alive. */
  alive: boolean;
  /** Optional per-session metadata (e.g. backing container id). */
  meta?: SessionMeta;
}

export interface CreateSessionOptions {
  label?: string;
  /**
   * The exact argv to spawn, e.g. ["bash"] or ["docker", "exec", "-it", "my-container", "bash"].
   * Defaults to ["bash"].
   */
  command?: string[];
  /** Working directory for the spawned process. Defaults to process.cwd(). */
  cwd?: string;
  /** Extra environment variables. Defaults to {} (inherits parent env). */
  env?: NodeJS.ProcessEnv;
  /** Optional per-session metadata surfaced in {@link SessionInfo}. */
  meta?: SessionMeta;
  /** Cleanup hook invoked once when the session is destroyed. */
  onDestroy?: SessionDestroyHook;
}

export interface ExecOptions {
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Kill the command (and session) if it runs longer than this many ms. */
  timeoutMs?: number;
}

export interface ExecResult {
  /** Combined stdout + stderr output. */
  output: string;
  /** Process exit code; undefined when the command was terminated by us. */
  exitCode: number | undefined;
  /** True when the command was cancelled via signal or timeout. */
  cancelled: boolean;
}

export interface SessionDestroyResult {
  /** True when a session with this id existed and was destroyed. */
  destroyed: boolean;
}

/**
 * Optional cleanup hook invoked when a session is destroyed. Used e.g. to
 * `docker rm -f` the container backing a container session.
 */
export type SessionDestroyHook = (session: PresistantBashSession) => void;

/**
 * Optional per-session metadata attached at creation time (e.g. the
 * container id backing a container session). Surfaced in {@link SessionInfo}.
 */
export type SessionMeta = Record<string, unknown>;

const DEFAULT_COMMAND = ["bash"];

/**
 * A single long-lived shell process.
 *
 * Commands are written to the process stdin; output is collected from
 * stdout/stderr. Because the process never exits between commands, `cd`,
 * `export`, virtualenv activation, and other shell state persist across
 * `exec()` calls.
 */
export class PresistantBashSession {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly commandLine: string;
  private readonly startedCwd: string;
  private readonly startedAt: number;
  private readonly label: string | undefined;
  private readonly meta: SessionMeta;
  private readonly destroyHook: SessionDestroyHook | undefined;
  private closed = false;

  constructor(
    /** argv to spawn (e.g. ["bash"] or ["docker", "exec", "-it", "c", "bash"]). */
    command: string[] = DEFAULT_COMMAND,
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      label?: string;
      /** Per-session metadata surfaced in {@link SessionInfo}. */
      meta?: SessionMeta;
      /** Cleanup hook called once on destroy(). */
      onDestroy?: SessionDestroyHook;
    } = {},
  ) {
    this.commandLine = command.join(" ");
    this.startedCwd = options.cwd ?? process.cwd();
    this.startedAt = Date.now();
    this.label = options.label;
    this.meta = options.meta ?? {};
    this.destroyHook = options.onDestroy;
    this.proc = spawn(command[0] ?? "bash", command.slice(1), {
      cwd: this.startedCwd,
      env: { ...process.env, ...options.env },
      // No shell wrapper: we want the exact argv the agent asked for
      // (e.g. docker exec … bash) and to control stdin ourselves.
      shell: false,
    });
    this.proc.on("error", () => {
      // The process failed to spawn (e.g. bad command). Mark closed so
      // subsequent execs fail fast.
      this.closed = true;
    });

    // Merge stderr into stdout so every command's output and the completion
    // marker travel on a single pipe. This guarantees ordering between
    // stdout/stderr writes and the marker echo, and prevents stderr data
    // from leaking into the next exec's buffer.
    this.proc.stdin.write("exec 2>&1\n", "utf8");
  }

  get id(): string {
    // Identity is owned by the manager (registry key); the session object
    // itself does not carry a stable id.
    throw new Error("PresistantBashSession has no id; use the session registry");
  }

  get info(): SessionInfo {
    return {
      id: this.commandLine, // placeholder; registry overrides with real id
      label: this.label,
      command: this.commandLine,
      cwd: this.startedCwd,
      createdAt: this.startedAt,
      alive: this.isAlive,
      ...(Object.keys(this.meta).length > 0 ? { meta: this.meta } : {}),
    };
  }

  get isAlive(): boolean {
    return !this.closed && this.proc.exitCode === null && this.proc.signalCode === null;
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  /** Force-kill the underlying process. Safe to call multiple times. */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.proc.exitCode === null && this.proc.signalCode === null) {
      this.proc.kill("SIGKILL");
    }
    // Cleanup hook (e.g. docker rm -f for container sessions).
    this.destroyHook?.(this);
  }

  /**
   * Run a single command inside this session and wait for it to finish.
   *
   * Command completion is detected by an end-of-command marker echoed to
   * stdout; this is the only portable way to know when an interactive shell
   * has finished evaluating a command.
   */
  exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
      if (!this.isAlive) {
        reject(new Error(`session is not alive (${this.commandLine})`));
        return;
      }

      const marker = `__pi_presistant_done_${randomUUID()}`;
      const markerRe = new RegExp(`${marker}_(\\d+)__`);
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (
        result: { output?: string; exitCode?: number; cancelled?: boolean },
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          output: result.output ?? Buffer.concat(chunks).toString("utf8"),
          exitCode: result.exitCode,
          cancelled: result.cancelled ?? false,
        });
      };

      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const onData = (data: Buffer): void => {
        if (settled) return;
        chunks.push(data);
        const text = Buffer.concat(chunks).toString("utf8");
        const m = markerRe.exec(text);
        if (!m) return;
        const exitCode = Number(m[1]);
        // Strip the marker line from the accumulated output.
        const markerIdx = text.indexOf(m[0]);
        const before = text.slice(0, markerIdx);
        const after = text.slice(markerIdx + m[0].length);
        const cleaned = before + (after.startsWith("\n") ? after.slice(1) : after);
        chunks.length = 0;
        chunks.push(Buffer.from(cleaned));
        finish({ exitCode });
      };

      const onError = (err: Error): void => {
        if (settled) return;
        chunks.push(Buffer.from(err.message, "utf8"));
        fail(new Error(`session process error: ${err.message}`));
      };

      const onClose = (): void => {
        if (settled) return;
        chunks.push(Buffer.from("\n[session closed]", "utf8"));
        finish({ exitCode: this.proc.exitCode ?? undefined, cancelled: true });
      };

      const cleanup = (): void => {
        clearTimeout(timeoutHandle);
        this.proc.stdout.off("data", onData);
        this.proc.stderr.off("data", onData);
        this.proc.off("error", onError);
        this.proc.off("close", onClose);
        options.signal?.removeEventListener("abort", onAbort);
      };

      const onAbort = (): void => {
        finish({ exitCode: undefined, cancelled: true });
        // Leave the process running; the caller decided to stop waiting.
      };

      let timeoutHandle: NodeJS.Timeout | undefined;
      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          finish({ exitCode: undefined, cancelled: true });
          this.destroy();
        }, options.timeoutMs);
      }

      this.proc.stdout.on("data", onData);
      this.proc.stderr.on("data", onData);
      this.proc.on("error", onError);
      this.proc.on("close", onClose);
      if (options.signal?.aborted) {
        finish({ exitCode: undefined, cancelled: true });
        return;
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });

      // Write the command plus a completion marker carrying the exit code.
      // `$?` is expanded by the session shell right after the command runs,
      // so the marker line carries the command's real exit code.
      this.proc.stdin.write(`${command}\necho ${marker}_$?__\n`, "utf8");
    });
  }
}

/** Registry of all live sessions, keyed by id. */
export class SessionRegistry {
  private readonly sessions = new Map<string, PresistantBashSession>();
  private readonly labels = new Map<string, string>();

  create(options: CreateSessionOptions = {}): SessionInfo {
    const id = randomUUID();
    const session = new PresistantBashSession(options.command ?? DEFAULT_COMMAND, {
      cwd: options.cwd,
      env: options.env,
      label: options.label,
      meta: options.meta,
      onDestroy: options.onDestroy,
    });
    this.sessions.set(id, session);
    if (options.label) this.labels.set(id, options.label);
    return this.describe(id);
  }

  get(id: string): PresistantBashSession | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    const out: SessionInfo[] = [];
    for (const [id, session] of this.sessions) {
      out.push(this.describe(id));
    }
    return out;
  }

  destroy(id: string): SessionDestroyResult {
    const session = this.sessions.get(id);
    if (!session) return { destroyed: false };
    session.destroy();
    this.sessions.delete(id);
    this.labels.delete(id);
    return { destroyed: true };
  }

  destroyAll(): number {
    let count = 0;
    for (const id of [...this.sessions.keys()]) {
      if (this.destroy(id).destroyed) count++;
    }
    return count;
  }

  private describe(id: string): SessionInfo {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`unknown session: ${id}`);
    }
    return {
      ...session.info,
      id,
      label: this.labels.get(id) ?? session.info.label,
    };
  }
}
