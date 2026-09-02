// packages/pi-tui-fold-blocks/src/render.ts
import { Text, HStack, visibleWidth, truncateToWidth, type Component, type StackChild } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FoldBlocksConfig } from "./config.js";
import { foldPath } from "./folders/path.js";
import { foldCommand } from "./folders/command.js";
import type { ToolRenderContext } from "./overrides.js";

export interface RenderBlockOpts {
  name: string;
  stage: "call" | "result",
  args: unknown;
  result?: unknown;
  cwd: string;
  config: FoldBlocksConfig;
  theme: Theme;
}

function countRows(content: string): number {
  return content.split("\n").reduce((n, v) => v.trim() ? n + 1: n, 0)
}

export interface LineContext {
  icon?: string;
  tool: string;
  shown: string;
  tips?: string;
  result?: string;
}

interface ReadArgsSchema {
  path: string;
  offset?: number;
  limit?: number;
}
export function buildReadBlockText(ctx: ToolRenderContext, opts: RenderBlockOpts): LineContext {
  const args = ctx.args as ReadArgsSchema;
  const shown = foldPath(args.path ?? "", { cwd: opts.cwd, style: opts.config.fileBlocks.pathStyle, foldGitWorktree: opts.config.fileBlocks.foldGitWorktree });
  const startLine = args.offset ?? 1;
  const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "?";
  // 默认读整文件(offset 缺省 + limit 缺省)→ 显示为 "1-?",纯噪声,隐藏。
  // 显式 offset=1 同样落到 1-?,一并隐藏(等价于不写 offset)。
  const tips = (startLine === 1 && endLine === "?") ? "" : `[ ${startLine} - ${endLine} ]`;
  return {
    icon: opts.config.nerdFont ? "\udb85\uddd6" : "",
    tool: "read",
    shown: shown,
    tips: tips,
    result: opts.stage === "call" ? ""
                     :ctx.isError ? "FAILED"
                                  : "SUCCESS"
  }
}

interface WriteArgsSchema {
  path: string;
  content: string
}
export function buildWriteBlockText(ctx: ToolRenderContext, opts: RenderBlockOpts): LineContext {
  const args = ctx.args as WriteArgsSchema;
  const shown = foldPath(args.path ?? "", { cwd: opts.cwd, style: opts.config.fileBlocks.pathStyle, foldGitWorktree: opts.config.fileBlocks.foldGitWorktree });
  const rowCount = countRows(args.content);
  return {
    icon: opts.config.nerdFont ? "\ue27c" : "",
    tool: "write",
    shown: shown,
    tips: `[ +${rowCount} ]`,
    result: opts.stage === "call" ? "" 
                     :ctx.isError ? "FAILED" 
                                  : "SUCCESS"
  }
}

interface EditArgsSchema {
  path: string;
  edits: {oldText:string; newText: string}[];
}
export function buildEditBlockText(ctx: ToolRenderContext, opts: RenderBlockOpts): LineContext {
  const args = ctx.args as EditArgsSchema;
  const shown = foldPath(args.path ?? "", { cwd: opts.cwd, style: opts.config.fileBlocks.pathStyle, foldGitWorktree: opts.config.fileBlocks.foldGitWorktree });
  const countOldRows = args.edits.reduce((n, v) => n + countRows(v.oldText), 0)
  const countNewRows = args.edits.reduce((n, v) => n + countRows(v.newText), 0)
  
  return {
    icon: opts.config.nerdFont ? "\uF044" : "",
    tool: "write",
    shown: shown,
    tips: `[ -${countOldRows}, +${countNewRows} ]`,
    result: opts.stage === "call" ? "" 
                    : ctx.isError ? "FAILED" 
                                  : "SUCCESS"
  }
}

export function buildGrepBlockText(ctx: ToolRenderContext, opts: RenderBlockOpts): LineContext {
  return {
    icon: opts.config.nerdFont ? "\udb83\udc7c" : "",
    tool: "grep",
    shown: "",
    tips: "",
    result: opts.stage === "call" ? "" 
                    : ctx.isError ? "FAILED" 
                                  : "SUCCESS"
  }
}

export function buildLsBlockText(ctx: ToolRenderContext, opts: RenderBlockOpts): LineContext {
  return {
    icon: opts.config.nerdFont ? "\uf07c" : "",
    tool: "ls",
    shown: "",
    tips: "",
    result: opts.stage === "call" ? "" 
                    : ctx.isError ? "FAILED" 
                                  : "SUCCESS"
  }
}

interface BashArgsSchema {
  command: string;
  timeout?: number;
}
/** 从 AgentToolResult.content 提取退出码(形如 "exit code N");提取失败返回 undefined。 */
export function contentExitCode(result: unknown): number | undefined {
  const content = (result as { content?: { text?: string }[] } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content.map((c) => c.text ?? "").join("\n");
  const m = /exit code (\d+)/i.exec(text);
  return m ? Number(m[1]) : undefined;
}
/** 从 AgentToolResult.content 统计输出行数(含空行);result 缺失/为空 → 0。
 * 末尾 "\n" 不计独立行,这是文本文件/管道输出的常见约定("a\nb\n" = 2 行而非 3)。 */
export function contentLineCount(result: unknown): number {
  const content = (result as { content?: { text?: string }[] } | undefined)?.content;
  if (!Array.isArray(content) || content.length === 0) return 0;
  const text = content.map((c) => c.text ?? "").join("");
  if (text === "") return 0;
  const lines = text.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}
export function buildBashBlockText(ctx: ToolRenderContext, opts: RenderBlockOpts): LineContext {
  const args = ctx.args as BashArgsSchema;
  const shown = foldCommand(args.command, { smart: opts.config.bashBlocks.smart });
  // 仅在 result 阶段提取统计量:call 阶段 opts.result 尚未就绪,提取无意义。
  const errorCode = opts.stage === "result" ? contentExitCode(opts.result) : undefined;
  const lineCount = opts.stage === "result" ? contentLineCount(opts.result) : undefined;
  // tips 仅在确有信息时显示,各段用 ", " 拼接。
  // 行数:output 行数(含空行);0 行不显示(空输出挂个 [ 0 lines ] 是噪声)。
  // exit 码:仅 failed 时显示,与 result 的 FAILED(M) 互补。
  const tipParts: string[] = [];
  if (args.timeout !== undefined) tipParts.push(`${args.timeout}s`);
  if (lineCount !== undefined && lineCount > 0) tipParts.push(`${lineCount} lines`);
  if (ctx.isError && errorCode !== undefined && errorCode !== 0) tipParts.push(`exit ${errorCode}`);
  const tips = tipParts.length > 0 ? `[ ${tipParts.join(", ")} ]` : "";
  return {
    icon: opts.config.nerdFont ? "\uf489" : "",
    tool: "exec",
    shown: shown,
    tips: tips,
    result: opts.stage === "call" ? ""
                    : ctx.isError ? (errorCode !== undefined ? `FAILED(${errorCode})` : "FAILED")
                                  : "SUCCESS"
  }
}

/** 左半段:icon + tool + shown(tips 独立成段,保证折叠时不丢失)。 */
function buildLeft(text: LineContext): string {
  return `${text.icon ?? ""} ${text.tool} - ${text.shown}`.trim();
}

/** 右半段:result / 退出码。 */
function buildRight(text: LineContext): string {
  return (text.result ?? "").trim();
}

/**
 * 自带背景的截断文本(替代 TruncatedText:后者没有 customBgFn,无法上色)。
 *
 * 为什么不直接用 Box 整行套 bg:pi-tui 的 `theme.bg(color, text)` 形如 `${ansi}${text}\x1b[49m`,
 * 只在首尾包一次。而 HStack.render 的 compositeTuiLine 会在每段子组件之间插入
 * `SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07"`,其中 `\x1b[0m` 是全量重置 → 会清掉已在行的 bg,
 * 之后不再重建,导致 Box 的单次包裹只覆盖到首个 segment 边界。同理 truncateToWidth 在
 * 截断省略号前也会插入 `\x1b[0m`,使 `...` 丢色。
 *
 * 修法:让每个子组件自带 bg,且把行按 `\x1b[0m` 分片、每片重新套 bg —— 这样任何
 * reset 之后紧跟的下一个可见片段都会重新建立 bg,跨 segment 边界 / 省略号都能连续着色。
 * (\x1b[0m 本身零宽,不会产生可见空隙。)
 */
class BgTruncatedText implements Component {
  constructor(private readonly text: string, private readonly bgFn: (line: string) => string) {}
  invalidate(): void {
    // 无缓存(每次 render 直接按 width 计算)
  }
  render(width: number): string[] {
    const w = Math.max(0, Math.floor(width));
    if (w === 0) return [];
    // truncateToWidth(maxWidth, "...", pad=true):截断并 pad 到恰好 w 可见宽。空文本 → 全空格。
    const line = truncateToWidth(this.text, w, "...", true);
    return [this.reBg(line)];
  }
  private reBg(line: string): string {
    return line.split("\x1b[0m").map((chunk) => this.bgFn(chunk)).join("\x1b[0m");
  }
}

/**
 * 带 padding + 背景的容器(替代 pi-tui 的 Box:后者 applyBg = `bgFn(line + trailingPad)`
 * 只在最外层包一次,行内一旦出现 `\x1b[0m` 全量重置就把那次包裹清掉,导致 trailing 右 padding
 * 落在最后一个 reset 之后、无 bg)。本容器把 "左 padding + 子组件行 + 右 padding" 拼好后
 * 走 reBg(按 `\x1b[0m` 分片、每片各套 bgFn 再 join),任何 reset 之后紧跟的片段(含右 padding
 * 空格、上下留白行)都会重新建立 bg → 全行连续着色。`\x1b[0m` 本身零宽,不产生可见空隙。
 */
class BgPaddedBox implements Component {
  constructor(
    private readonly child: Component,
    private readonly paddingX: number,
    private readonly paddingY: number,
    private readonly bgFn: (line: string) => string,
  ) {}
  invalidate(): void {
    this.child.invalidate?.();
  }
  render(width: number): string[] {
    const w = Math.max(0, Math.floor(width));
    if (w === 0) return [];
    const padX = Math.min(this.paddingX, Math.max(0, Math.floor((w - 1) / 2)));
    const contentWidth = Math.max(1, w - padX * 2);
    const childLines = this.child.render(contentWidth);
    if (childLines.length === 0) {
      // 仍需输出 paddingY*2+1 行 bg 空行,避免整块高度塌陷导致 SDK 容器重排闪烁
      const empty = this.reBg(" ".repeat(w));
      const rows: string[] = [];
      for (let i = 0; i < this.paddingY * 2 + 1; i++) rows.push(empty);
      return rows;
    }
    const leftPad = " ".repeat(padX);
    const rows: string[] = [];
    // 上留白
    const topEmpty = this.reBg(" ".repeat(w));
    for (let i = 0; i < this.paddingY; i++) rows.push(topEmpty);
    // 内容行:左 padding + 子行,再 pad 到 w,整体 reBg
    for (const line of childLines) {
      const withLeft = leftPad + line;
      const vis = visibleWidth(withLeft);
      const rightPad = Math.max(0, w - vis);
      rows.push(this.reBg(withLeft + " ".repeat(rightPad)));
    }
    // 下留白
    for (let i = 0; i < this.paddingY; i++) rows.push(topEmpty);
    return rows;
  }
  private reBg(line: string): string {
    return line.split("\x1b[0m").map((chunk) => this.bgFn(chunk)).join("\x1b[0m");
  }
}

/**
 * 构造单行块组件树,交给 pi-tui 布局系统随终端宽度实时重算,不再在构造时用
 * process.stdout.columns 预拼字符串(旧 buildBlockText 的 resize 不刷新问题即来源于此)。
 *
 * 结构:
 *   BgPaddedBox(padX=1, padY=1, bgFn)         ← 左右/上下留白 + 全行 reBg(含右 padding)
 *     └ HStack(gap=1)                          ← 左右布局,宽度随 render(width) 实时重算
 *         ├ BgTruncatedText(left)  grow:1 shrink:1 minSize:0  ← 占满剩余宽度,过长截断(不换行)
 *         ├ BgTruncatedText(tips)  grow:0 shrink:0            ← 完整保留,不被截断
 *         └ BgTruncatedText(right) grow:0 shrink:0            ← 自然宽度,贴右
 *
 * tips 独立成段(grow:0 shrink:0):空间不足时只有 left 的 shown 被截断,tips(如行号范围)
 * 始终完整显示。HStack gap=1 保证 left 与 right 之间留 1 字符 padding。
 *
 * HStack.render(width) 先测各子组件 intrinsic 宽度(Intrinsic = render(safeWidth) 的可见宽,
 * 但 BgTruncatedText 输出恒 pad 到 width → intrinsic 恒等于 safeWidth,会误导分配),
 * 改指定 basis = 内容自然可见宽度,让 allocateStackSizes 跳过 intrinsic、以 basis 为起点:
 *   - 左槽 grow:1 shrink:1 → 填满 contentSize - rightW;溢出时回退到 minSize:0;
 *   - 右槽 shrink:0 grow:0 → 恒为自身可见宽度,贴右边。
 * thus 左截断、右贴边,每次 render 都以传入 width 重算,resize 即时生效。
 */
export function buildBlockComponent(
  text: LineContext,
  bgFn: (line: string) => string,
): Component {
  const left = buildLeft(text);
  const tips = (text.tips ?? "").trim();
  const right = buildRight(text);
  const leftW = visibleWidth(left);
  const tipsW = visibleWidth(tips);
  const rightW = visibleWidth(right);
  const children: StackChild[] = [
    { component: new BgTruncatedText(left, bgFn), basis: leftW, grow: 1, shrink: 1, minSize: 0 },
  ];
  // tips 为空时不插入中间槽,避免 HStack 对零宽 entry 也加 gap(会导致 left/right 间隙 2 字符)
  if (tipsW > 0) {
    children.push({ component: new BgTruncatedText(tips, bgFn), basis: tipsW, grow: 0, shrink: 0 });
  }
  children.push({ component: new BgTruncatedText(right, bgFn), basis: rightW, grow: 0, shrink: 0 });
  const hstack = new HStack(children, { gap: 1, align: "stretch" });
  return new BgPaddedBox(hstack, 1, 1, bgFn);
}

/** 背景:文件块恒绿;bash 按 isPartial(黄)/isError(红)/成功(绿)。 */
function bgFor(ctx: ToolRenderContext, opts: RenderBlockOpts): (text: string) => string {
  if (opts.stage === "call") return (t) => opts.theme.bg("toolPendingBg", t);
  if (ctx.isError) return (t) => opts.theme.bg("toolErrorBg", t);
  return (t) => opts.theme.bg("toolSuccessBg", t);
}

export function renderBlock(ctx: ToolRenderContext, opts: RenderBlockOpts): Component {
  // 现有 4 工具各自的 lineBuilder;未知工具名 → 空 builder(产出 0 行,保持原默认行为)。
  let lineBuilder: (ctx: ToolRenderContext, opts: RenderBlockOpts) => LineContext;
  switch (opts.name) {
    case "read": lineBuilder = buildReadBlockText; break;
    case "write": lineBuilder = buildWriteBlockText; break;
    case "edit": lineBuilder = buildWriteBlockText; break;
    case "bash": lineBuilder = buildBashBlockText; break;
    default:
      lineBuilder = () => ({ tool: "", shown: "" });
  }
  return renderOwnedBlock(ctx, opts, lineBuilder);
}

/**
 * 折叠块渲染核心,供本包工具与外部扩展(经命名导出)共用。
 *
 * 语义与原 renderBlock 完全一致:
 *  - hide 模式 → 空 Text → 0 行 → 块整体消失;
 *  - 单帧归属(call/result 槽互斥,只让一个产出可见行,见下注释);
 *  - lineBuilder 产出空文本(如未知/无内容)→ 同样 0 行空 Text。
 *
 * lineBuilder: 由调用方把"工具名 → 行文本"的决策收窄成单函数,
 * 从 (ctx, opts) 构建 LineContext(icon/tool/shown/tips/result)。
 */
export function renderOwnedBlock(
  ctx: ToolRenderContext,
  opts: RenderBlockOpts,
  lineBuilder: (ctx: ToolRenderContext, opts: RenderBlockOpts) => LineContext,
): Component {
  if (opts.config.mode === "hide") return new Text("", 0, 0); // 空 Text → 0 行 → 块整体消失

  // SDK 的 ToolExecutionComponent.updateDisplay 会把 renderCall 与 renderResult 的返回值
  // 作为两个独立子组件加入同一个容器(call 槽在前,result 槽在后)。若两者都返回可见行,同一个
  // tool call 会被渲染成两行(调用行 + 结果行)。为保持"单行"语义,任意时刻只让一个槽产出可见
  // 行,另一个槽返回 0 行空 Text:
  //   - 尚无最终结果(ctx.isPartial === true:调用阶段或 partial 流式)→ call 槽拥有该行;
  //   - 最终结果到达(ctx.isPartial === false:tool_execution_end)→ result 槽拥有该行,call 槽退让。
  // isPartial 由 SDK 维护:构造时为 true,tool_execution_end 置 false,partial update 仍为 true。
  // 用 isPartial 而非跨槽 state,是因为 call 槽先于 result 槽执行,无法在单帧内获知 result 槽
  // 是否会运行;isPartial 在帧开始前就已就绪,单帧即可定正确归属,无 flicker、无需 invalidate。
  const ownsLine = opts.stage === "call" ? ctx.isPartial : !ctx.isPartial;
  if (!ownsLine) return new Text("", 0, 0);

  const line = lineBuilder(ctx, opts);
  // 空行文本(未识别工具/无内容)→ 0 行,避免 BgTruncatedText 造出孤立的 "-" 摘要行。
  if (!line.tool && !line.shown) return new Text("", 0, 0);

  return buildBlockComponent(line, bgFor(ctx, opts));
}
