import type {
  ContentViolation,
  CreateEpisodeRequest,
  Destination,
  Episode,
  EpisodeMode,
  EpisodePatch,
  EstimateCostResult,
  Persona,
  RegenStage,
  ScriptRuleViolation,
  ShotPatch,
  Template,
} from "@kelvoy/engine";

// Typed wrapper around the /api/* routes apps/web/src/server/routes/*.ts
// actually serve. M2-7 scoped this to read-only pages (auth +
// personas/destinations/episodes lists + episode detail); M2-10 (#32) adds
// the templates create/list/delete + save-episode-as-template functions.
// Still no functions for persona-refs-upload/episode-writes — no page
// calls them yet.

export type ApiOk<T> = { ok: true } & T;

// content_blocked(#29) 带的是关键词违规，script_rule_violation(FR-02) 带的
// 是结构规则违规，两个后端路由用的都是 `violations` 这个键名，所以这里是个
// 联合类型；按 error 码决定该当成哪一种，或者用下面的 isContentViolation。
export type ApiViolation = ContentViolation | ScriptRuleViolation;

export function isContentViolation(v: ApiViolation): v is ContentViolation {
  return "term" in v;
}

export function isScriptRuleViolation(v: ApiViolation): v is ScriptRuleViolation {
  return "rule" in v;
}

// violations / current_row_version 只有特定路由的失败响应才有——放在通用
// ApiFail 上是因为 apiFetch 是唯一的解析点。
export type ApiFail = {
  ok: false;
  error?: string;
  errors?: unknown;
  message?: string;
  violations?: ApiViolation[];
  current_row_version?: number;
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

// M2-9 (#31): 审片台. 所有写操作都回 row_version（乐观锁计数器），调用方
// （review/useEpisodeMutation.ts）拿它接着做下一步，不用等下一次轮询。

export type WriteResult = ApiResult<{ row_version: number }>;

function post(path: string, body: unknown): Promise<WriteResult> {
  return apiFetch<{ row_version: number }>(path, { method: "POST", body: JSON.stringify(body) });
}

function episodePath(episodeId: string, suffix = ""): string {
  return `/api/episodes/${encodeURIComponent(episodeId)}${suffix}`;
}

function shotPath(episodeId: string, shotNo: number, suffix = ""): string {
  return `${episodePath(episodeId)}/shots/${encodeURIComponent(String(shotNo))}${suffix}`;
}

export function patchEpisode(episodeId: string, rowVersion: number, patch: EpisodePatch) {
  return apiFetch<{ row_version: number }>(episodePath(episodeId), {
    method: "PATCH",
    body: JSON.stringify({ row_version: rowVersion, patch }),
  });
}

export function patchShot(episodeId: string, shotNo: number, rowVersion: number, patch: ShotPatch) {
  return apiFetch<{ row_version: number }>(shotPath(episodeId, shotNo), {
    method: "PATCH",
    body: JSON.stringify({ row_version: rowVersion, patch }),
  });
}

export function continueEpisode(episodeId: string, rowVersion: number) {
  return post(episodePath(episodeId, "/continue"), { row_version: rowVersion });
}

export function recompose(episodeId: string, rowVersion: number) {
  return post(episodePath(episodeId, "/recompose"), { row_version: rowVersion });
}

export function reorderShots(episodeId: string, rowVersion: number, order: number[]) {
  return post(episodePath(episodeId, "/shots/reorder"), { row_version: rowVersion, order });
}

export function regenShot(
  episodeId: string,
  shotNo: number,
  rowVersion: number,
  regenStage?: RegenStage,
) {
  return post(shotPath(episodeId, shotNo, "/regen"), {
    row_version: rowVersion,
    ...(regenStage ? { regen_stage: regenStage } : {}),
  });
}

export function reportBadShot(
  episodeId: string,
  shotNo: number,
  rowVersion: number,
  regenStage?: RegenStage,
) {
  return post(shotPath(episodeId, shotNo, "/report-bad"), {
    row_version: rowVersion,
    ...(regenStage ? { regen_stage: regenStage } : {}),
  });
}

export function removeShot(episodeId: string, shotNo: number, rowVersion: number) {
  return post(shotPath(episodeId, shotNo, "/remove"), { row_version: rowVersion });
}

/** 期目录下的产物（候选图 kf/07_a.png、片段 clip/07.mp4、网格 grid/plan_01.png、成片）。 */
export function episodeFileUrl(episodeId: string, key: string): string {
  return `${episodePath(episodeId)}/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** projects 根下的共享参考图（dest/... 地标实景、persona/... 角色参考）。 */
export function assetUrl(key: string): string {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}
