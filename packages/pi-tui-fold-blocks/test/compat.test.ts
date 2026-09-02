import { describe, it, expect } from "vitest";
import {
  getFoldConfig,
  isFoldBlocksActive,
  markFoldBlocksActive,
  publishConfig,
  subscribeFoldBlocksActive,
  subscribeFoldConfig,
} from "../src/compat.js";
import { DEFAULT_CONFIG, type FoldBlocksConfig } from "../src/config.js";

describe("fold-blocks activation singleton", () => {
  it("初始未激活", () => {
    expect(isFoldBlocksActive()).toBe(false);
  });

  it("未激活时订阅不回调;markFoldBlocksActive 后收到且仅一次", () => {
    const calls: number[] = [];
    subscribeFoldBlocksActive(() => {
      calls.push(1);
    });
    expect(calls).toHaveLength(0);
    markFoldBlocksActive();
    expect(calls).toHaveLength(1);
    markFoldBlocksActive(); // 幂等:重复激活不重复回调
    expect(calls).toHaveLength(1);
  });

  it("已激活后再订阅 → 立即同步回调,unsub 生效(再 mark 不重复回调)", () => {
    markFoldBlocksActive();
    expect(isFoldBlocksActive()).toBe(true);
    let calls = 0;
    const unsub = subscribeFoldBlocksActive(() => {
      calls++;
    });
    expect(calls).toBe(1);
    unsub();
    markFoldBlocksActive();
    expect(calls).toBe(1);
  });
});

describe("fold-blocks current-config singleton", () => {
  it("初始等于 DEFAULT_CONFIG 字段但不共享对象引用(独立拷贝)", () => {
    const cfg = getFoldConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg).not.toBe(DEFAULT_CONFIG);
    expect(cfg.fileBlocks).not.toBe(DEFAULT_CONFIG.fileBlocks);
    expect(cfg.bashBlocks).not.toBe(DEFAULT_CONFIG.bashBlocks);
  });

  it("publishConfig 后 getFoldConfig 返回 next", () => {
    const next: FoldBlocksConfig = {
      ...DEFAULT_CONFIG,
      mode: "hide",
      fileBlocks: { ...DEFAULT_CONFIG.fileBlocks },
      bashBlocks: { ...DEFAULT_CONFIG.bashBlocks },
    };
    publishConfig(next);
    expect(getFoldConfig()).toBe(next);
    expect(getFoldConfig().mode).toBe("hide");
  });

  it("subscribeFoldConfig 在 publish 时收到通知;unsub 后不再收到", () => {
    const seen: string[] = [];
    const unsub = subscribeFoldConfig((cfg) => {
      seen.push(cfg.mode);
    });
    const nativeCfg: FoldBlocksConfig = {
      ...DEFAULT_CONFIG,
      mode: "native",
      fileBlocks: { ...DEFAULT_CONFIG.fileBlocks },
      bashBlocks: { ...DEFAULT_CONFIG.bashBlocks },
    };
    publishConfig(nativeCfg);
    publishConfig({
      ...DEFAULT_CONFIG,
      mode: "fold",
      fileBlocks: { ...DEFAULT_CONFIG.fileBlocks },
      bashBlocks: { ...DEFAULT_CONFIG.bashBlocks },
    });
    expect(seen).toEqual(["native", "fold"]);
    unsub();
    publishConfig(nativeCfg);
    expect(seen).toEqual(["native", "fold"]);
  });
});
