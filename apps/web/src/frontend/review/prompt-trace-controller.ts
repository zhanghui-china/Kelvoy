import type { PromptTraceItem, PromptTraceLegacy, PromptTracesResponse } from "../../shared/prompt-traces";
import type { ApiResult } from "../api/client";

/**
 * State machine behind the review desk's "prompts sent to the model" disclosure
 * (ADR-0012). Framework-free so concurrency rules are unit-testable; the React
 * wrapper is usePromptTraces.ts.
 *
 * Rules: nothing is requested until load() (first expansion); responses are
 * matched to a monotonically increasing request number and anything older than
 * the latest request is dropped; every new request aborts the previous one;
 * collapsing keeps data; a refresh-key change refetches only while expanded and
 * otherwise marks the data stale so the next expansion refetches.
 */
export type PromptTraceState =
  | { status: "idle" }
  | { status: "loading" }
  | {
    status: "ready";
    items: PromptTraceItem[];
    nextBefore: string | null;
    legacy: PromptTraceLegacy | null;
    loadingMore: boolean;
    moreFailed: boolean;
  }
  | { status: "empty"; legacy: PromptTraceLegacy | null }
  | { status: "error" };

export type FetchPromptPage = (
  before: string | undefined,
  signal: AbortSignal,
) => Promise<ApiResult<PromptTracesResponse>>;

export function createPromptTraceController({ fetchPage }: { fetchPage: FetchPromptPage }) {
  let state: PromptTraceState = { status: "idle" };
  let open = false;
  let stale = false;
  let key: string | number | null | undefined;
  let seq = 0;
  let inflight: AbortController | null = null;
  const listeners = new Set<() => void>();

  function set(next: PromptTraceState) {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function begin() {
    inflight?.abort();
    inflight = new AbortController();
    seq += 1;
    return { id: seq, signal: inflight.signal };
  }

  function fetchFirstPage() {
    stale = false;
    const { id, signal } = begin();
    set({ status: "loading" });
    void fetchPage(undefined, signal).then((result) => {
      if (id !== seq) return;
      inflight = null;
      if (!result.ok) { set({ status: "error" }); return; }
      if (result.items.length === 0) { set({ status: "empty", legacy: result.legacy ?? null }); return; }
      set({
        status: "ready", items: result.items, nextBefore: result.next_before ?? null,
        legacy: result.legacy ?? null, loadingMore: false, moreFailed: false,
      });
    });
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Called when the disclosure opens. Fetches only if nothing is loaded or data is stale. */
    load() {
      open = true;
      if (state.status === "loading") return;
      if (state.status === "idle" || stale) fetchFirstPage();
    },
    close() { open = false; },
    retry() {
      if (state.status === "error") fetchFirstPage();
    },
    loadMore() {
      if (state.status !== "ready" || state.loadingMore || state.nextBefore === null) return;
      const current = state;
      const before = current.nextBefore!;
      const { id, signal } = begin();
      set({ ...current, loadingMore: true, moreFailed: false });
      void fetchPage(before, signal).then((result) => {
        if (id !== seq) return;
        inflight = null;
        if (!result.ok) { set({ ...current, loadingMore: false, moreFailed: true }); return; }
        const seen = new Set(current.items.map((i) => i.id));
        set({
          ...current,
          items: [...current.items, ...result.items.filter((i) => !seen.has(i.id))],
          nextBefore: result.next_before ?? null,
          loadingMore: false,
          moreFailed: false,
        });
      });
    },
    /** Tell the controller what the displayed artifact version is. */
    refresh(next: string | number | null | undefined) {
      const changed = key !== undefined && next !== key;
      key = next;
      if (!changed || state.status === "idle") return;
      if (open) fetchFirstPage();
      else stale = true;
    },
    /** Unmount / parameter change: abort and ignore anything still in flight. */
    dispose() {
      inflight?.abort();
      inflight = null;
      seq += 1;
      if (state.status === "loading") state = { status: "idle" };
      else if (state.status === "ready" && state.loadingMore) state = { ...state, loadingMore: false };
    },
  };
}

export type PromptTraceController = ReturnType<typeof createPromptTraceController>;
