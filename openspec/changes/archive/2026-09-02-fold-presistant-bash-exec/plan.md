---
change: fold-presistant-bash-exec
design-doc: openspec/changes/fold-presistant-bash-exec/design.md
base-ref: dc31ea8bd40c15cb83cf2fe3deb54a3948faf6f0
---

# Plan:fold-blocks 兼容 presistant-bash-exec 块

工作区:本 change 的 git worktree(分支 `feat/fold-presistant-bash-exec`),monorepo 根。
两包:packages/pi-tui-fold-blocks、packages/pi-tool-presistant-bash。
命令前缀:`F=pnpm --filter @philogag/pi-tui-fold-blocks`、`B=pnpm --filter @philogag/pi-tool-presistant-bash`。
依赖顺序:fold-blocks 先实现并 `build`(presistant-bash 的 tsc 需要它的 dist .d.ts)。

TDD 纪律:每步先写失败断言(红)→ 实现(绿)→ 视需要重构;commit 后进入下一步。

## Task 1:fold-blocks 对外兼容导出面

### Step 1.1 compat.ts 激活单例(RED→GREEN)
- [ ] 1.1.1 RED:写 `packages/pi-tui-fold-blocks/test/compat.test.ts`:
  - `isFoldBlocksActive()` 初始 false;
  - `subscribeFoldBlocksActive(cb)`:未激活时注册不回调,`markFoldBlocksActive()` 后收到且仅一次;
  - 激活后再订阅 → cb 立即同步调用,返回的 unsub 生效(再 mark 不重复回调)。
- [ ] 1.1.2 GREEN:新建 `packages/pi-tui-fold-blocks/src/compat.ts`:
  `let active=false; const waiters=new Set<()=>void>();`
  `markFoldBlocksActive()`(幂等:置 true 并清空 waiters)、`isFoldBlocksActive()`、
  `subscribeFoldBlocksActive(cb)`(active? 同步 cb 返回 no-op : 注册返回 unsub)。
  类型导出自本模块统一管理。
- [ ] 1.1.3 跑 `F test -- test/compat.test.ts`,绿。

### Step 1.2 compat.ts 配置单例(RED→GREEN)
- [ ] 1.2.1 RED:compat.test.ts 追加:
  - `getFoldConfig()` 初始 = DEFAULT_CONFIG 深拷贝(引用不等);
  - `publishConfig(next)` 后 `getFoldConfig()` 返回 next;
  - `subscribeFoldConfig(cb)`:publish 时收到通知;unsub 后不再收到。
- [ ] 1.2.2 GREEN:compat.ts 加 `let current=FoldConfig=DEFAULT_COPY; getFoldConfig(); publishConfig(next){current=next; listeners…}`。
- [ ] 1.2.3 跑 `F test -- test/compat.test.ts`,绿。

### Step 1.3 renderOwnedBlock 泛化(RED→GREEN,行为不变)
- [ ] 1.3.1 RED:`test/render.test.ts` 追加对 `renderOwnedBlock` 的断言(直接调它,传 bash 的 lineBuilder):
  - call 阶段且 `isPartial:true` → 产出 1 行(bg 黄)且 result 槽空;`isPartial:false` 时 result 槽产出 1 行、call 槽空(单帧归属语义与现有 renderBlock 相同,可对照现有 renderBlock 同参输出 stripAnsi 后相等);
  - mode=hide → 0 行;
  - 未知/空 lineBuilder 输出 → 0 行。
- [ ] 1.3.2 GREEN:`render.ts` 抽出
  `export function renderOwnedBlock(ctx, opts, lineBuilder:(ctx,opts)=>LineContext): Component`
  内容 = 原 renderBlock 的 hide 检查 + ownsLine 判定 + `buildBlockComponent(lineBuilder(...), bgFor(ctx,opts))`;
  `renderBlock` 改为 `switch(name)→lineBuilder` 委托 renderOwnedBlock(现有 export 与行为全保留)。
- [ ] 1.3.3 跑 `F test`,绿;确认既有 render.test/settings/index 测试全绿(行为未变)。

### Step 1.4 index.ts 接线 + 命名导出
- [ ] 1.4.1 `src/index.ts`:默认导出工厂首行调 `markFoldBlocksActive()`;把 config 变更点
  (openSettings 回调内 `config = next` 处、modeState onModeChange/setMode 保存路径)统一为
  赋值后调 `publishConfig(config)`(与现有 `saveConfig` 调用并列,顺序:先存盘后通知)。
- [ ] 1.4.2 index.ts 文件尾追加命名导出:`isFoldBlocksActive、subscribeFoldBlocksActive、
  getFoldConfig、subscribeFoldConfig、renderOwnedBlock、buildBlockComponent、contentLineCount、
  foldCommand(及 FoldOptions)、LineContext、FoldBlocksConfig、ToolRenderContext` 类型与函数
  (逐一 from ./compat.js|./render.js|./config.js|./folders/command.js|./overrides.js re-export)。
- [ ] 1.4.3 RED/GREEN:index.test.ts 补「导入默认导出时导出面存在且默认工厂激活标记生效」
  (模拟 pi 对象走 factory → isFoldBlocksActive() true)。跑 `F test`。
- [ ] 1.4.4 `F build && F typecheck`,绿。

### Step 1.5 README
- [ ] 1.5.1 `packages/pi-tui-fold-blocks/README.md` 增「面向其他扩展的库面」小节:激活/配置
  订阅、renderOwnedBlock 语义、稳定性声明(默认导出与内置折叠行为不变)。

### Commit(1)
- [ ] `git add packages/pi-tui-fold-blocks && git commit -m "feat(tui-fold-blocks): export fold render kit + active/config singleton for extension reuse"`

## Task 2:presistant-bash 可选折叠装配

### Step 2.1 依赖声明
- [ ] 2.1.1 `packages/pi-tool-presistant-bash/package.json`:dependencies 不动;
  `optionalDependencies: {"@philogag/pi-tui-fold-blocks": "workspace:*"}`,
  `devDependencies` 同加 `workspace:*`(dev 类型可见、与 optional 解耦)。
- [ ] 2.1.2 根目录 `pnpm install`;确认
  `packages/pi-tool-presistant-bash/node_modules/@philogag/pi-tui-fold-blocks` link 存在
  (fold-blocks 已 build,dist 在场)。`git add pnpm-lock.yaml …/package.json`。

### Step 2.2 fold-compat.ts 纯函数(RED→GREEN)
- [ ] 2.2.1 新建 `test/fold-compat.test.ts`(vi.mock fold-blocks 包? 否——纯函数不需要):
  - `formatTimeoutMs(undefined)→""`;`15000→"15s"`;`7500→"7.5s"`;
  - `execOutputLineCount("a\nb")→2`;`""→0`;`"a\n\nb\n"→3`(结尾换行不计,空行计入,与 contentLineCount 同约);
  - `execStatus(details)`:`exitCode:0→{error:false,code:undefined}`、
    `exitCode:7→{error:true,code:7}`、`cancelled:true→{error:true,code:undefined}`、
    `exitCode:undefined,cancelled:false→{error:true,code:undefined}`;
  - `buildExecLine(ctx,{stage:"result",result:{content,details:{output:"x",exitCode:7,cancelled:false}},config})`
    → `tips` 含 `exit 7`、result 段 `FAILED(7)`;cancelled → result `FAILED`;
    成功零输出 → tips 为空(0 lines 不显示)、SUCCESS;timeoutMs 存在 → tips 前缀 `15s`;
    lineBuilder 产出的 icon/tool 与 nerdFont 开/关对应(fold-blocks LineContext 契约)。
- [ ] 2.2.2 GREEN:新建 `packages/pi-tool-presistant-bash/src/fold-compat.ts`:
  `formatTimeoutMs`、`execOutputLineCount`、`execStatus(details:ExecResult)`、
  `buildExecFoldLine(ctx, opts)`(返回 LineContext;内部复用 fold-blocks 的 `foldCommand`)
  纯函数区。type-only import fold-blocks。
- [ ] 2.2.3 `B test -- test/fold-compat.test.ts`,绿。

### Step 2.3 三态渲染分派(RED→GREEN)
- [ ] 2.3.1 RED:fold-compat.test.ts 追加(注:折叠/原生/hide 三个 renderer 由 2.4 装配函数构造,
  此步先测 `buildExecFoldRenderers({config:()=>…})` 返回的 renderCall/renderResult 本身,用
  fold-blocks 真实组件渲染后 stripAnsi 断言,theme 用真实 pi-tui theme? 简化:传入测试 theme
  stub `{fg:()=>s=>s, bg:()=>s=>s}`):
  - fold + result(isPartial:false) → 恰 1 行可见,含 `exec - ` + foldCommand 摘要,右段含 SUCCESS;
    失败(exit 3)同参 → 红? 组件不编码颜色断言,仅断言文本含 `FAILED(3)`(颜色走 theme,由
    dogfood 验证);
  - hide → render(width) 返回 [] 或空文本 0 行;
  - native → result 内容前 10 行预览含首行输出;11 行以上含 `... (` 与剩余计数;expanded:true
    时全量;call 槽 native → 含工具名标题文本。
- [ ] 2.3.2 GREEN:fold-compat.ts 加 `buildExecFoldRenderers(access:{getConfig,subscribeConfig})`
  返回 `{renderShell:"self", renderCall, renderResult}`:
  - fold:renderOwnedBlock + buildExecFoldLine;hide:空 Text;native:小实现复刻 pi 默认观感
    (bg 由 BgPaddedBox 类私有——用 fold-blocks 导出的 `buildBlockComponent`? 不适用。
    在 presistant-bash 侧以 Text + theme.fg/bg 拼接原生态,复用 fold-blocks 导出的
    `contentLineCount` 不需要;预览行按内容文本,颜色 theme.fg("toolOutput"/"toolTitle"/"muted"));
  - 结果阶段读 `result.details`(ExecResult)得 exitCode/cancelled/output;details 缺失回退
    content 文本解析 `exit code[: ]?(\d+)`(兼容 presistant 自带格式)。
- [ ] 2.3.3 `B test -- test/fold-compat.test.ts`,绿。

### Step 2.4 装配 attachExecFoldCompat(RED→GREEN)
- [ ] 2.4.1 RED:fold-compat.test.ts 追加注入 fake compat 装配测试:
  - loader 返回 null(import 失败)→ 不调 registerTool、不抛错;
  - loader 返回包对象且包 `isFoldBlocksActive()=false` → 暂不注册;随后 fake 触发激活
    (模拟 subscribeFoldBlocksActive 立即同步)→ 对 exec 定义二次 registerTool,execute
    与原定义同一引用,渲染字段为 self+函数;
  - config 变更订阅回调 → 登记的 invalidator 被调用(用注入的 fake access)。
- [ ] 2.4.2 GREEN:fold-compat.ts 加
  `export async function attachExecFoldCompat(pi, execTool, deps:{loadCompat?:()=>Promise<…>, subscribeFoldConfig, registerInvalidator…})`
  (动态 `import("@philogag/pi-tui-fold-blocks")` try/catch 返回 null;激活订阅一次性装配;
  渲染回调里按 toolCallId 登记 invalidate 到 Map,config 订阅时遍历 invalidate)。
- [ ] 2.4.3 `B test -- test/fold-compat.test.ts`,绿。

### Step 2.5 index.ts 接线
- [ ] 2.5.1 `src/index.ts`:`createTools` 不变;factory 里收集 exec 定义;options 增加
  `attachExecFoldCompat?` 注入(默认走 fold-compat 实现);注册完工具后调用
  `void attach(pi, execDef)`(异步,不阻塞 factory)。
- [ ] 2.5.2 index.test.ts 补:不注入时默认路径不抛错(loader 不可用? 单测环境 node_modules
  内 fold-blocks 已 link → 会真装配 → 断言 exec 定义被二次注册仍含 execute 且可执行——
  用 registry 注入的现有 pattern 验证 execute 行为不变即可,渲染字段存在性不破坏行为)。

### Step 2.6 验证与 README
- [ ] 2.6.1 `B typecheck && B test && B build`,全绿。
- [ ] 2.6.2 README(packages/pi-tool-presistant-bash/README.md)增兼容矩阵小节(见表):
  单独装 fold-blocks / 单独装 presistant-bash / 同装激活 / 同装未激活 四行行为。

### Commit(2)
- [ ] `git add packages/pi-tool-presistant-bash pnpm-lock.yaml && git commit -m "feat(tool-presistant-bash): fold exec block via optional pi-tui-fold-blocks compat"`

## Task 3:验证与发布准备

- [ ] 3.1 两包 `pnpm -r typecheck && pnpm -r test && pnpm -r build` 全绿;`openspec validate --all` 通过。
- [ ] 3.2 `[~]` 延迟项(手工):.pi/settings.json 临时同列两包路径启动 pi TUI → exec 块折叠、
  非零退出码红色 FAILED(N)、/tui-fold-blocks 三态即时切换、移除 fold-blocks 后回退原生。
  等价自动化覆盖映射:文本/装配断言见 test/fold-compat.test.ts(2.2–2.4)与
  fold-blocks test/compat.test.ts(1.1–1.4);行形态组件级断言见 2.3。

### Commit(3)
- [ ] `git add -A && git commit -m "chore: verification pass for fold-presistant-bash-exec"`(若 3.2 产出代码/配置改动则并入本 commit 并说明)
