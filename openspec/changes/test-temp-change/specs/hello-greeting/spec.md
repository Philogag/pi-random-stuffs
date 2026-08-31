<!--
Delta spec：hello-greeting（临时测试能力）
-->

## ADDED Requirements

### Requirement: hello 函数返回固定格式问候语
系统 SHALL 提供 `hello(name: string): string` 函数，返回以 `Hello, ` 开头、以 `!` 结尾、中间为传入 name 的字符串。

#### Scenario: 传入普通名字
- **WHEN** 调用 `hello("world")`
- **THEN** 返回 `Hello, world!`

#### Scenario: 传入空字符串
- **WHEN** 调用 `hello("")`
- **THEN** 返回 `Hello, !`

#### Scenario: 函数保持纯函数语义
- **WHEN** 以相同参数重复调用 `hello`
- **THEN** 每次返回相同结果，且不产生任何副作用
