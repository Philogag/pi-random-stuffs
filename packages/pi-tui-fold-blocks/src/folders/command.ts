export interface FoldCommandOpts {
  smart: boolean;
}

const WRAP_PREFIX = /^(?:cd\s+\S+\s*&&|source\s+\S+\s*&&|export\s+[^=]+=\S*\s*&&)\s*/;

export function foldCommand(command: string, opts: FoldCommandOpts): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (opts.smart) {
    // 先把多行命令折叠为单行(保证折叠块只渲染一行),再剥包装前缀:
    //   - 反斜杠续行(换行前一个反斜杠)按 shell 语义整体移除(\ + 换行 + 后续缩进),
    //     如 "cd build && \\" 接换行 → "cd build && npm test";
    //   - 其余换行以 " ⏎ " 分隔并吞掉下一行缩进,如 for 循环保持可读的单行概要。
    let cur = trimmed.replace(/\\\r?\n\s*/g, "").replace(/\r?\n\s*/g, " ⏎ ");
    let next = cur.replace(WRAP_PREFIX, "");
    while (next !== cur) { cur = next; next = cur.replace(WRAP_PREFIX, ""); }
    return cur;
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}