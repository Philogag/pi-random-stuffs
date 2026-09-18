# Retrospective: fold-presistant-bash-exec

> Written: 2026-09-02 (after verify passed, before PR/merge)
> Commit range: `29f053f..HEAD` (implementation) — docs 基线在 29f053f,变更从 51b22a5 起
> Worktree: `/home/yuhr/workspace/self/pi-random-stuffs/.worktrees/fold-presistant-bash-exec`

---

## 0. Evidence

- **Commit range**: `29f053f..HEAD` = 4 commits(51b22a5、9865e08、de889da、4df1e6d;基线的文档 commit 29f053f 在 master)
- **Diff size**: 实现两 commit(fold-blocks +400/−13 over 7 files;presistant-bash ~+880 over 6 files)+ 修复 commit(+23/−3)+ chores。全部包级验证绿。
- **Tasks done**: 14/15(`grep -cE '^\s*- \[x\]'` → 14;未完成 3.2 为 plan 显式 deferred 项)
- **Active hours**: ~2.5h(规划含两轮澄清 ~1h + apply/审查 ~1.5h,全在同一会话)
- **Subagent dispatches**: 3(worker×2 实现 Task1/Task2 + reviewer×1 全分支审查);修复 de889da 与 verify/retrospective 由 parent 直接完成
- **New external dependencies**: 无新增运行时第三方依赖;presistant-bash 增加对 workspace 包 `@philogag/pi-tui-fold-blocks` 的 optionalDependency(本仓库自产,已 build)
- **Bugs encountered post-merge**: n/a(尚未 merge)
- **OpenSpec validate state at archive**: 待 archive 时确认;change 级 validate 已 pass(4/4 True)
- **Test coverage signal**: fold-blocks 58 vitest、presistant-bash 66 vitest、openspec-status 113 vitest,全绿;typecheck+build 3 包全绿

Commit chain:

```
51b22a5 feat(tui-fold-blocks): export fold render kit + active/config singleton for extension reuse
9865e08 feat(tool-presistant-bash): fold exec block via optional pi-tui-fold-blocks compat
de889da fix(tool-presistant-bash): fallback fold stats exclude exit marker, unknown result conservative error
4df1e6d chore: mark fold-presistant-bash-exec tasks complete (3.2 dogfood deferred)
```

---

## 1. Wins

- [evidence: 51b22a5 + reviewer 逐 scenario 对照] 折叠渲染核心以 `renderOwnedBlock` 泛化后由两包共享,exec 行与 bash 行共用同一 `buildBlockComponent`/三态 bg——「完全同形」不是靠复制而是靠复用达成,零像素级偏差风险(除 design R4 记录的原生观感提示文案)。
- [evidence: 9865e08 fold-compat.ts] details(ExecResult)驱动的成败态把 presistant-bash「从不 throw、ctx.isError 恒 false」的机制坑在渲染层闭环解决(克隆 ctx 补 isError 取红背景),语义精确到 cancelled-with-code 也正确显示无码 FAILED。
- [evidence: de889da] reviewer 发现的回退路径计数/语义不一致在 1 个 commit 内修复并补断言(66/66)。
- [evidence: 全过程] 双 worker 均严格 TDD(自报每 micro-step RED→GREEN),reviewer 无 blocking 发现;交付物与 plan 微步一一对应。
- [evidence: verify §1-§6] 仓库级验证与 openspec validate 全绿;front-door 无泄漏。

## 2. Misses

- 🟡 [painful | evidence: verify §7] 3.2 dogfood(真实 pi TUI 同装两扩展的视觉验证)无法在本环境执行,是真正的覆盖缺口——视觉像素层(背景色实际观感、HStack 布局、折叠/隐藏切换的屏幕行为)没有等价自动化。缓解:着色逻辑与 fold-blocks 既有 bash 行共用同一 theme.bg 键与同源组件,reviewer 逐 scenario 静态对照通过;**follow-up**:首次真实 TUI 使用(或用户在含 fold-blocks 的 pi 会话里跑一次 presistant-bash-exec)后,把观察回填本节(前向指针)。
- 📌 [nit | evidence: fold-compat.ts attach] invalidator Map 无逐行回收(与 fold-blocks mode.ts 同款生命周期,`disposed()` 才清空)——长会话 exec 次数线性增长。接受为现状(单会话 exec 次数有限),follow-up 如需可加 tool_execution_end 剪枝。
- 📌 [nit | evidence: 9865e08] 两 worker 运行均在结束时被宿主标记「Background task failed」,但交付物完整且经 parent 二次实测(commit 存在、测试全绿、tree clean)——疑似子代理收尾阶段的宿主侧误报;复盘建议:不要因 failed 通知怀疑交付,一律以 worktree 实测为准(见 §6 promote)。

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| 1.2 | compat.ts 激活+配置单例一次成型,配置断言首轮出现过约束后回退 | 单文件自然聚合;保持 plan 语义(publishConfig 替换引用) |
| 2.1/2.2 | 无中间 commit,Task2 整包单 commit;纯函数命名 buildExecFoldLine(plan 写 buildExecLine) | SDD 每任务一 commit 纪律;任务文本优先 |
| 2.5 | 「默认路径」测试经 options 注入 loader-stub 而非真实 import 断言 | 单测避免真 import 的副作用,契约等价 |
| Task 3 | 3.2 dogfood 显式 deferred(plan 自带 `[~]`);verify §7 判读为真正 gap | 无头环境无法启动交互式 pi TUI |
| Task 3 追加 | reviewer 判定后补 de889da 修复 commit(原 plan 无) | 采纳 reviewer f.1 非阻塞发现,一致性收益高于保留现状 |

## 4. Skill / workflow compliance

| Skill | Used |
|-------|------|
| superpowers:brainstorming | ✓(brainstorm.md 决策日志;两轮 ask_user_question 澄清) |
| superpowers:writing-plans | ✓(plan.md 微步 + 提交点 + 前置检查;plan 头含 change/design-doc/base-ref) |
| superpowers:using-git-worktrees | ✓(.worktrees/fold-presistant-bash-exec,分支 feat/fold-presistant-bash-exec) |
| superpowers:subagent-driven-development | ✓(每任务 fresh worker + 全分支 reviewer;3 dispatches) |
| (transitive) superpowers:test-driven-development | ✓(两 worker 逐微步 RED→GREEN;全部断言先于实现) |
| (transitive) superpowers:requesting-code-review | ⚠️ 部分——reviewer 只做了一次**全分支**审查,未严格做到「每任务后」review;Task1 由 parent 事后微审查替代(结论无差异) |
| superpowers:finishing-a-development-branch | 下一步执行 |

### Deliberately Skipped Skills

**requesting-code-review(每任务粒度 → 合并为全分支单次)**
- **What was skipped**:计划为 Task1/Task2 各派一次 task-reviewer,实际合并为对 `29f053f..HEAD` 的一次全分支审查(Task1 由 parent 直接读 diff 微审查)。
- **Why this cycle**:两个任务强耦合(exec 行必须消费 Task1 的导出面),Task1 完成后 Task2 立即消费,分两次审需在 Task1 提交时点中断流程;而全分支审查天然覆盖两任务的接口契约与 spec 场景的完整链条。触发条件具体为:依赖链(exec 装配 → fold-blocks 库面)使 task 边界处审查价值低、跨任务审查价值高。
- **How to prevent recurrence**:对「后任务直接消费前任务导出面」的强耦合序列,SDD 可允许合并 task review(在依赖图中标注),或 reviewer 的 task-review 粒度改为按「导出面消费者」而非按 commit 切分。若后续多个 cycle 同样跳过,建议把该规则写进 schema apply 指令的 task-review 粒度说明。

## 5. Surprises

- [evidence: 两 worker 运行] 子代理在交付完整后仍被宿主报「Background task failed」——收尾信号不可靠,证据以 worktree 实测为准(未被证明错误的假设:failed 通知 ≈ 交付失败)。
- [evidence: reviewer 实证] pi 对扩展入口用 jiti `moduleCache:false`,但扩展内部对 `@philogag/pi-tui-fold-blocks` 的 dynamic import 走 Node 真实 ESM resolver——两处解析到同一文件 URL,单实例假设在正常安装形态下成立(design R5 的担忧未在代码层面触发,兜底未实现亦无碍)。
- [evidence: 9865e08 测试] presistant-bash 结果槽在 native 模式对非零退出码仍显示绿(pi 默认按 isError 而非 exitCode 着色,exec 从不置 isError)——「原生模式显示非零退出码」反而是对 pi 默认行为的忠实复刻,最初以为是偏差。

## 6. Promote candidates → long-term learning

- [ ] 🟡 子代理「Background task failed」通知与交付物状态解耦——验证一律以 worktree 实测为准
  - → **Promote to** memory
  - > **Why**:本 cycle 两 worker + 一 reviewer 均报 failed 而交付完整;信任失败通知会造成重复派发/重复验证的浪费。
  - > **How to apply**:任何后台子代理报 failed 时,先跑 `git log`/`git status`/目标测试命令复核交付,再决定修复或重派;只有实测失败才算失败。
- [ ] 🟡 TUI 视觉类改动必须有 dogfood 或明确的前向指针计划,不能只靠组件级单测
  - → **Promote to** schema(本 schema verify §7 已有框架;补「视觉/交互层默认列入 §7 真正 gap 并要求 retrospective follow-up」)
  - > **Why**:exec 折叠的着色/布局实际观感无法在无头环境断言,verify §7 判读为真正 gap;若无 follow-up 机制会静默丢失。
  - > **How to apply**:规划期对含 TUI 视觉的 change 预置 `[~]` dogfood 项,verify 逐项映射,retrospective 给 follow-up;条件允许时跑 headed dogfood。
- [ ] 📌 强耦合任务的 SDD review 粒度可合并(见 §4 skip 分析)
  - → **Promote to** schema(apply 指令的 task-review 粒度说明)
  - > **Why**:依赖链使逐任务 review 价值低、跨任务 review 价值高,本 cycle 合并后无质量损失。
  - > **How to apply**:reviewer 任务文本按「导出面/接口消费者链」组织;合并时在 ledger 记录 Ruling。

## 前向指针(本文件写出后事实变化时追加,不重写)

> 尚未发生。待 3.2 dogfood 在真实 pi TUI 执行后,回填 §2 的视觉验证结果与此处。
