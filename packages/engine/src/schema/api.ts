import type { Episode, Shot } from "./episode";
import type { StageName } from "../stages";

/**
 * Queue task (PRD v0.2 §6). Transient — carries only a reference, never the
 * episode body. Redis is the transport; this is the payload shape.
 */
export interface Task {
  task_id: string;
  episode_id: string;
  stage: StageName;
  shot_no?: number;
  attempt: number;
}

/**
 * Internal API (PRD v0.2 §9): apps/worker is the only caller, reached
 * outbound-only from DGX. apps/web owns Postgres; worker never connects to
 * it directly. All three endpoints live under apps/web's /internal/* prefix,
 * gated by a worker-only token (see docs/contracts/internal-api.md).
 *
 * Optimistic locking: every read returns row_version (the Postgres row's
 * version counter, distinct from persona_version/destination_version which
 * are domain snapshots). Every write must submit the row_version it read;
 * a mismatch is rejected with VersionConflict so two workers racing on the
 * same episode can't silently clobber each other.
 */

export interface GetEpisodeResponse {
  episode: Episode;
  row_version: number;
}

// Fields a worker is allowed to patch on a single shot. Anything else
// (schema-defining fields like `scene`/`camera`/`beat`) is script-stage
// output, not worker write-back.
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

export interface PatchShotResponse {
  row_version: number;
}

// Fields a worker is allowed to patch on the episode itself (status
// transitions and render-stage outputs). Brief/scenes/shots are not
// touched here — shots go through PatchShotRequest.
export type EpisodePatch = Partial<
  Pick<Episode, "status" | "credits_used" | "grid_refs" | "render" | "music">
>;

export interface PatchEpisodeRequest {
  row_version: number;
  patch: EpisodePatch;
}

export interface PatchEpisodeResponse {
  row_version: number;
}

export interface VersionConflict {
  error: "version_conflict";
  current_row_version: number;
}
