export interface FoldCommandOpts {
  smart: boolean;
}

const WRAP_PREFIX = /^(?:cd\s+\S+\s*&&|source\s+\S+\s*&&|export\s+[^=]+=\S*\s*&&)\s*/;

export function foldCommand(command: string, opts: FoldCommandOpts): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (opts.smart) {
    let cur = trimmed;
    let next = cur.replace(WRAP_PREFIX, "");
    while (next !== cur) { cur = next; next = cur.replace(WRAP_PREFIX, ""); }
    return cur;
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}