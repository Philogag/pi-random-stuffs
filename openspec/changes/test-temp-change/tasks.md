## 1. 创建 hello-greeting 包

- [ ] 1.1 创建 `packages/hello-greeting` 包结构（package.json、tsconfig.json，仿照既有包但不引入 pi peer 依赖）
- [ ] 1.2 实现 `src/index.ts`，导出 `hello(name: string): string` 纯函数

## 2. 测试与验证

- [ ] 2.1 编写 `test/index.test.ts`，覆盖 spec 中的三个场景（普通名字 / 空字符串 / 纯函数语义）
- [ ] 2.2 运行 `pnpm --filter @philogag/hello-greeting test`，确认全部通过

## 3. 收尾

- [ ] 3.1 运行根目录 `pnpm test:unit`，确认 monorepo 整体无回归
- [ ] 3.2 确认测试变更完成后可安全删除本包（临时测试定位）
