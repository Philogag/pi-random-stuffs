// src/index.ts
import { Type, type Static } from "typebox";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SessionRegistry, type ExecResult, type SessionInfo } from "./session.js";
import { createContainerSession, type ContainerCreateResult } from "./container.js";

export const EXTENSION_ID = "pi-tool-presistant-bash";

export interface PresistantBashOptions {
  /**
   * Session registry instance. Overridable for tests; defaults to a
   * fresh registry per extension load.
   */
  registry?: SessionRegistry;
}

const createParams = Type.Object({
  /** Label for the session (informational; helps the agent tell sessions apart). */
  label: Type.Optional(Type.String()),
  /** argv of the command to spawn, e.g. ["bash"] or ["docker", "exec", "-it", "c", "bash"]. */
  command: Type.Optional(Type.Array(Type.String())),
  /** Working directory for the spawned process. */
  cwd: Type.Optional(Type.String()),
});
type CreateParams = Static<typeof createParams>;

const execParams = Type.Object({
  /** Session id returned by presistant-bash-create. */
  sessionId: Type.String(),
  /** The command to run inside the session. */
  command: Type.String(),
  /** Kill the session if the command runs longer than this many ms. */
  timeoutMs: Type.Optional(Type.Number()),
});
type ExecParams = Static<typeof execParams>;

const destroyParams = Type.Object({
  sessionId: Type.String(),
});
type DestroyParams = Static<typeof destroyParams>;

const listParams = Type.Object({});
type ListParams = Static<typeof listParams>;

const createContainerParams = Type.Object({
  /** Container runtime: "docker" (default) or "podman". */
  runtime: Type.Optional(Type.String()),
  /** Container image, e.g. "node:22" or "alpine". */
  image: Type.String(),
  /** Extra `docker run` args (volumes, ports, env…). Do NOT include -it/-d/image. */
  args: Type.Optional(Type.Array(Type.String())),
  /** Shell inside the container (default "bash"). */
  shell: Type.Optional(Type.String()),
  /** Keep-alive command (default ["tail", "-f", "/dev/null"]). */
  keepAlive: Type.Optional(Type.Array(Type.String())),
  /** Label for the session. */
  label: Type.Optional(Type.String()),
});
type CreateContainerParams = Static<typeof createContainerParams>;

const doneText = (exitCode: number | undefined, cancelled: boolean): string =>
  cancelled
    ? "\n(command cancelled)"
    : `\n[exit code: ${exitCode ?? "unknown"}]`;

export function createTools(registry: SessionRegistry): ToolDefinition[] {
  return [
    {
      name: "presistant-bash-create",
      label: "Create persistent bash session",
      description:
        "Create a new long-lived shell session. The spawned process stays alive " +
        "between commands, so cd, export, and virtualenv activation persist. " +
        "Returns a session id. The agent decides what to spawn — e.g. local bash, " +
        "`docker exec -it <container> bash`, or an ssh session — via the `command` array.",
      promptSnippet: "Create a persistent bash session",
      parameters: createParams,
      execute: async (
        _toolCallId,
        params: CreateParams,
      ): Promise<{ content: { type: "text"; text: string }[]; details: SessionInfo }> => {
        const info = registry.create({
          label: params.label,
          command: params.command,
          cwd: params.cwd,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created persistent bash session ${info.id}${
                info.label ? ` (${info.label})` : ""
              }.\nUse presistant-bash-exec with sessionId "${info.id}" to run commands.`,
            },
          ],
          details: info,
        };
      },
    },
    {
      name: "presistant-bash-create-container",
      label: "Create persistent bash session in a container",
      description:
        "Create a docker/podman container and attach a persistent bash session to it. " +
        "The container is started detached (docker/podman run -d) with a keep-alive " +
        "command (tail -f /dev/null by default) so it stays up without a TTY; the " +
        "session attaches via docker/podman exec -i (no -t). The container is removed " +
        "when the session is destroyed. Returns a session id usable with " +
        "presistant-bash-exec / -list / -destroy.",
      promptSnippet: "Create a persistent bash session inside a docker/podman container",
      parameters: createContainerParams,
      execute: async (
        _toolCallId,
        params: CreateContainerParams,
      ): Promise<{ content: { type: "text"; text: string }[]; details: ContainerCreateResult }> => {
        const { containerShortId, session } = createContainerSession(registry, params);
        return {
          content: [
            {
              type: "text",
              text:
                `Created container ${containerShortId} (${params.runtime ?? "docker"} ${params.image}) ` +
                `with persistent bash session ${session.id}.\n` +
                `Use presistant-bash-exec with sessionId "${session.id}" to run commands.`,
            },
          ],
          details: { containerShortId, containerId: containerShortId, session },
        };
      },
    },
    {
      name: "presistant-bash-exec",
      label: "Run command in persistent bash session",
      description:
        "Run a command inside an existing persistent bash session (created with " +
        "presistant-bash-create). Shell state (cwd, exports, venv) from earlier " +
        "commands in the same session is preserved.",
      promptSnippet: "Run a command in a persistent bash session",
      parameters: execParams,
      execute: async (
        _toolCallId,
        params: ExecParams,
        signal,
      ): Promise<{ content: { type: "text"; text: string }[]; details: ExecResult }> => {
        const session = registry.get(params.sessionId);
        if (!session) {
          throw new Error(`no such session: ${params.sessionId} (list active sessions with presistant-bash-list)`);
        }
        const result = await session.exec(params.command, {
          signal,
          timeoutMs: params.timeoutMs,
        });
        return {
          content: [
            {
              type: "text",
              text: `${result.output}${doneText(result.exitCode, result.cancelled)}`,
            },
          ],
          details: result,
        };
      },
    },
    {
      name: "presistant-bash-list",
      label: "List persistent bash sessions",
      description:
        "List all active persistent bash sessions with their ids, labels, commands, " +
        "working directories, and creation time. Use the ids with presistant-bash-exec.",
      promptSnippet: "List active persistent bash sessions",
      parameters: listParams,
      execute: async (): Promise<{ content: { type: "text"; text: string }[]; details: SessionInfo[] }> => {
        const sessions = registry.list();
        const lines =
          sessions.length === 0
            ? ["No active sessions."]
            : sessions.map((s) => {
                const label = s.label ? ` (${s.label})` : "";
                const alive = s.alive ? "alive" : "dead";
                return `- ${s.id}${label} — ${s.command} @ ${s.cwd} [${alive}, created ${new Date(s.createdAt).toISOString()}]`;
              });
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: sessions,
        };
      },
    },
    {
      name: "presistant-bash-destroy",
      label: "Destroy persistent bash session",
      description:
        "Terminate and remove a persistent bash session. Any shell state in it is lost. " +
        "Safe to call on a session id that no longer exists.",
      promptSnippet: "Destroy a persistent bash session",
      parameters: destroyParams,
      execute: async (
        _toolCallId,
        params: DestroyParams,
      ): Promise<{ content: { type: "text"; text: string }[]; details: { destroyed: boolean } }> => {
        const { destroyed } = registry.destroy(params.sessionId);
        return {
          content: [
            {
              type: "text",
              text: destroyed
                ? `Destroyed session ${params.sessionId}.`
                : `No such session ${params.sessionId} (nothing to destroy).`,
            },
          ],
          details: { destroyed },
        };
      },
    },
  ];
}

/**
 * pi extension: long-lived bash sessions for the agent.
 *
 * The agent creates sessions via `presistant-bash-create` (spawning whatever
 * it needs — local bash, docker exec, ssh), runs commands inside them with
 * `presistant-bash-exec`, inspects them with `presistant-bash-list`, and
 * tears them down with `presistant-bash-destroy`. Sessions live only in
 * memory: when the pi session shuts down all processes are killed, and a
 * resumed session starts empty (the agent recreates what it needs).
 */
export default function (pi: ExtensionAPI, options: PresistantBashOptions = {}): void {
  const registry = options.registry ?? new SessionRegistry();

  for (const tool of createTools(registry)) {
    pi.registerTool(tool);
  }

  // Kill all sessions when the pi session ends. Sessions are intentionally
  // NOT restored on resume: the agent recreates them as needed.
  pi.on("session_shutdown", () => {
    registry.destroyAll();
  });
}
