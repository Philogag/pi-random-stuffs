<!--
superpowers:brainstorming 产出的原始捕获。

本文件原样捕捉 brainstorming skill 的产出，不强制结构。
Skill 的自然产出通常是 decision log 格式（背景 → 决策链 Q1-Qn → 设计取舍），
但依对话内容可能有不同的组织方式。

design.md 从本文件萃取并重新整理为结构化设计文档。

不要将本文件的内容复制到 design.md — design.md 是独立的重组产物，
两者互补但不重叠。
-->

# Brainstorm — add-tui-openspec-select

## 背景

`pi-tui-openspec-status` 扩展目前在 TUI 状态栏显示当前 openspec change 的进度
（artifact 状态 + tasks 进度条）。锁定机制完全依赖 bash tool_call 解析：
当 LLM 执行 `openspec status --change <name>` 等命令时，扩展从命令字符串中
提取 change 名并锁定显示。用户无法直接控制"状态栏跟踪哪个 spec"——
例如当 LLM 尚未执行任何 openspec 命令、或想要固定跟踪某个与当前工作无关的
change 时，状态栏要么为空、要么跟着 bash 命令乱跳。

用户需求（原话）：“tui-openspec-status 增加命令 tui-openspec-select 来手动指令spec”
—— 增加一条手动指令，让用户能亲自指定状态栏跟踪哪个 spec。

## 决策链

### Q1: 命令以什么形式存在？

选项：
- **A. TUI 斜杠命令**（`pi.registerCommand` 注册 `/tui-openspec-select`）—— pi 扩展
  标准命令机制，用户在输入框直接输入触发，与 bash 解析的自动锁定互补。
- B. bash 命令字符串解析 —— 继续监听 tool_call，当命令含 `tui-openspec-select <name>`
  时手动锁定。对 LLM 可见，但用户无法直接触发。
- C. 两者都要 —— 覆盖两种路径。

**决策：A（用户确认 "TUI 斜杠命令"）。**
理由：命令面向的是"用户手动指定"这个场景，天然属于 TUI 交互层；bash 解析路径
是给 LLM 用的，用户手动指令走斜杠命令最直接。不做 C 以避免双入口带来的优先级
混乱与测试面膨胀。

### Q2: 手动选中后与自动锁定（bash openspec 命令）的优先级？

选项：
- **A. 手动覆盖自动** —— 手动锁定的 change 保持，后续 bash 中的 openspec 命令
  不再改变它，直到用户再次手动选择或清空。适合"手动指定后稳定跟踪"。
- B. 自动覆盖手动 —— bash 中出现 openspec 命令即切换，手动选择只是临时覆盖。
- C. 最近一次优先 —— 谁后发生谁生效。

**决策：A（用户确认 "手动覆盖自动"）。**
理由：手动选择的语义就是"我要看这个 spec，别被其它命令带走"。若自动覆盖手动，
手动选择的稳定性无从谈起。实现上引入 `manualLock: boolean` 状态：为 true 时
`tool_call` 中的自动锁定逻辑跳过 change 名更新。

### Q2b: manualLock 时 worktree 检测是否仍生效？

**决策：仍生效。**
理由：worktree 检测更新的是 `effectiveCwd`（渲染时的扫描路径），与"锁定哪个
change"正交。用户在 worktree 中工作时仍希望看到主仓+worktree 合并的进度。
`manualLock` 只冻结 change 名，不冻结 cwd 跟随。

### Q3: 如何清空手动选择？

选项：
- A. 无参调用清空 —— `/tui-openspec-select` 不带参数即清空。
- B. `--clear` 标志。
- C. 不需要清空 —— 跟随现有归档自动解锁。

**决策：用户自定义 —— "打开tui交互，列举当前所有活动spec可选，额外提供一个
None选项"。**
即：命令无参执行时打开 `ctx.ui.select` 交互选择器，列出 `openspec/changes/*/`
下所有活动 change（排除 `archive/`），额外附一个 `None` 选项代表清空。
用户选 `None` → 清空手动锁定，恢复自动监听；选某个 change → 手动锁定；
取消（`select` 返回 `undefined`）→ 无操作。

理由：交互选择器比记忆命令参数更符合"手动选择"的心智模型，且 `None` 选项
让清空动作显式可见。

### Q4: 归档后是否自动解锁手动锁定的 change？

选项：
- A. 跟随现有逻辑自动解锁 —— 所有 source 的 `openspec/changes/<name>/` 消失即清空。
- B. 手动锁定后即使归档也不清空，必须手动选 None。

**决策：A（用户确认设计稿中"归档自动解锁"）。**
理由：change 已归档即不存在，继续跟踪一个不存在的 spec 无意义；且与现有
解锁语义（文件夹消失即解锁）保持一致，避免两条解锁路径行为分裂。

## 设计取舍摘要

- **入口**：`pi.registerCommand("tui-openspec-select", { description, handler })`，
  仅在 `ctx.mode === "tui"` 激活分支内注册（保持 TUI 独占激活要求）。
- **选择器**：`ctx.ui.select(prompt, items)`，items = 活动 change 名列表 + `"None"`。
  `select` 返回 `undefined` 表示取消（含超时），此时无副作用。
- **锁定语义**：选中的 change 名写入内部状态（复用现有 `lockedChange`），
  设置 `manualLock = true`，随后走既有 `render()` 渲染路径（含 worktree 合并、
  debounce、错误吞噬）。
- **清空**：选 `None` → `lockedChange = undefined; manualLock = false;`
  并按现有规则清空状态栏（仅当 `lastRendered !== ""` 时 `setStatus(undefined)`）。
- **优先级**：`manualLock === true` 时 `tool_call` 中跳过
  `lockedChange = parsed.changeName`，但 `effectiveCwd` 跟随照常。
- **自动解锁**：`render()` 中所有 source 文件夹消失时，清空 lockedChange 与
  manualLock（恢复自动监听）。
- **取消**：`select` 取消不改任何状态。

## 开放问题 / 后续

- `ctx.ui.select` 超时行为：确认 `select` 超时返回 `undefined` 与用户取消不可区分，
  两者都按"无操作"处理 —— 可接受，无需区分。
- 是否需要 `getArgumentCompletions`：本设计无参执行（选择器内选），
  暂不注册补全；若后续需要直接参数形式再补。
