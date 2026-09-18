## Context

`pi` agent 在执行 openspec 类的子命令（`new` / `status` / `apply` /
`verify` 等）时，用户经常需要在 TUI 底部一眼看到当前锁定 change 的进度：
artifact 完成情况、tasks 完成数、worktree 中的实时更新。参考实现
`mattoopie/pi-openspec-status` 把这些信息用 `ctx.ui.setWidget` 渲染成
3 行卡片 + Ctrl+Alt+O 弹窗——信息密度大、占垂直空间，且当 agent 在
`.worktrees/feat/<branch>/` 跑 openspec 时（典型 SDD apply 场景），
tasks.md 只在 worktree 更新而主仓保留旧版，参考实现直接读主仓 → 进度
"倒退"。

本设计提出一个**单行 status 条**变体，渲染面压缩到 pi 底部 status
栏（`ctx.ui.setStatus`），不弹 dialog、不占 widget 行；锁定语义收窄为
"用户显式指定了某个 change"，避免 `openspec list` / `openspec doctor`
等浏览类命令无意义地刷状态条；并自动按命令实际 cwd 合并主仓与
worktree 的 tasks 进度。

**干系人**

- **主要使用者**：本仓库（pi-ramdom-stuffs）的 agent 与作者本人；
  后续可能开放给社区，但本期仅自用 + 内部代码评审。
- **依赖**：openspec CLI（外部可执行，本仓库已有）必须已安装；
  `@earendil-works/pi-coding-agent` SDK（hooks + ctx API）。

**约束**

- 不调用 setWidget、不引入 keyboard shortcut、不弹 dialog（用户
  明确"我只要我自己定制的 status 条"）。
- 不修改 openspec 文件本体、不修改 session 内容、不污染 LLM 上下文。
- 不在非交互模式（`ctx.hasUI === false`）下做任何可见副作用；
  pi 启动/退出 hook 须保持幂等。

## Goals / Non-Goals

**Goals**

1. 任何 pi 交互模式（TUI / RPC）下，当用户/agent 通过 bash 调用一个
   **显式指定 change** 的 openspec 子命令时，状态栏即时显示一行：
   `<spec-name> (<spec-driver>) [<artifacts>] Tasks: ████░░░░░░ n/m`
2. 自动解析命令真实 cwd（含 `cd X &&` 重写），落在 worktree 时按
   **主仓 ∪ worktree** 合并去重计算 tasks 进度条；其余字段优先
   worktree，回退主仓。
3. 释放"锁定"语义后（用户运行 `openspec list`、`openspec doctor`、
   或未涉及 openspec 的命令），状态条自动清空（`setStatus(undefined)`）。
4. 仅在 `ctx.mode === "tui"` 模式下激活；非 TUI 模式
   （`print` / `json` / `rpc`）下完全不激活——零 hook 注册、
   零 I/O、零内部状态维护。
5. 包形态完整可发：源码、`tsconfig.json`、`package.json`、README、
   `pnpm workspace` 接入。

**Non-Goals**

1. **不做** 多 change 概览：单行宽度不允许；与"锁定"语义冲突。
2. **不做** overlay / popup / 键盘快捷键（Ctrl+Alt+O 等）。
3. **不做** 文件监听（chokidar 等）：500ms debounce + tool_result
   触发已足够实时，避免多 worktree 监听复杂度。
4. **不** 通过 setWidget 渲染任何东西；不**改** toolbar。
5. **不** 影响其它扩展的 `ctx.ui.setStatus`——使用独立
   `extensionId`（`"pi-tui-openspec-status"`）。
6. **不** 重写 mattoopie/pi-openspec-status 的 CLI 解析、theme 渲染
   等可复用部分；但本期**不**通过 `npm install` 复用其代码（依赖
   管理成本 > 200 行自写的重复成本）。
7. **不** 在 RPC 模式下工作——尽管 `ctx.hasUI === true` 在 RPC
   模式也成立，本扩展仍按 `ctx.mode !== "tui"` 视为非激活。
   用户明确"当 pi 不是 tui 模式时该插件完全不激活"。

## Decisions

### D1：渲染面选择 `ctx.ui.setStatus` 而非 `ctx.ui.setWidget`

- **选择**：调用 `ctx.ui.setStatus(extensionId, line | undefined)`，
  `undefined` 表示清空。
- **理由**：用户需求就是"一行 status 条"；setWidget 会占 1～3 行
  垂直空间并触发后续弹窗 UX 决策；setStatus 直接复用 pi 底部固定
  1 行的状态栏（见 pi-coding-agent `docs/extensions.md:167` 与
  `docs/tui.md:754`）。
- **已考虑 alternative**：
  - `setWidget`：参考实现的渲染面。3 行卡片 + dialog 信息密度大
    但占空间；与"只要 status 条"冲突。
  - `notify`（toast）：闪烁一下就消失，不持续可见——与"持续显示
    进度"的需求冲突。

### D2：锁定 change 解析策略——"显式指定"子命令集合

- **选择**：定义 `_LOCKING_SUBCOMMANDS = new Set([ "new",
  "status", "apply", "archive", "verify", "sync", "instructions",
  "show", "validate", "context", "view" ])`；当 bash 命令 shell
  split 后第二 token 在此集合中时，从 `--change <name>` 形参或
  第一个位置参数提取 change name，作为"锁定 change"。
- **理由**：用户澄清"new, status, apply 等任意需要手动指定
  spec 的命令"——即必须显式告诉 openspec 在操作哪个 change 的
  命令。无 change 参数的子命令（如 `openspec list` / `openspec
  doctor` / `openspec schemas`）不触发锁定。
- **已考虑 alternative**：
  - "任何 active change 都显示"（参考实现）：用户主动否决——
    浏览时无意义闪烁。
  - "任何 openspec 子命令都锁定第一个 positional"：误命中——
    `openspec show` 在旧版是 `openspec show <change>`，但
    `openspec list` 第一个 positional 是 `--json`/`--long` 等
    flag 而非 change，逻辑变脆。

### D3：worktree 检测与 cwd 解析

- **选择**：
  1. 优先用 `pi.on("tool_call")` 中 `event.input.cwd`（pi bash
     tool 已暴露）；如未提供，则按 `.worktrees/feat/<branch>/`
     路径前缀探测 `ctx.cwd`。
  2. 用正则 `/\.worktrees\/([^\/\s]+)/` 提取 worktree 名称。
  3. 落入 worktree → 后续 `openspec status --change <name> --json`
     调用**通过显式 `--workdir <worktree-cwd>` 参数（openspec 0.6+
     支持）或在子进程 `spawn(cmd, { cwd: worktreeCwd })`** 执行；
     tasks.md 文件系统读直接 `path.resolve(worktreeCwd,
     "openspec/changes/<change>/tasks.md")`。
- **理由**：agent 在 worktree 跑 openspec 时，`ctx.cwd` 通常已是
  worktree；但有时主仓运行 cd-rewrite 进入 worktree，必须从 bash
  命令字符串里把 cwd 抠出来。子进程 cwd 必须与读 tasks.md 的
  路径**一致**。
- **已考虑 alternative**：
  - chokidar 监听 `openspec/changes/`：实时但要监听多 worktree
    目录；过度工程。
  - "只在 worktree 中存在 `tasks.md` 才合并"：错误——主仓与
    worktree **都**存在 `tasks.md`（worktree 是完整 checkout），
    必须合并去重而非判断存否。

### D4：tasks 合并去重规则

- **选择**：解析两边 `tasks.md`，按 **task ID**（形如 `1.` `2.`
  `1.1` 或 `(1)`）做 key；任一 source 勾选 `checked` 属性视为完成；
  `total = |keySet_main ∪ keySet_worktree|`，`done = |{k ∈ union
  : main.checked(k) OR worktree.checked(k)}|`。
- **理由**：worktree 是工作的"前台"，主仓是"过去的状态"——
  任一为真都表示 task 已被完成过；避免主仓旧版本 + worktree 新
  完成的 task 退步。
- **已考虑 alternative**：
  - "worktree 优先"：可能漏掉主仓已合并完成但 worktree 尚未
    rebase 的 task。
  - "取 max(主仓 done, worktree done)"：粗暴——双倍计数时
    不能保证正确进度。

### D5：artifact 首字母与状态符号集合

- **选择**：`ARTIFACT_INITIALS = { proposal: "P", design: "D",
  specs: "S", tasks: "T" }`（schema 名 `superpowers-bridge-cn`
  下的 4 个对外产物；与 `openspec status --change --json` 返回
  的 artifact 列表对齐）；status.json 中 `done` → ●，其它 →
  ○；空格分隔拼接。
- **理由**：状态条宽度有限；用首字母比文件路径短得多；schema 的
  对外产物正好 4 个，1 字符/项 ≈ 4-8 字符总长度。排除
  `brainstorm.md` / `verify.md` / `retrospective.md`——它们是
  planning-phase 内部产物，不应在用户 UI 上展示。
- **已考虑 alternative**：
  - 全文件名（如 `proposal.md`）：太长，破坏单行约束。
  - 数字索引（`1●2●3○4○`）：与 schema 名无关联，可读性差。

### D6：刷新策略——debounce + session_start 初始化

> 仅在 `ctx.mode === "tui"` 时生效（见 D9）；非 TUI 模式
> 下工厂函数直接 return，不注册任何处理器。

- **选择**：
  - `pi.on("session_start")` 清空一次（清掉旧实例残留）。
  - `pi.on("tool_call", { type: "bash" })` → 解析命令；
    若锁定 change 解析成功，候选 `pendingChange = name`，延迟
    500ms 后执行 `openspec status --change <name> --json` 并
    调用 `setStatus(line)`。
  - `pi.on("tool_result")` → 拿到 bash 退出后立即触发一次
    （覆盖 candidate 已确认的 change），500ms 内的重复事件
    去重。
- **理由**：与参考实现相同（500ms debounce）——平衡 CLI 启动
  成本与视觉更新延迟；tool_result 触发保证 status 与最新命令
  同步。
- **已考虑 alternative**：
  - 无 debounce：每次 tool_call 都同步 spawn，CLI 启动延迟
    叠加到 LLM 工具调用延迟。
  - 1s debounce：太迟，体感"卡顿"。

### D7：错误处理

- **选择**：所有 openspec CLI 调用与文件读取用 `try/catch` 包
  裹；失败时保留上次状态（或清空），**不**通知用户、不抛错。
- **理由**：状态条是 UI 增强，不应影响主流程；用户当前没装
  openspec CLI 时整个 pi 仍可工作——只需不亮 status 条。

### D8：包结构与发布形式

- **选择**：
  ```
  packages/pi-tui-openspec-status/
  ├── package.json
  ├── tsconfig.json
  ├── README.md
  └── src/
      ├── index.ts          # 入口；导出 default ExtensionFactory
      ├── parser.ts         # bash 命令 → { subcommand, changeName, worktreeCwd }
      ├── openspec.ts       # CLI 包装 (spawn 封装 + 5s timeout)
      ├── merge.ts          # tasks.md 主仓 ∪ worktree 合并去重
      └── render.ts         # 拼装单行 status 文本
  ```
- **理由**：与参考实现拆分对齐；每单元 < 100 行，可独立单测。
  monorepo `packages/` 目录约定，pnpm workspace 直接链接。
- **已考虑 alternative**：
  - 单文件 `index.ts`：可写但 > 200 行时难维护。
  - 复制 mattoopie/pi-openspec-status 全文件后改：依赖
    `npm install` 后还要叠加 patch，pnpm workspace 下不优雅。

### D9：TUI 模式独占激活——工厂级早 return

- **选择**：扩展工厂函数最顶端做
  `if (ctx.mode !== "tui") return;`，
  不调用任何 `pi.on(...)`，不启动任何资源。
- **理由**：
  - pi.dev 官方 docs 明确 `ctx.mode === "tui"` 为终端独占
    特征判据（见 `pi.dev/docs/latest/extensions#ctx-mode`）。
  - `ctx.hasUI` 在 `tui` 与 `rpc` 两模式下都为 `true`，
    不能用来区分 TUI 与 RPC。
  - 用户明确"当 pi 不是 tui 模式时该插件完全不激活"
    ——需要在工厂层短路，确保零 hook 注册、零 I/O。
- **已考虑 alternative**：
  - 在每个 handler 顶端 `if (ctx.mode !== "tui") return;`：
    功能上等价，但 hook 仍被注册、pi 仍会调度这些 handler，
    增加每次事件循环的函数调用开销。
  - 用 `ctx.hasUI` 作为判定键：会错误激活 RPC 模式，
    违反用户要求。

## Risks / Trade-offs

- **[Risk] openspec CLI 启动慢（>500ms）** → Mitigation：
  `spawn` 时设 2 秒 timeout（参考实现 5s 太宽松，本地 openspec
  应 < 200ms）；超时则保留上次状态。
- **[Risk] worktree 路径命名不规范**（`feature-x` 而非 `feat-x`）→
  Mitigation：用正则 `/\.worktrees\/([^\/\s]+)/` 宽松匹配；不识别时
  回退到 `ctx.cwd` 普通处理。
- **[Risk] 用户在主仓中 `cd .worktrees/feat/x && openspec status
  --change foo` 跑命令**，但 `event.input.cwd` 仍是主仓 → Mitigation：
  parser 优先解析命令字符串里的 `cd <path> &&` 链；取最后一个
  `cd` 的目录作为 effective cwd。
- **[Risk] `setStatus(undefined)` 在 pi 旧版本（< 0.40）不支持** →
  Mitigation：在 package.json 的 `peerDependencies` 锁定
  `@earendil-works/pi-coding-agent >= 0.40.0`。
- **[Risk] multi-agent / 多 worktree 并行时 status 条语义错乱** →
  Mitigation：本期锁定语义定义为"最近一次 bash 命令"，单线程
  串行符合绝大多数场景；并行情况不在本期范围。
- **[Trade-off] 不做 notify（toast）提醒** → 接受理由：status 条
  持续可见，反馈已足够；toast 在 TUI 中易被忽略。
- **[Trade-off] 不复用 mattoopie/pi-openspec-status 源码** →
  接受理由：自写 < 200 行；不引入间接依赖与版本耦合；可独立
  演进。
- **[Trade-off] artifact 首字母硬编码 4 个**（P/D/S/T）→ 接受
  理由：schema 变更本就是 breaking，本插件随版本发版即可。

## Migration Plan

N/A — 本 change 不涉及部署变更（pure-add：新增 packages/ 子包
+ 本地启用；不影响已部署的 openspec 文件、agent 行为或其它扩展）。

**Acceptance checklist（apply 前对照）**：

1. `pnpm -F @philogag/pi-tui-openspec-status build` 通过；
2. `pi -e ./packages/pi-tui-openspec-status/src/index.ts` 启动后，
   运行 `openspec status --change add-pi-tui-openspec-status
   --json` → 状态栏显示
   `add-pi-tui-openspec-status (superpowers-bridge-cn) [P● D● S○ T○] Tasks: ██░░░░░░░░ 2/7`（按当前进度的实际数字）。
3. 在 `.worktrees/test-merge/` 下创建 tasks.md 并勾选一个 task →
   重启验证状态条数字自动更新为合并值。
4. 运行 `openspec list --json` → 状态条清空。
5. 非 TUI 模式无副作用（4 个模式逐个验证）：
   ```bash
   pi -p   -e ./packages/pi-tui-openspec-status/src/index.ts   # print
   pi --mode json -e ./packages/pi-tui-openspec-status/src/index.ts   # json
   pi --mode rpc -e ./packages/pi-tui-openspec-status/src/index.ts   # rpc
   pi --mode rpc -e ./packages/pi-tui-openspec-status/src/index.ts   # rpc hasUI=true 也要不激活
   ```
   任意一个跑普通 prompt → 无报错、无 stdout 副作用、无 status 条；
   rpc 模式 `ctx.hasUI === true` 也不激活（验证 `ctx.mode` 判定）。

## Open Questions

1. **openspec CLI 是否支持 `--workdir` / `--cwd` 参数**？需在
   `openspec.ts` 实装前查 docs；不支持时需走 `spawn(cmd, { cwd })`
   路径变体。
2. **tasks.md 中 task ID 的格式变体**：当前假设 `1.` `2.` `1.1`；
   实际可能 `(1)`、`[ ]`/ `[x]` checkbox 风格无编号。需在
   `merge.ts` 实装前抽样 1-2 个真实 archive 验证解析器。
3. **是否要在状态条显示 schema 版本号**？当前格式只显示 schema
   名；如运维需要可加 `[v0.6]`，但本期不做。
4. **多行 bash（含换行/续行）下解析 robustness**：parser 用 shell
   tokenizer 而非正则；需要至少覆盖 `&&` `;` `||` `|`
   4 种连接符；`$()` 与 backtick 不在范围。
