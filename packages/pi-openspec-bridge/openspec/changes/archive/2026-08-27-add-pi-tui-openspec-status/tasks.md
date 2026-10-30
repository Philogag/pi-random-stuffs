## 1. 包骨架与 monorepo 接入

- [x] 1.1 创建 `packages/pi-tui-openspec-status/` 目录与子目录 `src/`
- [x] 1.2 编写 `packages/pi-tui-openspec-status/package.json`：name=`@philogag/pi-tui-openspec-status`，main=`dist/index.js`，types=`dist/index.d.ts`；peerDependencies 锁定 `@earendil-works/pi-coding-agent >= 0.40.0`；devDependencies 包含 `typescript`、`@types/node`；scripts 含 `build`/`watch`
- [x] 1.3 编写 `packages/pi-tui-openspec-status/tsconfig.json`：target=ES2022，module=NodeNext，moduleResolution=NodeNext，outDir=`dist`，include=`src/**/*`，strict=true
- [x] 1.4 验证 pnpm workspace 链接：`pnpm -F @philogag/pi-tui-openspec-status build` 至少输出 `dist/`（占位 index.ts 即可）

## 2. 命令解析单元 (`parser.ts`)

- [x] 2.1 实现 shell tokenize 函数，支持 `&&` `;` `||` `|` 四种连接符分句
- [x] 2.2 实现 `parseBashCommand(cmd: string): { subcommand, changeName?, effectiveCwd }`：
  - 命中 `openspec` 子命令时返回 subcommand；非 openspec 命令返回 null
  - 从子命令后续 token 中优先匹配 `--change <name>`，否则取第一个非 flag 位置参数
  - 解析 `cd <path> &&` 重写链（取最后一个 cd 目标），作为 effective cwd 候选
- [x] 2.3 实现 `isLockingSubcommand(sub: string): boolean`：命中预定义集合
- [x] 2.4 实现 worktree 探测：`/\.worktrees\/([^/\s]+)/` 匹配 effective cwd 路径

## 3. openspec CLI 封装 (`openspec.ts`)

- [x] 3.1 实现 `runOpenspecStatus(changeName: string, cwd: string): Promise<StatusJson | null>`：spawn `openspec status --change <name> --json`，2 秒 timeout，失败返回 null
- [x] 3.2 实现 `StatusJson` 类型：artifact `id`/`status` 列表 + `applied` / `tasks` 字段（按 openspec CLI 实际返回结构）
- [x] 3.3 处理 stdout 非 JSON / stderr / 非零退出码：均返回 null 而不抛错

## 4. tasks.md 合并单元 (`merge.ts`)

- [x] 4.1 实现 `parseTasksFile(path: string): Map<string, boolean>`：解析 `1.` `2.` `1.1` 等 task ID → checked
- [x] 4.2 实现 `mergeTasks(main: Map, worktree: Map): { done: number; total: number }`：按 key 并集去重，任一勾选即完成
- [x] 4.3 实现 `readMergedTasks(changeName: string, mainRepo: string, worktreeCwd?: string)`：分别读 `openspec/changes/<change>/tasks.md`（主仓 + 可选 worktree），合并返回
- [x] 4.4 解析失败 / 文件缺失时返回 `{ done: 0, total: 0 }`，不抛错

## 5. 渲染单元 (`render.ts`)

- [x] 5.1 实现 `ARTIFACT_INITIALS = { proposal: "P", design: "D", specs: "S", tasks: "T" }` 常量
- [x] 5.2 实现 `formatArtifactTokens(statuses: ArtifactStatus[]): string`：done→●、其它→○；空格分隔
- [x] 5.3 实现 `formatProgressBar(done: number, total: number): string`：10 格 `█`/`░`，done=0 时全 `░`，total=0 时返回 `░░░░░░░░░░`
- [x] 5.4 实现 `renderLine(name, schemaName, statuses, tasks): string`：拼接 `<name> (<schema>) [<tokens>] Tasks: <bar> <done>/<total>`，确保无换行

## 6. 入口与 hooks (`index.ts`)

- [x] 6.0 **TUI 模式独占激活**：工厂函数最顶端检查 `ctx.mode !== "tui"` 时直接 `return`，不调用任何 `pi.on(...)`、不启动任何资源、不维护内部状态；判定依据为 `ctx.mode` 而**非** `ctx.hasUI`（见 `pi.dev/docs/latest/extensions#ctx-mode`）
- [x] 6.1 实现 `default export` 的 ExtensionFactory，注册 extensionId=`"pi-tui-openspec-status"`
- [x] 6.2 `pi.on("session_start")` hook：调用 `ctx.ui.setStatus(extensionId, undefined)` 清空
- [x] 6.3 `pi.on("tool_call", { type: "bash" })` hook：解析命令 → 命中锁定子命令则更新 `pendingChange` → debounce 500ms 后调用 `runOpenspecStatus` + `readMergedTasks` + `renderLine` → 调用 `setStatus(line)`；无锁定时保留内部状态
- [x] 6.4 `pi.on("tool_result")` hook：拿到 bash 退出后立即触发一次刷新（同上路径），500ms 内重复触发去重
- [x] 6.5 错误捕获：所有 await 包 try/catch；不抛错、不修改 session 内容

## 7. README 与文档

- [x] 7.1 编写 `packages/pi-tui-openspec-status/README.md`：包名/作用/安装/启用/状态条格式示例/worktree 行为/已知限制
- [x] 7.2 在根 `README.md`（如果存在）的"扩展列表"小节中追加一行 `@philogag/pi-tui-openspec-status`；如不存在则跳过

## 8. 验收

- [x] 8.1 `pnpm -F @philogag/pi-tui-openspec-status build` 通过
- [x] 8.2 `pi -e ./packages/pi-tui-openspec-status/src/index.ts` 启动后执行 `openspec status --change add-pi-tui-openspec-status --json` → 状态栏出现完整一行（按当前真实进度）
- [x] 8.3 在 `.worktrees/test-merge/openspec/changes/<change>/tasks.md` 中勾选一个 task → 状态条进度数字按合并规则变化
- [x] 8.4 执行 `openspec list --json` → 状态条清空
- [x] 8.5 非 TUI 模式无副作用：逐个跑
   ```bash
   pi -p   -e ./packages/pi-tui-openspec-status/dist/index.js
   pi --mode json -e ./packages/pi-tui-openspec-status/dist/index.js
   pi --mode rpc -e ./packages/pi-tui-openspec-status/dist/index.js
   ```
   每个模式各跑一个普通 prompt → 均无错误、无 stdout 副作用、无 status 条；rpc 模式下 `ctx.hasUI === true` 也要不激活（验证 `ctx.mode` 判定）
- [x] 8.6 `tsc --noEmit` 在包目录下 0 报错
