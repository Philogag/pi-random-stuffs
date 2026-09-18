## 1. 包骨架与扩展入口

- [x] 1.1 新建 `packages/pi-tui-fold-blocks/`（`@philogag/pi-tui-fold-blocks`），配置 package.json（type module、devDep typescript、peerDep @earendil-works/pi-tui）与 tsconfig（import 自 tsconfig.base.json）
- [x] 1.2 新增 `tsconfig.json`，把包加入仓库根 `tsconfig.json` 的 references
- [x] 1.3 新增扩展入口 `src/index.ts`：`export default function(pi: ExtensionAPI): void`，从 `settings.json` 载入 `<包名>` 块并用默认值回退
- [x] 1.4 注册 `/fold-blocks` 命令（循环切换 原生/折叠/隐藏 三态 + 打开设置子页面）

## 2. 配置模块

- [x] 2.1 实现 `src/config.ts` 配置读写：定义完整配置 schema（模式 / nerd font / 文件块折叠行为 / 路径样式 / git worktree 折叠 / bash 折叠行为 / smart / 状态提示）
- [x] 2.2 实现 settings.json 的读写 + 校验：缺失/损坏时回退默认值且不阻塞渲染（对应 spec「settings.json 缺失回退」）
- [x] 2.3 用 pi 内置 TUI 组件（select/confirm/input 等）实现设置子页面，改动写回 settings.json（对应 spec「命令进入设置」）

## 3. 折叠器纯函数

- [x] 3.1 实现 `src/folders/path.ts` 的 `foldPath`：按 路径样式(absolute/relative/basename，默认 relative) 折叠路径，支持 git worktree 前缀折叠（默认开）（对应 spec foldPath 场景）
- [x] 3.2 实现 `src/folders/command.ts` 的 `foldCommand`：取首 token，剥离 `cd X &&`/`source … &&`/`export … &&` 包装前缀；受 `smart` 开关控制（对应 spec foldCommand 场景）
- [x] 3.3 为 `foldPath` 与 `foldCommand` 补充单测（vitest），覆盖 路径样式/git worktree/包装剥离/smart 关闭 分支

## 4. 工具块自绘渲染

- [x] 4.1 实现 三态逻辑：native（完全放手，不干预）/ fold（单行）/ hide（不渲染任何工具块，session 内容不变）（对应 spec「工作模式」场景）
- [x] 4.2 用 `create*ToolDefinition(*)(cwd)` 重建 read/bash/edit/write 定义，`pi.registerTool` 同名覆盖；`execute` 原样委托原始定义（对应 spec「覆盖工具与执行委托」/「执行行为不变」）
- [x] 4.3 实现 `renderCall`/`renderResult`：折叠态单行左右对齐（左概要 + 右统计），窄终端裁剪；统一 `renderShell:"self"` + `setCustomBgFn` 自绘背景（对应 spec「折叠块单行左右对齐布局」/「窄终端裁切」）

## 5. 背景色与图标

- [x] 5.1 背景色策略：文件块( read/write/edit )始终成功绿；bash 块跟随状态（运行黄 / 成功绿 / 失败红）（对应 spec「状态背景色」场景）
- [x] 5.2 折叠行背景色接入：`setCustomBgFn` 自绘（文件块恒绿；bash 按 isPartial/isError 黄/红/绿），跨渲染块保持状态关联
- [x] 5.3 nerd font 图标（默认开）：按 read/write/edit/bash 工具类型显示符号，关闭时用纯文本工具名标签（对应 spec「nerd font 图标」场景）

## 6. 跨块重渲染与集成

- [x] 6.1 实现 `Map<toolCallId, invalidate>` 收集渲染块的 `context.invalidate`，模式切换时 `rerenderAll()` 强制所有块重绘
- [x] 6.2 委托渲染策略落地：`renderCall` 返回空 Text(0 行)，`renderResult` 统一本地渲染单行概要+统计，复用 `context.lastComponent as Text`，避免 `lastComponent` 类型不匹配
- [x] 6.3 `pi -e` 冒烟验证：/fold-blocks 循环三态、单行布局、背景色、图标、settings.json 读写、默认值回退

## 7. 验证与发布准备

- [x] 7.1 在 packages 内执行 typecheck / lint / test（vitest），全绿
- [x] 7.2 冒烟验收对照 design 验收条件：三态循环、单行左右对齐、文件块常绿、bash 状态背景、settings.json 读写回退
- [x] 7.3 确认非侵入：未加载扩展时行为不变；会话/LLM/存储历史内容原样保留