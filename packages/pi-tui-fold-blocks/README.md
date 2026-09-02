# @philogag/pi-tui-fold-blocks

pi TUI 插件:折叠 / 隐藏工具调用块,让对话更清爽。**只改渲染,不改 session**——所有内容仍完整保留在会话里。

## 安装

```bash
pi install npm:@philogag/pi-tui-fold-blocks
```

- 安装后扩展自动启用,无需额外配置;用 `pi config` 可启用 / 禁用。
- 项目级安装加 `-l`(`pi install -l npm:@philogag/pi-tui-fold-blocks`,写入 `.pi/settings.json`,可随仓库共享)。
- 卸载:`pi remove npm:@philogag/pi-tui-fold-blocks`。
- 快速体验:`pi -e npm:@philogag/pi-tui-fold-blocks`(仅本次运行,不写入配置)。

改动扩展后执行 `/reload` 热重载,无需重启 pi。

## 特性

- **三态模式**:`native`(原生)/ `fold`(折叠成一行)/ `hide`(完全不渲染)
- **单行左右对齐**:左侧概要 + 右侧统计,不占纵向空间
- **状态背景色**:
  - 文件操作块(read / edit / write):恒绿
  - bash 块:运行中(黄)/ 失败(红)/ 成功(绿),颜色随状态实时变化
- **智能 bash 摘要**:自动剥离 `cd ... &&` / `source ... &&` 前缀,提取关键命令
- **路径样式可选**:`relative` / `absolute` / `basename`;git worktree 路径自动折叠
- **nerd font 图标**:默认开启,可关闭(兼容无 nerd font 字体的终端)
- **非侵入**:`execute` 原样委托给内置工具,不改变任何行为

## 使用

### Settings 页面

运行 `/tui-fold-blocks` 打开设置页。页面遵循 pi 原生 settings 交互:

- 单选列表列出全部选项(Mode、Nerd font icons、Path style、Fold git worktree、Bash smart detection、Show status hints)。
- `↑`/`↓` 导航,`Space` 循环切换当前选项的值(布尔在 `on`/`off` 间切换,枚举循环其取值)。
- 改动立即写入 `settings.json`。
- `Esc` 关闭页面。

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

## 面向其他扩展的库面

本包在保持默认导出(扩展工厂)与内置折叠行为不变的前提下,提供一组命名导出,供其他扩展(如 `pi-tool-presistant-bash`)复用折叠渲染能力。API 不依赖任何具体工具名或对方扩展的类型。

### 激活状态(门控)

默认导出工厂执行时即标记本扩展已激活(幂等)。其他扩展可在任意加载顺序下安全订阅:

```ts
import { isFoldBlocksActive, subscribeFoldBlocksActive } from "@philogag/pi-tui-fold-blocks";

if (isFoldBlocksActive()) {
  attach(); // 已激活:立即装配
} else {
  const unsub = subscribeFoldBlocksActive(() => {
    attach(); // 激活回调(仅一次)
    unsub();
  });
}
```

### 当前配置(实时读取 + 变更订阅)

```ts
import { getFoldConfig, subscribeFoldConfig } from "@philogag/pi-tui-fold-blocks";

// 读取当前生效配置(未激活/未变更时为 DEFAULT_CONFIG 的独立拷贝)
getFoldConfig();

// 订阅配置变更(设置页保存 / 命令循环 / setMode 路径统一经 publishConfig 通知,先持久化后通知)
const unsub = subscribeFoldConfig((next) => rerenderAll(next));
```

### 折叠渲染核心

```ts
import { renderOwnedBlock } from "@philogag/pi-tui-fold-blocks";

renderOwnedBlock(ctx, { name, stage, args, result, cwd, config, theme }, (ctx, opts) => ({
  icon: "", tool: "exec", shown: "npm test", tips: "[ 2 lines ]", result: "SUCCESS",
}));
```

`renderOwnedBlock(ctx, opts, lineBuilder)` 语义与内置 `renderBlock` 一致:hide 模式返回 0 行空 `Text`;单帧归属(call 槽在 `ctx.isPartial` 时拥有该行,result 槽在 `!ctx.isPartial` 时拥有,另一槽退让为 0 行);`lineBuilder` 产出空文本 → 0 行。行内布局(截断策略/三态背景)由 `buildBlockComponent` / `bgFor` 保证,与内置工具块同形。

### 稳定性声明

- **默认导出不变**:仍为扩展工厂,内置 `read` / `bash` / `edit` / `write` 折叠行为与新增导出前完全一致。
- **无反向依赖**:本包不引用任何其他扩展的类型或工具名。
- 以上导出在包版本间保持向后兼容;如需新增能力,以追加导出方式演进。

## 开发

```bash
pnpm install                 # 安装依赖(弱依赖来自宿主 pi,devDeps 供本地构建)
pnpm --filter @philogag/pi-tui-fold-blocks test        # 测试
pnpm --filter @philogag/pi-tui-fold-blocks typecheck
pnpm --filter @philogag/pi-tui-fold-blocks build       # 产出 dist/
```

### 依赖说明

运行时依赖(`@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` / `typebox`)声明为 **peerDependencies(弱依赖)**:宿主 pi 环境已内置这些包,插件不重复打包;`devDependencies` 中保留同名依赖供本地 typecheck / test。

## 已知限制

- `native` 模式下渲染委托给内置渲染(不叠加状态色框)——保留原生外观,换取模式切换的即时性。
- 仅覆盖 `read` / `bash` / `edit` / `write` 四个高频工具;`grep` / `find` / `ls` 等保持原生渲染。
