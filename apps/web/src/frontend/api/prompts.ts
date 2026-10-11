import type { PromptTracesResponse } from "../../shared/prompt-traces";
import type { ApiResult } from "./client";

// docs/api/prompt-traces.md. Kept local (like api/system.ts) because it needs an
// AbortSignal and a distinct "aborted" result that the shared apiFetch does not model.

export type PromptTraceQuery = {
  kind: "script" | "video";
  shotId?: string;
  before?: string;
  limit?: number;
};

const TIMEOUT_MS = 15_000;

export async function fetchPromptTraces(
  episodeId: string,
  query: PromptTraceQuery,
  signal?: AbortSignal,
): Promise<ApiResult<PromptTracesResponse>> {
  const params = [`kind=${encodeURIComponent(query.kind)}`];
  if (query.shotId !== undefined) params.push(`shot_id=${encodeURIComponent(query.shotId)}`);
  if (query.limit !== undefined) params.push(`limit=${encodeURIComponent(String(query.limit))}`);
  if (query.before !== undefined) params.push(`before=${encodeURIComponent(query.before)}`);
  const path = `/api/episodes/${encodeURIComponent(episodeId)}/prompts?${params.join("&")}`;

  if (signal?.aborted) return { ok: false, error: "aborted" };
  // One controller merges the caller's signal with our own timeout.
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  try {
    const response = await fetch(path, { method: "GET", signal: controller.signal });
    const body = await response.json().catch(() => null) as ApiResult<PromptTracesResponse> | null;
    if (!body || typeof body.ok !== "boolean") return { ok: false, error: "invalid_response" };
    if (body.ok) {
      if (!response.ok || !Array.isArray(body.items)) return { ok: false, error: "invalid_response" };
      return body;
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: timedOut ? "timeout" : "aborted" };
    }
    return { ok: false, error: "network_error" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
