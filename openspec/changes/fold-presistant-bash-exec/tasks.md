## 1. fold-blocks:对外兼容导出面(库面,默认导出不变)

- [ ] 1.1 新增 `src/compat.ts`:模块级激活单例——`isFoldBlocksActive()`、`subscribeFoldBlocksActive(cb)`(已激活立即同步调用并返回 no-op)、`markFoldBlocksActive()`
- [ ] 1.2 `src/compat.ts`:模块级当前配置单例——`getFoldConfig()`、`publishConfig(next)`、`subscribeFoldConfig(cb)`
- [ ] 1.3 `src/render.ts`:泛化出 `renderOwnedBlock(ctx, opts, lineBuilder)`(hide 空行 / isPartial 槽归属 / buildBlockComponent + 三态 bg),既有 `renderBlock` 改为委托、行为不变
- [ ] 1.4 `src/index.ts`:工厂首行 `markFoldBlocksActive()`;config 各变更点统一走 `publishConfig`;命名导出 compat 面(激活/配置/渲染件与既有类型、foldCommand/contentLineCount)
- [ ] 1.5 单测:`test/compat.test.ts`(激活订阅时序、配置通知)+ `test/render.test.ts` 补 `renderOwnedBlock` 委托/隐藏/归属断言
- [ ] 1.6 README 增补「库面(供其他扩展复用)」说明

## 2. presistant-bash:exec 可选折叠装配(无 fold-blocks 零变化)

- [ ] 2.1 `package.json` 增 optionalDependencies `@philogag/pi-tui-fold-blocks: workspace:*`(并作为 devDependency 保证类型可见);更新 lockfile
- [ ] 2.2 `src/fold-compat.ts` 纯函数:`timeoutMs→显示秒`、`details.output→行数`(不含 doneText 标记行)、成败/退出码判定(exitCode/cancelled)→ `LineContext`(与 bash 同形 icon/tool/shown/tips/result)
- [ ] 2.3 `src/fold-compat.ts` 渲染分派:`renderCall`/`renderResult` 按 fold/hide/native 三态(fold 复用 fold-blocks 渲染件;native 复刻 pi 默认观感——工具名标题 + 输出前 10 行/expanded 全量)
- [ ] 2.4 `src/fold-compat.ts` 装配:`attachExecFoldCompat(pi, registry, tools)`——动态 import fold-blocks(失败静默返回)、激活订阅后二次 `registerTool`(execute 不变)、登记 exec 行 invalidators 并订阅折叠配置变更即时刷新
- [ ] 2.5 `src/index.ts` 接线:`options` 增加注入点(loader/attach 便于测试),工厂注册工具后调用装配
- [ ] 2.6 单测:`test/fold-compat.test.ts`(行文本/fold/native/hide/FAILED(N)/cancelled 断言 + 注入 fake compat 的装配时序)
- [ ] 2.7 README 增补兼容矩阵(独立安装行为不变;同装时 exec 折叠行为)

## 3. 验证与发布准备

- [ ] 3.1 两包 `build`/`typecheck`/`test` 全绿;`openspec validate fold-presistant-bash-exec` 通过;spec/design 抽查一致
- [ ] 3.2 `[~]` dogfood 冒烟(延迟项):.pi/settings 同装两扩展,验证 exec 折叠行形态/三态切换即时生效/非零退出码红态与 FAILED(N)/未激活回退 —— 等价自动化断言见 verify §7
