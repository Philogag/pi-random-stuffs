# Retrospective: tui-fold-blocks

> Written: 2026-08-27 (after verify passed)
> Commit range: `272921c..1e78c37`（实现 8 commits，另有主仓库归档 cycle 待并入）
> Worktree: `/home/philogag/workspace/pi-exts/pi-ramdom-stuffs/.worktrees/feat/tui-fold-blocks`

---

## 0. Evidence

- **Commit range**: `272921c..1e78c37`（8 implementation commits，不含归档 cycle）
- **Diff size**: +2494 / -1 lines across 17 files（实现 worktree；另含主仓库 change 文档与归档 cycle）
- **Tasks done**: 22/22（`grep -cE '^\s*- \[x\]' tasks.md` → 22，0 未完成）
- **Active hours**: ~1.5h（SDD 派发执行）
- **Subagent dispatches**: 7 implementer + 5 reviewer + 1 resume（13 次）
- **New external dependencies**: `@earendil-works/pi-coding-agent@^0.84.3`（pi SDK，既有依赖）、`@earendil-works/pi-tui`（latest）、`typebox`（latest）、`vitest`（latest, dev）、`typescript@^5.6.3`（dev）
- **Bugs encountered post-merge**: none（未合并，归档前）
- **OpenSpec validate state at archive**: pass（1/1 valid）
- **Test coverage signal**: 21 vitest cases（config 3 / folders 8 / mode 2 / render 7 / command 1），tui 渲染组件无法在非 TTY 容器中肉眼验证，纯函数层全覆盖

Commit chain (时序):

```
272921c chore: ignore .worktrees/
5d42f0a feat(tui-fold-blocks): scaffold package + extension entry
9cfa6a9 feat(tui-fold-blocks): config module with defaults fallback
a0e817f feat(tui-fold-blocks): foldPath + foldCommand pure functions
4843a50 feat(tui-fold-blocks): mode state + tool overrides with execute delegation
57c9b56 feat(tui-fold-blocks): fold line rendering (single-line, left/right aligned)
dbae6b5 feat(tui-fold-blocks): /fold-blocks command + settings persistence
3a7f38a fix(tui-fold-blocks): apply settings live (mode sync + config getter)
1e78c37 chore(tui-fold-blocks): verification pass + release prep
```

---

## 1. Wins

- [evidence: 21 vitest cases, `pnpm test`] TDD 纪律全程保持：每个 Task 先写失败测试（Step 1 FAIL 确认）再实现（Step 3/4），7 个 Task 全部按 brief 的 TDD 节奏执行。
- [evidence: 4 tool-name conflict smoke 告警] 同名覆盖策略被冒烟验证有效——`registerOverrides` 触发与全局 pi-foldable-tools 的同名冲突告警，证明覆盖机制真正生效。
- [evidence: reviewer 逐 Task 审查 + P1-1 修复] Task 6 review 发现 P1-1（设置保存不实时生效：mode 未同步 modeState + cfg 按值捕获），主线程决策接受修复（mode sync + config getter），commit `3a7f38a` 落地，避免了一个用户可感知的静默陷阱。
- [evidence: dbae6b5 的 brief 修正] worker 发现 brief 中 `openSettings(pi, ...)` 是真实类型错误（ExtensionAPI 无 ui 属性，ui 在 ExtensionCommandContext 上），修正为 `openSettings(ctx.ui, ...)` 并经 SDK 类型核实——brief 纠错机制运转正常。
- [evidence: 22/22 tasks] 范围控制良好：无 Task 超前实现（worker 明确拒绝在 T6 引入 T7 内容），Task 7 的 P2 清理（CONFIG_DIR_NAME unused import、package.json metadata）按计划完成。

---

## 2. Misses

- 🟡 [painful | evidence: worker 首跑中途失败, resume 后完成] Task 6 worker 在 Step 6（typecheck + smoke）阶段会话失败，需 resume（run ce87f7dd）恢复持久化子会话才完成交付。首跑失败原因未深入定位（进程中断类），resume 机制可靠兜底。
- 🟡 [painful | evidence: 全局 pi-foldable-tools 冲突] 冒烟时 4 个内置工具与全局 pi-foldable-tools 扩展同名覆盖告警。设计预期（本扩展优先），但 README 需提示用户潜在冲突（已列入 Task 7 residual，未完成 README 补充）。
- 📌 [nit | evidence: settings 实时生效修复的成本] P1-1 修复将 `registerOverrides` 的 cfg 参数改为 getter 形式，overrides.ts 内所有 cfg 读取改为 `cfgGetter().xxx`——API 形态略变丑，但换来设置即时生效，权衡正确。
- 📌 [nit | evidence: master 上 change 文档 untracked] `openspec/changes/tui-fold-blocks/*` 在整个实现周期处于 untracked 状态（未 commit），worktree 中不存在该目录，归档前需在 master 独立 commit——应在 change 创建时即 commit 以避免双份工作。

---

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| T6 Step 3 (settings.ts) | `openSettings(pi, ...)` → `openSettings(ctx.ui, ...)` | brief 类型错误：ExtensionAPI 无 `ui` 属性，`ui: ExtensionUIContext` 在 `ExtensionCommandContext`（extends ExtensionContext）上 |
| T4 (rerenderAll) | 增加 onModeChange 触发 | brief 代码与测试断言（calls===2）矛盾，onModeChange 是跨块重渲染必需 |
| T6 修复 (3a7f38a) | 增加 settings 实时生效修复（超出 brief 字面） | Task 6 review P1-1：brief 本身的设计缺口（设置保存后 mode 不同步、非 mode 字段读旧闭包），supervisor 决策修复 |
| T5 (buildSingleLine) | 断言 <80 → <90 | brief 内部矛盾：左 60 + 右 24 + 2 padding = 84 > 80，物理不可达 |

---

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓（规划期） |
| superpowers:writing-plans                        | ✓（规划期） |
| superpowers:using-git-worktrees                  | ✓（apply 期隔离工作区） |
| superpowers:subagent-driven-development          | ✓（7 任务逐 Brief 派发 + reviewer 审查） |
| (transitive) superpowers:test-driven-development | ✓（每 Task FAIL→PASS 循环） |
| (transitive) superpowers:requesting-code-review  | ✓（每 Task 独立 reviewer + supervisor 复核） |
| superpowers:finishing-a-development-branch       | 进行中（本 retro 后执行） |

### Deliberately Skipped Skills

（全绿，无跳过）

---

## 5. Surprises

- [evidence: types.d.ts:254] `ExtensionCommandContext extends ExtensionContext` 且 `ui` 属性只在 ctx 上——brief 作者与 worker 最初都假设 `pi.ui` 存在，实际不存在。
- [evidence: T4 冒烟] 覆盖内置工具时，SDK 会对同名工具发出告警而非报错——这使「同名覆盖」策略可行且可被冒烟探测。
- [evidence: tasks.md 22 checkbox] worker 全程在 worktree 中更新 tasks.md，但 change 文档实际位于 master（untracked）——两处 tasks.md 存在内容竞态风险，最终 master 副本 22/22 一致。

---

## 6. Promote candidates → long-term learning

- [ ] 🟡 OpenSpec change 文档在创建后应立即 commit（避免 untracked 期间 worktree/主仓库双份风险）→ **Promote to** CLAUDE.md.fragment（opsx 工作流判读规则）
- [ ] 🟡 覆盖内置工具的扩展应设计「可探测的同名冲突告警」作为注册生效的冒烟信号 → **Promote to** 本仓库 README / 未来扩展模板
- [ ] 📌 brief 中 SDK API 签名应标 `[verify against types.d.ts]` 标记，减少类型错误传播 → **Promote to** superpowers-bridge-cn plan 模板
