# fold-openspec-block Implementation Plan

> **给 agentic worker 使用：** 用 superpowers:subagent-driven-development
> 逐任务实现本计划（TDD）。

---
change: fold-openspec-block
design-doc: openspec/changes/fold-openspec-block/design.md
base-ref: a9a7560f883c2e2a3cb27ec704e27a6ca6add5f1
---

**Goal:** 让 `@philogag/pi-tui-fold-blocks` 兼容 pi-openspec-bridge 的 `openspec` 工具——折叠成单行 `openspec - <sub> <args> [--change X]` + 右侧状态，遵循全局 fold/hide/native 模式并支持单击展开。

**Architecture:** 沿用既有 `registerOverrides(pi, cwd, cfgGetter)` 入口，但用 SDK 的 `pi.registerToolRenderer` 注册一个按工具名分发的 resolver（方案 A）：`toolName === "openspec"` 返回 `{ renderShell:"self", renderCall, renderResult }`，其余委托 `next()`。renderers 运行时读 live config 路由模式；折叠走 `renderOwnedBlock`，展开/原生经 `next()` 聚合原生 call+result 成单盒。不 import pi-openspec-bridge，只读 `subcommand/args/change` 字段。

**Tech Stack:** TypeScript ESM、pi SDK `@earendil-works/pi-coding-agent@1.4.0`、vitest。

---

## Task 1: 新增 openspec 渲染器（resolver + 行构造，TDD）

- [ ] **Step 1:** 建测试骨架 `test/openspec-render.test.ts`（红）。断言：`shown` 构造函数输入 `{subcommand:"status", args:[], change:"add-user-auth"}` → `status --change add-user-auth`；`{subcommand:"new change", args:["add-dark-mode"], change:undefined}` → `new change add-dark-mode`（无 `--change`）。
  `跑: pnpm test test/openspec-render.test.ts` 应失败于缺失模块（待实现）。
- [ ] **Step 2:** 在 `src/render.ts`（或 `src/openspec.ts`）新增纯函数 `openspecShown(args): string` 与 `openspecStatusText(result): string`——前者=`[subcommand, ...args, change?"--change "+change:""].filter(Boolean).join(" ")`；后者复用 `contentExitCode`（非零 → `` `FAILED(${n})` ``，否则 `SUCCESS`），对缺失字段防御。让 Step 1 测试转绿。
  `跑: pnpm test test/openspec-render.test.ts`
- [ ] **Step 3:** 建 `test/openspec-mode.test.ts`（红，TDD 先写场景后实现）：断言模式路由 dispatch 在 native→调 next、hide→空、fold→折叠行、fold+expanded→展开单盒（保留状态背景、无折叠摘要行）、next() 为 undefined 时折叠正常。
- [ ] **Step 4:** 在 `src/overrides.ts` 新增 `export function registerOpenspecRenderer(pi, cfgGetter)`：`pi.registerToolRenderer((toolName, next) => toolName === "openspec" ? openspecRenderers(next, cfgGetter) : next())`；并实现 `openspecRenderers` 返回 `{ renderShell:"self", renderCall, renderResult }`，按 Step 3 路由。`renderCall`/`renderResult` 的 expand 分支复用 `renderExpandedFold` + `unwrapBoxChildren` 对 `next()` 输出聚合；fold 分支调 `renderOwnedBlock(opts, lineContext, ~~)` 带 openspec lineBuilder（icon + `openspec - <shown>` + 右状态）。让 Step 3 绿。
- [ ] **Step 5:** 新增 `test/openspec-native-absent.test.ts`（红→绿）：断言非 openspec 工具 resolver 返回 `next()`/undefined（不受影响）、模拟无 `openspec` 工具时覆盖无副作用。
- [ ] **Step 6:** 在 `src/overrides.ts` 的 `registerOverrides(...)` 末尾调用 `registerOpenspecRenderer(pi, cfgGetter)`，并补导出新符号（`src/index.ts` 的 export 列表）。
  `跑: pnpm typecheck && pnpm test`
- [ ] **提交:** `测试通过后` → `git add -A && git commit -m "feat(pi-tui-fold-blocks): openspec 工具折叠为单行(registerToolRenderer 方案 A)"`

## Task 2: 无头冒烟 + 版本/文档

- [ ] **Step 1:** 扩展 `scripts/smoke-click.mjs`（或新增 `scripts/smoke-openspec.mjs` + `"smoke:openspec"` script）：用真实 SDK 容器注册一个 `name:"openspec"` 的假执行（stub execute 返回带 `[exit code 1]` 的文本），驱动折叠渲染——断言折叠态为单行 `openspec - …` 右 `FAILED(1)`；单击后展开态非空行均含 `\x1b[48;2;` 状态背景。
  `跑: pnpm smoke:openspec`
- [ ] **Step 2:** 更新 `README.md`（openspec 折叠说明 + 与 pi-openspec-bridge 的联动），package.json version `0.2.0 → 0.3.0`，`pnpm build` 重建 dist。
- [ ] **Step 3:** 全仓回归：`pnpm -r exec tsc --noEmit` 0 错误；本包 + 相关包测试全绿。
  `跑: pnpm test`
- [ ] **提交:** `git add -A && git commit -m "chore(pi-tui-fold-blocks): openspec 冒烟+版本 0.3.0"`

## Task 3: 手工冒烟确认（需用户）

- [ ] **Step 1:** 构建并在运行中的 pi 重启扩展后，实际调一次 `openspec …`，确认终端折叠为单行表现正确、单击可展开（需用户在终端点一下确认，agent 无法代跑）。

## 说明

- 每步保持测试红→绿；实现严格贴合 `specs/openspec-tool-collapse/spec.md` 的三条 Requirement 与 `design.md` 的 D1–D4。
- 绝不 import pi-openspec-bridge；只在 openspec 参数上读 `subcommand/args/change`。
- 不修改既有 `tui-tool-block-collapse` requirements。