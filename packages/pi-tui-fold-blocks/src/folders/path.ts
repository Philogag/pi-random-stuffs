import { relative, basename, isAbsolute, sep } from "node:path";

export interface FoldPathOpts {
  cwd: string;
  style: "absolute" | "relative" | "basename";
  foldGitWorktree: boolean;
}

export function foldPath(path: string, opts: FoldPathOpts): string {
  let p = path;
  if (opts.foldGitWorktree) {
    const idx = p.indexOf(`${sep}.git${sep}worktrees${sep}`);
    if (idx !== -1) {
      const wtRoot = p.slice(0, idx);
      const rest = p.slice(idx + (`.git${sep}worktrees${sep}`.length + 1)); // 跳过 <wtName>/ 段
      const restNoName = rest.split(sep).slice(1).join(sep);
      p = wtRoot.endsWith(sep) ? wtRoot + restNoName : `${wtRoot}${sep}${restNoName}`;
    }
  }
  switch (opts.style) {
    case "absolute":
      return isAbsolute(p) ? p : `${opts.cwd}${sep}${p}`;
    case "basename":
      return basename(p);
    case "relative":
    default: {
      const rel = relative(opts.cwd, p);
      return rel && !rel.startsWith("..") ? rel : p;
    }
  }
}