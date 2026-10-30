## 1. 渲染核心（src/render.ts）

- [x] 1.1 新增导出 `contentText(result)`：从 `AgentToolResult.content` 拼接原始文本，缺失/非数组/空内容返回空串（TDD：先写 `test/render.test.ts` 用例）
- [x] 1.2 新增展开态块容器：多行内容 + 按 `\x1b[0m` 分片重套背景 + `paddingX` 可配（`outputPad`）、`paddingY=1`，并为其写组件级单测（行数、背景转义、宽度 pad）
- [x] 1.3 `renderOwnedBlock` 响应 `ctx.expanded`：折叠摘要行作头部 + 展开体（优先 `opts.expandedBody` 回调，否则 `contentText` 原文逐行），并保证 `mode: "hide"` 与 `expanded: false` 输出与现状逐字节一致
- [x] 1.4 `RenderBlockOpts` 增加可选 `expandedBody?: (ctx, opts) => Component | undefined` 字段，导出对应类型

## 2. 内置四工具覆盖（src/overrides.ts）

- [x] 2.1 `fold` 模式且 `expanded` 为真时委托原生渲染器：result 槽返回「原生 `renderCall` 头 + 原生 `renderResult(expanded: true)` 体」装进单个自绘盒子；call 槽（`isPartial`）仅返回原生头
- [x] 2.2 委托时不传 `lastComponent`，避免跨布局复用被折叠态 mutate 过的 `Text` 实例
- [x] 2.3 单测：spy 原生渲染器断言展开态以 `expanded: true` 调用、折叠态不调用；断言展开态输出行数 > 折叠态（read/bash 各一例）
- [x] 2.4 回归：`native` 与 `hide` 模式、折叠态渲染的既有单测全部保持通过且无需修改断言

## 3. 库面与文档

- [x] 3.1 `src/index.ts` 追加导出 `contentText` 与展开体相关类型（保持既有导出与默认导出工厂不变）
- [x] 3.2 `README.md` 补充「单击展开」行为、`hide`/`native` 下的语义、以及外部扩展用 `expandedBody` 自绘展开体
- [x] 3.3 提升 `packages/pi-tui-fold-blocks/package.json` 版本为 `0.2.0`（minor：新增可展开行为，无 breaking；仓库用 `scripts/publish-changed.sh` 按版本号差异发布，无 changesets）

## 4. 验证

- [x] 4.1 `pnpm --filter @philogag/pi-tui-fold-blocks typecheck` 与 `test` 全绿
- [x] 4.2 `pnpm -r exec tsc --noEmit` 与 `pnpm -r exec vitest run` 在仓库根全绿（确认没有影响 presistant-bash 等依赖库面的包）
- [ ] 4.3 手工冒烟（可延后至 [~]）：真实 TUI 中单击 read/bash 块展开与收起、切换 mode 后再单击
