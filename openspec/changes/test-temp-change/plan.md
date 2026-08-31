# hello-greeting 临时测试变更 Implementation Plan

> **给 agentic worker 使用：** 用 superpowers:subagent-driven-development
> 逐任务实现本计划。Steps 使用 checkbox（`- [ ]`）语法跟踪进度。

---
change: test-temp-change
design-doc: openspec/changes/test-temp-change/design.md
base-ref: a2603c0a1889de7250fe03c80f3331a567e2383f
---

**Goal:** 新建 `packages/hello-greeting` 包，提供 `hello(name)` 纯函数并通过单测，作为 OpenSpec 工作流的临时测试载体。

**Architecture:** 独立小包（仿照既有 `packages/pi-tui-*` 结构），不引入 pi peer 依赖；`src/index.ts` 导出纯函数，`test/index.test.ts` 用 vitest 覆盖 spec 三个场景。

**Tech Stack:** TypeScript 5.6+、vitest、pnpm workspace。

**Spec:** `openspec/changes/test-temp-change/specs/hello-greeting/spec.md`

## Global Constraints

- 纯函数：无副作用、无状态、无外部依赖
- 不引入 CLI / HTTP / i18n
- 包名遵循仓库既有命名：`@philogag/hello-greeting`
- Node >= 20（根 package.json engines）

---

## Task 1: 创建 hello-greeting 包结构（tasks 1.1）

- [ ] **Step 1:** 创建 `packages/hello-greeting/package.json`（name `@philogag/hello-greeting`，type `module`，scripts: build/typecheck/test=`vitest run`/lint，devDeps: typescript + vitest，**不含** pi peer 依赖）
- [ ] **Step 2:** 创建 `packages/hello-greeting/tsconfig.json`（extends `../../tsconfig.base.json`，rootDir src，outDir dist，include src+test）
- [ ] **Step 3:** 创建空 `src/index.ts` 与 `test/index.test.ts` 占位
- [ ] **Step 4:** 运行 `pnpm install` 安装依赖（如 workspace 已自动链接则跳过）
- [ ] **Step 5:** 运行 `pnpm --filter @philogag/hello-greeting typecheck` 确认包可编译
- [ ] **Step 6:** Commit: `chore(hello-greeting): scaffold test package`

## Task 2: TDD 实现 hello 函数（tasks 1.2, 2.1）

- [ ] **Step 1:** 在 `test/index.test.ts` 写失败测试，覆盖三个场景：`hello("world") === "Hello, world!"`、`hello("") === "Hello, !"`、重复调用返回相同结果（纯函数语义）
- [ ] **Step 2:** 运行 `pnpm --filter @philogag/hello-greeting test`，确认测试失败（模块无导出）
- [ ] **Step 3:** 在 `src/index.ts` 实现 `export function hello(name: string): string { return \`Hello, ${name}!\`; }`
- [ ] **Step 4:** 运行测试，确认全部通过
- [ ] **Step 5:** Commit: `feat(hello-greeting): add hello function with tests`

## Task 3: Monorepo 验证与收尾（tasks 2.2, 3.1, 3.2）

- [ ] **Step 1:** 运行根目录 `pnpm build`，确认新包正常构建
- [ ] **Step 2:** 运行根目录 `pnpm test:unit`，确认 monorepo 整体无回归
- [ ] **Step 3:** 运行 `openspec validate --change test-temp-change`（如支持），确认 delta spec 合法
- [ ] **Step 4:** Commit: `chore(hello-greeting): verify monorepo integration`
- [ ] **Step 5:** 记录清理方式：临时测试完成后删除 `packages/hello-greeting` 即可回滚
