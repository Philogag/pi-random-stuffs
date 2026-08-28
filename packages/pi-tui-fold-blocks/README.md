# @philogag/pi-tui-fold-blocks

pi TUI 插件:折叠 / 隐藏工具调用块,让对话更清爽。**只改渲染,不改 session**——所有内容仍完整保留在会话里。

## 特性

- **三态显示模式**:`native`(原生)/ `fold`(折叠成一行)/ `hide`(完全不渲染)
- **单行左右对齐**:左侧概要 + 右侧统计,不占纵向空间
- **状态背景色**:
  - 文件操作块(read / edit / write):恒绿
  - bash 块:运行中(黄)/ 失败(红)/ 成功(绿),颜色随状态实时变化
- **智能 bash 摘要**:自动剥离 `cd ... &&` / `source ... &&` 前缀,提取关键命令
- **路径样式可选**:`relative` / `absolute` / `basename`;git worktree 路径自动折叠
- **nerd font 图标**:默认开启,可关闭(兼容无 nerd font 字体的终端)
- **非侵入**:`execute` 原样委托给内置工具,不改变任何行为

## 安装

扩展放在自动发现的扩展目录中:

| 位置 | 作用域 |
| --- | --- |
| `~/.pi/agent/extensions/` | 全局(所有项目) |
| `.pi/extensions/` | 项目级(需先信任项目) |

把仓库内 `packages/pi-tui-fold-blocks/` 复制(或链接)到上述任一目录的 `pi-tui-fold-blocks/` 子目录即可,如:

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/packages/pi-tui-fold-blocks" ~/.pi/agent/extensions/pi-tui-fold-blocks
```

或在 `~/.pi/settings.json` 的 `extensions` 数组中追加包目录的绝对路径。

> 也可使用 `pi -e ./packages/pi-tui-fold-blocks/src/index.ts` 快速体验。

改动扩展后执行 `/reload` 热重载,无需重启 pi。

## 使用

## Settings

Run `/tui-fold-blocks` to open the settings page. The page follows pi's
native settings interaction:

- Single select list with all options (Mode, Nerd font icons, Path style,
  Fold git worktree, Bash smart detection, Show status hints).
- `↑`/`↓` to navigate, `Space` to cycle the selected option's value
  (booleans cycle `on`/`off`, enums cycle their choices).
- Changes are saved to `settings.json` immediately.
- `Esc` closes the page.

### 手动配置

直接在 `settings.json` 中写入即可(扩展启动时读取):

```json
{
  "@philogag/pi-tui-fold-blocks": {
    "mode": "fold",
    "nerdFont": true,
    "fileBlocks": {
      "collapse": true,
      "pathStyle": "relative",
      "foldGitWorktree": true
    },
    "bashBlocks": {
      "collapse": true,
      "smart": true,
      "showStatus": true
    }
  }
}
```

## 工作原理

- 在 `session_start` 事件中检测 `ctx.mode === "tui"`,**仅当 pi 运行于 TUI 模式时**才注册渲染钩子与命令(print / json / rpc 模式零注册,互不影响)。
- 通过 `pi.registerTool()` 以 `renderShell: "self"` 覆盖内置 `read` / `bash` / `edit` / `write` 的 `renderCall` / `renderResult`,`execute` 保持原样委托。
- 折叠内容全部由 `renderResult` 单次渲染(`renderCall` 返回空 `Text`),保证布局一致。
- 模式切换通过跨块重渲染(`invalidate`)实时生效,无需重启。

## 开发

```bash
pnpm install                 # 安装依赖(弱依赖来自宿主 pi,devDeps 供本地构建)
pnpm --filter @philogag/pi-tui-fold-blocks test        # 24 个测试
pnpm --filter @philogag/pi-tui-fold-blocks typecheck
pnpm --filter @philogag/pi-tui-fold-blocks build       # 产出 dist/
```

### 依赖说明

运行时依赖(`@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` / `typebox`)声明为 **peerDependencies(弱依赖)**:宿主 pi 环境已内置这些包,插件不重复打包;`devDependencies` 中保留同名依赖供本地 typecheck / test。

## 已知限制

- `native` 模式下渲染委托给内置渲染(不叠加状态色框)——保留原生外观,换取模式切换的即时性。
- 仅覆盖 `read` / `bash` / `edit` / `write` 四个高频工具;`grep` / `find` / `ls` 等保持原生渲染。
