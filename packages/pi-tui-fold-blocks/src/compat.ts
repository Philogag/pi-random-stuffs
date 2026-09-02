// packages/pi-tui-fold-blocks/src/compat.ts
//
// 面向其他扩展(如 pi-tool-presistant-bash)的库面:激活门控 + 实时配置访问。
// 默认导出工厂执行时经 markFoldBlocksActive() 置 active;订阅方据此挂载折叠渲染。
// 模块级单例:同进程内多处 import 解析到同一文件(Node ESM 缓存),状态互相可见。
import { DEFAULT_CONFIG, type FoldBlocksConfig } from "./config.js";

// ---- 激活单例 ---------------------------------------------------------------

let active = false;
const activationWaiters = new Set<() => void>();

/** 标记 fold-blocks 已作为扩展激活。幂等:仅首次激活会唤醒等待者。 */
export function markFoldBlocksActive(): void {
  if (active) return;
  active = true;
  const waiters = [...activationWaiters];
  activationWaiters.clear();
  for (const cb of waiters) cb();
}

export function isFoldBlocksActive(): boolean {
  return active;
}

/** 订阅激活事件。已激活 → 立即同步回调并返回 no-op;否则注册,激活时回调一次。 */
export function subscribeFoldBlocksActive(cb: () => void): () => void {
  if (active) {
    cb();
    return () => {};
  }
  activationWaiters.add(cb);
  return () => {
    activationWaiters.delete(cb);
  };
}

// ---- 当前配置单例 -----------------------------------------------------------

function cloneDefaultConfig(): FoldBlocksConfig {
  return {
    ...DEFAULT_CONFIG,
    fileBlocks: { ...DEFAULT_CONFIG.fileBlocks },
    bashBlocks: { ...DEFAULT_CONFIG.bashBlocks },
  };
}

let currentConfig: FoldBlocksConfig = cloneDefaultConfig();
const configListeners = new Set<(cfg: FoldBlocksConfig) => void>();

/** 当前生效配置(未激活/未发布时为 DEFAULT_CONFIG 的独立深拷贝)。 */
export function getFoldConfig(): FoldBlocksConfig {
  return currentConfig;
}

/** 更新当前配置并通知所有订阅者(调用方负责先持久化,即 persist-then-notify)。 */
export function publishConfig(next: FoldBlocksConfig): void {
  currentConfig = next;
  for (const cb of [...configListeners]) cb(next);
}

/** 订阅配置变更。返回 unsubscribe。 */
export function subscribeFoldConfig(cb: (cfg: FoldBlocksConfig) => void): () => void {
  configListeners.add(cb);
  return () => {
    configListeners.delete(cb);
  };
}
