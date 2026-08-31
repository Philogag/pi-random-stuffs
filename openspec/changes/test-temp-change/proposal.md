## Why

需要一个临时的 OpenSpec 变更来测试 openspec 工作流的完整链路（制品生成、status 流转、apply 执行）。选用最小 hello-world 能力作为载体：内容足够简单，不会引入真实业务语义，但能覆盖所有制品类型，便于验证工作流本身是否正常。

## What Changes

新增一个极简问候能力：

**hello-greeting 能力**
- From: 无（仓库中不存在任何问候功能）
- To: 提供纯函数 `hello(name: string): string`，返回 `Hello, {name}!`
- Reason: 作为测试变更的最小可执行载体
- Impact: non-breaking，新增包内代码与单元测试，不影响既有功能

## Capabilities

### New Capabilities
- `hello-greeting`: 提供 `hello(name)` 纯函数，返回固定格式问候语

### Modified Capabilities

（无 — 不修改既有 spec）

## Impact

- 代码：在 `packages/` 下某个包内新增 `hello` 函数及单测
- API：新增一个导出函数，无破坏性变更
- 依赖：无新增依赖
