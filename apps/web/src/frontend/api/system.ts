import type { ApiResult } from "./client";

export interface SystemConfig {
  version: number;
  comfyui_base_url: string | null;
  bridge_base_url: string | null;
  updated_by: string | null;
  updated_at: string | null;
}
export type SystemCandidate = Pick<SystemConfig, "comfyui_base_url" | "bridge_base_url">;
export interface SystemConfigResponse {
  operator: boolean;
  config?: SystemConfig;
}
export type DiagnosticStatus = "healthy" | "busy" | "error" | "unchecked";
export interface DiagnosticCheck {
  service: "web" | "inference" | "comfyui" | "bridge";
  status: DiagnosticStatus;
  duration_ms: number;
  reason?: string;
  address?: string;
  queue?: { running: number; pending: number };
  dependencies?: { workflow: string; missing_nodes: string[]; missing_models: string[]; status: DiagnosticStatus }[];
}
export interface SystemTestResult { checked_at: string; checks: DiagnosticCheck[] }

// Kept local to this API boundary to avoid changing the existing client module.
async function request<T>(path: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      // Allow one second for delivery beyond the server's 15-second diagnostic budget.
      signal: AbortSignal.timeout(16_000),
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!result || typeof result.ok !== "boolean") return { ok: false, error: "invalid_response" };
    if (!response.ok && result.ok) return { ok: false, error: "invalid_response" };
    return result;
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: "network_error" };
  }
}
export function getSystemConfig() {
  return request<SystemConfigResponse>("/api/system/config", "GET");
}
export function testSystem(candidate?: SystemCandidate) {
  return request<SystemTestResult>("/api/system/test", "POST", candidate ?? {});
}
export function saveSystemConfig(config: SystemCandidate & { version: number }) {
  return request<{ config: SystemConfig }>("/api/system/config", "PATCH", config);
}
