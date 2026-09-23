import type { Episode, Shot } from "./episode";
import type { StageName } from "../stages";

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

// Fields allowed to be patched on a single shot. Anything else
// (schema-defining fields like `scene`/`camera`/`beat`) is script-stage
// output, not write-back.
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
export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}
