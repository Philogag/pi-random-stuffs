#!/usr/bin/env node
// packages/pi-tui-fold-blocks/scripts/smoke-openspec.mjs
//
// 无头冒烟:openspec 渲染覆盖(方案 A · registerToolRenderer)。
// 用真实 ToolExecutionComponent(pi 的 self-shell 容器)装载 openspecRenderers 产出的渲染器,
// 断言:
//   - fold 折叠态是单行 `openspec - status --change add-x` + 右侧 FAILED(1);
//   - 单击展开 → 展开态每非空行都带折叠态同款背景(48;2; 状态背景)。
//
// 本脚本不 import openspec-bridge,只用 openspec 参数文档化字段构建 stub 原生渲染器(nativeRs)。
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
const { ToolExecutionComponent } = await import(path.join(sdkRoot, "dist/modes/interactive/components/tool-execution.js"));
const { initTheme, theme } = await import(path.join(sdkRoot, "dist/modes/interactive/theme/theme.js"));
initTheme("dark");

const { openspecRenderers } = await import("../dist/openspec.js");
const { DEFAULT_CONFIG } = await import("../dist/config.js");
const { Text } = await import("@earendil-works/pi-tui");

// stub 原生渲染器:模拟 openspec 底层默认渲染(整块标题 + 输出),next() 返回它。
let nativeCallCalled = 0;
const nativeRs = {
  renderShell: "default",
  renderCall: () => { nativeCallCalled++; return new Text("openspec status --change add-x", 0, 0); },
  renderResult: () => new Text("validated ok\n[exit code 0]", 0, 0),
};

const renders = openspecRenderers(() => nativeRs, () => ({ ...DEFAULT_CONFIG, mode: "fold" }));
const def = { renderShell: "self", renderCall: renders.renderCall, renderResult: renders.renderResult, execute: async () => {} };

const ui = { requestRender: () => {}, invalidate: () => {} };
const args = { subcommand: "status", args: [], change: "add-x" };
const comp = new ToolExecutionComponent("openspec", "t1", args, { showImages: false }, def, ui, process.cwd());
comp.updateResult({ content: [{ type: "text", text: "boom\n[exit code 1]" }] }, false);

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const show = (lines) => lines.map(strip).map((l) => l.trimEnd());
const flat = (lines) => show(lines).join("\n");

// 折叠态:单行 + FAILED(1)
const collapsed = comp.render(100);
const collapsedText = flat(collapsed);
console.log(`[collapsed] ${collapsed.length} lines`);
console.log(show(collapsed).map((l) => `  |${l}`).join("\n"));
if (!collapsedText.includes("openspec - status --change add-x")) throw new Error("折叠态缺少 openspec 摘要行");
if (!collapsedText.includes("FAILED(1)")) throw new Error(`折叠态缺少右侧失败状态 FAILED(1): ${JSON.stringify(collapsedText)}`);
if (collapsedText.includes("[exit code 1]")) throw new Error("折叠态泄漏了结果原文");

// 单击展开:非空行都带 48;2; 背景,且包含原生全量输出
const click = { type: "click", button: "left", y: 1, x: 5, width: 100, height: collapsed.length, screenX: 5, screenY: 1 };
const handled = comp.handleMouse(click);
if (!handled?.handled) throw new Error("单击未被处理:MouseRegion/self-shell 链路断开");
if (!comp.expanded) throw new Error("单击后 expanded 未置位");

const expanded = comp.render(100);
console.log(`\n[expanded] ${expanded.length} lines`);
console.log(show(expanded).map((l) => `  |${l}`).join("\n"));
if (expanded.length <= collapsed.length) throw new Error("展开态行数未增加");
for (const raw of expanded) {
  if (raw.trim() !== "" && !raw.includes("\x1b[48;2;")) throw new Error("展开态有行缺少折叠态同款背景: " + JSON.stringify(raw));
}

console.log("\n✓ openspec 折叠单行 + 展开背景一致 冒烟通过");