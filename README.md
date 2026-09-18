# pi-ramdom-stuffs

Node.js monorepo scaffold using **pnpm workspaces** + **TypeScript**。存放 pi 相关的扩展/工具包。

## Packages

| 包 | 说明 | 状态 |
| --- | --- | --- |
| [`@philogag/pi-tui-fold-blocks`](packages/pi-tui-fold-blocks/) | pi TUI 插件:折叠 / 隐藏工具调用块(三态、单行左右对齐、状态背景色) | ✅ 可用 |
| [`@philogag/pi-tui-openspec-status`](packages/pi-tui-openspec-status/) | pi TUI 插件:在状态栏显示当前锁定的 openspec change 进度(自动/手动锁定、worktree 合并、锁定状态跨会话持久化) | ✅ 可用 |
| [`@philogag/pi-tool-presistant-bash`](packages/pi-tool-presistant-bash/) | pi 扩展:为 agent 管理长驻 bash 会话(创建/执行/查询/销毁,支持 docker exec / ssh 等自定义启动命令,含 docker/podman 容器会话封装) | ✅ 可用 |

## Layout

```
.
├── packages/              # 所有的可复用 packages 放在这里
│   └── <name>/            # 每个子 package 自带 package.json / tsconfig.json
├── package.json           # workspace 根 (private)
├── pnpm-workspace.yaml    # 声明 workspace glob
├── tsconfig.base.json     # 共享的 TS 编译选项基线
└── tsconfig.json          # 根项目引用入口 (references)
```

## OpenSpec Layout (after split)

Root `openspec/` has been removed. Each package now maintains its own independent OpenSpec workspace under `packages/<pkg>/openspec/`:

- `config.yaml` (copied from root)
- `schemas/superpowers-bridge-cn/` (schema + templates, duplicated across packages)
- `specs/<relevant-spec>/spec.md`
- `changes/archive/<relevant-change>/` (only changes that affect that package)

The original root `test-temp-change` was deleted as it was purely for workflow testing (hello-greeting capability).

Use `openspec` CLI inside a package directory to work with its workspace.

