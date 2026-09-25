import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskState } from "./types";
import { STORAGE_KEY } from "./model";
import { buildSeedState } from "./seed";

function loadInitial(): DeskState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DeskState;
      if (parsed && Array.isArray(parsed.tanks) && Array.isArray(parsed.shifts)) {
        return parsed;
      }
    }
  } catch {
    // 落库损坏时回到演示数据
  }
  return buildSeedState();
}

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "err" | "info";
}

export function useDeskStore() {
  const [state, setState] = useState<DeskState>(loadInitial);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时仅当前会话可用
    }
  }, [state]);

  const pushToast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((ts) => [...ts, { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  /** 包一层：成功提示，失败弹错误 */
  const run = useCallback(
    <T>(label: string, fn: () => T): T | undefined => {
      try {
        const result = fn();
        if (label) pushToast(label, "ok");
        return result;
      } catch (err) {
        pushToast(err instanceof Error ? err.message : "操作失败", "err");
        return undefined;
      }
    },
    [pushToast]
  );

  const resetDemo = useCallback(() => {
    setState(buildSeedState());
    pushToast("已恢复演示数据", "info");
  }, [pushToast]);

  return { state, setState, toasts, pushToast, run, resetDemo };
}
