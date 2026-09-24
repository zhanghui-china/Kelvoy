import type {
  ContentViolation,
  CreateEpisodeRequest,
  Destination,
  Episode,
  EpisodeMode,
  EstimateCostResult,
  Persona,
  Template,
} from "@kelvoy/engine";

// Typed wrapper around the /api/* routes apps/web/src/server/routes/*.ts
// actually serve. M2-7 scoped this to read-only pages (auth +
// personas/destinations/episodes lists + episode detail); M2-10 (#32) adds
// the templates create/list/delete + save-episode-as-template functions.
// Still no functions for persona-refs-upload/episode-writes — no page
// calls them yet.

export type ApiOk<T> = { ok: true } & T;
// violations 只有 POST /api/episodes 命中关键词拦截(#29)时才有，其它路由的
// 失败响应没有这个字段——放在通用 ApiFail 上是因为 apiFetch 是唯一的解析点。
export type ApiFail = {
  ok: false;
  error?: string;
  errors?: unknown;
  message?: string;
  violations?: ContentViolation[];
};
export type ApiResult<T> = ApiOk<T> | ApiFail;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, error: "network_error" };
  }
  const body = (await res.json().catch(() => null)) as ApiResult<T> | null;
  return body ?? { ok: false, error: "invalid_response" };
}

export interface AuthedUser {
  user_id: string;
  username: string;
}

export function login(username: string, password: string) {
  return apiFetch<{ user: AuthedUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return apiFetch<Record<string, never>>("/api/auth/logout", { method: "POST" });
}

export function listPersonas() {
  return apiFetch<{ personas: Persona[] }>("/api/personas");
}

export function listDestinations() {
  return apiFetch<{ destinations: Destination[] }>("/api/destinations");
}

export function listEpisodes() {
  return apiFetch<{ episodes: Episode[] }>("/api/episodes");
}

export function getEpisode(episodeId: string) {
  return apiFetch<{ episode: Episode; row_version: number }>(
    `/api/episodes/${encodeURIComponent(episodeId)}`,
  );
}

export function listTemplates() {
  return apiFetch<{ templates: Template[] }>("/api/templates");
}

export type CreateTemplateBody = Pick<
  Template,
  "name" | "skeleton" | "lut" | "intro" | "outro" | "title_style"
>;

export function createTemplate(body: CreateTemplateBody) {
  return apiFetch<{ template: Template }>("/api/templates", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteTemplate(templateId: string) {
  return apiFetch<Record<string, never>>(`/api/templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}

export function saveEpisodeAsTemplate(episodeId: string, name: string) {
  return apiFetch<{ template: Template }>(
    `/api/episodes/${encodeURIComponent(episodeId)}/save-as-template`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
}

// M2-8 (#30): brief 表单页.

export function createEpisode(body: CreateEpisodeRequest) {
  return apiFetch<{ episode: Episode }>("/api/episodes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getEstimate(mode: EpisodeMode) {
  return apiFetch<{ estimate: EstimateCostResult }>(
    `/api/episodes/estimate?mode=${encodeURIComponent(mode)}`,
  );
}
