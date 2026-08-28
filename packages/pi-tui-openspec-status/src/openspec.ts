// src/openspec.ts
import { spawn } from "node:child_process";
import type { StatusJson } from "./types.js";

export const OPENSPEC_STATUS_TIMEOUT_MS = 2000;

export async function runOpenspecStatus(
  changeName: string,
  cwd: string,
): Promise<StatusJson | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: StatusJson | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    let stdout = "";
    let stderr = "";
    let proc: ReturnType<typeof spawn> | null = null;
    try {
      proc = spawn(
        "openspec",
        ["status", "--change", changeName, "--json"],
        { cwd: cwd || process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      proc?.kill();
      finish(null);
    }, OPENSPEC_STATUS_TIMEOUT_MS);

    proc.stdout?.on("data", (b) => (stdout += b.toString("utf8")));
    proc.stderr?.on("data", (b) => (stderr += b.toString("utf8")));

    proc.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as StatusJson;
        finish(parsed);
      } catch {
        finish(null);
      }
    });
  });
}