import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export interface ShotNavigation {
  currentNo: number | null;
  /** 定位到某一镜：滚动到它并把它标成当前镜。 */
  focusShot: (no: number) => void;
  /** 每一镜的容器 ref callback，用于滚动定位。 */
  registerShot: (no: number, el: HTMLElement | null) => void;
}

const PREV_KEYS = new Set(["k", "K", "ArrowLeft"]);
const NEXT_KEYS = new Set(["j", "J", "ArrowRight"]);

/**
 * 审核 2/3 的"一镜决策 ≤ 10 秒"（FR-05 验收）：J/K 或 ←/→ 在镜之间跳，
 * 待审队列点击也走同一个定位逻辑。输入框里按键不拦截（否则打不了字）。
 */
export function useShotNavigation(shotNos: number[]): ShotNavigation {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = Number(searchParams.get("shot"));
  const urlShot = searchParams.has("shot") && shotNos.includes(selected) ? selected : null;
  const [currentNo, setCurrentNo] = useState<number | null>(urlShot);

  // 轮询每 3 秒换一个新数组，直接进 effect 依赖会让键盘监听反复解绑重绑。
  const shotNosRef = useRef(shotNos);
  shotNosRef.current = shotNos;
  const currentNoRef = useRef<number | null>(null);
  currentNoRef.current = currentNo;
  const elements = useRef(new Map<number, HTMLElement | null>());

  const registerShot = useCallback((no: number, el: HTMLElement | null) => {
    elements.current.set(no, el);
  }, []);

  const focusShot = useCallback((no: number) => {
    setCurrentNo(no);
    const next = new URLSearchParams(searchParams);
    next.set("shot", String(no));
    setSearchParams(next);
    elements.current.get(no)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setCurrentNo(urlShot);
    if (urlShot !== null) elements.current.get(urlShot)?.scrollIntoView({ block: "center" });
  }, [urlShot]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      const delta = NEXT_KEYS.has(event.key) ? 1 : PREV_KEYS.has(event.key) ? -1 : 0;
      if (delta === 0) return;

      const list = shotNosRef.current;
      if (list.length === 0) return;
      const index = currentNoRef.current === null ? -1 : list.indexOf(currentNoRef.current);
      const nextIndex = Math.min(list.length - 1, Math.max(0, index + delta));
      event.preventDefault();
      focusShot(list[nextIndex]);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusShot]);

  return { currentNo, focusShot, registerShot };
}
