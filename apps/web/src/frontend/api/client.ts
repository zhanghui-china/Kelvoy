import type {
  ContentViolation,
  CreateEpisodeRequest,
  CreatePersonaRequest,
  Destination,
  Episode,
  EpisodeMode,
  EpisodePatch,
  EstimateCostResult,
  Persona,
  PersonaPatch,
  RegenStage,
  ScriptRuleViolation,
  ShotPatch,
  Template,
  UserSettings,
} from "@kelvoy/engine";

// Typed wrapper around the /api/* routes apps/web/src/server/routes/*.ts
// actually serve. M2-7 scoped this to read-only pages (auth +
// personas/destinations/episodes lists + episode detail); M2-10 (#32) adds
// the templates create/list/delete + save-episode-as-template functions;
// M2-13 (#41) adds the persona create/patch/refs-upload functions below.

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

// 参考图上传（POST /api/personas/:id/refs）走 multipart/form-data，不能复用
// apiFetch——它固定塞 content-type: application/json，一旦 body 是 FormData
// 就丢了 multipart 需要的 boundary。不设 content-type，交给浏览器自己算。
async function apiFetchMultipart<T>(path: string, formData: FormData): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", body: formData });
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

export function getMe() {
  return apiFetch<{ user: AuthedUser; balance: { available: number; reserved: number } }>("/api/me");
}

// M2-15 (#43) 设置页：当前登录账号自己的出片默认值 + 改密码。路由前缀
// /api/me/* 都在 requireOwner 后面，改的永远是 cookie 对应的那个账号。

export function getMySettings() {
  return apiFetch<{ settings: UserSettings }>("/api/me/settings");
}

export function getMyCredits() {
  return apiFetch<{ balance: { available: number; reserved: number }; ledger: {
    entry_id: string; action_id: string; kind: string;
    available_delta: number; reserved_delta: number; created_at: string;
  }[] }>("/api/me/credits");
}

/** 合并式更新：只传要改的项，没传的保持原值（服务端 json_patch）。 */
export function updateMySettings(patch: UserSettings) {
  return apiFetch<{ settings: UserSettings }>("/api/me/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch<Record<string, never>>("/api/me/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export function listPersonas() {
  return apiFetch<{ personas: Persona[] }>("/api/personas");
}

// M2-13 (#41): 角色新建/编辑页.

export function createPersona(body: CreatePersonaRequest) {
  return apiFetch<{ persona: Persona }>("/api/personas", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchPersona(personaId: string, patch: PersonaPatch) {
  return apiFetch<{ persona: Persona }>(`/api/personas/${encodeURIComponent(personaId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** files.length 必须落在 [3, 7]（合上角色已有的张数）——后端校验，见
 * personas.ts；这里只管把 multipart 请求发出去，数量校验留给调用方在提交
 * 前做，好给出"至少 3 张 / 最多 7 张"这种即时反馈，不用等一趟网络。 */
export function uploadPersonaRefs(personaId: string, files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return apiFetchMultipart<{ persona: Persona }>(
    `/api/personas/${encodeURIComponent(personaId)}/refs`,
    form,
  );
}

export function listDestinations() {
  return apiFetch<{ destinations: Destination[] }>("/api/destinations");
}

export function listEpisodes() {
  return apiFetch<{ episodes: Episode[] }>("/api/episodes");
}

export function getEpisode(episodeId: string) {
  return apiFetch<{ episode: Episode; persona: Persona | null; row_version: number }>(
    `/api/episodes/${encodeURIComponent(episodeId)}`,
  );
}

/** FR-12 分享页看到的字段——服务端只挑这几个，见 share.ts，不含账号信息。 */
export type SharedEpisode = Pick<Episode, "episode_id" | "status" | "scenes" | "shots" | "music" | "render" | "final">;

/** 公开路由，不带 cookie 也能拿到——分享页不要求登录。 */
export function getShare(slug: string) {
  return apiFetch<{ episode: SharedEpisode }>(`/api/share/${encodeURIComponent(slug)}`);
}

export function shareFinalVideoUrl(slug: string): string {
  return `/api/share/${encodeURIComponent(slug)}/final.mp4`;
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

export function getEstimate(mode: EpisodeMode, candidates: number) {
  return apiFetch<{ estimate: EstimateCostResult; credit_quote: number }>(
    `/api/episodes/estimate?mode=${encodeURIComponent(mode)}&candidates=${encodeURIComponent(candidates)}`,
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

export function retryFailedTask(episodeId: string, rowVersion: number) {
  return post(episodePath(episodeId, "/retry"), { row_version: rowVersion });
}

export function convertLegacyCuts(episodeId: string, rowVersion: number) {
  return post(episodePath(episodeId, "/convert-cuts"), { row_version: rowVersion });
}

export function regenerateScript(episodeId: string, rowVersion: number) {
  return post(episodePath(episodeId, "/script/regenerate"), { row_version: rowVersion });
}

export function optimizeScript(episodeId: string, rowVersion: number, instruction: string) {
  return post(episodePath(episodeId, "/script/optimize"), { row_version: rowVersion, instruction });
}

export function recompose(episodeId: string, rowVersion: number) {
  return post(episodePath(episodeId, "/recompose"), { row_version: rowVersion });
}

// slug 不用从响应里读——写成功后 mutation.run 会 refresh()，slug 跟着
// episode.share 一起回来，见 DoneView.tsx。
export function setEpisodeShare(episodeId: string, rowVersion: number, enabled: boolean) {
  return post(episodePath(episodeId, "/share"), { row_version: rowVersion, enabled });
}

/** FR-12 分享页链接——不需要登录，前端路由见 App.tsx 的 /s/:slug。 */
export function shareUrl(slug: string): string {
  return `${window.location.origin}/s/${encodeURIComponent(slug)}`;
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
