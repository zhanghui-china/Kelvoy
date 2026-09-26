export type ShotSize = "wide" | "medium" | "close" | "detail" | "pov";
export type ShotCamera = "static" | "pan" | "push" | "follow";
export type SceneTime = "morning" | "noon" | "afternoon" | "evening" | "night";
export type EpisodeMode = "per_shot" | "grid";
export type EpisodeAspect = "9:16" | "16:9";

// PRD v0.2 §6 期级状态机. Review states advance to the next generating state on user action.
export type EpisodeStatus =
  | "draft"
  | "scripting"
  | "script_review"
  | "assets"
  | "keyframing"
  | "kf_review"
  | "clipping"
  | "clip_review"
  | "compose_ready"
  | "composing"
  | "done"
  | "failed";

// PRD v0.2 §6 镜级状态机. rejected = user asked for regeneration (see regen_stage), not deletion.
export type ShotStatus =
  | "draft"
  | "generating_kf"
  | "kf_ready"
  | "kf_selected"
  | "generating_clip"
  | "clip_ready"
  | "approved"
  | "rejected"
  | "failed";

export type RegenStage = "keyframe" | "video";

export type ProviderId = "local" | "kling" | "jimeng" | (string & {});

export interface Scene {
  id: string;
  name: string;
  time: SceneTime;
  landmarks: string[]; // Landmark.id[]
}

// Reproducibility record per modality (PRD v0.2 §6, §8). attempts counts local retries + overflow.
export interface ShotModelRecord {
  provider: ProviderId;
  model: string;
  version: string;
  seed: number;
  prompt: string;
  ref_hashes: string[];
  attempts: number;
  cost_usd: number;
}

export interface ShotModelRef {
  image?: ShotModelRecord;
  video?: ShotModelRecord;
}

export interface Shot {
  no: number;
  scene: string; // Scene.id
  size: ShotSize;
  beat: string;
  caption?: string;
  camera: ShotCamera;
  landmark: string | null; // Landmark.id
  kf_prompt: string;
  motion_prompt: string;
  duration_s: number; // target; actual cut length is beat-aligned within 0.8–2.0 s (FR-07)
  candidates: string[];
  kf_selected: string | null;
  clip: string | null;
  trim_start_s: number | null;
  status: ShotStatus;
  regen_stage: RegenStage | null;
  bad_shot_reported: boolean;
  model: ShotModelRef;
}

export interface EpisodeBrief {
  season: string;
  aspect: EpisodeAspect;
  requirements: string;
  duration_s: number;
  tone: string;
  outfit_override: string | null;
  banned: string[];
}

export interface EpisodeShare {
  enabled: boolean;
  slug: string;
}

export interface EpisodeMusic {
  file: string;
  bpm: number;
  license: string;
}

export interface EpisodeRender {
  res: string;
  fps: number;
  title: string;
  intro: string | null; // defaults from template, overridable per episode
  outro: string | null;
  ai_label: boolean;
  subtitles_enabled?: boolean;
  transitions_enabled?: boolean;
}

export interface FinalArtifact {
  version: number;
  key: string;
  duration_s: number;
  width: number;
  height: number;
  fps: number;
  size_bytes: number;
  completed_at: string;
}

export interface Episode {
  episode_id: string;
  name: string;
  owner_id: string;
  persona_id: string;
  persona_version: number;
  destination_id: string;
  destination_version: number;
  series_id: string;
  template_id: string;
  status: EpisodeStatus;
  mode: EpisodeMode;
  cut_policy?: "fixed_1s" | "beat_aligned";
  candidate_count: number;
  script_pending_task_id?: string | null;
  script_action_error?: string | null;
  final?: FinalArtifact | null;
  created_at: string; // ISO 8601
  estimated_credits: number;
  credits_used: number;
  share: EpisodeShare;
  brief: EpisodeBrief;
  grid_refs: string[]; // planning grids (per_shot mode); viewable, not a review gate
  scenes: Scene[];
  shots: Shot[];
  removed_shots: Shot[]; // deleted at review 1; kept for history
  music: EpisodeMusic;
  render: EpisodeRender;
}
