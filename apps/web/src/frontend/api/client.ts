import type { Destination, Episode, Persona } from "@kelvoy/engine";

// Typed wrapper around the /api/* routes apps/web/src/server/routes/*.ts
// actually serve. Scoped to what M2-7's read-only pages need (auth +
// personas/destinations/episodes lists + episode detail) — no functions
// for templates/persona-refs-upload/episode-writes, since no page in this
// issue calls them (brief form and review desk are explicitly out of
// scope here, see M2-7 issue's "不做" list).

export type ApiOk<T> = { ok: true } & T;
export type ApiFail = { ok: false; error?: string; errors?: unknown; message?: string };
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

export function register(username: string, password: string) {
  return apiFetch<{ user: AuthedUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
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
