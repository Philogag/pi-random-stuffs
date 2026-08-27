# pi-tui-fold-blocks Implementation Plan

> **给 agentic worker 使用:** 用 superpowers:subagent-driven-development
> 逐任务实现本计划。步骤使用 checkbox (`- [ ]`) 语法跟踪。

---
change: tui-fold-blocks
design-doc: openspec/changes/tui-fold-blocks/design.md
base-ref: 569caeb84f76c39e850df75b8527cf961f1fd6c7
---

**Goal:** 新增 pi 扩展包 `@philogag/pi-tui-fold-blocks`,拦截 read/write/edit/bash 工具块的自绘渲染,提供 原生/折叠/隐藏 三态(默认折叠)与可配置的折叠显示。

**Architecture:** 扩展用 `pi.registerTool` 同名覆盖 4 个内置工具定义(`execute` 委托原始定义、仅替换渲染层,统一 `renderShell:"self"`);`renderCall` 返回空 Text(0 行,避免与 renderResult 双 addChild 成两行),`renderResult` 返回单行左右对齐 Text(左概要+右统计)并用 `setCustomBgFn` 自绘背景(文件块恒绿/bash 随状态黄绿红);`Map<toolCallId, invalidate>` 收集重绘回调,模式切换时 `rerenderAll()` 强制重绘;配置读写 `settings.json` 的 `@philogag/pi-tui-fold-blocks` 块,损坏回退默认值;`/fold-blocks` 命令循环三态并进入设置子页面。

**Tech Stack:** TypeScript (strict + NodeNext)、pnpm workspaces、@earendil-works/pi-coding-agent (SDK)、@earendil-works/pi-tui (Text/Box/Container)、typebox (参数 schema)、vitest (测试)。

**Spec:** `openspec/changes/tui-fold-blocks/specs/tui-tool-block-collapse/spec.md`;设计:`openspec/changes/tui-fold-blocks/design.md`(D1-D8)。

## Global Constraints

- TypeScript strict + NodeNext + verbatimModuleSyntax + composite(继承仓库根 `tsconfig.base.json`)。
- 包名 `@philogag/pi-tui-fold-blocks`,目录 `packages/pi-tui-fold-blocks/`。
- **非侵入:** 不改 session/LLM 上下文/存储历史;`execute` 必须原样委托原始定义,行为不变;未加载扩展时行为不变。
- 不覆盖 grep/find/ls;不注册快捷键(仅 `/fold-blocks` 命令)。
- **背景色自绘**:统一 `renderShell:"self"`(SDK 的 Box 背景固定为 运行黄/成功绿/失败红,无法表达“文件块运行中也绿”),在 renderCall/renderResult 返回的 Text 组件上用 `setCustomBgFn` 自绘:文件块(read/write/edit)恒绿, bash 按 `isPartial`(黄)/`isError`(红)/成功(绿)。hide 模式返回空 Text(SDK `addChild(null)` 会崩溃;空 Text render 为 0 行,块整体消失)。
- nerd font 图标默认开,可关;折叠块必须恰好一行,左概要右统计,窄终端裁剪。
- runtime deps 放 `dependencies`(发布 pi 包要求);devDeps 放 `devDependencies`。

---

## Task 1: 包骨架与扩展入口

**Files:**
- Create: `packages/pi-tui-fold-blocks/package.json`
- Create: `packages/pi-tui-fold-blocks/tsconfig.json`
- Create: `packages/pi-tui-fold-blocks/src/index.ts`
- Modify: `tsconfig.json`(仓库根 references)
- Test: `packages/pi-tui-fold-blocks/` 可 typecheck

**Interfaces:**
- Consumes: 仓库根 `tsconfig.base.json`、pnpm workspace 约定。
- Produces: `src/index.ts` 的默认导出 `export default function(pi: ExtensionAPI): void`;`src/config.ts` 的 `loadConfig(): FoldBlocksConfig` 与 `DEFAULT_CONFIG`(Task 2 使用)。

- [ ] **Step 1: 创建包清单**

```json
// packages/pi-tui-fold-blocks/package.json
{
  "name": "@philogag/pi-tui-fold-blocks",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "lint": "echo \"no linter configured\""
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^0.84.3",
    "@earendil-works/pi-tui": "latest",
    "typebox": "latest"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: 创建 tsconfig(继承 base)**

```json
// packages/pi-tui-fold-blocks/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: 把包加入根 references**

```json
// tsconfig.json (仓库根)
{
  "files": [],
  "references": [{ "path": "./packages/pi-tui-fold-blocks" }]
}
```

- [ ] **Step 4: 写最小入口(先编译通过)**

```ts
// packages/pi-tui-fold-blocks/src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  // Task 3 起填充:配置加载 + 工具覆盖 + 命令注册
  void pi;
}
```

- [ ] **Step 5: typecheck 验证**

Run: `cd /home/philogag/workspace/pi-exts/pi-ramdom-stuffs && pnpm install && pnpm --filter @philogag/pi-tui-fold-blocks typecheck`
Expected: 无 TS 错误(TS18002 已在根 script 处理)。

- [ ] **Step 6: Commit**

```bash
git add packages/pi-tui-fold-blocks tsconfig.json pnpm-lock.yaml
git commit -m "feat(tui-fold-blocks): scaffold package + extension entry"
```

## Task 2: 配置模块(读写 settings.json + 默认值回退)

**Files:**
- Create: `packages/pi-tui-fold-blocks/src/config.ts`
- Create: `packages/pi-tui-fold-blocks/test/config.test.ts`
- Modify: `packages/pi-tui-fold-blocks/src/index.ts`(调用 `loadConfig`)

**Interfaces:**
- Consumes: Task 1 的 `src/index.ts` 入口;SDK `getSettingsPath(): string`(pi 的 settings.json 路径,导出自 `@earendil-works/pi-coding-agent`);spec「配置存储与命令入口」「settings.json 缺失回退」。
- Produces: `type Mode = "native" | "fold" | "hide"`;`interface FoldBlocksConfig { mode: Mode; nerdFont: boolean; fileBlocks: { collapse: boolean; pathStyle: "absolute" | "relative" | "basename"; foldGitWorktree: boolean }; bashBlocks: { collapse: boolean; smart: boolean; showStatus: boolean } }`;`const DEFAULT_CONFIG: FoldBlocksConfig`;`loadConfig(): FoldBlocksConfig`;`saveConfig(cfg: FoldBlocksConfig): void`;`setMode(cfg: FoldBlocksConfig, mode: Mode): FoldBlocksConfig`。Task 3/4/5/6 使用。

- [ ] **Step 1: 写失败测试(默认值 + 损坏回退)**

```ts
// packages/pi-tui-fold-blocks/test/config.test.ts
import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, loadConfig, setMode } from "../src/config.js";

describe("config", () => {
  it("DEFAULT_CONFIG 默认 fold、nerdFont 开、pathStyle relative、smart 开", () => {
    expect(DEFAULT_CONFIG.mode).toBe("fold");
    expect(DEFAULT_CONFIG.nerdFont).toBe(true);
    expect(DEFAULT_CONFIG.fileBlocks.pathStyle).toBe("relative");
    expect(DEFAULT_CONFIG.fileBlocks.foldGitWorktree).toBe(true);
    expect(DEFAULT_CONFIG.bashBlocks.smart).toBe(true);
  });

  it("settings 缺失/损坏时回退默认值且不抛错", () => {
    const cfg = loadConfig("/nonexistent/settings.json");
    expect(cfg.mode).toBe("fold");
    expect(cfg.nerdFont).toBe(true);
  });

  it("setMode 返回新对象并写入 mode", () => {
    const next = setMode(DEFAULT_CONFIG, "hide");
    expect(next.mode).toBe("hide");
    expect(DEFAULT_CONFIG.mode).toBe("fold"); // 原对象不可变
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: FAIL(`config` 模块不存在 / 断言失败)。

- [ ] **Step 3: 实现 config.ts**

```ts
// packages/pi-tui-fold-blocks/src/config.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getSettingsPath } from "@earendil-works/pi-coding-agent";

export type Mode = "native" | "fold" | "hide";

export interface FoldBlocksConfig {
  mode: Mode;
  nerdFont: boolean;
  fileBlocks: {
    collapse: boolean;
    pathStyle: "absolute" | "relative" | "basename";
    foldGitWorktree: boolean;
  };
  bashBlocks: { collapse: boolean; smart: boolean; showStatus: boolean };
}

export const DEFAULT_CONFIG: FoldBlocksConfig = {
  mode: "fold",
  nerdFont: true,
  fileBlocks: { collapse: true, pathStyle: "relative", foldGitWorktree: true },
  bashBlocks: { collapse: true, smart: true, showStatus: true },
};

const PACKAGE_KEY = "@philogag/pi-tui-fold-blocks";

function sanitize(raw: unknown): FoldBlocksConfig {
  if (typeof raw !== "object" || raw === null) return DEFAULT_CONFIG;
  const r = raw as Record<string, unknown>;
  return {
    mode: r.mode === "native" || r.mode === "hide" ? r.mode : r.mode === "fold" ? "fold" : DEFAULT_CONFIG.mode,
    nerdFont: typeof r.nerdFont === "boolean" ? r.nerdFont : DEFAULT_CONFIG.nerdFont,
    fileBlocks: {
      collapse: typeof (r.fileBlocks as any)?.collapse === "boolean" ? (r.fileBlocks as any).collapse : DEFAULT_CONFIG.fileBlocks.collapse,
      pathStyle: ["absolute", "relative", "basename"].includes((r.fileBlocks as any)?.pathStyle)
        ? (r.fileBlocks as any).pathStyle
        : DEFAULT_CONFIG.fileBlocks.pathStyle,
      foldGitWorktree: typeof (r.fileBlocks as any)?.foldGitWorktree === "boolean" ? (r.fileBlocks as any).foldGitWorktree : DEFAULT_CONFIG.fileBlocks.foldGitWorktree,
    },
    bashBlocks: {
      collapse: typeof (r.bashBlocks as any)?.collapse === "boolean" ? (r.bashBlocks as any).collapse : DEFAULT_CONFIG.bashBlocks.collapse,
      smart: typeof (r.bashBlocks as any)?.smart === "boolean" ? (r.bashBlocks as any).smart : DEFAULT_CONFIG.bashBlocks.smart,
      showStatus: typeof (r.bashBlocks as any)?.showStatus === "boolean" ? (r.bashBlocks as any).showStatus : DEFAULT_CONFIG.bashBlocks.showStatus,
    },
  };
}

export function loadConfig(settingsPath?: string): FoldBlocksConfig {
  const path = settingsPath ?? findSettingsPath();
  try {
    const text = readFileSync(path, "utf8");
    const json = JSON.parse(text) as Record<string, unknown>;
    return sanitize(json[PACKAGE_KEY]);
  } catch {
    return { ...DEFAULT_CONFIG, fileBlocks: { ...DEFAULT_CONFIG.fileBlocks }, bashBlocks: { ...DEFAULT_CONFIG.bashBlocks } };
  }
}

export function saveConfig(cfg: FoldBlocksConfig, settingsPath?: string): void {
  const path = settingsPath ?? findSettingsPath();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch { /* 新建 */ }
  json[PACKAGE_KEY] = cfg;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(json, null, 2), "utf8");
}

export function setMode(cfg: FoldBlocksConfig, mode: Mode): FoldBlocksConfig {
  return { ...cfg, mode, fileBlocks: { ...cfg.fileBlocks }, bashBlocks: { ...cfg.bashBlocks } };
}

function findSettingsPath(): string {
  return getSettingsPath(); // pi 的 settings.json(如 ~/.config/pi/settings.json)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS(3 用例)。

- [ ] **Step 5: 在入口加载配置**

```ts
// packages/pi-tui-fold-blocks/src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";

export default function (pi: ExtensionAPI): void {
  const config = loadConfig();
  void config;
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/pi-tui-fold-blocks/src packages/pi-tui-fold-blocks/test
git commit -m "feat(tui-fold-blocks): config module with defaults fallback"
```

## Task 3: 折叠器纯函数 foldPath / foldCommand

**Files:**
- Create: `packages/pi-tui-fold-blocks/src/folders/path.ts`
- Create: `packages/pi-tui-fold-blocks/src/folders/command.ts`
- Create: `packages/pi-tui-fold-blocks/test/folders.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `FoldBlocksConfig`(pathStyle/foldGitWorktree/smart)。
- Produces: `foldPath(path: string, opts: { cwd: string; style: "absolute" | "relative" | "basename"; foldGitWorktree: boolean }): string`;`foldCommand(command: string, opts: { smart: boolean }): string`。Task 4 使用。

- [ ] **Step 1: 写失败测试**

```ts
// packages/pi-tui-fold-blocks/test/folders.test.ts
import { describe, it, expect } from "vitest";
import { foldPath } from "../src/folders/path.js";
import { foldCommand } from "../src/folders/command.js";

describe("foldPath", () => {
  const cwd = "/home/user/proj";
  it("relative 样式返回相对 cwd 的短路径", () => {
    expect(foldPath("/home/user/proj/src/main.ts", { cwd, style: "relative", foldGitWorktree: false })).toBe("src/main.ts");
  });
  it("absolute 样式原样返回", () => {
    expect(foldPath("/home/user/proj/src/main.ts", { cwd, style: "absolute", foldGitWorktree: false })).toBe("/home/user/proj/src/main.ts");
  });
  it("basename 样式仅返回文件名", () => {
    expect(foldPath("/home/user/proj/src/main.ts", { cwd, style: "basename", foldGitWorktree: false })).toBe("main.ts");
  });
  it("git worktree 折叠裁掉 worktree 前缀", () => {
    const wt = "/home/user/proj/.git/worktrees/feature";
    expect(foldPath(`${wt}/src/a.ts`, { cwd, style: "relative", foldGitWorktree: true })).toBe("src/a.ts");
  });
});

describe("foldCommand", () => {
  it("剥离 cd X && 包装前缀", () => {
    expect(foldCommand("cd build && npm test", { smart: true })).toBe("npm test");
  });
  it("剥离 export 前缀", () => {
    expect(foldCommand("export FOO=1 && node run.js", { smart: true })).toBe("node run.js");
  });
  it("smart 关闭时仅取首 token", () => {
    expect(foldCommand("cd build && npm test", { smart: false })).toBe("cd");
  });
  it("无包装时返回整命令", () => {
    expect(foldCommand("npm test", { smart: true })).toBe("npm test");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 path.ts**

```ts
// packages/pi-tui-fold-blocks/src/folders/path.ts
import { relative, basename, isAbsolute, sep } from "node:path";

export interface FoldPathOpts {
  cwd: string;
  style: "absolute" | "relative" | "basename";
  foldGitWorktree: boolean;
}

export function foldPath(path: string, opts: FoldPathOpts): string {
  let p = path;
  if (opts.foldGitWorktree) {
    const idx = p.indexOf(`${sep}.git${sep}worktrees${sep}`);
    if (idx !== -1) {
      const wtRoot = p.slice(0, idx);
      const rest = p.slice(idx + (`.git${sep}worktrees${sep}`.length + 1)); // 跳过 <wtName>/ 段
      const restNoName = rest.split(sep).slice(1).join(sep);
      p = wtRoot.endsWith(sep) ? wtRoot + restNoName : `${wtRoot}${sep}${restNoName}`;
    }
  }
  switch (opts.style) {
    case "absolute":
      return isAbsolute(p) ? p : `${opts.cwd}${sep}${p}`;
    case "basename":
      return basename(p);
    case "relative":
    default: {
      const rel = relative(opts.cwd, p);
      return rel && !rel.startsWith("..") ? rel : p;
    }
  }
}
```

- [ ] **Step 4: 实现 command.ts**

```ts
// packages/pi-tui-fold-blocks/src/folders/command.ts
export interface FoldCommandOpts {
  smart: boolean;
}

const WRAP_PREFIX = /^(?:cd\s+\S+\s*&&|source\s+\S+\s*&&|export\s+[^=]+=\S*\s*&&)\s*/;

export function foldCommand(command: string, opts: FoldCommandOpts): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (opts.smart) {
    let cur = trimmed;
    let next = cur.replace(WRAP_PREFIX, "");
    while (next !== cur) { cur = next; next = cur.replace(WRAP_PREFIX, ""); }
    return cur;
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS(8 用例)。

- [ ] **Step 6: Commit**

```bash
git add packages/pi-tui-fold-blocks/src/folders packages/pi-tui-fold-blocks/test/folders.test.ts
git commit -m "feat(tui-fold-blocks): foldPath + foldCommand pure functions"
```

## Task 4: 三态逻辑与工具覆盖(execute 委托)

**Files:**
- Create: `packages/pi-tui-fold-blocks/src/overrides.ts`
- Create: `packages/pi-tui-fold-blocks/src/render.ts`(折叠行组件,Task 5 完善)
- Modify: `packages/pi-tui-fold-blocks/src/index.ts`

**Interfaces:**
- Consumes: Task 1 入口;Task 2 `FoldBlocksConfig`/`Mode`/`setMode`;Task 3 `foldPath`/`foldCommand`;SDK `createReadToolDefinition`/`createBashToolDefinition`/`createEditToolDefinition`/`createWriteToolDefinition`(签名 `(cwd: string) => ToolDefinition`)、`pi.registerTool`、`pi.registerCommand`、`ExtensionContext`(execute 的第 5 参数,原样委托)。
- Produces: `interface ModeState { mode: Mode; setMode(m: Mode): void; addInvalidator(toolCallId: string, inv: () => void): void; removeInvalidator(toolCallId: string): void; rerenderAll(): void }`;`registerOverrides(pi: ExtensionAPI, cwd: string, cfg: FoldBlocksConfig, modeState: ModeState): void`;`renderBlock(opts: RenderBlockOpts): Text`(RenderBlockOpts = { toolName; kind: "file" | "bash"; args; result; isPartial; isError; expanded; config; cwd; modeState; theme: Theme; lastComponent: unknown; toolCallId: string },Task 5 填充实现)。index.ts 中 `const modeState = createModeState(config.mode, onModeChange)`,Task 6 接线持久化。

- [ ] **Step 1: 写失败测试(模式状态机)**

```ts
// packages/pi-tui-fold-blocks/test/mode.test.ts
import { describe, it, expect } from "vitest";
import { createModeState } from "../src/mode.js";

describe("mode state", () => {
  it("默认 fold,setMode 循环 native/fold/hide", () => {
    const s = createModeState("fold", () => {});
    expect(s.mode).toBe("fold");
    s.setMode("hide");
    expect(s.mode).toBe("hide");
    s.setMode("native");
    expect(s.mode).toBe("native");
  });
  it("rerenderAll 触发所有 invalidator", () => {
    let calls = 0;
    const s = createModeState("fold", () => { calls++; });
    s.addInvalidator("t1", () => { calls++; });
    s.rerenderAll();
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: FAIL(module missing)。

- [ ] **Step 3: 实现 mode.ts**

```ts
// packages/pi-tui-fold-blocks/src/mode.ts
import type { Mode } from "./config.js";

export interface ModeState {
  mode: Mode;
  setMode(m: Mode): void;
  addInvalidator(toolCallId: string, inv: () => void): void;
  removeInvalidator(toolCallId: string): void;
  rerenderAll(): void;
}

export function createModeState(initial: Mode, onModeChange: () => void): ModeState {
  let mode: Mode = initial;
  const invalidators = new Map<string, () => void>();
  return {
    get mode() { return mode; },
    setMode(m: Mode) { mode = m; onModeChange(); invalidators.forEach((inv) => inv()); },
    addInvalidator(id, inv) { invalidators.set(id, inv); },
    removeInvalidator(id) { invalidators.delete(id); },
    rerenderAll() { invalidators.forEach((inv) => inv()); },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS(2 用例)。

- [ ] **Step 5: 实现 overrides.ts(execute 委托 + 三态分派)**

```ts
// packages/pi-tui-fold-blocks/src/overrides.ts
import type { ExtensionAPI, ToolRenderContext, Component } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ModeState } from "./mode.js";
import type { FoldBlocksConfig } from "./config.js";
import { renderBlock } from "./render.js";

type DefFactory = (cwd: string) => ReturnType<typeof createReadToolDefinition>;

function override(
  pi: ExtensionAPI,
  name: string,
  cwd: string,
  factory: DefFactory,
  cfg: FoldBlocksConfig,
  modeState: ModeState,
): void {
  const original = factory(cwd);
  // renderCall 签名: (args, theme, context); renderResult: (result, options, theme, context)
  // ToolRenderContext 自带 args/toolCallId/invalidate/lastComponent/state/cwd/isPartial/isError/expanded
  const renderCall = (args: unknown, theme: unknown, context: ToolRenderContext): Component => {
    modeState.addInvalidator(context.toolCallId, context.invalidate);
    if (modeState.mode === "native") {
      // 完全放手:委托内置渲染(renderShell:self 限制下无状态色框,记录为已知限制)
      return (original.renderCall?.(args as never, theme as never, context) as Component) ?? new Text("", 0, 0);
    }
    // 单行原则:内容全部由 renderResult 渲染;这里返回 0 行空 Text,
    // 避免 SDK 将 renderCall 与 renderResult 都 addChild 导致两行。
    return new Text("", 0, 0);
  };
  const renderResult = (
    result: Awaited<ReturnType<typeof original.execute>>,
    options: { expanded: boolean; isPartial: boolean },
    theme: unknown,
    context: ToolRenderContext,
  ): Component => {
    modeState.addInvalidator(context.toolCallId, context.invalidate);
    if (modeState.mode === "native") {
      return (original.renderResult?.(result as never, options as never, theme as never, context) as Component) ?? new Text("", 0, 0);
    }
    return renderBlock({
      toolName: name,
      kind: name === "bash" ? "bash" : "file",
      args: context.args,
      result,
      isPartial: options.isPartial,
      isError: context.isError,
      expanded: options.expanded,
      config: cfg,
      cwd: context.cwd,
      modeState,
      theme: theme as never,
      lastComponent: context.lastComponent,
      toolCallId: context.toolCallId,
    });
  };
  pi.registerTool({
    ...original,
    renderShell: "self",
    execute: original.execute, // 原样委托,行为不变(D1/D8)
    renderCall: renderCall as never,
    renderResult: renderResult as never,
  });
}

export function registerOverrides(pi: ExtensionAPI, cwd: string, cfg: FoldBlocksConfig, modeState: ModeState): void {
  override(pi, "read", cwd, createReadToolDefinition, cfg, modeState);
  override(pi, "bash", cwd, createBashToolDefinition, cfg, modeState);
  override(pi, "edit", cwd, createEditToolDefinition, cfg, modeState);
  override(pi, "write", cwd, createWriteToolDefinition, cfg, modeState);
}
```

- [ ] **Step 6: 在 index.ts 接线**

```ts
// packages/pi-tui-fold-blocks/src/index.ts
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, setMode, type Mode } from "./config.js";
import { createModeState } from "./mode.js";
import { registerOverrides } from "./overrides.js";

export default function (pi: ExtensionAPI): void {
  let config = loadConfig();
  const modeState = createModeState(config.mode, () => {
    config = setMode(config, modeState.mode);
    // 持久化见 Task 6(命令注册)
  });
  const cwd = process.cwd();
  registerOverrides(pi, cwd, config, modeState);

  pi.registerCommand("fold-blocks", {
    description: "循环切换工具块显示模式(原生/折叠/隐藏)并进入设置",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      void args; void _ctx;
      // Task 6 填充:循环三态 + 设置子页面
    },
  });
}
```

- [ ] **Step 7: 冒烟验证(typecheck + 加载)**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks typecheck && cd /home/philogag/workspace/pi-exts/pi-ramdom-stuffs && pi -e ./packages/pi-tui-fold-blocks/src/index.ts -c "echo smoke"`
Expected: typecheck 无错;`pi -e` 加载扩展无报错(覆盖告警允许,execute 委托不变)。

- [ ] **Step 8: Commit**

```bash
git add packages/pi-tui-fold-blocks/src packages/pi-tui-fold-blocks/test/mode.test.ts
git commit -m "feat(tui-fold-blocks): mode state + tool overrides with execute delegation"
```

## Task 5: 折叠行渲染与状态背景色(render.ts 完整实现)

**Files:**
- Modify: `packages/pi-tui-fold-blocks/src/render.ts`(补全 Task 4 的 `renderBlock`)
- Create: `packages/pi-tui-fold-blocks/test/render.test.ts`(纯逻辑分支测试)

**Interfaces:**
- Consumes: Task 2 `FoldBlocksConfig`;Task 3 `foldPath`/`foldCommand`;Task 4 `ModeState`;pi-tui `Text`/`Box`/`Container` 组件。
- Produces: `renderBlock(opts: RenderBlockOpts): Text` 完整实现:fold 模式返回单行 Text(左概要+右统计,`setCustomBgFn` 自绘背景:文件块恒绿/bash 按 isPartial/isError);hide 返回空 `Text("",0,0)`(0 行 → 块消失);`buildFoldLine(opts): { left: string; right: string } | null`(供测试的纯函数);`contentRows`/`contentExitCode` 从 AgentToolResult.content 提取行数与退出码。

- [ ] **Step 1: 写失败测试(纯逻辑)**

```ts
// packages/pi-tui-fold-blocks/test/render.test.ts
import { describe, it, expect } from "vitest";
import { buildFoldLine, buildSingleLine, contentRows, contentExitCode } from "../src/render.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("buildFoldLine", () => {
  it("文件块:左 工具名 文件名 (参数) 右 行数", () => {
    const line = buildFoldLine({
      toolName: "read", kind: "file", path: "src/main.ts", args: { offset: 10, limit: 20 },
      rows: 20, config: DEFAULT_CONFIG, cwd: "/home/u/p",
    });
    expect(line!.left).toContain("read");
    expect(line!.left).toContain("src/main.ts");
    expect(line!.left).toContain("10");
    expect(line!.right).toBe("20");
  });
  it("bash 块:左 exec 摘要 右 输出行数", () => {
    const line = buildFoldLine({
      toolName: "bash", kind: "bash", command: "cd build && npm test", args: null,
      rows: 5, exitCode: 0, config: DEFAULT_CONFIG, cwd: "/home/u/p",
    });
    expect(line!.left).toContain("npm test");
    expect(line!.right).toContain("5");
  });
  it("hide 模式返回 null 渲染", () => {
    expect(buildFoldLine({
      toolName: "read", kind: "file", path: "a.ts", args: null, rows: 0,
      config: { ...DEFAULT_CONFIG, mode: "hide" }, cwd: "/",
    })).toBeNull();
  });
});

describe("buildSingleLine", () => {
  it("左右拼接且含留白", () => {
    expect(buildSingleLine("read a.ts", "20")).toMatch(/^read a\.ts\s+20$/);
  });
  it("超长左概要截断加 ...", () => {
    const line = buildSingleLine("x".repeat(80), "20");
    expect(line.length).toBeLessThan(80);
    expect(line).toContain("...");
  });
});

describe("contentRows / contentExitCode", () => {
  it("contentRows 聚合 TextContent 行数", () => {
    expect(contentRows({ content: [{ type: "text", text: "a\nb\nc" }] })).toBe(3);
    expect(contentRows({})).toBe(0);
  });
  it("contentExitCode 提取 exit code N", () => {
    expect(contentExitCode({ content: [{ type: "text", text: "boom\nexit code 2" }] })).toBe(2);
    expect(contentExitCode({ content: [{ type: "text", text: "ok" }] })).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: FAIL(buildFoldLine 未导出)。

- [ ] **Step 3: 实现 render.ts**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS(5 用例)。

- [ ] **Step 5: typecheck + 冒烟**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks typecheck && pi -e ./packages/pi-tui-fold-blocks/src/index.ts -c "echo smoke2"`
Expected: 无 TS 错;加载无运行时崩溃。

- [ ] **Step 6: Commit**

```bash
git add packages/pi-tui-fold-blocks/src/render.ts packages/pi-tui-fold-blocks/test/render.test.ts
git commit -m "feat(tui-fold-blocks): fold line rendering (single-line, left/right aligned)"
```

## Task 6: /fold-blocks 命令、设置子页面与持久化

**Files:**
- Modify: `packages/pi-tui-fold-blocks/src/index.ts`(命令 handler 完整实现)
- Create: `packages/pi-tui-fold-blocks/src/settings.ts`

**Interfaces:**
- Consumes: Task 2 `saveConfig`/`setMode`/`FoldBlocksConfig`/`Mode`;Task 4 `ModeState`;`pi.ui`(`ExtensionUIContext`) 的 `select(title, options, opts?): Promise<string|undefined>`、`confirm(title, message, opts?): Promise<boolean>`、`input(title, placeholder?, opts?): Promise<string|undefined>`。
- Produces: `openSettings(pi: Pick<ExtensionUIContext, "select"|"confirm"|"input">, config: FoldBlocksConfig, onSave: (cfg: FoldBlocksConfig) => void): Promise<void>`(settings.ts);命令 handler 循环:fold→hide→native→fold,并持久化。

- [ ] **Step 1: 写失败测试(命令循环逻辑)**

```ts
// packages/pi-tui-fold-blocks/test/command.test.ts
import { describe, it, expect } from "vitest";
import { nextMode } from "../src/settings.js";

describe("nextMode", () => {
  it("循环 fold -> hide -> native -> fold", () => {
    expect(nextMode("fold")).toBe("hide");
    expect(nextMode("hide")).toBe("native");
    expect(nextMode("native")).toBe("fold");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: FAIL(nextMode 未导出)。

- [ ] **Step 3: 实现 settings.ts**

```ts
// packages/pi-tui-fold-blocks/src/settings.ts
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { type FoldBlocksConfig, type Mode } from "./config.js";

export function nextMode(mode: Mode): Mode {
  return mode === "fold" ? "hide" : mode === "hide" ? "native" : "fold";
}

export async function openSettings(
  pi: Pick<ExtensionUIContext, "select" | "confirm" | "input">,
  config: FoldBlocksConfig,
  onSave: (cfg: FoldBlocksConfig) => void,
): Promise<void> {
  let cfg = config;
  for (;;) {
    const choice = await pi.select("fold-blocks 设置", [
      `${cfg.mode === "fold" ? "[x]" : "[ ]"} 模式:${cfg.mode}`,
      `${cfg.nerdFont ? "[x]" : "[ ]"} nerd font 图标`,
      `路径样式:${cfg.fileBlocks.pathStyle}`,
      `${cfg.fileBlocks.foldGitWorktree ? "[x]" : "[ ]"} git worktree 折叠`,
      `${cfg.bashBlocks.smart ? "[x]" : "[ ]"} bash 智能识别`,
      `${cfg.bashBlocks.showStatus ? "[x]" : "[ ]"} 状态提示`,
      "保存并退出",
    ]);
    if (!choice || choice === "保存并退出") break;
    if (choice.includes("模式:")) {
      const m = await pi.select("显示模式", ["native", "fold", "hide"]);
      if (m) cfg = { ...cfg, mode: m as Mode };
    } else if (choice.includes("nerd font")) {
      cfg = { ...cfg, nerdFont: !cfg.nerdFont };
    } else if (choice.includes("路径样式")) {
      const s = await pi.select("路径样式", ["relative", "absolute", "basename"]);
      if (s) {
        cfg = { ...cfg, fileBlocks: { ...cfg.fileBlocks, pathStyle: s as FoldBlocksConfig["fileBlocks"]["pathStyle"] } };
      }
    } else if (choice.includes("git worktree")) {
      cfg = { ...cfg, fileBlocks: { ...cfg.fileBlocks, foldGitWorktree: !cfg.fileBlocks.foldGitWorktree } };
    } else if (choice.includes("智能识别")) {
      cfg = { ...cfg, bashBlocks: { ...cfg.bashBlocks, smart: !cfg.bashBlocks.smart } };
    } else if (choice.includes("状态提示")) {
      cfg = { ...cfg, bashBlocks: { ...cfg.bashBlocks, showStatus: !cfg.bashBlocks.showStatus } };
    }
  }
  onSave(cfg);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: PASS(1 用例)。

- [ ] **Step 5: 完整命令 handler**

```ts
// packages/pi-tui-fold-blocks/src/index.ts (替换 Task 4 Step 6 的 handler 占位)
// 顶部已有 import type { ExtensionAPI, ExtensionCommandContext } 与
// import { loadConfig, setMode } from "./config.js"、createModeState、registerOverrides、openSettings;
// handler 真实签名: (args: string, ctx: ExtensionCommandContext) => Promise<void> — args 是字符串参数。
pi.registerCommand("fold-blocks", {
  description: "循环切换工具块显示模式(原生/折叠/隐藏)并进入设置",
  handler: async (args: string, _ctx: ExtensionCommandContext) => {
    if (args.trim() === "settings") {
      await openSettings(pi, config, (next) => {
        config = next as FoldBlocksConfig;
        saveConfig(config);
      });
      return;
    }
    const next = nextMode(modeState.mode);
    modeState.setMode(next); // 触发 rerenderAll
    config = setMode(config, next);
    saveConfig(config);
  },
});
```

- [ ] **Step 6: typecheck + 冒烟(循环三态)**

Run: `pnpm --filter @philogag/pi-tui-fold-blocks typecheck && pi -e ./packages/pi-tui-fold-blocks/src/index.ts -c "echo smoke3"`
Expected: 无 TS 错;/fold-blocks 可循环三态并写 settings.json(观察文件内容含 `@philogag/pi-tui-fold-blocks` 块)。

- [ ] **Step 7: Commit**

```bash
git add packages/pi-tui-fold-blocks/src packages/pi-tui-fold-blocks/test/command.test.ts
git commit -m "feat(tui-fold-blocks): /fold-blocks command + settings persistence"
```

## Task 7: 验证与发布准备

**Files:**
- Modify: `packages/pi-tui-fold-blocks/package.json`(private 置 false 或按发布策略)
- 无新代码

**Interfaces:**
- Consumes: 全部前序产出。

- [ ] **Step 1: 全量验证**

Run: `cd /home/philogag/workspace/pi-exts/pi-ramdom-stuffs && pnpm --filter @philogag/pi-tui-fold-blocks typecheck && pnpm --filter @philogag/pi-tui-fold-blocks test`
Expected: 全部通过;`pnpm -r build` 亦通过(根 references 覆盖)。

- [ ] **Step 2: 冒烟验收(对照 design 验收条件)**

Run: `pi -e ./packages/pi-tui-fold-blocks/src/index.ts` 后人工/脚本核对:
- `/fold-blocks` 循环三态立即重绘(跨块 `rerenderAll`);
- 折叠块为单行左右对齐(文件块左 `read 文件 (offset,limit)` 右 行数;bash 左 `exec 摘要` 右 输出行数/退出码);
- 文件块背景常绿;bash 运行黄/成功绿/失败红;
- settings.json 的 `<包名>` 块可读写;缺失/损坏回退默认值不阻塞渲染;
- nerd font 图标开关生效(开=图标,关=纯文本工具名)。

- [ ] **Step 3: 非侵入确认**

Run: 对比启用扩展前后,同一会话中 read/bash/edit/write 的 session 与存储历史内容不变(仅渲染层替换);卸载扩展(`.pi/extensions/` 移除或配置关闭)后行为恢复内置。
Expected: 无差异。

- [ ] **Step 4: Commit**

```bash
git add packages/pi-tui-fold-blocks
git commit -m "chore(tui-fold-blocks): verification pass + release prep"
```
