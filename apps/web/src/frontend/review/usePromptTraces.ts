import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchPromptTraces } from "../api/prompts";
import { createPromptTraceController } from "./prompt-trace-controller";

/**
 * React binding for the prompt-trace controller. A new controller (and thus a
 * fresh idle state) is created whenever the episode, kind or shot changes; the
 * old one is disposed so its in-flight request is aborted and ignored.
 */
export function usePromptTraces({ episodeId, kind, shotId, refreshKey }: {
  episodeId: string; kind: "script" | "video"; shotId?: string; refreshKey?: string | number | null;
}) {
  const controller = useMemo(() => createPromptTraceController({
    fetchPage: (before, signal) => fetchPromptTraces(episodeId, { kind, shotId, before }, signal),
  }), [episodeId, kind, shotId]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => { controller.refresh(refreshKey ?? null); }, [controller, refreshKey]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { controller, state };
}
