import type { InferenceRequest, InferenceResponse } from "@kelvoy/engine";

/**
 * HTTP client to the local, always-on services/inference process (PRD §9).
 * Same machine/network, called by the worker after pulling a task.
 */
const TIMEOUT_MS = 5 * 60 * 1000; // PRD §8: 5-minute timeout, then retry.

export type InferenceError =
  | { type: "timeout" }
  | { type: "network"; message: string }
  | { type: "not_implemented" } // LLM and upscale routes still return 501
  | { type: "invalid_request"; details: unknown } // pydantic 422
  | { type: "http_error"; status: number; body: string };

export type CallInferenceResult =
  | { ok: true; response: InferenceResponse }
  | { ok: false; error: InferenceError };

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
  options: { timeoutMs?: number } = {},
): Promise<CallInferenceResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

  try {
    const res = await fetch(`${inferenceBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      return { ok: false, error: { type: "http_error", status: res.status, body: text } };
    }

    const response = (await res.json()) as InferenceResponse;
    return { ok: true, response };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { type: "timeout" } };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { type: "network", message } };
  } finally {
    clearTimeout(timeout);
  }
}
