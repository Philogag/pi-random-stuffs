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

## Requirements

- Node.js `>=20`
- pnpm `>=9` (本仓库用 `pnpm@9.12.3`,见根 `package.json` 的 `packageManager`)

## Common commands

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装所有 workspace 依赖 |
| `pnpm build` | 递归(按 workspace 拓扑序)构建所有 packages |
| `pnpm test` | 运行所有 packages 的测试 |
| `pnpm test:unit` | 运行所有 packages 的单元测试 |
| `pnpm typecheck` | `tsc -b` 项目引用增量类型检查 |
| `pnpm lint` | 运行所有 packages 的 lint |
| `pnpm clean` | 清理所有 packages 的 `dist/` 等构建产物 |

## 添加一个新 package

1. `mkdir -p packages/<name>` 并在其中创建 `package.json` / `tsconfig.json`
2. 在根 `tsconfig.json` 的 `references` 中加入 `{ "path": "./packages/<name>" }`
3. 在 `packages/<name>/tsconfig.json` 中:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "composite": true, "outDir": "dist", "tsBuildInfo": "dist/.tsbuildinfo" },
     "include": ["src"]
   }
   ```
4. 跨包引用时,使用 `workspace:*` 协议,例如 `"@scope/util": "workspace:*"`

## 跨包引用示例

在 `packages/a/package.json`:

```json
{
  "name": "@scope/a",
  "dependencies": { "@scope/b": "workspace:*" }
}
```

pnpm 会把 `packages/b` 软链到 `packages/a/node_modules/@scope/b`,无需发布。