// packages/pi-tui-fold-blocks/src/mode.ts
import type { Mode } from "./config.js";

export interface ModeState {
  mode: Mode;
  setMode(m: Mode): void;
  addInvalidator(toolCallId: string, inv: () => void): void;
  removeInvalidator(toolCallId: string): void;
  rerenderAll(): void;
}

export function createModeState(initial: Mode, onModeChange: () => void): ModeState {
  let mode: Mode = initial;
  const invalidators = new Map<string, () => void>();
  return {
    get mode() { return mode; },
    setMode(m: Mode) { mode = m; onModeChange(); invalidators.forEach((inv) => inv()); },
    addInvalidator(id, inv) { invalidators.set(id, inv); },
    removeInvalidator(id) { invalidators.delete(id); },
    rerenderAll() { onModeChange(); invalidators.forEach((inv) => inv()); },
  };
}