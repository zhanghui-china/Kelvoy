import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ApiResult } from "../api/client";
import { singleFlight } from "./singleFlight";

interface State<T> {
  loading: boolean;
  data: T | null;
  error: string | null;
}

// Shared by the read-only list/detail pages (personas/destinations/episodes):
// fetch on mount (and again whenever `deps` changes), redirect to /login on
// a 401 from requireOwner, otherwise surface ok:false as a plain error
// string. See ADR-0005 — no global auth context, the cookie is httpOnly so
// "am I logged in" can only be answered by trying a request.
export function useApiResource<T>(fetcher: () => Promise<ApiResult<T>>, deps: unknown[]): State<T> {
  const [state, setState] = useState<State<T>>({ loading: true, data: null, error: null });
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    fetcher().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.error === "unauthorized") {
          navigate("/login");
          return;
        }
        setState({ loading: false, data: null, error: result.error ?? "unknown_error" });
        return;
      }
      setState({ loading: false, data: result, error: null });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

// Episode detail page's §8 "2–5 秒轮询": same fetch-and-redirect behavior as
// useApiResource, but re-fetches on an interval instead of once per `deps`
// change. Picked 3000ms — the middle of the PRD's stated 2–5s range, no
// finer requirement given.
const POLL_INTERVAL_MS = 3000;

// 审片台 (#31) 的写操作成功后要立刻看到新状态，不能等下一个 3 秒 tick——
// `refresh()` 就是手动跑一次同一个 tick，轮询本身的行为没变。
export function usePolledApiResource<T>(
  fetcher: () => Promise<ApiResult<T>>,
  deps: unknown[],
  shouldPoll: (data: T) => boolean = () => true,
): State<T> & { refresh: () => void } {
  const [state, setState] = useState<State<T>>({ loading: true, data: null, error: null });
  const navigate = useNavigate();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let active = true;
    const poll = singleFlight(() => fetcherRef.current(), (result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.error === "unauthorized") {
          navigate("/login");
          return;
        }
        if (result.error === "not_found") active = false;
        setState((prev) => ({ loading: false, data: result.error === "not_found" ? null : prev.data, error: result.error ?? "unknown_error" }));
        return;
      }
      active = shouldPoll(result);
      setState({ loading: false, data: result, error: null });
    });

    const pollWhenVisible = () => {
      if (!document.hidden && active) poll.trigger();
    };
    // Even completed works must revalidate when another tab may have deleted them.
    const revalidate = () => { if (!document.hidden) poll.trigger(); };

    setState({ loading: true, data: null, error: null });
    tickRef.current = poll.trigger;
    poll.trigger();
    const id = setInterval(pollWhenVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      cancelled = true;
      poll.stop();
      clearInterval(id);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => tickRef.current(), []);
  return { ...state, refresh };
}
