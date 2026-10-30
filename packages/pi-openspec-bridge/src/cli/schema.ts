// src/cli/schema.ts
//
// Hand-written bridge schema for the OpenSpec CLI (verb-first surface of
// @fission-ai/openspec 1.15.x).
//
// Two things live here:
//   1. OPENSPEC_SUBCOMMANDS — the flat list of every documented subcommand
//      path. The tool exposes it as an enum so the model can only pick a
//      real command (100% subcommand coverage, zero free-form guessing).
//   2. FLAGS — one descriptor per CLI flag (key, flag string, kind). The
//      tool builds argv from these, so adding a flag in a future OpenSpec
//      release is a one-line change here.
//
// Hidden commands (`experimental`, `__complete`) are intentionally absent:
// they are internal/deprecated and not part of the agent surface.

import { Type, type TSchema } from "typebox";

/** Every documented subcommand path, in help order. */
export const OPENSPEC_SUBCOMMANDS = [
  // project lifecycle
  "init",
  "update",
  "install",
  "version",
  // reading
  "list",
  "show",
  "view",
  "status",
  "instructions",
  "context",
  "doctor",
  // changes (verb-first)
  "new change",
  "archive",
  "validate",
  // specs
  "spec list",
  "spec show",
  "spec validate",
  // change group (deprecated aliases, kept for compatibility)
  "change list",
  "change show",
  "change validate",
  // workflow schemas
  "schemas",
  "templates",
  "schema which",
  "schema validate",
  "schema fork",
  "schema init",
  // stores
  "store list",
  "store setup",
  "store register",
  "store unregister",
  "store remove",
  "store doctor",
  // worksets
  "workset list",
  "workset create",
  "workset open",
  "workset remove",
  // global config
  "config path",
  "config list",
  "config get",
  "config set",
  "config unset",
  "config reset",
  "config edit",
  "config profile",
  // shell completions
  "completion generate",
  "completion install",
  "completion uninstall",
  // misc
  "feedback",
] as const;

export type OpenspecSubcommand = (typeof OPENSPEC_SUBCOMMANDS)[number];

export type FlagKind = "boolean" | "string" | "number";

export interface FlagSpec {
  /** camelCase param key (the tool parameter name). */
  readonly key: string;
  /** CLI flag as passed to the binary, e.g. "--skip-specs". */
  readonly flag: string;
  readonly kind: FlagKind;
  /** Subcommands that accept this flag. `undefined` = not restricted. */
  readonly appliesTo?: readonly OpenspecSubcommand[];
  /** One-line description for the JSON schema. */
  readonly description: string;
}

const STORE_COMMANDS: readonly OpenspecSubcommand[] = [
  "list",
  "show",
  "view",
  "archive",
  "validate",
  "status",
  "instructions",
  "context",
  "doctor",
  "schemas",
  "new change",
  "spec list",
  "spec show",
  "spec validate",
  "change list",
  "change show",
  "change validate",
];

/**
 * Flag registry. Order matters only for argv readability: positionals are
 * emitted first, then flags in this order.
 */
export const FLAGS: readonly FlagSpec[] = [
  {
    key: "json",
    flag: "--json",
    kind: "boolean",
    description:
      "Machine-readable JSON output. Prefer this for anything you want to parse.",
  },
  {
    key: "store",
    flag: "--store",
    kind: "string",
    appliesTo: STORE_COMMANDS,
    description:
      "Id of a registered store to use as the OpenSpec root. Use instead of `root` when the spec repo is registered locally.",
  },
  {
    key: "all",
    flag: "--all",
    kind: "boolean",
    description:
      "list: include archived changes. status/validate: every active change instead of one.",
  },
  {
    key: "archived",
    flag: "--archived",
    kind: "boolean",
    description:
      "list: show only archived changes. validate: check archived changes have all tasks completed.",
  },
  { key: "specs", flag: "--specs", kind: "boolean", description: "List / validate specs instead of changes." },
  { key: "changes", flag: "--changes", kind: "boolean", description: "List / validate changes (the default)." },
  {
    key: "sort",
    flag: "--sort",
    kind: "string",
    description: 'list: sort order, "recent" (default) or "name".',
  },
  {
    key: "change",
    flag: "--change",
    kind: "string",
    description: "status / instructions: change name. Same as passing it as a positional.",
  },
  {
    key: "schemaName",
    flag: "--schema",
    kind: "string",
    description: "Workflow schema override (auto-detected from openspec/config.yaml otherwise).",
  },
  {
    key: "type",
    flag: "--type",
    kind: "string",
    description: 'show / validate: "change" or "spec" when the name is ambiguous.',
  },
  {
    key: "report",
    flag: "--report",
    kind: "string",
    description: 'validate: bulk report content, "full" or "findings".',
  },
  {
    key: "concurrency",
    flag: "--concurrency",
    kind: "number",
    description: "validate: max concurrent validations (default 6).",
  },
  { key: "strict", flag: "--strict", kind: "boolean", description: "Enable strict validation mode." },
  {
    key: "deltasOnly",
    flag: "--deltas-only",
    kind: "boolean",
    description: "show: only the delta specs (JSON output only).",
  },
  {
    key: "diff",
    flag: "--diff",
    kind: "boolean",
    description: "show: per-requirement diffs for delta specs.",
  },
  {
    key: "requirements",
    flag: "--requirements",
    kind: "boolean",
    description: "spec show: only requirements, no scenarios.",
  },
  {
    key: "requirement",
    flag: "--requirement",
    kind: "string",
    description: "spec show: show a single requirement by 1-based id.",
  },
  {
    key: "noScenarios",
    flag: "--no-scenarios",
    kind: "boolean",
    description: "spec show: exclude scenario content (JSON only).",
  },
  {
    key: "long",
    flag: "--long",
    kind: "boolean",
    description: "spec list / change list: show id and title with counts.",
  },
  {
    key: "description",
    flag: "--description",
    kind: "string",
    description: "new change: description written into the change README. schema init: schema description.",
  },
  {
    key: "goal",
    flag: "--goal",
    kind: "string",
    description: "new change: optional goal metadata stored with the change.",
  },
  {
    key: "yes",
    flag: "--yes",
    kind: "boolean",
    description: "Skip confirmation prompts (archive, config reset, store remove, workset remove, completion uninstall).",
  },
  {
    key: "skipSpecs",
    flag: "--skip-specs",
    kind: "boolean",
    description: "archive: skip spec update operations (infra / docs-only changes).",
  },
  {
    key: "noValidate",
    flag: "--no-validate",
    kind: "boolean",
    description: "archive: skip validation (not recommended).",
  },
  {
    key: "noInteractive",
    flag: "--no-interactive",
    kind: "boolean",
    description: "Disable interactive prompts. Always set this when running unattended.",
  },
  {
    key: "force",
    flag: "--force",
    kind: "boolean",
    description: "init / update / schema fork / schema init: overwrite existing files without prompting.",
  },
  {
    key: "dryRun",
    flag: "--dry-run",
    kind: "boolean",
    description: "update: report planned changes without writing anything.",
  },
  {
    key: "check",
    flag: "--check",
    kind: "boolean",
    description: "version: also check the registry for a newer release.",
  },
  {
    key: "tools",
    flag: "--tools",
    kind: "string",
    description: 'init: AI tools to configure — "all", "none", or a comma-separated tool id list.',
  },
  {
    key: "language",
    flag: "--language",
    kind: "string",
    description: "init: language new artifacts are written in.",
  },
  {
    key: "profile",
    flag: "--profile",
    kind: "string",
    description: 'init: workflow profile override ("core" or a custom profile).',
  },
  {
    key: "noAnimation",
    flag: "--no-animation",
    kind: "boolean",
    description: "init: static welcome screen instead of the animated one.",
  },
  {
    key: "noCopilotCloud",
    flag: "--no-copilot-cloud",
    kind: "boolean",
    description: "init: skip GitHub Copilot cloud coding-agent files.",
  },
  {
    key: "tool",
    flag: "--tool",
    kind: "string",
    description: "workset: editor / agent tool id to open or scaffold for.",
  },
  {
    key: "member",
    flag: "--member",
    kind: "string",
    description: "workset create: member folder. Repeat via the args array or call workset create once per member.",
  },
  {
    key: "id",
    flag: "--id",
    kind: "string",
    description: "store register: explicit store id.",
  },
  {
    key: "path",
    flag: "--path",
    kind: "string",
    description: "store setup: local folder for the new store.",
  },
  {
    key: "initGit",
    flag: "--init-git",
    kind: "boolean",
    description: "store setup: initialize a git repo in the new store.",
  },
  {
    key: "noInitGit",
    flag: "--no-init-git",
    kind: "boolean",
    description: "store setup: do not initialize a git repo.",
  },
  {
    key: "remote",
    flag: "--remote",
    kind: "string",
    description: "store setup: git remote url for the new store.",
  },
  {
    key: "artifacts",
    flag: "--artifacts",
    kind: "string",
    description: "schema init: comma-separated list of artifact ids.",
  },
  {
    key: "defaultSchema",
    flag: "--default",
    kind: "boolean",
    description: "schema init: make the new schema the project default.",
  },
  {
    key: "noDefault",
    flag: "--no-default",
    kind: "boolean",
    description: "schema init: do not make the new schema the default.",
  },
  {
    key: "string",
    flag: "--string",
    kind: "boolean",
    description: "config set: store the value as a raw string instead of coercing its type.",
  },
  {
    key: "allowUnknown",
    flag: "--allow-unknown",
    kind: "boolean",
    description: "config set: accept keys that are not in the schema.",
  },
  {
    key: "scope",
    flag: "--scope",
    kind: "string",
    description: "config: config scope to read or write.",
  },
  {
    key: "codeWorkspace",
    flag: "--code-workspace",
    kind: "string",
    description: "context: also write a VS Code workspace file at this path.",
  },
  {
    key: "body",
    flag: "--body",
    kind: "string",
    description: "feedback: detailed description.",
  },
  {
    key: "verbose",
    flag: "--verbose",
    kind: "boolean",
    description: "completion install / schema validate: extra detail.",
  },
] as const;

/** Flags that take a value (needed to keep argv well-formed). */
export function isValueFlag(spec: FlagSpec): boolean {
  return spec.kind !== "boolean";
}

/**
 * TypeBox parameters object for the `openspec` tool.
 *
 * `root` is handled by the bridge itself (it becomes the child process cwd),
 * and is therefore listed first alongside `subcommand` and `args`.
 */
export function buildOpenspecParameters() {
  const shape: Record<string, TSchema> = {
    subcommand: Type.Unsafe<OpenspecSubcommand>({
      type: "string",
      enum: [...OPENSPEC_SUBCOMMANDS],
      description:
        "OpenSpec subcommand to run. Every documented subcommand is listed; use `args` for its positionals and the boolean/string params for its flags.",
    }),
    args: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Positional arguments in CLI order, e.g. ["add-dark-mode"] for `new change`, or ["spec-name","Title"] where a command takes two.',
      }),
    ),
    root: Type.Optional(
      Type.String({
        description:
          "Spec root directory — the directory containing (or to contain) `openspec/`. The command runs with this as its cwd, so no `cd` is needed. Defaults to the session cwd.",
      }),
    ),
  };

  for (const spec of FLAGS) {
    if (!spec.flag) continue; // bridge-only params (e.g. `root`) are declared above
    const base =
      spec.kind === "boolean"
        ? Type.Boolean({ description: spec.description })
        : spec.kind === "number"
          ? Type.Number({ description: spec.description })
          : Type.String({ description: spec.description });
    shape[spec.key] = Type.Optional(base);
  }

  return Type.Object(shape);
}

export type OpenspecToolParams = {
  subcommand: OpenspecSubcommand;
  args?: string[];
  root?: string;
} & Partial<Record<string, string | number | boolean>>;
