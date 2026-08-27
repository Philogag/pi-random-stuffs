// packages/pi-tui-fold-blocks/src/render.ts
// Task 4: 占位实现,导出 RenderBlockOpts 接口与 renderBlock 符号,让 overrides.ts 可编译。
// Task 5 补全:fold 单行布局 + 状态背景色 + buildFoldLine + contentRows/contentExitCode。

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FoldBlocksConfig } from "./config.js";
import type { ModeState } from "./mode.js";

export interface RenderBlockOpts {
  toolName: string;
  kind: "file" | "bash";
  args: unknown;
  result: unknown;
  isPartial: boolean;
  isError: boolean;
  expanded: boolean;
  config: FoldBlocksConfig;
  cwd: string;
  modeState: ModeState;
  theme: Theme;
  lastComponent: unknown;
  toolCallId: string;
}

/** Task 4 占位:返回空 Text(0 行)。Task 5 替换为 setCustomBgFn 自绘背景的单行折叠行。 */
export function renderBlock(_opts: RenderBlockOpts): Text {
  void _opts; // Task 5 消费
  return new Text("", 0, 0);
}