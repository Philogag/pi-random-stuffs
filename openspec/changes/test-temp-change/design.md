## Context

本仓库（pi-random-stuffs）是 pnpm workspace 的 TS monorepo，已启用 OpenSpec 工作流（schema: superpowers-bridge-cn）。本次变更为**临时测试变更**，目的是验证 openspec 制品生成与 apply 全链路是否正常，内容刻意保持最小，不承载真实业务语义。

## Goals / Non-Goals

**Goals:**
- 提供 `hello(name: string): string` 纯函数，返回 `Hello, {name}!`
- 提供单个单元测试验证函数行为
- 完整走通 proposal → specs → tasks → plan 制品链路

**Non-Goals:**
- 不引入 CLI、HTTP 接口或任何外部依赖
- 不做 i18n、可配置文案、日志
- 不修改既有 spec 与既有包行为

## Decisions

### D1：能力载体为纯函数
- **选择**：单个导出函数 `hello(name)`，置于 `packages/` 下某一包中
- **理由**：仓库是 TS monorepo，纯函数改动面最小、最易测试
- **已考虑 alternative**：CLI 工具 —— 需额外处理 argv/stdio，对测试工作流无增益，拒绝

### D2：固定文案格式
- **选择**：固定 `Hello, {name}!`
- **理由**：YAGNI，无配置状态，测试断言简单确定
- **已考虑 alternative**：可配置 greeting 文案 —— 引入配置层，超出测试变更最小边界，拒绝

### D3：测试方式为单测
- **选择**：一个单元测试文件，断言 `hello("world") === "Hello, world!"`
- **理由**：验证 apply 阶段测试执行链路；单测足够覆盖纯函数
- **已考虑 alternative**：集成/e2e 测试 —— 对纯函数过度，拒绝

## Risks / Trade-offs

[Risk] 测试变更可能被误当成真实功能合并 → Mitigation: 变更名与文档中明确标注"临时测试"，apply 后即可 archive 清理
[Trade-off] 函数放置包位置未在 design 层指定具体包 → 接受：spec 只约束行为，具体落点由 tasks 决定

## Migration Plan

N/A — 本 change 不涉及部署变更（纯新增函数与测试，无 endpoint / DB / 依赖变更）。回滚策略：删除新增文件即可。

## Open Questions

无。
