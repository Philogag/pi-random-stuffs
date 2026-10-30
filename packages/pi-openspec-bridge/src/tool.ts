// src/tool.ts
//
// The `openspec` tool: a structured replacement for running `openspec …`
// through the shell tool.
//
// Why a tool instead of shell:
//   * the subcommand is an enum, so the model cannot invent one;
//   * every flag is a typed parameter with a description, so no `--foo bar`
//     quoting mistakes;
//   * `root` picks the spec root explicitly instead of relying on `cd` and
//     ancestor discovery — the same call works from any session cwd;
//   * output is captured with the exit code, so failures are visible as data
//     rather than a shell error the model has to re-read.

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { buildArgv, OpenspecArgvError } from "./cli/argv.js";
import { resolveBinary } from "./cli/resolve.js";
import { runOpenspec, summarizeRun, type RunResult } from "./cli/run.js";
import {
  buildOpenspecParameters,
  type OpenspecSubcommand,
  type OpenspecToolParams,
} from "./cli/schema.js";

export const TOOL_NAME = "openspec";

export interface ToolExecutionContext {
  /** Resolve the spec root for this call. */
  resolveRoot(params: OpenspecToolParams, ctx: ExtensionContext): string;
}

/**
 * Default spec-root resolution: explicit `root` param, else the session cwd.
 * Never walks ancestors — `root` is the contract.
 */
export function defaultResolveRoot(
  params: OpenspecToolParams,
  ctx: ExtensionContext,
): string {
  const root = params.root;
  if (typeof root === "string" && root.trim().length > 0) {
    return path.resolve(ctx.cwd ?? process.cwd(), root);
  }
  return ctx.cwd ?? process.cwd();
}

/** Format a run as the text block returned to the model. */
export function formatRunForModel(result: RunResult): string {
  const header = [
    `$ openspec ${result.argv.join(" ")}`,
    `# cwd: ${result.cwd}`,
    `# ${summarizeRun(result)}`,
  ].join("\n");

  const chunks = [header];

  if (result.spawnError) {
    chunks.push(`spawn error: ${result.spawnError}`);
    return chunks.join("\n\n");
  }

  const out = result.stdout.trim();
  const err = result.stderr.trim();

  if (out.length > 0) chunks.push(out);
  if (err.length > 0) chunks.push(`[stderr]\n${err}`);
  if (out.length === 0 && err.length === 0) chunks.push("(no output)");
  if (result.timedOut) chunks.push("[killed after timeout]");
  if (result.exitCode !== 0 && result.exitCode !== null) {
    chunks.push(`[exit code ${result.exitCode}]`);
  }

  return chunks.join("\n\n");
}

export interface RegisterOpenspecToolOptions {
  /** Override root resolution (tests, custom layouts). */
  resolveRoot?: ToolExecutionContext["resolveRoot"];
  /** Override the binary (tests). */
  binary?: ReturnType<typeof resolveBinary>;
  /** Kill the child after this many ms. */
  timeoutMs?: number;
  /**
   * Called after every successful spawn (even a non-zero exit) so the
   * status bar can lock onto the change the command touched.
   */
  onRun?: (params: OpenspecToolParams, result: RunResult) => void;
}

export function registerOpenspecTool(
  pi: ExtensionAPI,
  options: RegisterOpenspecToolOptions = {},
): void {
  const resolveRoot = options.resolveRoot ?? defaultResolveRoot;

  const definition: ToolDefinition = {
    name: TOOL_NAME,
    label: "OpenSpec",
    description:
      "Run the OpenSpec CLI (spec-driven development) directly. " +
      "Pick a `subcommand` (enum of every documented command), pass its positionals in `args`, " +
      "and set flags as typed parameters. Set `root` to the directory containing the `openspec/` " +
      "folder when it is not the session cwd. " +
      "Prefer `json: true` for commands that support it, then read the JSON from the output. " +
      "This replaces calling `openspec` through the shell tool.",
    parameters: buildOpenspecParameters(),
    promptSnippet:
      "openspec: run any OpenSpec CLI subcommand (list, show, status, new change, archive, validate, store, …) with typed flags and an explicit spec root",
    promptGuidelines: [
      "Use the openspec tool instead of the shell/bash tool for any `openspec` command.",
      "Use the openspec tool with `root` set to the directory containing `openspec/` instead of `cd <dir> && openspec …`.",
      "Use openspec with `json: true` where the subcommand supports it, so results can be parsed instead of scraped.",
    ],

    async execute(toolCallId, rawParams, signal, onUpdate, ctx) {
      const params = rawParams as OpenspecToolParams;
      const cwd = resolveRoot(params, ctx);

      let argv: string[];
      let subcommand: OpenspecSubcommand;
      try {
        const built = buildArgv(params);
        argv = built.argv;
        subcommand = built.subcommand;
      } catch (error) {
        const message =
          error instanceof OpenspecArgvError
            ? error.message
            : `Invalid parameters: ${(error as Error).message}`;
        // Throwing (rather than encoding the error in content) is what pi
        // expects from a tool; the message is already model-actionable.
        throw new Error(message);
      }

      onUpdate?.({
        content: [{ type: "text", text: `openspec ${argv.join(" ")}` }],
        details: { ok: true, argv, cwd, pending: true },
      });

      const result = await runOpenspec({
        argv,
        cwd,
        signal,
        timeoutMs: options.timeoutMs,
        binary: options.binary,
      });

      try {
        options.onRun?.(params, result);
      } catch {
        // Status-bar bookkeeping must never fail the tool call.
      }

      if (result.spawnError) {
        throw new Error(
          `Failed to start the OpenSpec CLI (${result.binary.label}): ${result.spawnError}. ` +
            `Install @fission-ai/openspec or set PI_OPENSPEC_BIN.`,
        );
      }

      const ok = !result.timedOut && result.exitCode === 0;
      return {
        content: [{ type: "text", text: formatRunForModel(result) }],
        details: {
          ok,
          subcommand,
          argv,
          cwd,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          spawnError: result.spawnError,
          durationMs: result.durationMs,
          binary: result.binary.label,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };
    },
  };

  pi.registerTool(definition);
}
