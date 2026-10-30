#!/usr/bin/env node
// packages/pi-tui-fold-blocks/scripts/smoke-click.mjs
//
// 无头点击冒烟:用真实 ToolExecutionComponent(pi 的 self-shell 容器)装载被 override 的
// read 工具定义,渲染 → 模拟左键单击 → 再渲染,断言折叠态是单行块、展开态是原生视图。
//
// 为什么要它:折叠块"不响应点击"的常见原因不在渲染代码,而在 dist 构建过期或 pi 加载的是
// 已安装的旧版本(pi 从 ~/.pi/agent/npm 读包)。本脚本验证的是"真 SDK 容器 + 本包 dist"
// 这条完整链路。用法:`pnpm smoke`。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";

// pi-coding-agent 的 exports 指向 dist/index.js;内部组件未公开导出,按相邻路径解析。
// 用 import.meta.resolve(而非 createRequire):该包 exports 只声明了 "import" 条件。
const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
const { ToolExecutionComponent } = await import(
  path.join(sdkRoot, "dist/modes/interactive/components/tool-execution.js")
);
const { initTheme, theme } = await import(
  path.join(sdkRoot, "dist/modes/interactive/theme/theme.js")
);
initTheme("dark");

const { overrideTool } = await import("../dist/overrides.js");
const { DEFAULT_CONFIG } = await import("../dist/config.js");

const cwd = process.cwd();
let def;
overrideTool(
  { registerTool: (d) => { def = d; } },
  "read",
  cwd,
  () => createReadToolDefinition(cwd),
  () => ({ ...DEFAULT_CONFIG, mode: "fold" }),
);

const ui = { requestRender: () => {}, invalidate: () => {} };
const args = { path: "src/main.ts", offset: 1, limit: 5 };
const comp = new ToolExecutionComponent("read", "t1", args, { showImages: false }, def, ui, cwd);
comp.updateResult({ content: [{ type: "text", text: "l1\nl2\nl3\nl4\nl5" }] }, false);

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const show = (lines) => lines.map(strip).map((l) => l.trimEnd());

const collapsed = comp.render(60);
const collapsedText = show(collapsed).join("\n");
console.log(`[collapsed] ${collapsed.length} lines`);
console.log(show(collapsed).map((l) => `  |${l}`).join("\n"));
if (!collapsedText.includes("read - src/main.ts")) throw new Error("折叠态缺少摘要行");
if (collapsedText.includes("l3")) throw new Error("折叠态泄漏了结果原文");

const click = { type: "click", button: "left", y: 1, x: 5, width: 60, height: collapsed.length, screenX: 5, screenY: 1 };
const result = comp.handleMouse(click);
console.log(`\n[click] handled=${!!result?.handled} expanded=${comp.expanded}`);
if (!result?.handled) throw new Error("单击未被处理:MouseRegion/self-shell 链路断开");
if (!comp.expanded) throw new Error("单击后 expanded 未置位");

const expanded = comp.render(60);
const expandedText = show(expanded).join("\n");
console.log(`\n[expanded] ${expanded.length} lines`);
console.log(show(expanded).map((l) => `  |${l}`).join("\n"));
if (expanded.length <= collapsed.length) throw new Error("展开态行数未增加");
for (const l of ["l1", "l3", "l5"]) {
  if (!expandedText.includes(l)) throw new Error(`展开态缺少结果行 ${l}`);
}
// 展开态与折叠态同背景:非空行必须都带成功绿背景(只允许 SDK 的前导空行无 bg)
for (const raw of expanded) {
  if (raw.trim() !== "" && !raw.includes("\x1b[48;2;")) throw new Error("展开态有行缺少折叠态同款背景: " + JSON.stringify(raw));
}

// 再单击收回
comp.handleMouse(click);
console.log(`\n[collapse again] expanded=${comp.expanded} lines=${comp.render(60).length}`);
if (comp.expanded) throw new Error("再次单击未能收起");

console.log("\n✓ 点击展开/收起链路正常");
