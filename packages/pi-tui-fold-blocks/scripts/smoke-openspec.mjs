#!/usr/bin/env node
// packages/pi-tui-fold-blocks/scripts/smoke-openspec.mjs
//
// 无头冒烟:openspec 渲染覆盖(方案 A · registerToolRenderer)。
// 用真实 ToolExecutionComponent(pi 的 self-shell 容器)装载 openspecRenderers 产出的渲染器,
// 断言(两个场景各跑一遍):
//   场景 A · 第三方提供原生渲染器:折叠态单行 + 单击展开 → 委托原生(call 头 + 全量输出);
//   场景 B · real bridge 形态(next() 返回的命令定义完全不带 renderCall/renderResult):
//     折叠态单行;单击展开 → 不再是空行,而是自绘单盒,形态对齐 pi 原生 fallback:
//     标题 `openspec` + 逐行 `  key: value`(即 formatToolCallWithArgs 的展开版),
//     后接结果全量原文(不截断、不只看前 10 行)。
//   两场景共同断言:展开态每非空行都带折叠态同款背景(48;2;/48;5; 状态背景)。
//
// 本脚本不 import openspec-bridge,只用 openspec 参数文档化字段构建 stub 原生渲染器(nativeRs)。
// 背景 SGR 同时接受 truecolor(48;2;)与 256 色(48;5;)——具体格式由当前终端能力/主题决定。
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
const { ToolExecutionComponent } = await import(path.join(sdkRoot, "dist/modes/interactive/components/tool-execution.js"));
const { initTheme, theme } = await import(path.join(sdkRoot, "dist/modes/interactive/theme/theme.js"));
initTheme("dark");

const { openspecRenderers } = await import("../dist/openspec.js");
const { DEFAULT_CONFIG } = await import("../dist/config.js");
const { Text } = await import("@earendil-works/pi-tui");

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const show = (lines) => lines.map(strip).map((l) => l.trimEnd());
const flat = (lines) => show(lines).join("\n");
const hasBg = (raw) => /\x1b\[48;[25];/.test(raw);

const ui = { requestRender: () => {}, invalidate: () => {} };
const args = { subcommand: "status", args: [], change: "add-x" };
const RESULT = { content: [{ type: "text", text: "boom\nsecond line\n[exit code 1]" }] };

/** 用真实 ToolExecutionComponent 装一次渲染器,跑「折叠 → 单击展开」。 */
function runScenario(label, nextRs) {
  const renders = openspecRenderers(nextRs, () => ({ ...DEFAULT_CONFIG, mode: "fold" }));
  const def = { renderShell: "self", renderCall: renders.renderCall, renderResult: renders.renderResult, execute: async () => {} };
  const comp = new ToolExecutionComponent("openspec", label, args, { showImages: false }, def, ui, process.cwd());
  comp.updateResult(RESULT, false);

  const collapsed = comp.render(100);
  const collapsedText = flat(collapsed);
  console.log(`\n[${label} · collapsed] ${collapsed.length} lines`);
  console.log(show(collapsed).map((l) => `  |${l}`).join("\n"));
  if (!collapsedText.includes("openspec - status --change add-x")) throw new Error(`[${label}] 折叠态缺少 openspec 摘要行`);
  if (!collapsedText.includes("FAILED(1)")) throw new Error(`[${label}] 折叠态缺少右侧失败状态 FAILED(1): ${JSON.stringify(collapsedText)}`);
  if (collapsedText.includes("[exit code 1]")) throw new Error(`[${label}] 折叠态泄漏了结果原文`);

  const click = { type: "click", button: "left", y: 1, x: 5, width: 100, height: collapsed.length, screenX: 5, screenY: 1 };
  const handled = comp.handleMouse(click);
  if (!handled?.handled) throw new Error(`[${label}] 单击未被处理:MouseRegion/self-shell 链路断开`);
  if (!comp.expanded) throw new Error(`[${label}] 单击后 expanded 未置位`);

  const expanded = comp.render(100);
  const expandedText = flat(expanded);
  console.log(`\n[${label} · expanded] ${expanded.length} lines`);
  console.log(show(expanded).map((l) => `  |${l}`).join("\n"));
  if (expanded.length <= collapsed.length) throw new Error(`[${label}] 展开态行数未增加`);
  for (const raw of expanded) {
    if (raw.trim() !== "" && !hasBg(raw)) throw new Error(`[${label}] 展开态有行缺少折叠态同款背景(空行 bug 回归): ` + JSON.stringify(raw));
  }
  return { collapsed, expanded, expandedText };
}

// 场景 A:第三方(或未来 SDK)为 openspec 提供原生渲染器 → 展开态委托原生。
const nativeRs = {
  renderShell: "default",
  renderCall: () => new Text("openspec status --change add-x", 0, 0),
  renderResult: () => new Text("validated ok\n[exit code 0]", 0, 0),
};
const a = runScenario("native", () => nativeRs);
if (!a.expandedText.includes("validated ok")) throw new Error("[native] 展开态缺少原生输出(委托失效)");

// 场景 B:real bridge 形态 —— 只 registerTool,不带任何渲染器。
// 修复前这里委托原生 → 空组件 → 展开后只剩一条空行(本 bug)。
const b = runScenario("bare", () => ({ execute: async () => {} }));
// 展开态 = 原生观感标题(工具名 + 参数逐行),不是折叠摘要行
if (!b.expandedText.includes("openspec")) throw new Error("[bare] 展开态缺少原生标题 openspec");
if (!b.expandedText.includes("subcommand: status")) throw new Error(`[bare] 展开态缺少参数行: ${JSON.stringify(b.expandedText)}`);
if (b.expandedText.includes("openspec - status")) throw new Error("[bare] 展开态仍显示了折叠摘要行(应只展示原生展开形态)");
if (!b.expandedText.includes("second line")) throw new Error(`[bare] 展开态缺少结果原文: ${JSON.stringify(b.expandedText)}`);

console.log("\n✓ openspec 折叠单行 + 展开(原生委托 / 无原生兜底)+ 背景一致 冒烟通过");
