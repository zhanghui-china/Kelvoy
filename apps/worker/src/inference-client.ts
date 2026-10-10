import type { GenerationDiagnostic } from "./generation/errors";
import type { InferenceRequest, InferenceResponse } from "@kelvoy/engine";

/**
 * HTTP client to the local, always-on services/inference process (PRD §9).
 * Same machine/network, called by the worker after pulling a task.
 */
const TIMEOUT_MS = 5 * 60 * 1000; // PRD §8: 5-minute timeout, then retry.

export function videoTimeoutSeconds(): number {
  const value = Number(process.env.KELVOY_VIDEO_TIMEOUT_SECONDS ?? "900");
  if (!Number.isInteger(value) || value < 30 || value > 1800) {
    throw new Error("KELVOY_VIDEO_TIMEOUT_SECONDS must be an integer from 30 to 1800");
  }
  return value;
}

export type InferenceError =
  | { type: "timeout" }
  | { type: "cancelled" }
  | { type: "network"; message: string }
  | { type: "invalid_response" }
  | { type: "not_implemented" } // LLM and upscale routes still return 501
  | { type: "invalid_request"; details: unknown } // pydantic 422
  | { type: "http_error"; status: number; body: string; detail?: GenerationDiagnostic };

export type CallInferenceResult =
  | { ok: true; response: InferenceResponse }
  | { ok: false; error: InferenceError };

function isInferenceResponse(value: unknown): value is InferenceResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  const text = (item: unknown): item is string => typeof item === "string" && item.trim().length > 0;
  return Array.isArray(response.paths) && response.paths.length > 0 && response.paths.every(text)
    && text(response.model) && text(response.version) && Number.isSafeInteger(response.seed)
    && typeof response.seconds === "number" && Number.isFinite(response.seconds) && response.seconds >= 0;
}

function inferenceBaseUrl(): string {
  return process.env.INFERENCE_BASE_URL ?? "http://127.0.0.1:8100";
}

/**
 * Calls one of services/inference's endpoints (e.g. "/llm/", "/image/").
 * Distinguishes timeout / network failure / 501 (not implemented yet) /
 * 422 (bad request) / other HTTP errors, so a caller's retry logic (e.g.
 * FR-04's local-retry-then-overflow policy) can tell them apart instead of
 * treating every failure the same way.
 */
export async function callInference(
  path: string,
  body: InferenceRequest,
  options: { timeoutMs?: number; signal?: AbortSignal; baseUrl?: string; correlation?: { task_id: string; shot_id?: string; attempt: number } } = {},
): Promise<CallInferenceResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? (path === "/video/" ? (videoTimeoutSeconds() + 60) * 1000 : TIMEOUT_MS));
  const onCancel = () => controller.abort();
  options.signal?.addEventListener("abort", onCancel, { once: true });
  if (options.signal?.aborted) controller.abort();

  try {
    const res = await fetch(`${options.baseUrl ?? inferenceBaseUrl()}${path}`, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", ...(options.correlation ? {
        "X-Kelvoy-Task-Id": options.correlation.task_id,
        "X-Kelvoy-Shot-Id": options.correlation.shot_id ?? "",
        "X-Kelvoy-Attempt": String(options.correlation.attempt),
      } : {}) },
      ...(path === "/video/" ? { timeout: 0 } : {}),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 501) {
      return { ok: false, error: { type: "not_implemented" } };
    }
    if (res.status === 422) {
      const details = await res.json().catch(() => undefined);
      return { ok: false, error: { type: "invalid_request", details } };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail: GenerationDiagnostic | undefined;
      try { detail = parseDiagnostic(JSON.parse(text).detail); } catch { /* Legacy plain text errors. */ }
      return { ok: false, error: { type: "http_error", status: res.status, body: text, ...(detail ? { detail } : {}) } };
    }

    const response: unknown = await res.json();
    if (!isInferenceResponse(response)) return { ok: false, error: { type: "invalid_response" } };
    return { ok: true, response };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { type: options.signal?.aborted ? "cancelled" : "timeout" } };
    }
    if (err instanceof SyntaxError) return { ok: false, error: { type: "invalid_response" } };
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { type: "network", message } };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onCancel);
  }
}

function parseDiagnostic(value: unknown): GenerationDiagnostic | undefined {
  if (!value || typeof value !== "object") return;
  const d = value as Record<string, unknown>;
  const messages: Record<string, string> = {
    backend_unavailable: "视频生成服务暂时不可用，请稍后重试。",
    model_execution_failed: "视频模型执行失败，请联系团队排查。",
    media_validation_failed: "生成视频未通过媒体校验，请重试。",
    generation_timeout: `视频生成超过 ${Number(d.budget_seconds) / 60} 分钟，${d.cancellation === "confirmed" ? "已停止" : "已请求停止，停止结果未确认"}。`,
  };
  if (typeof d.code !== "string" || !messages[d.code] ||
      !["comfyui_submit", "comfyui_wait", "media_validation"].includes(String(d.stage)) ||
      typeof d.elapsed_seconds !== "number" || !Number.isFinite(d.elapsed_seconds) || d.elapsed_seconds < 0 ||
      typeof d.budget_seconds !== "number" || !Number.isFinite(d.budget_seconds) || d.budget_seconds < 0 ||
      !["confirmed", "unconfirmed", "failed", "not_needed"].includes(String(d.cancellation))) return;
  return { stage: String(d.stage), code: d.code, message: messages[d.code]!,
    elapsed_seconds: d.elapsed_seconds, budget_seconds: d.budget_seconds, cancellation: d.cancellation as GenerationDiagnostic["cancellation"] };
}
