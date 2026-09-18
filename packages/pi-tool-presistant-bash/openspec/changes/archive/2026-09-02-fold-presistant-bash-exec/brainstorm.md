<!--
superpowers:brainstorming 产出的原始捕获(决策日志)。
-->

# brainstorm 原始捕获:fold-blocks 兼容 presistant-bash-exec 块

变更名:`fold-presistant-bash-exec`

## 背景

`@philogag/pi-tui-fold-blocks`(折叠 read/bash/write/edit 内置工具块,TUI 单行化)
不能折叠 `@philogag/pi-tool-presistant-bash` 的 `presistant-bash-exec` 工具输出块。
诉求:**让 fold-blocks 的折叠行为覆盖 presistant-bash 的 exec 工具**,与本地 bash
块的折叠体验一致。

## 探索发现(SDK 机制约束,已验证于 @earendil-works/pi-coding-agent 0.84.3 运行时源码)

1. **跨扩展无法"只覆盖渲染"**。pi 的扩展 API 中:
   - 同名工具跨扩展以「先注册者胜」(`getAllRegisteredTools()` 按扩展序 first-match);
   - `getAllTools()` 只暴露 name/description/parameters/promptGuidelines,拿不到别的
     扩展工具定义里的 `execute` 闭包;
   - 渲染回退 `toolDefinition.renderCall ?? builtIn.renderCall` 只查内置工具表。
   因此 fold-blocks 无法单方面把另一个扩展的工具挂上自己的渲染——必须由**工具归属方
   (presistant-bash)在自己注册的定义上挂渲染**,或两包共享渲染代码。
2. **自定义工具默认渲染**(presistant-bash-exec 今天无 renderCall/renderResult 时的
   TUI 呈现,见 tool-execution.js):调用槽 = `Text(theme.fg("toolTitle", bold(name)))`;
   结果槽 = 内容文本截前 10 行 + `... (N more lines, <expand hint>)`,外包
   toolPendingBg/toolErrorBg/toolSuccessBg 三态 Box。渲染钩子随工具定义静态注册,
   无法按 config 动态装卸。
3. **fold-blocks 内部现状**(v0.1.1):
   - `overrides.ts` 对 4 个内置工具 `registerTool({...original, renderShell:"self",
     execute: original.execute, renderCall, renderResult})`;renderCall/Result 在
     mode=native 时委托 `original.renderCall/renderResult`,否则走 `renderBlock`;
   - `render.ts::renderBlock` 按 tool name 构造单行;mode=hide → 返回 0 行空 Text
     (整块消失);用 `isPartial` 决定 call/result 槽谁拥有该行(单帧内无 flicker);
     bash 行 label 恰为 **"exec"**(icon \uf489),tips `[ timeout, N lines, exit M ]`,
     result 段 SUCCESS/FAILED[(M)];
   - `mode.ts` 维护自己注册行的 `Map<toolCallId, invalidate>` 做模式切换即时重渲染。
4. **结果文本格式差异**:fold-blocks 的 `contentExitCode` 正则 `/exit code (\d+)/i`
   匹配 pi 内置 bash 的退出码文本;而 presistant-bash-exec 的 doneText 是
   `\n[exit code: N]`(冒号),cancelled 时 `\n(command cancelled)` —— 现正则不命中,
   exec 折叠行需要兼容两种格式(或给出针对性的提取)。

## 决策链(Q1–Q5,均经用户确认)

### Q1 折叠渲染归属的架构方向
备选:
- **A. presistant-bash 可选依赖 fold-blocks(选中)**:fold-blocks 导出折叠渲染 API;
  presistant-bash 注册 exec 工具时**动态探测** fold-blocks 是否可用:可用 → 挂
  fold-blocks 提供的折叠渲染(execute 仍是自己的闭包,与安装顺序无关、无同名冲突);
  不可用 → 保持默认渲染(现状)。
- B. 抽取共享渲染核心包(如 `@philogag/pi-fold-render`):分层最干净,但要新增第 4 个
  包、迁移 fold-blocks 现有 render/config/folders 模块,版本与发布面大,爆炸半径大。
- C. fold-blocks 侧尝试注册 presistant-bash-exec 同名覆盖:被「execute 闭包在对方包内」
  与「先注册者胜」双重否决,不可行。

取舍:选 A——改动集中在两个既有包,无新发布单元;fold-blocks 仍可独立使用;
presistant-bash 独立安装(无 fold-blocks)时行为不变。代价:fold-blocks 变成
"扩展 + 库"双身份包,需要导出稳定 API;presistant-bash 侧多一个可选依赖探测路径。

### Q2 折叠覆盖哪些 presistant-bash 工具
仅 `presistant-bash-exec`(create/create-container/list/destroy 输出本就 1–2 行,
保持默认渲染,不加折叠)。

### Q3 exec 折叠行内容
与本地 bash 折叠行**完全对齐**:左侧 icon + "exec" + 折叠后命令(foldCommand,
smart 规则同 bash);右侧 tips `[ timeout?, N lines, exit M? ]`;result 段
SUCCESS/FAILED[(M)];背景色 call→pending 黄 / isError→错误红 / 成功→绿。
不带 session 信息。

### Q4 流程
完整 OpenSpec 变更(brainstorm → proposal → design → specs → tasks → plan →
apply(TDD) → verify → retrospective → archive)。

### Q5 行标签是否区分 bash 与 exec
用户选:**与 bash 完全一致**(label 同为 "exec",图标、配色、结构全同)。
即 presistant-bash-exec 的折叠行外观 == 内置 bash 的折叠行外观;两行同形是接受的
取舍(二者本就出现在不同上下文位置)。

## 收敛出的设计要点(待 design.md 结构化)

1. **fold-blocks 导出(库面,新增 `src/compat.ts` 或类似,index 默认导出不变)**:
   - 折叠渲染核心的复用入口:bash 行文本构建(含 foldCommand、timeout/lines/exit
     tips、`exit code` 兼容冒号格式的提取)与 `renderBlock`/`buildBlockComponent`
     单行组件构建;
   - **活配置**:module 级当前 config 读取 `getFoldConfig()` + 变更订阅
     `subscribeFoldConfig(listener): unsubscribe`(index.ts 每次 saveConfig/setMode
     后更新并通知)——presistant-bash 据此在模式切换时 invalidate 自己已渲染的 exec 行,
     实现与 fold-blocks 自家工具一致的即时生效;
   - 探测入口:`hasFoldBlocksApi()`/包存在性检查 + `buildExecFoldRenderers(opts)`(或
     等价命名),返回 `{ renderShell, renderCall, renderResult }` 供 presistant-bash
     registerTool 时合并。
2. **presistant-bash 侧**:注册 `presistant-bash-exec` 时保持默认定义;随后异步
   探测/加载 fold-blocks compat(失败静默回退 → 现状);加载成功则用折叠渲染器
   **再次 registerTool 同一工具**(覆盖定义,execute 不变;探测与首帧渲染间隔极小,
   正常在首个 exec 调用前完成);渲染器内部按活配置分派三态:
   - `fold` → bash 同构单行块;
   - `native` → 复刻 pi 默认渲染(工具名标题 + 前 10 行预览;expand 快捷键提示文本
     为非像素级复刻,记录为已知偏差);
   - `hide` → 0 行空组件(整块消失,同 bash hide)。
   exec 专属解析:退出码兼容 `\n[exit code: N]`(cancelled → FAILED,无码);timeoutMs
   (毫秒)换算为秒级 tips 或对齐 bash 语义(见 tasks/spec 固化)。
3. **依赖形态**:fold-blocks 列入 presistant-bash `optionalDependencies`
   (workspace 内 dev 可用;独立安装时缺失 → 探测失败 → 静默回退)。
4. **回归红线**:fold-blocks 未安装/探测失败时,presistant-bash 一切行为与渲染不变;
   fold-blocks 已装的 bash/read/write/edit 行为不变;print/rpc 非 TUI 模式不受影响
   (渲染函数不被调用)。

## 开放项 / 风险(进 design.md 的 Risks / Open Questions)

- native 模式默认渲染复刻的非像素级偏差(expand 提示文本)→ 接受并记录。
- exec 行与 bash 行同形 → 已确认接受。
- timeoutMs 单位换算(ms → s 显示)与 bash `timeout` 语义对齐方式 → design 定稿。
- 探测窗口(加载 fold-blocks 之前若有 exec 渲染)内的默认渲染闪现 → 视为可接受,
  仍可加首帧前同步预载(require.resolve)消除。
