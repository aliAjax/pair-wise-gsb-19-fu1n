import type { AppState } from "./types";
import { createSeedState } from "./seed";

const KEY = "hxwl-05-duty-desk:v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.tanks)) {
        return parsed;
      }
    }
  } catch {
    /* 存档损坏时退回演示数据 */
  }
  const seed = createSeedState();
  saveState(seed);
  return seed;
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 存储不可用时仅保留内存状态 */
  }
}

export function resetState(): AppState {
  const seed = createSeedState();
  saveState(seed);
  return seed;
}
