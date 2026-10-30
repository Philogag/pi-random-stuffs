# openspec-bridge Specification

## Purpose

`@philogag/pi-openspec-bridge` 把 OpenSpec CLI 包裹进 pi 扩展，向 agent 暴露一个结构化的 `openspec`
tool 取代用 shell 工具执行 `openspec …`；并把原 `@philogag/pi-tui-openspec-status` 的状态条功能合并进同一
个扩展，状态条改由 tool 调用驱动（bash 调用仍兼容）。

## Requirements

### Requirement: 单一 `openspec` tool 全子命令桥接

扩展 MUST 通过 `pi.registerTool()` 注册名为 `openspec` 的 tool，其 `subcommand` 参数 MUST 是一个枚举，
覆盖所捆绑 OpenSpec CLI 的**全部**非隐藏子命令（扁平路径形式，嵌套命令用空格连接，如 `new change`、
`store register`）。枚举与实际命令树的一致性 MUST 由测试保证。

#### Scenario: 枚举与真实命令树一致
- **WHEN** 读取捆绑的 `@fission-ai/openspec` 的 commander 命令树并展开为叶子路径
- **THEN** 该集合与 `OPENSPEC_SUBCOMMANDS` 枚举集合完全相等（不缺、不多）

#### Scenario: 未知子命令被拒绝
- **WHEN** 传入 `subcommand: "frobnicate"`
- **THEN** 调用失败并提示合法子命令列表，不启动任何子进程

### Requirement: 结构化 flag 参数

tool 的每个 OpenSpec flag MUST 以具名、带描述的参数暴露（布尔 / 字符串 / 数字三类），
MUST NOT 要求调用方拼接原始命令行字符串。未提供的 flag MUST NOT 出现在 argv 中（不注入默认值）。

#### Scenario: 位置参数与 flag 分离
- **WHEN** 调用 `{ subcommand: "new change", args: ["add-dark-mode"], description: "Add dark mode", json: true }`
- **THEN** 实际 argv 为 `new change add-dark-mode --json --description "Add dark mode"`

#### Scenario: 否定式 flag 保留字面拼写
- **WHEN** 调用 `{ subcommand: "archive", args: ["x"], noValidate: true, skipSpecs: true }`
- **THEN** argv 包含 `--no-validate` 与 `--skip-specs`

#### Scenario: 未知参数不静默透传
- **WHEN** 调用方传入 schema 未定义的键
- **THEN** tool 返回参数错误，而不是把键当作位置参数传给 CLI

### Requirement: 显式指定 spec root

tool MUST 接受 `root` 参数指定 spec root（含 `openspec/` 的目录），并 MUST 以该目录作为子进程 cwd。
相对路径 MUST 相对 session cwd 解析。未提供 `root` 时 MUST 回退到 session cwd。

#### Scenario: root 与 session cwd 不同
- **WHEN** session cwd 为 `/a`，调用 `{ subcommand: "list", root: "/b/specs", json: true }`
- **THEN** 子进程 cwd 为 `/b/specs`，无需 `cd`

#### Scenario: 相对 root
- **WHEN** session cwd 为 `/repo`，调用 `{ subcommand: "list", root: "." }`
- **THEN** 子进程 cwd 解析为 `/repo`

### Requirement: 子进程执行保真

tool MUST 以子进程方式执行 OpenSpec CLI（而非在宿主进程内 import 调用），MUST 捕获 stdout、stderr、
退出码与耗时，并在结果中同时返回结构化 `details`。非零退出码 MUST NOT 抛异常：其输出与退出码 MUST
以数据形式返回给模型，以便读取失败 JSON 载荷。仅当子进程完全无法启动（如二进制缺失）时才以错误终止调用。

#### Scenario: 非零退出码仍返回输出
- **WHEN** `openspec status --change does-not-exist --json` 退出码非 0
- **THEN** tool 返回内容包含 CLI 的 JSON 失败载荷，`details.ok === false`，`details.exitCode !== 0`

#### Scenario: 二进制缺失
- **WHEN** 解析不到任何 OpenSpec 二进制
- **THEN** tool 以错误终止并提示安装 `@fission-ai/openspec` 或设置 `PI_OPENSPEC_BIN`

### Requirement: 二进制解析顺序

扩展 MUST 按以下顺序解析 OpenSpec 二进制：环境变量覆盖（`PI_OPENSPEC_BIN` 或 `OPENSPEC_BIN`）→
捆绑依赖 `@fission-ai/openspec` 的 `bin/openspec.js`（用当前 node 执行）→ PATH 上的 `openspec`。
捆绑依赖 MUST 优先于 PATH，使扩展在未全局安装 CLI 的机器上仍可用。

#### Scenario: 未全局安装 CLI
- **WHEN** PATH 中没有 `openspec`，但扩展依赖已安装
- **THEN** 解析到捆绑的 `bin/openspec.js` 并使用当前 node 运行

### Requirement: 非交互、无颜色、无遥测

每次执行 MUST 设置非交互环境（`NO_COLOR`、`OPENSPEC_NO_UPDATE_CHECK`、`OPENSPEC_TELEMETRY=0`、
`CI=1` 等），子进程 stdin MUST 关闭，避免命令挂起等待提示或污染 stdout。

#### Scenario: 无需用户输入的命令
- **WHEN** 执行 `list --json`
- **THEN** 进程以关闭的 stdin 运行并在超时内退出

### Requirement: 状态条由 tool 调用驱动

状态条逻辑（原 `tui-openspec-status`）MUST 在合并后继续工作，并 MUST 主要从 `openspec` tool 的
结构化参数获取锁定目标：`--change` 参数优先，其次按子命令约定取位置参数。只读/全局命令
（`list`、`store list`、`config *`、`spec list` 等）MUST NOT 改变锁定目标。
通过 bash 工具执行 `openspec …` 的旧路径 MUST 继续可用。

#### Scenario: tool 调用锁定 change
- **WHEN** agent 通过 `openspec` tool 调用 `{ subcommand: "new change", args: ["add-dark-mode"] }`
- **THEN** 状态条锁定并显示 `add-dark-mode`

#### Scenario: 只读命令不锁定
- **WHEN** agent 通过 tool 调用 `{ subcommand: "list", json: true }`
- **THEN** 状态条锁定目标保持不变，仅触发一次刷新

#### Scenario: tool 指定的 root 作为额外扫描源
- **WHEN** tool 调用的 `root` 与 session cwd 不同
- **THEN** 该 root 被登记为额外扫描源（等价于旧 worktree 语义），状态条显示各源合并后的进度

### Requirement: 状态条仅在 TUI 启用

扩展 MUST 只在 `ctx.mode === "tui"` 的 session 中创建状态条渲染器；print / json / rpc 模式下
MUST NOT 调用 `ui.setStatus`。`openspec` tool 本身 MUST 在所有模式下注册可用。

#### Scenario: headless 会话
- **WHEN** 在 `print` 模式会话中加载扩展
- **THEN** `setStatus` 从未被调用，而 `openspec` tool 仍可调用

### Requirement: 锁定状态跨会话持久化

锁定状态 MUST 通过 `pi.appendEntry` 以 custom entry 形式持久化（不进入 LLM 上下文），
session_start（含 `/resume`）时 MUST 从最后一条匹配 entry 恢复，手动锁定与自动锁定语义 MUST 保持区分。

#### Scenario: 恢复手动锁定
- **WHEN** journal 中最后一条 lock entry 为 `{ spec: "gamma", manualLock: true, version: 1 }`
- **THEN** 重启后状态条恢复为手动锁定 `gamma`

#### Scenario: 脏数据回退空状态
- **WHEN** 最后一条 lock entry 的 `version !== 1`
- **THEN** 不恢复任何锁定，状态条保持空状态
