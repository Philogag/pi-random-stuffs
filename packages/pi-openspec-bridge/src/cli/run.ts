// src/cli/run.ts
//
// Spawn the OpenSpec CLI as a child process and capture its output.
//
// A child process (rather than importing `runCli()`) is deliberate:
//   * `runCli` calls `process.exit()` on most error paths, which would kill
//     the host pi process;
//   * commander keeps one global program instance, so in-process runs leak
//     state between calls;
//   * stdout/stderr/exit code stay exactly what the CLI would print on a
//     shell, which is what "100% subcommand bridging" means.
//
// Environment is tuned for agent use: no ANSI colors, no update checks, no
// telemetry, no interactive prompts, no animation.

import { spawn } from "node:child_process";
import { resolveBinary, type ResolvedBinary } from "./resolve.js";

export const DEFAULT_TIMEOUT_MS = 120_000;

export interface RunOptions {
  /** argv after the binary, e.g. ["list", "--json"]. */
  argv: string[];
  /** Working directory for the child = the resolved spec root. */
  cwd: string;
  /** Abort signal from the tool call. */
  signal?: AbortSignal;
  /** Kill the child after this many ms. */
  timeoutMs?: number;
  /** Override binary resolution (tests). */
  binary?: ResolvedBinary;
  /** Extra environment variables. */
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  argv: string[];
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** Set when the process could not be started at all (ENOENT, …). */
  spawnError?: string;
  binary: ResolvedBinary;
}

/** Env vars that turn the CLI into a well-behaved, non-interactive child. */
export function nonInteractiveEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    NO_COLOR: "1",
    OPENSPEC_NO_AUTO_CONFIG: "1",
    OPENSPEC_NO_UPDATE_CHECK: "1",
    OPENSPEC_NO_ANIMATION: "1",
    OPENSPEC_TELEMETRY: "0",
    CI: env["CI"] ?? "1",
    // stdin is closed for these runs; make that explicit for any library
    // that sniffs it before falling back to a prompt.
    FORCE_COLOR: "0",
  };
}

export async function runOpenspec(options: RunOptions): Promise<RunResult> {
  const binary = options.binary ?? resolveBinary();
  const fullArgv = [...binary.prefixArgs, ...options.argv];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  return new Promise<RunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    // Declared before `finish` so the spawn-failure path can clear it safely
    // (a `const` here would be in TDZ and throw on that path).
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (partial: Partial<RunResult>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        argv: options.argv,
        command: binary.command,
        cwd: options.cwd,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
        binary,
        ...partial,
      });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary.command, fullArgv, {
        cwd: options.cwd,
        env: nonInteractiveEnv(options.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({ spawnError: (error as Error).message });
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });

    child.on("error", (error) => {
      finish({ spawnError: error.message });
    });
    child.on("close", (code, signal) => {
      finish({ exitCode: code, signal });
    });
  });
}

/** One-line summary of a run, used in the tool's `details`. */
export function summarizeRun(result: RunResult): string {
  const parts = [`exit=${result.exitCode ?? "null"}`, `cwd=${result.cwd}`];
  if (result.timedOut) parts.push("timed-out");
  if (result.spawnError) parts.push(`spawn-error=${result.spawnError}`);
  parts.push(`${result.durationMs}ms`);
  return parts.join(" ");
}
