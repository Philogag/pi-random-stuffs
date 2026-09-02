## Why

`pi-tui-fold-blocks` 目前只折叠内置 read/bash/write/edit 块;`pi-tool-presistant-bash`
的 `presistant-bash-exec` 在 TUI 里仍是大段原始输出(默认渲染仅截前 10 行,与本地
bash 的折叠行体验割裂)。用户同时安装两扩展时,持久会话命令与本地命令的呈现不一致,
且 exec 输出很长时占据整个屏幕。pi 的扩展机制不允许第三方扩展"只覆盖另一扩展的
渲染"——必须由工具归属方(presistant-bash)在注册时挂折叠渲染,或两包共享代码。
本轮让 presistant-bash 可选依赖 fold-blocks 的折叠渲染 API,把 exec 块渲染成与
本地 bash 完全同形的单行折叠块,安装/不安装 fold-blocks 都保持行为一致。

## What Changes

**presistant-bash-exec 的 TUI 块折叠(核心变更)**
- From: `presistant-bash-exec` 无论 fold-blocks 是否安装都走 pi 默认渲染(工具名标题
  + 前 10 行预览),无折叠能力。
- To: 安装 fold-blocks 时,exec 块按 fold-blocks 全局模式渲染——fold → 与本地
  bash 完全同形的单行块(icon + "exec" + foldCommand 折叠命令;tips
  `[ timeout, N lines, exit M ]`;SUCCESS/FAILED[(M)];三态背景);hide → 整块隐藏;
  native → 复刻 pi 默认渲染。未安装 fold-blocks 时行为不变(探测失败静默回退)。
- Reason: SDK 无法跨扩展做渲染-only 覆盖,折叠逻辑必须以工具归属方注册。
- Impact: non-breaking。两扩展独立使用时的现有行为不变;同装时仅 TUI 显示变化,
  会话内容/LLM 上下文/执行语义零变化。

**fold-blocks 从"纯扩展"变为"扩展 + 可复用折叠渲染库"**
- From: 默认导出仅有扩展工厂,折叠渲染核心模块内部私有。
- To: 额外导出兼容 API:活配置读取与变更订阅(getFoldConfig/subscribeFoldConfig)、
  单行块渲染核心复用入口、exec 折叠渲染器装配函数(返回 renderShell/renderCall/
  renderResult),供 presistant-bash 探测使用。默认导出与既有命令/设置行为不变。
- Reason: 让归属方无需复制渲染实现即可获得像素级一致的折叠行。
- Impact: non-breaking;fold-blocks 单独安装(无 presistant-bash)行为不变。

## Capabilities

### New Capabilities
(无——不新建能力。presistant-bash 自身执行/会话语义零变化,折叠契约是
fold-blocks 折叠能力的扩展,归入既有能力 `tui-tool-block-collapse`。)

### Modified Capabilities
- `tui-tool-block-collapse`: 新增 ADDED requirements——(1) fold-blocks 向外部工具
  归属方提供折叠渲染兼容 API(活配置/订阅/渲染装配);(2) 安装 fold-blocks 时
  presistant-bash-exec 的 TUI 块按全局模式折叠/隐藏/原生,外观与本地 bash 块同形;
  (3) 未安装/探测失败时 presistant-bash 行为与渲染保持不变(回退契约)。

## Impact

- 代码:`packages/pi-tui-fold-blocks`(新增导出面 `src/compat.ts` 或同构模块 +
  index.ts 接线;config/render/mode 小改);`packages/pi-tool-presistant-bash`
  (exec 工具注册处加可选探测与渲染器装配;新增对 fold-blocks 的 optionalDependency
  声明)。
- 依赖:presistant-bash `optionalDependencies` 增
  `@philogag/pi-tui-fold-blocks`;fold-blocks 依赖不变(仍只需
  pi-coding-agent/pi-tui/typebox,不反向依赖 presistant-bash)。
- 加载:同装时两扩展在各自既有注册路径工作;探测通过动态 import/require.resolve,
  失败不抛错、不影响扩展加载。
- 不改动:会话(session/container 执行语义)、LLM 上下文、存储历史、print/rpc
  非 TUI 渲染路径、fold-blocks 对内置 4 工具的行为、presistant-bash 其余 4 工具。
- 文档:两包 README 增补兼容说明(依赖关系与行为矩阵)。
- 测试:两包 vitest 单测(渲染文本/解析/装配纯函数)+ 类型检查;折叠行的像素级
  TUI 冒烟为手工验证(plan 中 `[~]` 延迟项)。
