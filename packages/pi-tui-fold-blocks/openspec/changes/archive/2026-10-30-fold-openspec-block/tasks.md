# Tasks

## 1. 实现 openspec 渲染器覆盖（方案 A：registerToolRenderer）

- [x] 1.1 在 src 新增 `registerOpenspecRenderer(pi, cfgGetter)`：调用 `pi.registerToolRenderer` 注册 resolver，`toolName === "openspec"` 时返回 `openspecRenderers(next, cfgGetter)`，否则返回 `next()`（保持链路）。
- [x] 1.2 实现 `openspecRenderers`：返回 `{ renderShell:"self", renderCall, renderResult }`；`renderCall`/`renderResult` 运行时经 `cfgGetter()` 读当前 mode 与 `ctx.expanded` 路由。
- [x] 1.3 实现 openspec 折叠行 lineBuilder：`shown = [subcommand, ...args, change ? "--change " + change : ""].filter(Boolean).join(" ")`，左侧 `openspec - <shown>`，右侧状态由 result 解析（`contentExitCode` 非零 → `FAILED(n)`，否则 `SUCCESS`）；对缺失字段防御读取。
- [x] 1.4 模式路由：`native` → 返回 `next()` 原生渲染；`hide` → 空；`fold && expanded` → 用 `next()` 聚合原生 call+result 成单盒（沿用 `renderExpandedFold` + `unwrapBoxChildren`，保留状态背景，不含折叠摘要行）；`fold` → `renderOwnedBlock` 折叠单行。`next()` 为 undefined 时安全降级（折叠分支正常）。
- [x] 1.5 在 `registerOverrides`（src/overrides.ts）中随既有工具一并调用 `registerOpenspecRenderer`，并导出所需新符号供测试/复用。

## 2. TDD 测试（test/）

- [x] 2.1 单行拼接：渲染 `{subcommand:"status", args:[], change:"add-user-auth"}` → 左侧含 `openspec - status --change add-user-auth`；`{subcommand:"new change", args:["add-dark-mode"]}` → `openspec - new change add-dark-mode` 且无 `--change`。
- [x] 2.2 行内不含 `root`/`json` 等非 subcommand/args/change 参数；缺失字段（如 args/change undefined）不崩溃。
- [x] 2.3 右状态：退出码 0 → SUCCESS；非零退出码文本（`[exit code N]`）→ FAILED(N)。
- [x] 2.4 模式路由：native → 委托 `next()` 结果；hide → 空；fold+expanded → 展开原生完整输出（无折叠摘要行）且保留状态背景；再次收起 → 单行。
- [x] 2.5 非 openspec 工具 resolver 返回 `next()`/undefined，不受影响；未注册 openspec（模拟无该工具）时无副作用。
- [x] 2.6 `pnpm typecheck` 0 错误、本包测试全绿、全仓 `pnpm -r exec tsc --noEmit` 0 错误。

## 3. 收尾

- [x] 3.1 更新 README（新增 openspec 折叠说明）与 package version（0.2.x → 0.3.0），重建 dist。
- [x] 3.2 无头冒烟（沿用 smoke 脚本思路）：`openspec` 折叠单行 + 展开态背景一致断言通过。