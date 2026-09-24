import type { Episode, EpisodeMode, Shot } from "./episode";
import type { Persona, PersonaStyle } from "./persona";
import type { StageName } from "../stages";
import type { Template } from "./template";

/**
 * Task queue payload (PRD v0.2 §6, ADR-0004). Transient — carries only a
 * reference, never the episode body. Transport is a `tasks` table in the
 * same local SQLite database (packages/store), not Redis.
 */
export interface Task {
  task_id: string;
  episode_id: string;
  stage: StageName;
  shot_no?: number;
  attempt: number;
}

/**
 * Generic "patch envelope" shapes for episode/shot writes (ADR-0004).
 * Originally an HTTP request body (worker -> apps/web's /internal/*); that
 * HTTP layer is gone now that web/worker share a machine and both call
 * packages/store directly, but the same envelope shape (row_version +
 * patch) is still the right argument shape for packages/store's
 * patchEpisode/patchShot — and for apps/web's own public /api/episodes
 * routes later, which still take untrusted JSON from the browser and need
 * something to validate against (see schema/validate.ts).
 *
 * row_version is the optimistic-lock counter packages/store maintains per
 * row — distinct from persona_version/destination_version, which are
 * domain snapshots baked into the episode doc itself.
 */

// Fields allowed to be patched on a single shot: the first group is
// worker/review-desk write-back (generation results + review decisions),
// the second is what PRD v0.2 §4 lets a human change at 审核 1（镜头顺序
// 之外的脚本字段）和 审核 2（改 prompt 后重生成）。
//
// Still not patchable: `no`（顺序由 state/episode.ts 的 reorderShots 整体
// 重排，不能单镜改号）、`scene`（场景是 script 阶段的产出结构，审核 1 只
// 改镜、不改场景表）、`duration_s`（节拍对齐由 FR-07 的合成逻辑决定，不是
// 人工字段）。
export type ShotPatch = Partial<
  Pick<
    Shot,
    | "status"
    | "candidates"
    | "kf_selected"
    | "clip"
    | "trim_start_s"
    | "regen_stage"
    | "bad_shot_reported"
    | "model"
    | "beat"
    | "size"
    | "camera"
    | "landmark"
    | "kf_prompt"
    | "motion_prompt"
  >
>;

export interface PatchShotRequest {
  row_version: number;
  patch: ShotPatch;
}

// Fields allowed to be patched on the episode itself (status transitions
// and render-stage outputs). Brief/scenes/shots are not touched here —
// shots go through PatchShotRequest.
export type EpisodePatch = Partial<
  Pick<Episode, "status" | "credits_used" | "grid_refs" | "render" | "music">
>;

export interface PatchEpisodeRequest {
  row_version: number;
  patch: EpisodePatch;
}

// FR-11 账号: apps/web 的 /api/auth/* 请求体.
export interface LoginRequest {
  username: string;
  password: string;
}

// FR-03 角色: apps/web 的 POST /api/personas 请求体. 不含 persona_id/
// owner_id/version(服务端生成/管理)、refs(走单独的 POST /:id/refs 上传接口,
// 3–7 张的校验只在那一条路径上做,PATCH/创建都不碰 refs)。
export interface CreatePersonaRequest {
  name: string;
  desc: string;
  locked: string[];
  default_outfit: string;
  style: PersonaStyle;
}

// PATCH /api/personas/:id 请求体. Persona.version 不是乐观锁(不像
// Episode.row_version),updatePersona 自己管 bump,所以这里没有 row_version
// 信封,直接就是要改的字段。
export type PersonaPatch = Partial<Pick<Persona, "name" | "desc" | "locked" | "default_outfit" | "style">>;

// FR-01 建期: apps/web 的 POST /api/episodes 请求体. series_id/season/
// tone/banned/mode 都可省略——省略时由路由按 FR-01"缺字段给默认值"的验收
// 要求补上(mode 默认 per_shot 是 PRD 原文写明的默认值,其余是本 issue 自定
// 的合理默认,见 M2-5 commit)。persona_version/destination_version/
// render/music/estimated_credits 等派生字段不在请求体里——那些是服务端在
// 提交那一刻从 persona/destination/template 当前状态算出来的快照,不是
// 客户端能直接指定的。
export interface CreateEpisodeRequest {
  persona_id: string;
  destination_id: string;
  template_id: string;
  series_id?: string;
  season?: string;
  tone?: string;
  banned?: string[];
  mode?: EpisodeMode;
  outfit_override?: string;
}

// FR-10 模板: apps/web 的 POST /api/templates 请求体. 不含 template_id/
// owner_id(服务端生成/从会话取)，其余字段和 Template 一一对应。
export type CreateTemplateRequest = Pick<
  Template,
  "name" | "skeleton" | "lut" | "intro" | "outro" | "title_style"
>;
