import { describe, it, expect } from "vitest";
import { foldPath } from "../src/folders/path.js";
import { foldCommand } from "../src/folders/command.js";

describe("foldPath", () => {
  const cwd = "/home/user/proj";
  it("relative 样式返回相对 cwd 的短路径", () => {
    expect(foldPath("/home/user/proj/src/main.ts", { cwd, style: "relative", foldGitWorktree: false })).toBe("src/main.ts");
  });
  it("absolute 样式原样返回", () => {
    expect(foldPath("/home/user/proj/src/main.ts", { cwd, style: "absolute", foldGitWorktree: false })).toBe("/home/user/proj/src/main.ts");
  });
  it("basename 样式仅返回文件名", () => {
    expect(foldPath("/home/user/proj/src/main.ts", { cwd, style: "basename", foldGitWorktree: false })).toBe("main.ts");
  });
  it("git worktree 折叠裁掉 worktree 前缀", () => {
    const wt = "/home/user/proj/.git/worktrees/feature";
    expect(foldPath(`${wt}/src/a.ts`, { cwd, style: "relative", foldGitWorktree: true })).toBe("src/a.ts");
  });
});

describe("foldCommand", () => {
  it("剥离 cd X && 包装前缀", () => {
    expect(foldCommand("cd build && npm test", { smart: true })).toBe("npm test");
  });
  it("剥离 export 前缀", () => {
    expect(foldCommand("export FOO=1 && node run.js", { smart: true })).toBe("node run.js");
  });
  it("smart 关闭时仅取首 token", () => {
    expect(foldCommand("cd build && npm test", { smart: false })).toBe("cd");
  });
  it("无包装时返回整命令", () => {
    expect(foldCommand("npm test", { smart: true })).toBe("npm test");
  });
  it("多行命令折叠为单行", () => {
    expect(foldCommand("cd build && \\\nnpm test", { smart: true })).toBe("npm test");
    expect(foldCommand("ls -l && \\\n  echo hi", { smart: true })).toBe("ls -l && echo hi");
  });
  it("反斜杠续行合并为空格;其余换行用 ⏎ 分隔并吞掉缩进", () => {
    expect(foldCommand("cd /tmp && \\\n  npm test", { smart: true })).toBe("npm test");
    expect(foldCommand("for f in *; do \\\n  echo $f \\\n  done", { smart: true })).toBe("for f in *; do echo $f done");
    expect(foldCommand("echo a\nb", { smart: false })).toBe("echo");
  });
  it("未以反斜杠结尾的换行用 ⏎ 分隔", () => {
    expect(foldCommand("git status\n", { smart: true })).toBe("git status");
    expect(foldCommand("ls\nls -l", { smart: true })).toBe("ls ⏎ ls -l");
  });
});
