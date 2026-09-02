// src/fold-compat.ts
//
// presistant-bash 侧的折叠兼容装配。本模块运行时**不静态依赖**
// @philogag/pi-tui-fold-blocks(rollback 契约):fold-blocks 缺失时扩展必须照常
// 加载。所有 fold-blocks 符号均为 type-only import(编译期擦除)或经
// attachExecFoldCompat 的 loader 注入。
import type {
  FoldBlocksConfig,
  FoldCommandOpts,
  LineContext,
  ToolRenderContext,
} from "@philogag/pi-tui-fold-blocks";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ExecResult } from "./session.js";

/** 毫秒超时 → 展示串:undefined → "";15000 → "15s";7500 → "7.5s"(去掉尾随 .0)。 */
export function formatTimeoutMs(timeoutMs: number | undefined): string {
  if (timeoutMs === undefined) return "";
  const seconds = timeoutMs / 1000;
  const rounded = Math.round(seconds * 10) / 10;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(/\.0+$/, "");
  return `${text}s`;
}

/** 输出文本行数(含空行);末尾换行不计独立行——与 fold-blocks contentLineCount 同一约定。 */
export function execOutputLineCount(output: string): number {
  if (!output) return 0;
  const lines = output.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

/**
 * exec 失败态判定。presistant-bash-exec 从不抛错(ctx.isError 恒 false),失败态
 * 只能从 ExecResult details 推导:
 *  - 取消 → error,无退出码(即使进程事后留下 exitCode);
 *  - exitCode 0 → 成功;
 *  - 非零 exitCode → error + 该码;
 *  - exitCode 缺失且未取消 → error,无退出码。
 */
export function execStatus(
  details: ExecResult | undefined | null,
): { error: boolean; code: number | undefined } {
  if (!details) return { error: true, code: undefined };
  if (details.cancelled) return { error: true, code: undefined };
  if (details.exitCode === 0) return { error: false, code: undefined };
  if (typeof details.exitCode === "number") {
    return { error: true, code: details.exitCode };
  }
  return { error: true, code: undefined };
}

export interface ExecResultLike {
  output?: string;
  exitCode?: number;
  cancelled?: boolean;
}

/** fold-blocks foldCommand 同签名。 */
export type FoldCommandFn = (command: string, opts: FoldCommandOpts) => string;

// 镜像 fold-blocks src/folders/command.ts 的智能折叠规则(见该文件的注释),保证
// exec 行的 shown 段与 bash 行逐字节同形。装配时若 fold-blocks 已加载,渲染器会优先
// 用 fold-blocks 自身的 foldCommand(见 buildExecFoldLine 的 opts.foldCommand)。
const WRAP_PREFIX = /^(?:cd\s+\S+\s*&&|source\s+\S+\s*&&|export\s+[^=]+=\S*\s*&&)\s*/;

export function foldExecCommand(command: string, opts: FoldCommandOpts): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (opts.smart) {
    let cur = trimmed.replace(/\\\r?\n\s*/g, "").replace(/\r?\n\s*/g, " ⏎ ");
    let next = cur.replace(WRAP_PREFIX, "");
    while (next !== cur) {
      cur = next;
      next = cur.replace(WRAP_PREFIX, "");
    }
    return cur;
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function execDetailsOf(result: unknown): ExecResultLike | undefined {
  const details = (result as { details?: unknown } | undefined)?.details;
  if (details && typeof details === "object") {
    return details as ExecResultLike;
  }
  return undefined;
}

function contentTextOf(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] } | undefined)
    ?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === undefined || c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

/** 折叠行内容/统计所需的 result 侧信息:失败态 + 展示行数。 */
function foldResultInfo(result: unknown): {
  error: boolean;
  code: number | undefined;
  lineCount: number;
} {
  const details = execDetailsOf(result);
  if (details) {
    const { error, code } = execStatus(details as ExecResult);
    return { error, code, lineCount: execOutputLineCount(details.output ?? "") };
  }
  // 回退:details 缺失时解析 content 文本里的退出码(兼容 presistant 自带
  // "[exit code: N]" 等格式);解析不到则按成功处理。
  const text = contentTextOf(result);
  const m = /exit code[: ]?\s*(\d+)/i.exec(text);
  if (!m) return { error: false, code: undefined, lineCount: execOutputLineCount(text) };
  const code = Number(m[1]);
  return {
    error: code !== 0,
    code: code === 0 ? undefined : code,
    lineCount: execOutputLineCount(text),
  };
}

export interface ExecFoldLineOpts {
  stage: "call" | "result";
  config: FoldBlocksConfig;
  /** result 阶段挂载的 AgentToolResult(details 为 ExecResult)。 */
  result?: unknown;
  /** foldCommand 实现;缺省用本模块内置的 fold-blocks 镜像(纯函数场景/测试)。 */
  foldCommand?: FoldCommandFn;
}

/**
 * 构造 exec 折叠行文本(LineContext)。与 fold-blocks 内置 bash 行的行文本规则逐条对齐:
 * icon = nerdFont ? \uf489 : ""、tool = "exec"、shown = 智能折叠后的命令;tips 仅
 * result 阶段展示 [ 超时秒?, N lines?, exit M? ](0 行不显示、成功不显示 exit);
 * result 段 = 失败? FAILED[(M)] : SUCCESS。失败态源自 result.details(ExecResult),
 * 而非 ctx.isError(presistant 从不置 isError)。
 */
export function buildExecFoldLine(
  ctx: ToolRenderContext,
  opts: ExecFoldLineOpts,
): LineContext {
  const args = ctx?.args as { command?: unknown; timeoutMs?: number } | undefined;
  const command = typeof args?.command === "string" ? args.command : "";
  const fold = opts.foldCommand ?? foldExecCommand;
  const shown = fold(command, { smart: opts.config.bashBlocks.smart });
  const icon = opts.config.nerdFont ? "\uf489" : "";
  if (opts.stage === "call") {
    // 运行中:单行折叠命令预览,无 tips/result 段。
    return { icon, tool: "exec", shown, tips: "", result: "" };
  }
  const { error, code, lineCount } = foldResultInfo(opts.result);
  const tipParts: string[] = [];
  const timeoutS = formatTimeoutMs(args?.timeoutMs);
  if (timeoutS) tipParts.push(timeoutS);
  if (lineCount > 0) tipParts.push(`${lineCount} lines`);
  if (error && code !== undefined) tipParts.push(`exit ${code}`);
  return {
    icon,
    tool: "exec",
    shown,
    tips: tipParts.length > 0 ? `[ ${tipParts.join(", ")} ]` : "",
    result: error ? (code !== undefined ? `FAILED(${code})` : "FAILED") : "SUCCESS",
  };
}

// ---------------------------------------------------------------------------
// 渲染分派(2.3):fold → renderOwnedBlock;hide → 空;native → pi 默认观感复刻。
// 组件用本地结构类型(不 import pi-tui):pi-tui 的 Component 契约即
// { render(width): string[]; invalidate(): void } + 可选成员,结构兼容。
// ---------------------------------------------------------------------------

/** pi-tui Component 的结构子集(render/invalidate 为必选成员)。 */
export interface RendererComponent {
  invalidate(): void;
  render(width: number): string[];
}

class EmptyComponent implements RendererComponent {
  invalidate(): void {}
  render(_width: number): string[] {
    return [];
  }
}

const EMPTY: RendererComponent = new EmptyComponent();

/** 可见宽度(剥 ANSI SGR / OSC8 链接标记后按码点计数)。 */
function visibleWidth(s: string): number {
  const stripped = s
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b[()][A-Z0-9]/g, "");
  return [...stripped].length;
}

function padToWidth(s: string, width: number): string {
  const extra = width - visibleWidth(s);
  return extra > 0 ? s + " ".repeat(extra) : s;
}

/**
 * 默认观感块:复刻 pi 默认渲染的 Box(1,1,bgFn) 外框 + 逐行内容。
 * 已知偏差(见 design R4):不做软折行、expand keycap 用静态 muted 文案代替。
 */
class DefaultBlock implements RendererComponent {
  constructor(
    private readonly rows: string[],
    private readonly bgFn: (line: string) => string,
  ) {}
  invalidate(): void {}
  render(width: number): string[] {
    const w = Math.max(0, Math.floor(width));
    if (w === 0 || this.rows.length === 0) return [];
    const padX = Math.min(1, Math.max(0, Math.floor((w - 1) / 2)));
    const contentWidth = Math.max(1, w - padX * 2);
    const leftPad = " ".repeat(padX);
    const emptyRow = this.bgFn(" ".repeat(w));
    const out: string[] = [emptyRow];
    for (const raw of this.rows) {
      out.push(this.bgFn(leftPad + padToWidth(raw, contentWidth)));
    }
    out.push(emptyRow);
    return out;
  }
}

export interface FoldRenderAccess {
  /** 每次渲染时读取的 live 配置(fold-blocks getFoldConfig)。 */
  getConfig: () => FoldBlocksConfig;
  /** 配置变更订阅(fold-blocks subscribeFoldConfig)。 */
  subscribeConfig: (cb: (cfg: FoldBlocksConfig) => void) => () => void;
  /** fold-blocks renderOwnedBlock(真实折叠行组件)。 */
  renderOwnedBlock: (
    ctx: ToolRenderContext,
    opts: FoldRenderOpts,
    lineBuilder: (ctx: ToolRenderContext, opts: FoldRenderOpts) => LineContext,
  ) => RendererComponent;
  /** fold-blocks foldCommand。 */
  foldCommand: FoldCommandFn;
}

/**
 * 传给 renderOwnedBlock 的 opts:与 fold-blocks 内部 RenderBlockOpts 结构同构
 * (该接口未导出),另携带 foldCommand 供 buildExecFoldLine 使用。
 */
export interface FoldRenderOpts {
  name: string;
  stage: "call" | "result";
  args: unknown;
  result?: unknown;
  cwd: string;
  config: FoldBlocksConfig;
  theme: Theme;
  foldCommand?: FoldCommandFn;
}

/** exec 工具折叠渲染器集合(供 attachExecFoldCompat 装配到工具定义)。 */
export interface ExecFoldRenderers {
  renderShell: "self";
  renderCall: (
    args: unknown,
    theme: Theme,
    ctx: ToolRenderContext,
  ) => RendererComponent;
  renderResult: (
    result: unknown,
    options: { expanded: boolean; isPartial: boolean },
    theme: Theme,
    ctx: ToolRenderContext,
  ) => RendererComponent;
}

export interface BuildExecFoldRenderersOptions {
  /** 渲染回调按 toolCallId 登记 invalidate 的钩子(fold-blocks mode.ts 同款)。 */
  registerInvalidator?: (toolCallId: string, invalidate: () => void) => void;
}

const EXEC_TOOL_NAME = "presistant-bash-exec";
const NATIVE_PREVIEW_LINES = 10;

function nativeTitle(theme: Theme): string {
  return theme.fg("toolTitle", theme.bold(EXEC_TOOL_NAME));
}

/** pi 默认 result 观感:前 10 行预览(expanded 时全量),溢出提示 muted 静态文本。 */
function nativeResultRows(text: string, expanded: boolean, theme: Theme): string[] {
  const lines = text.split("\n");
  const displayLines = expanded ? lines : lines.slice(0, NATIVE_PREVIEW_LINES);
  const remaining = lines.length - displayLines.length;
  const rows = displayLines.map((line) => theme.fg("toolOutput", line));
  if (remaining > 0) {
    rows.push(theme.fg("muted", `... (${remaining} more lines, expand to view)`));
  }
  return rows;
}

function nativeResultComponent(result: unknown, expanded: boolean, theme: Theme): RendererComponent {
  const text = contentTextOf(result);
  // 默认 shell 最终帧 = 工具名标题行 + 输出预览行,同处一个成功色块(exec 从不置 isError)。
  const rows = text === "" ? [nativeTitle(theme)] : [nativeTitle(theme), ...nativeResultRows(text, expanded, theme)];
  return new DefaultBlock(rows, (line) => theme.bg("toolSuccessBg", line));
}

/**
 * 三态渲染分派的核心工厂。渲染器每次调用都经 access.getConfig() 读 live 配置,
 * 因此配置/模式变更在下次渲染(或经 invalidator 触发重渲染)时即时生效。
 */
export function buildExecFoldRenderers(
  access: FoldRenderAccess,
  options: BuildExecFoldRenderersOptions = {},
): ExecFoldRenderers {
  const registerInvalidator = options.registerInvalidator ?? (() => {});

  const renderCall: ExecFoldRenderers["renderCall"] = (_args, theme, ctx) => {
    registerInvalidator(ctx.toolCallId, ctx.invalidate);
    const config = access.getConfig();
    if (config.mode === "native") {
      // 运行中(无 result)默认观感 = 黄色块内的工具名标题行;result 到达后 call 槽退让。
      return ctx.isPartial
        ? new DefaultBlock([nativeTitle(theme)], (line) => theme.bg("toolPendingBg", line))
        : EMPTY;
    }
    return access.renderOwnedBlock(
      ctx,
      {
        name: "exec",
        stage: "call",
        args: ctx.args,
        cwd: ctx.cwd,
        config,
        theme,
        foldCommand: access.foldCommand,
      },
      buildExecFoldLine as never,
    );
  };

  const renderResult: ExecFoldRenderers["renderResult"] = (result, options, theme, ctx) => {
    registerInvalidator(ctx.toolCallId, ctx.invalidate);
    const config = access.getConfig();
    if (config.mode === "native") {
      return options.isPartial ? EMPTY : nativeResultComponent(result, options.expanded, theme);
    }
    // fold / hide:失败态源自 details(而非 ctx.isError),故克隆 ctx 修正 isError 以得到
    // 红色背景(renderOwnedBlock 的 bgFor 读 ctx.isError);hide 由 renderOwnedBlock 内
    // 返回空 Text(整块消失)。
    const foldCtx =
      options.isPartial ? ctx : { ...ctx, isError: foldResultInfo(result).error };
    return access.renderOwnedBlock(
      foldCtx,
      {
        name: "exec",
        stage: "result",
        args: ctx.args,
        result,
        cwd: ctx.cwd,
        config,
        theme,
        foldCommand: access.foldCommand,
      },
      buildExecFoldLine as never,
    );
  };

  return { renderShell: "self", renderCall, renderResult };
}

// ---------------------------------------------------------------------------
// 装配(2.4):动态 import + 激活门控 + 二次注册同一工具。
// ---------------------------------------------------------------------------

/** 动态加载到的 fold-blocks 模块形态(渲染件 + 激活/配置单例访问)。 */
export interface FoldCompatModule extends Omit<FoldRenderAccess, "getConfig" | "subscribeConfig"> {
  isFoldBlocksActive: () => boolean;
  subscribeFoldBlocksActive: (cb: () => void) => () => void;
  getFoldConfig: () => FoldBlocksConfig;
  subscribeFoldConfig: (cb: (cfg: FoldBlocksConfig) => void) => () => void;
}

export interface AttachExecFoldCompatDeps {
  /** fold-blocks 模块加载器;缺省为动态 import + try/catch 返回 null。 */
  loadCompat?: () => Promise<FoldCompatModule | null>;
  /** 渲染回调登记 invalidator 的钩子;缺省登记到内部 Map。 */
  registerInvalidator?: (toolCallId: string, invalidate: () => void) => void;
  /** 配置变更订阅;缺省用模块的 subscribeFoldConfig。 */
  subscribeConfig?: (cb: (cfg: FoldBlocksConfig) => void) => () => void;
}

export interface ExecFoldCompatHandle {
  /** 注销 config 订阅并清空 invalidator 表。 */
  disposed: () => void;
}

async function defaultLoadCompat(): Promise<FoldCompatModule | null> {
  try {
    return (await import("@philogag/pi-tui-fold-blocks")) as unknown as FoldCompatModule;
  } catch {
    // 回退契约:fold-blocks 未安装/加载失败 → 静默回退,不抛错、无 console 噪音。
    return null;
  }
}

/**
 * 装配 exec 折叠渲染(D1/D2):
 *  - loader 失败/返回 null → 不注册(默认渲染保持不变);
 *  - fold-blocks 尚未激活 → 订阅激活回调,激活后装配一次(任意加载顺序);
 *  - 装配 = 用渲染器重建 exec 定义并二次 registerTool(execute 闭包原样引用),
 *    并订阅 config 变更 → 逐 invalidator 触发已渲染行重渲染(即时模式切换)。
 */
export async function attachExecFoldCompat(
  pi: ExtensionAPI,
  tools: ToolDefinition[],
  deps: AttachExecFoldCompatDeps = {},
): Promise<ExecFoldCompatHandle> {
  const loadCompat = deps.loadCompat ?? defaultLoadCompat;
  let module: FoldCompatModule | null = null;
  try {
    module = await loadCompat();
  } catch {
    module = null;
  }
  if (!module) return { disposed: () => {} };

  const execTool = tools.find((t) => t.name === EXEC_TOOL_NAME);
  if (!execTool) return { disposed: () => {} };

  const invalidators = new Map<string, () => void>();
  const registerInvalidator =
    deps.registerInvalidator ??
    ((toolCallId: string, invalidate: () => void) => {
      invalidators.set(toolCallId, invalidate);
    });
  const subscribeConfig = deps.subscribeConfig ?? module.subscribeFoldConfig;

  let assembled = false;
  let unsubConfig: () => void = () => {};

  const assemble = (): void => {
    if (assembled) return; // 激活回调只应到达一次;防御重复触发。
    assembled = true;
    const renderers = buildExecFoldRenderers(
      {
        getConfig: module!.getFoldConfig,
        subscribeConfig: module!.subscribeFoldConfig,
        renderOwnedBlock: module!.renderOwnedBlock,
        foldCommand: module!.foldCommand,
      },
      { registerInvalidator },
    );
    pi.registerTool({
      ...execTool,
      renderShell: "self",
      execute: execTool.execute, // 原样委托,行为不变(D1)
      renderCall: renderers.renderCall as never,
      renderResult: renderers.renderResult as never,
    } as ToolDefinition);
    unsubConfig = subscribeConfig(() => {
      for (const invalidate of invalidators.values()) invalidate();
    });
  };

  if (module.isFoldBlocksActive()) {
    assemble();
  } else {
    module.subscribeFoldBlocksActive(assemble);
  }

  return {
    disposed: () => {
      unsubConfig();
      invalidators.clear();
    },
  };
}
