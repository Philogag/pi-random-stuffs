# tui-openspec-status — Delta Specification

## ADDED Requirements

### Requirement: 手动选择 spec 命令

扩展 MUST 通过 `pi.registerCommand` 注册 TUI 斜杠命令 `/tui-openspec-select`（仅在 `ctx.mode === "tui"` 激活分支内注册）。该命令 MUST 打开 `ctx.ui.select` 交互选择器，列出 `openspec/changes/*/` 目录下所有活动 change 名（MUST 排除 `archive/` 目录），并额外提供一个 `None` 选项。用户选择某 change 名时，扩展 MUST 将该 change 设为手动锁定并立即渲染状态栏；选择 `None` 时，扩展 MUST 清空手动锁定并恢复自动监听；选择器取消（`select` 返回 `undefined`）时，扩展 MUST 不修改任何状态。

手动锁定生效期间（`manualLock = true`），bash 工具调用中的 openspec 自动锁定 MUST 不再改变锁定 change 名（手动覆盖自动）；但 worktree 检测 MUST 仍生效，继续更新 effective cwd 以保持主仓+worktree 合并渲染。手动重新选择或选择 `None` 后，扩展 MUST 恢复自动锁定行为。

当手动锁定的 change 被归档（所有扫描 source 的 `openspec/changes/<name>/` 文件夹均不存在）时，扩展 MUST 按既有解锁逻辑清空状态栏，并 MUST 重置手动锁定状态。

#### Scenario: 打开选择器并选择 change
- **WHEN** 用户在 TUI 输入 `/tui-openspec-select`，`openspec/changes/` 下存在活动 change `add-pi-tui-openspec-status`，用户在选择器中选择该项
- **THEN** 扩展将 `add-pi-tui-openspec-status` 设为手动锁定，状态栏立即显示该 change 的进度

#### Scenario: 选择 None 清空手动锁定
- **WHEN** 手动锁定生效后，用户再次输入 `/tui-openspec-select` 并选择 `None`
- **THEN** 扩展清空锁定 change 与手动锁定状态，状态栏清空，后续 bash 自动锁定恢复生效

#### Scenario: 选择器取消无副作用
- **WHEN** 用户输入 `/tui-openspec-select` 打开选择器后按 Esc 取消（`select` 返回 `undefined`）
- **THEN** 扩展不修改锁定 change、手动锁定状态与状态栏，保持取消前状态

#### Scenario: 手动覆盖自动锁定
- **WHEN** 用户手动锁定 change `alpha` 后，LLM 执行 `openspec status --change beta --json`
- **THEN** 锁定 change 仍为 `alpha`，不切换到 `beta`；状态栏保持显示 `alpha` 进度

#### Scenario: 手动锁定下 worktree 检测仍生效
- **WHEN** 用户手动锁定 change `alpha` 后，LLM 在 worktree 路径执行 `cd .worktrees/feat/x && openspec status --change alpha --json`
- **THEN** 锁定 change 保持 `alpha`，且 effective cwd 更新为 worktree 路径，状态栏按主仓+worktree 合并结果渲染

#### Scenario: 手动锁定 change 归档后自动解锁
- **WHEN** 用户手动锁定 change `alpha` 后执行 `openspec archive alpha`，主仓与所有 worktree 的 `openspec/changes/alpha/` 文件夹均消失
- **THEN** 扩展按既有解锁逻辑清空状态栏，并重置手动锁定状态；后续 bash 自动锁定恢复生效

#### Scenario: 选择器只列出活动 change
- **WHEN** `openspec/changes/` 下存在 `alpha/`、`archive/2026-08-27-beta/`，用户输入 `/tui-openspec-select`
- **THEN** 选择器列出 `alpha` 与 `None`，MUST 不出现 `beta`（归档 change 不可选）
