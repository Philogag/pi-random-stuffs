# fold-blocks 单块可展开 Implementation Plan

> **给 agentic worker 使用：** 用 superpowers:subagent-driven-development 逐任务实现本计划
> （无 subagent 时用 executing-plans）。步骤用 `- [ ]` 跟踪。

---
change: add-fold-block-click-expand
design-doc: openspec/changes/add-fold-block-click-expand/design.md
base-ref: ae2d4b7e78fca7aafc07bf7e56656a3e9890abf9
---

**Goal:** `fold` 模式下让单个工具块能按 `native` 观感展开/收起，其它块保持单行。

**Architecture:** 展开态由渲染层响应 SDK 的 `expanded` 标志：内置四工具直接委托原生
`renderCall` / `renderResult(expanded: true)` 并装进自绘背景盒（self-shell 无 SDK `Box`）；
`renderOwnedBlock`（外部扩展共用核心）在折叠摘要行下追加展开体（回调或 `result.content` 原文）。
折叠路径、`native` / `hide` 模式与执行委托完全不动。

**Tech Stack:** TypeScript（strict, ESM）、`@earendil-works/pi-tui`（`Text`/`Container`/`HStack`）、
`@earendil-works/pi-coding-agent`（`ToolDefinition`/`Theme`）、vitest。

**Spec:** `openspec/changes/add-fold-block-click-expand/specs/tui-tool-block-collapse/spec.md`

## Global Constraints

- 只改渲染：`execute` MUST 原样委托；session 内容、LLM 上下文不得变化。
- 折叠态输出 MUST 与改动前逐字节一致（`hide` 模式、`expanded: false`、空 lineBuilder 三种情况）。
- `native` 与 `hide` 模式代码路径 MUST 保持不变。
- MUST NOT 新增 `settings.json` 配置项，MUST NOT 持久化展开状态。
- 折叠态 MUST NOT 出现任何"可展开"提示（hint / 标记）。
- 展开态留白 MUST 使用 `ctx.outputPad ?? 1`（对应原生 `Box` 的 `paddingX = outputPad`），纵向 `paddingY = 1`。
- 背景 MUST 按 `\x1b[0m` 分片重套（`BgPaddedBox.reBg` 的既有解法），不得直接依赖 `pi-tui` 的 `Box`。
- 展开态委托原生渲染器时 MUST 不传 `lastComponent`（避免跨布局复用被 mutate 的 `Text`）。
- 测试命令：`pnpm --filter @philogag/pi-tui-fold-blocks test` / `typecheck`。

## Review Focus

- 折叠态被误改：`renderBlock` / `renderOwnedBlock` 的折叠输出必须与 base-ref 逐字节一致
  （测试里用 `stripAnsi` 后比较固定字符串）→ Task 2 Step 5。
- 展开态出现**两条头**（call 槽与 result 槽同时出可见行）→ Task 3 Step 1 断言行数。
- `theme` 为 `undefined` 的老测试调用点（`test/render.test.ts` 大量 `theme: undefined as never`）
  在新增 `bgFor` 调用后崩溃 → Task 2 断言折叠路径不在 `expanded: false` 时触达 `theme.bg`。
- 原生渲染器返回 `undefined`（如无 `renderCall`）时崩溃 → Task 1/3 的假原始定义覆盖该分支。
- `outputPad = 0` 时展开态应零左右留白（与原生一致），不得出现负 padding → Task 1 边界测试。

---

### Task 1: 渲染原语（`contentText` / `buildBoxedBlock` / 多行背景文本）

**Files:**
- Modify: `packages/pi-tui-fold-blocks/src/render.ts`
- Test: `packages/pi-tui-fold-blocks/test/render.test.ts`

**Interfaces:**
- Produces:
  - `export function contentText(result: unknown): string`
  - `export function buildBoxedBlock(content: Component, bgFn: (line: string) => string, paddingX?: number): Component`
  - 内部 `class BgMultilineText implements Component`（构造 `(text: string, bgFn)`，`render(width)` 按 `\n` 拆行、逐行截断/pad 到 width、逐行 `reBg`）
  - 内部 `function buildLineRow(text: LineContext, bgFn: (line: string) => string): Component`（现有 `buildBlockComponent` 里 HStack 那段原样搬出）

- [ ] **Step 1: 写 `contentText` 的失败测试**

在 `test/render.test.ts` 追加：

```ts
describe("contentText", () => {
  it("拼接所有 text 块", () => {
    expect(contentText({ content: [{ type: "text", text: "a\nb" }, { type: "text", text: "c" }] })).toBe("a\nbc");
  });
  it("缺失/非数组/空内容 → 空串", () => {
    expect(contentText(undefined)).toBe("");
    expect(contentText({})).toBe("");
    expect(contentText({ content: [] })).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test -- contentText`
Expected: FAIL — `contentText is not a function`（或 TS 报未导出）。

- [ ] **Step 3: 实现 `contentText`**

在 `src/render.ts` 的 `contentLineCount` 之后：

```ts
export function contentText(result: unknown): string {
  const content = (result as { content?: { text?: string }[] } | undefined)?.content;
  if (!Array.isArray(content) || content.length === 0) return "";
  return content.map((c) => c.text ?? "").join("");
}
```

- [ ] **Step 4: 写 `buildBoxedBlock` 的失败测试**

```ts
describe("buildBoxedBlock", () => {
  const bg = (t: string) => `\x1b[48;5;22m${t}\x1b[49m`;
  it("多行内容每行都带背景且 pad 到给定宽度", () => {
    const lines = buildBoxedBlock(new Text("aa\nbb", 0, 0), bg, 1).render(10);
    expect(lines).toHaveLength(4); // paddingY=1 上下各一行
    for (const l of lines) expect(visibleWidth(l)).toBe(10);
    expect(lines.filter((l) => l.includes("48;5;22m")).length).toBe(4);
  });
  it("paddingX=0 时不加左右留白", () => {
    const lines = buildBoxedBlock(new Text("aa", 0, 0), bg, 0).render(4);
    expect(stripAnsi(lines[1]!)).toBe("aa  ");
  });
});
```

（`visibleWidth` 从 `@earendil-works/pi-tui` 导入；`stripAnsi` 已在该测试文件内定义。）
注意：`Text("aa\nbb", 0, 0)` 需要每行带 bg —— `BgMultilineText` 只用于纯文本；此用例用
`Text` 验证盒子本身的 pad/reBg，故断言"每行都含 bg 序列"即可。

- [ ] **Step 5: 跑测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test -- buildBoxedBlock`
Expected: FAIL — `buildBoxedBlock is not a function`。

- [ ] **Step 6: 实现 `buildBoxedBlock` + `buildLineRow` 重构**

`BgPaddedBox` 已存在（构造 `(child, paddingX, paddingY, bgFn)`）。新增：

```ts
export function buildBoxedBlock(content: Component, bgFn: (line: string) => string, paddingX = 1): Component {
  return new BgPaddedBox(content, Math.max(0, Math.floor(paddingX)), 1, bgFn);
}
```

把现有 `buildBlockComponent(text, bgFn)` 的 HStack 构造段原样搬进内部 `buildLineRow(text, bgFn)`，
`buildBlockComponent` 改为一行：`return buildBoxedBlock(buildLineRow(text, bgFn), bgFn, 1);`
（行为必须完全不变——paddingX 仍为 1。）

- [ ] **Step 7: 跑测试确认通过（含既有全部用例）**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS，既有 `buildBlockComponent` / `renderOwnedBlock` 用例一条都不用改。

- [ ] **Step 8: 提交**

```bash
git add packages/pi-tui-fold-blocks/src/render.ts packages/pi-tui-fold-blocks/test/render.test.ts
git commit -m "feat(pi-tui-fold-blocks): add contentText and buildBoxedBlock primitives"
```

---

### Task 2: `renderOwnedBlock` 响应 `expanded`

**Files:**
- Modify: `packages/pi-tui-fold-blocks/src/render.ts`（`RenderBlockOpts`、`renderOwnedBlock`、`bgFor` 改为导出且收窄签名）
- Test: `packages/pi-tui-fold-blocks/test/render.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `contentText` / `buildBoxedBlock` / `buildLineRow`
- Produces:
  - `RenderBlockOpts` 新字段 `expandedBody?: (ctx: ToolRenderContext, opts: RenderBlockOpts) => Component | undefined`
  - `export function bgFor(stage: "call" | "result", isError: boolean, theme: Theme): (line: string) => string`
    （原内部 `bgFor(ctx, opts)` 收窄为纯参数签名；唯一调用点在 `renderOwnedBlock` 内改为
    `bgFor(opts.stage, ctx.isError, opts.theme)`）

- [ ] **Step 1: 写展开分支的失败测试**

```ts
describe("renderOwnedBlock — expanded", () => {
  const bg = (t: string) => `«bg»${t}`;
  const theme = { bg, fg: (_n: string, t: string) => t } as never;
  const opts = (over: Partial<RenderBlockOpts> = {}): RenderBlockOpts => ({
    name: "bash", stage: "result", args: { command: "npm test" },
    result: { content: [{ type: "text", text: "line1\nline2\nline3" }] },
    cwd: CWD, config: DEFAULT_CONFIG, theme, ...over,
  });

  it("展开态：摘要行 + 原文逐行，行数 > 折叠态", () => {
    const collapsed = renderOwnedBlock({ ...makeCtx({ command: "npm test" }), expanded: false }, opts(), buildBashBlockText).render(40);
    const expanded = renderOwnedBlock({ ...makeCtx({ command: "npm test" }), expanded: true }, opts(), buildBashBlockText).render(40);
    expect(expanded.length).toBeGreaterThan(collapsed.length);
    const flat = expanded.map(stripAnsi).join("\n");
    expect(flat).toContain("npm test");   // 摘要行仍在
    expect(flat).toContain("line1");
    expect(flat).toContain("line3");
  });

  it("expandedBody 回调优先于原文", () => {
    const comp = renderOwnedBlock(
      { ...makeCtx({ command: "npm test" }), expanded: true },
      opts({ expandedBody: () => new Text("CUSTOM-BODY", 0, 0) }),
      buildBashBlockText,
    );
    const flat = comp.render(40).map(stripAnsi).join("\n");
    expect(flat).toContain("CUSTOM-BODY");
    expect(flat).not.toContain("line1");
  });

  it("hide 模式忽略 expanded", () => {
    const hide = { ...DEFAULT_CONFIG, mode: "hide" as const };
    const comp = renderOwnedBlock({ ...makeCtx({ command: "x" }), expanded: true }, opts({ config: hide }), buildBashBlockText);
    expect(comp.render(40)).toHaveLength(0);
  });

  it("折叠态输出与 expanded:false 前一致（不触达 theme.bg 以外的布局变化）", () => {
    const lines = renderOwnedBlock(makeCtx({ command: "npm test" }), opts(), buildBashBlockText).render(40);
    expect(lines).toHaveLength(3); // 上下 padding + 1 行
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test -- "renderOwnedBlock — expanded"`
Expected: FAIL — `expanded` 分支不存在（展开态行数与折叠态相同）。

- [ ] **Step 3: 实现展开分支**

`renderOwnedBlock` 在 `if (!ownsLine) return new Text("", 0, 0);` 之后、`lineBuilder` 调用之前插入：

```ts
const isExpanded = ctx.expanded === true;
const line = lineBuilder(ctx, opts);
if (!line.tool && !line.shown && !isExpanded) return new Text("", 0, 0);
const bgFn = bgFor(opts.stage, ctx.isError, opts.theme);
if (!isExpanded) return buildBlockComponent(line, bgFn);

const body = opts.expandedBody?.(ctx, opts);
const bodyComponent: Component = body
  ? body
  : new BgMultilineText(
      contentText(opts.result).split("\n").map((l) => opts.theme.fg("toolOutput", l)).join("\n"),
      bgFn,
    );
const header = line.tool || line.shown ? buildLineRow(line, bgFn) : undefined;
const content = header ? new Container([header, bodyComponent]) : bodyComponent;
return buildBoxedBlock(content, bgFn, ctx.outputPad ?? 1);
```

同时把 `expandBody` 空文本情形处理为 `new Text("", 0, 0)`（`contentText` 为空且无回调时）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS（含既有全部用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/pi-tui-fold-blocks/src/render.ts packages/pi-tui-fold-blocks/test/render.test.ts
git commit -m "feat(pi-tui-fold-blocks): expandable renderOwnedBlock with expandedBody hook"
```

---

### Task 3: 内置四工具展开态委托原生渲染器

**Files:**
- Modify: `packages/pi-tui-fold-blocks/src/overrides.ts`
- Test: `packages/pi-tui-fold-blocks/test/expand.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `buildBoxedBlock`、Task 2 的 `bgFor`
- Produces: `export function renderNativeExpanded(original: AnyToolDef, stage: "call" | "result", payload: { args: unknown; result?: unknown }, theme: Theme, ctx: ToolRenderContext): Component`

- [ ] **Step 1: 写失败测试（新建 `test/expand.test.ts`）**

```ts
import { describe, it, expect, vi } from "vitest";
import { Text, Container } from "@earendil-works/pi-tui";
import { renderNativeExpanded } from "../src/overrides.js";
import type { ToolRenderContext } from "../src/overrides.js";

const theme = { bg: (n: string, t: string) => `«${n}»${t}`, fg: (_n: string, t: string) => t } as never;
const ctx = (over: Partial<ToolRenderContext> = {}) => ({
  args: { command: "npm test" }, toolCallId: "t1", invalidate: () => {}, lastComponent: undefined,
  state: undefined, cwd: "/p", executionStarted: true, argsComplete: true,
  isPartial: false, expanded: true, showImages: false, isError: false, outputPad: 2, ...over,
}) as ToolRenderContext;

describe("renderNativeExpanded", () => {
  const original = {
    renderCall: vi.fn(() => new Text("NATIVE-CALL", 0, 0)),
    renderResult: vi.fn(() => new Text("NATIVE-BODY-1\nNATIVE-BODY-2", 0, 0)),
  } as never;

  it("result 槽：一个盒子内同时含原生头与原生体，expanded 传 true", () => {
    const lines = renderNativeExpanded(original, "result", { args: {}, result: { content: [] } }, theme, ctx()).render(30);
    const flat = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");
    expect(flat).toContain("NATIVE-CALL");
    expect(flat).toContain("NATIVE-BODY-2");
    expect((original as any).renderResult).toHaveBeenCalledWith(expect.anything(), { expanded: true, isPartial: false }, theme, expect.objectContaining({ lastComponent: undefined }));
  });

  it("call 槽：只有原生头，不调用 renderResult", () => {
    const o = { renderCall: vi.fn(() => new Text("NATIVE-CALL", 0, 0)), renderResult: vi.fn() } as never;
    const lines = renderNativeExpanded(o, "call", { args: {} }, theme, ctx({ isPartial: true })).render(30);
    expect(lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n")).toContain("NATIVE-CALL");
    expect((o as any).renderResult).not.toHaveBeenCalled();
  });

  it("缺少原生渲染器时退化为空组件而不抛错", () => {
    const lines = renderNativeExpanded({} as never, "result", { args: {}, result: {} }, theme, ctx()).render(30);
    expect(Array.isArray(lines)).toBe(true);
  });

  it("outputPad 缺省为 1", () => {
    const lines = renderNativeExpanded(original, "result", { args: {}, result: {} }, theme, ctx({ outputPad: undefined as never })).render(20);
    expect(lines.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test -- renderNativeExpanded`
Expected: FAIL — `renderNativeExpanded` 未导出。

- [ ] **Step 3: 实现 `renderNativeExpanded` 并接入两个槽**

```ts
export function renderNativeExpanded(
  original: AnyToolDef,
  stage: "call" | "result",
  payload: { args: unknown; result?: unknown },
  theme: Theme,
  ctx: ToolRenderContext,
): Component {
  const clean = { ...ctx, lastComponent: undefined } as ToolRenderContext;
  const children: Component[] = [];
  const call = original.renderCall?.(payload.args as never, theme as never, clean as never);
  if (call) children.push(call);
  if (stage === "result" && original.renderResult) {
    const body = original.renderResult(payload.result as never, { expanded: true, isPartial: ctx.isPartial }, theme as never, clean as never);
    if (body) children.push(body);
  }
  const content: Component = children.length === 0 ? new Text("", 0, 0) : new Container(children);
  return buildBoxedBlock(content, bgFor(stage, ctx.isError, theme), ctx.outputPad ?? 1);
}
```

`renderCall` 包装器在 `config.mode === "fold" && context.expanded` 时：
`return renderNativeExpanded(original, "call", { args: context.args }, theme, context as never);`
`renderResult` 包装器在 `config.mode === "fold" && context.expanded` 时：
`return renderNativeExpanded(original, "result", { args: context.args, result }, theme, context as never);`

（`native` 分支保持原样在最前，`hide`/折叠仍走 `renderBlock`。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/pi-tui-fold-blocks/src/overrides.ts packages/pi-tui-fold-blocks/test/expand.test.ts
git commit -m "feat(pi-tui-fold-blocks): delegate native renderers when a block is expanded"
```

---

### Task 4: 库面导出、文档与版本

**Files:**
- Modify: `packages/pi-tui-fold-blocks/src/index.ts`、`packages/pi-tui-fold-blocks/README.md`、`packages/pi-tui-fold-blocks/package.json`

**Interfaces:**
- Produces: 包级命名导出新增 `contentText`、`buildBoxedBlock`（既有导出与默认工厂不变）

- [ ] **Step 1: 写失败测试**

在 `test/index.test.ts`（或 `test/compat.test.ts`）追加：

```ts
it("导出展开相关库面", async () => {
  const mod = await import("../src/index.js");
  expect(typeof mod.contentText).toBe("function");
  expect(typeof mod.buildBoxedBlock).toBe("function");
  expect(typeof mod.default).toBe("function");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test -- "导出展开相关库面"`
Expected: FAIL — `mod.contentText` 为 `undefined`。

- [ ] **Step 3: 在 `src/index.ts` 追加导出**

在既有 re-export 块中把 `contentText`、`buildBoxedBlock` 从 `./render.js` 一并导出
（与 `renderOwnedBlock`、`buildBlockComponent` 同列）；更新上方注释清单。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS。

- [ ] **Step 5: 更新 README**

在「特性」加一条：**单击展开**——`fold` 模式下左键单击某个块，该块按原生观感展开全量内容，
再次单击收起；其它块保持单行。`hide` 模式下不可展开；`native` 模式由 pi 自行处理。
在「面向其他扩展的库面」的折叠渲染核心段落补充：`renderOwnedBlock(ctx, opts, lineBuilder)` 现在响应
`ctx.expanded`，可用 `opts.expandedBody?: (ctx, opts) => Component | undefined` 自绘展开体
（缺省用 `contentText(opts.result)` 原文）。并在「已知限制」注明 ctrl+o 全局切换会一并展开所有块。

- [ ] **Step 6: 提升版本并提交**

`packages/pi-tui-fold-blocks/package.json` 的 `version` 改为 `0.2.0`。

```bash
git add packages/pi-tui-fold-blocks/src/index.ts packages/pi-tui-fold-blocks/test/index.test.ts packages/pi-tui-fold-blocks/README.md packages/pi-tui-fold-blocks/package.json
git commit -m "docs(pi-tui-fold-blocks): document click-to-expand and bump to 0.2.0"
```

---

### Task 5: 全仓验证

**Files:** 无（只跑命令）

- [ ] **Step 1: 包级验证**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks typecheck && pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: 均退出 0。

- [ ] **Step 2: 仓库级验证**

Run: `pnpm -r exec tsc --noEmit && pnpm -r exec vitest run`
Expected: 5 个包的 tsc 无错；全部测试文件 PASS（确认 `pi-tool-presistant-bash` 等依赖库面的包未被破坏）。

- [ ] **Step 3: 手工冒烟（可延后标记 `[~]`）**

真实 pi TUI 中：`/reload` → 让 agent 跑一次 read 与一次失败 bash → 分别单击两个块验证展开/收起与
三态背景 → `/tui-fold-blocks` 切到 hide 后单击无效果 → 切回 fold 后再次单击仍可展开。

- [ ] **Step 4: 提交（若有冒烟修复）**

```bash
git add -A && git commit -m "test(pi-tui-fold-blocks): smoke verify click-to-expand"
```
