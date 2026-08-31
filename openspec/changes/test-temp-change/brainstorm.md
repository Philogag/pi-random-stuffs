<!--
superpowers:brainstorming 产出的原始捕获。

本文件原样捕捉 brainstorming skill 的产出，不强制结构。
-->

# 决策日志：add-hello-greeting（临时测试变更）

## 背景

用户需要一个**临时 OpenSpec 变更用于测试** OpenSpec 工作流本身
（openspec status / instructions / 制品生成 / apply 流程）。
不是真实功能开发，内容以最简为主，走通全流程即可。

## 决策链

### Q1: 测试变更的主题是什么？
- **决定**：`add-hello-greeting` —— 一个极简能力：提供 `hello()` 问候函数。
- 理由：内容足够小，能完整覆盖所有制品类型（brainstorm/proposal/design/specs/tasks/plan），
  又不会引入真实业务语义，符合"临时测试"定位。

### Q2: 能力边界？
- 决定：单函数 `hello(name: string): string`，无外部依赖，无状态。
- 非目标：不引入 CLI、不接网络、不做 i18n。

### Q3: 测试如何验证？
- 决定：单个单元测试，`hello("world") === "Hello, world!"`。
- 理由：验证 apply 阶段能跑测试，同时保持最小。

## 设计取舍

| 选项 | 取舍 |
|------|------|
| 单函数 vs 多模块 | 单函数：无需模块拆分，测试简单 |
| 固定文案 vs 可配置文案 | 固定 "Hello, {name}!"：YAGNI，无配置负担 |
| 纯 TS 函数 vs CLI 工具 | 纯 TS 函数：仓库是 TS monorepo，无需额外运行时 |

## 结论

实现一个 `hello(name)` 纯函数 + 单测，改动局限在
`packages/` 下的单一包内，作为测试 OpenSpec 全流程的载体。
