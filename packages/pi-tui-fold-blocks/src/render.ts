// packages/pi-tui-fold-blocks/src/render.ts
import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FoldBlocksConfig } from "./config.js";
import { foldPath } from "./folders/path.js";
import { foldCommand } from "./folders/command.js";
import type { ModeState } from "./mode.js";

export interface FoldLineOpts {
  toolName: string;
  kind: "file" | "bash";
  path?: string;
  command?: string;
  args: Record<string, unknown> | null;
  rows: number;
  exitCode?: number;
  config: FoldBlocksConfig;
  cwd: string;
}

export function buildFoldLine(opts: FoldLineOpts): { left: string; right: string } | null {
  if (opts.config.mode === "hide") return null;
  const icon = opts.config.nerdFont
    ? { read: "\uF0E7", write: "\uF0C5", edit: "\uF044", bash: "\uF489" }[opts.toolName] ?? ""
    : "";
  if (opts.kind === "bash") {
    const cmd = opts.command ?? String(opts.args?.command ?? "");
    const summary = foldCommand(cmd, { smart: opts.config.bashBlocks.smart });
    const left = `${icon ? icon + " " : ""}exec ${summary}`.trim();
    const right = opts.exitCode !== undefined ? `${opts.rows} lines, exit ${opts.exitCode}` : `${opts.rows} lines`;
    return { left, right };
  }
  const path = opts.path ?? String(opts.args?.path ?? "");
  const shown = foldPath(path, { cwd: opts.cwd, style: opts.config.fileBlocks.pathStyle, foldGitWorktree: opts.config.fileBlocks.foldGitWorktree });
  const paramBits: string[] = [];
  if (typeof opts.args?.offset === "number") paramBits.push(`offset ${opts.args.offset}`);
  if (typeof opts.args?.limit === "number") paramBits.push(`limit ${opts.args.limit}`);
  const left = `${icon ? icon + " " : ""}${opts.toolName} ${shown}${paramBits.length ? ` (${paramBits.join(", ")})` : ""}`.trim();
  return { left, right: String(opts.rows) };
}

export interface RenderBlockOpts {
  toolName: string;
  kind: "file" | "bash";
  args: unknown;
  result: unknown;
  isPartial: boolean;
  isError: boolean;
  expanded: boolean;
  config: FoldBlocksConfig;
  cwd: string;
  modeState: ModeState;
  theme: Theme;
  lastComponent: unknown;
  toolCallId: string;
}

/** 从 AgentToolResult.content 提取文本行数(TextContent 聚合)。 */
export function contentRows(result: unknown): number {
  const content = (result as { content?: { text?: string }[] } | undefined)?.content;
  if (!Array.isArray(content)) return 0;
  return content.reduce((n, c) => n + (typeof c.text === "string" ? c.text.split("\n").length : 0), 0);
}

/** 从 AgentToolResult.content 提取退出码(形如 "exit code N");提取失败返回 undefined。 */
export function contentExitCode(result: unknown): number | undefined {
  const content = (result as { content?: { text?: string }[] } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content.map((c) => c.text ?? "").join("\n");
  const m = /exit code (\d+)/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

/** 背景:文件块恒绿;bash 按 isPartial(黄)/isError(红)/成功(绿)。 */
function bgFor(opts: RenderBlockOpts): (text: string) => string {
  if (opts.kind === "file") return (t) => opts.theme.bg("toolSuccessBg", t);
  if (opts.isPartial) return (t) => opts.theme.bg("toolPendingBg", t);
  if (opts.isError) return (t) => opts.theme.bg("toolErrorBg", t);
  return (t) => opts.theme.bg("toolSuccessBg", t);
}

export function renderBlock(opts: RenderBlockOpts): Text {
  if (opts.modeState.mode === "hide") return new Text("", 0, 0); // 空 Text → 0 行 → 块整体消失
  const args = (opts.args ?? {}) as Record<string, unknown>;
  const rows = contentRows(opts.result);
  const exitCode = contentExitCode(opts.result);
  const line = buildFoldLine({
    toolName: opts.toolName,
    kind: opts.kind,
    path: opts.kind === "file" ? String(args.path ?? "") : undefined,
    command: opts.kind === "bash" ? String(args.command ?? "") : undefined,
    args,
    rows,
    exitCode,
    config: opts.config,
    cwd: opts.cwd,
  });
  const text = line ? buildSingleLine(line.left, line.right) : "";
  const t = (opts.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  t.setText(text);
  t.setCustomBgFn(bgFor(opts));
  return t;
}

/** 单行组装:左概要截断 60、右统计截断 24,中间留白避免 Text 自动换行。 */
export function buildSingleLine(left: string, right: string): string {
  const l = left.length > 60 ? left.slice(0, 57) + "..." : left;
  const r = right.length > 24 ? right.slice(0, 21) + "..." : right;
  return `${l}${r ? " ".repeat(Math.max(1, 24 - r.length)) + r : ""}`;
}