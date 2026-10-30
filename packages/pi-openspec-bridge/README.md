# @philogag/pi-openspec-bridge

pi 扩展:把 [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI **包裹进插件**,向 agent 暴露一个
`openspec` tool 取代用 shell 工具跑 `openspec …`;并合并了原 `@philogag/pi-tui-openspec-status` 的
状态条功能(同一个扩展、同一份锁定状态)。

## 安装

```bash
pi install npm:@philogag/pi-openspec-bridge
```

- 安装后扩展自动启用;`pi config` 可启用 / 禁用。
- 项目级安装加 `-l`(`pi install -l npm:@philogag/pi-openspec-bridge`)。
- 快速体验:`pi -e npm:@philogag/pi-openspec-bridge`。
- 改动扩展后执行 `/reload` 热重载。

## 两件事

### 1. `openspec` tool —— 100% 子命令桥接

模型不再需要 `bash: openspec status --change foo --json`,而是:

```jsonc
{
  "subcommand": "status",
  "change": "add-dark-mode",
  "json": true,
  "root": "/path/to/spec-root"
}
```

- **`subcommand` 是枚举**:覆盖所捆绑 CLI 的**全部**非隐藏子命令(嵌套命令用空格连接,如
  `"new change"`、`"store register"`)。枚举与真实命令树的一致性由 `test/coverage.test.ts` 保证
  ——升级 `@fission-ai/openspec` 后如果命令树变了,测试会直接失败而不是让 agent 拿到过期的接口。
- **flag 是具名参数**:布尔 / 字符串 / 数字三类,带中文以外的英文描述;未传的 flag 不会出现在 argv
  里(不注入默认值)。否定式 flag 用 `noXxx` 键对应 `--no-xxx`(如 `noValidate` → `--no-validate`)。
- **位置参数走 `args` 数组**,顺序与 CLI 一致,例如 `["add-dark-mode"]`、`["defaultSchema","spec-driven"]`。
- **`root` 指定 spec root**:子进程以该目录为 cwd,所以不再需要 `cd <dir> && openspec …`;相对路径
  按 session cwd 解析;缺省回退到 session cwd。
- **非零退出码不算异常**:CLI 的 stdout / stderr / 退出码以数据形式返回(`details.ok === false`),
  失败时的 JSON 载荷能被模型直接读到。只有二进制完全无法启动时才报错。

示例(在 `/repo` 会话里对 `/specs` 操作):

```jsonc
{ "subcommand": "new change", "args": ["add-dark-mode"], "description": "Add dark mode", "root": "/specs" }
{ "subcommand": "list", "json": true, "root": "/specs" }
{ "subcommand": "archive", "args": ["add-dark-mode"], "yes": true, "skipSpecs": true, "root": "/specs" }
```

### 2. 状态条 —— 合并自 pi-tui-openspec-status

底部状态栏显示当前锁定的 change 进度:

```
add-dark-mode (spec-driven) [P● S● D○ T○] Tasks: ███░░░░░░░ 3/9
```

- **锁定来源**:`openspec` tool 调用(结构化参数,`--change` 优先,否则按子命令取位置参数),
  以及 bash 里手敲的 `openspec …`(旧路径保留)。`list` / `store list` / `config *` 等只读、全局
  命令**不会**抢走锁定目标。
- **多源合并**:tool 的 `root` 与 session cwd 不同时,该 root 作为额外扫描源(等价于原 worktree
  语义),状态条显示合并后的 artifacts + tasks。
- **跨会话持久化**:锁定状态以 custom entry 写入 session journal(不进入 LLM 上下文),
  `session_start` / `/resume` 时恢复,并保留"手动锁定 vs 自动锁定"的区别。
- **仅 TUI 生效**:print / json / rpc 模式不会调用 `ui.setStatus`;`openspec` tool 本身在所有模式可用。
- 手动选择:`/openspec-bridge`(选 `None` 清空)。

## 二进制解析顺序

1. `PI_OPENSPEC_BIN` / `OPENSPEC_BIN` 环境变量(绝对路径的 JS 入口,或 PATH 上的命令名);
2. 本扩展依赖的 `@fission-ai/openspec` → `<pkg>/bin/openspec.js`(用当前 node 执行);
3. PATH 上的 `openspec`。

捆绑依赖优先于 PATH,**所以本机没有全局安装 `openspec` 也能用**。执行时固定注入非交互环境
(`NO_COLOR`、`OPENSPEC_NO_UPDATE_CHECK=1`、`OPENSPEC_TELEMETRY=0`、`CI=1`,stdin 关闭),
避免命令挂起等提示或污染 stdout。

> 用中文版 CLI(`@studyzy/openspec-cn` / `openspec-cn`)时,设 `PI_OPENSPEC_BIN=openspec` 即可。

## 为什么是子进程,不是进程内 `runCli()`

OpenSpec 的 `runCli()` 在多条错误路径上调用 `process.exit()`,进程内直调会杀掉 pi;commander 还持有
一个全局 program 单例,进程内重复调用会串状态。子进程同时保证了 stdout / stderr / 退出码与 shell
里完全一致 —— 这正是"100% 子命令桥接"的含义。

## 开发

```bash
pnpm --filter @philogag/pi-openspec-bridge build
pnpm --filter @philogag/pi-openspec-bridge test
```

- `src/cli/schema.ts` — 手写 schema:子命令枚举 + flag 注册表(新增 flag = 一行)
- `src/cli/argv.ts` — 参数 → argv(纯函数,含未知键拒绝)
- `src/cli/resolve.ts` / `src/cli/run.ts` — 二进制解析 / 子进程执行
- `src/tool.ts` — `pi.registerTool()` 定义与结果格式化
- `src/status/` — 状态条(merge 自 pi-tui-openspec-status 的源码)
