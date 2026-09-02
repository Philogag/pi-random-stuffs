# @philogag/pi-tui-openspec-status

pi TUI 插件:在状态栏单行显示当前锁定的 **openspec** change 进度:

```
add-pi-tui-openspec-status (superpowers-bridge-cn) [P● D● S○ T○] Tasks: ███░░░░░░░ 2/7
```

## 安装

```bash
pi install npm:@philogag/pi-tui-openspec-status
```

- 安装后扩展自动启用,无需额外配置;用 `pi config` 可启用 / 禁用。
- 项目级安装加 `-l`(`pi install -l npm:@philogag/pi-tui-openspec-status`,写入 `.pi/settings.json`,可随仓库共享)。
- 卸载:`pi remove npm:@philogag/pi-tui-openspec-status`。
- 快速体验:`pi -e npm:@philogag/pi-tui-openspec-status`(仅本次运行,不写入配置)。

## 激活模式

本扩展**仅限 TUI**。工厂阶段拿不到 `ctx.mode`(第一个事件触发后才有),因此门控在 `session_start`(第一个事件)时执行:

| 模式     | 激活?  | 说明                                     |
| -------- | ------ | ---------------------------------------- |
| `tui`    | ✅ 是  | 正常交互操作                             |
| `rpc`    | ❌ 否  | 此处 `ctx.hasUI === true`,但模式检查排除它 |
| `json`   | ❌ 否  | 无事件流输出                             |
| `print`  | ❌ 否  | `-p` 一次性模式                          |

按 `pi.dev/docs/latest/extensions#ctx-mode`,`ctx.mode`(而非 `ctx.hasUI`)才是正确的 TUI 特性门控。`/tui-openspec-select` 命令(可能在没有先发生 `session_start` 的情况下运行)在渲染前会重新检查模式。

## 行为

- 当你(或 agent)执行**显式指定 change** 的 openspec 命令时——`new`、`status`、`apply`、`archive`、`verify`、`sync`、`instructions`、`show`、`validate`、`context`、`view`——或手动用 `/tui-openspec-select` 选择 change 后,状态行出现。
- 浏览类命令(`openspec list` / `openspec doctor`)会清空状态行。
- 每次匹配的 `bash` 工具调用后 500ms 刷新。

## 手动跟踪:`/tui-openspec-select`

TUI 模式下可用 `/tui-openspec-select` 命令手动控制状态栏:

- 打开交互选择器,列出所有**活跃** change(`openspec/changes/*/` 减去 `archive/`)加一个 `None` 选项。
- 手动选择 change 会**锁定**状态栏:之后 bash 的 `openspec` 命令不会切换它,除非你手动重新选择或选 `None`(手动覆盖自动)。
- 选 `None` 清除手动锁,恢复 bash 命令的自动跟踪。
- 取消选择器(Esc)不改变任何内容——当前跟踪状态保持不变。
- 归档手动跟踪的 change(如 `openspec archive <name>`)仍会照常自动清空状态栏。

## 锁定跨重启持久化

跟踪的 spec、worktree 和锁类型(手动 vs 自动)通过 `pi.appendEntry()`(自定义条目——绝不发给 LLM)持久化到会话文件。`session_start` 时——包括 `/resume`(pi 用新实例重载扩展)——读回最后一条匹配条目并重建状态栏:

- **手动**锁(`/tui-openspec-select`)恢复后保持固定,bash 的 openspec 命令不会切换它。
- **自动**锁(来自 bash `openspec` 命令)按自动语义恢复,后续 `openspec status --change X` 仍会更新跟踪的 spec。
- 清除(`None` / 归档自动解锁)会写入显式空快照,因此不会恢复过期锁。

这意味着状态栏在 `/resume` 和扩展重载后依然保留,而不是变空。

## Worktree 支持

当 `openspec` 在 git worktree 内调用时(如 `.worktrees/feat/openspec-status/`),扩展会同时读取主仓库和 worktree 的 `tasks.md`,按任务 ID 去重:

- 任一侧勾选即为"完成"。
- 总数为唯一任务 ID 的并集。

这防止了 worktree 领先于主仓库时进度条回退(常见的 SDD apply 场景)。

## 已知限制

- 只显示 schema 的外部产物(`proposal`、`design`、`specs`、`tasks`);规划阶段内部产物(`brainstorm`、`verify`、`retrospective`)隐藏。
- 需要 `openspec` CLI 在 `$PATH` 上。CLI 缺失时静默禁用扩展。
- 不渲染 widget、对话框或键盘快捷键——只有底部状态栏(`ctx.ui.setStatus`)。
- **非 TUI 模式(rpc/json/print)不激活**——设计如此。

## 开发

```bash
pnpm install                 # 安装依赖(弱依赖来自宿主 pi,devDeps 供本地构建)
pnpm --filter @philogag/pi-tui-openspec-status test        # 测试
pnpm --filter @philogag/pi-tui-openspec-status typecheck
pnpm --filter @philogag/pi-tui-openspec-status build       # 产出 dist/
```

### 依赖说明

运行时依赖(`@earendil-works/pi-coding-agent` / `typebox`)声明为 **peerDependencies(弱依赖)**:宿主 pi 环境已内置这些包,插件不重复打包;`devDependencies` 中保留同名依赖供本地 typecheck / test。
