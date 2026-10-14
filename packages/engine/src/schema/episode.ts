export type ShotSize = "wide" | "medium" | "close" | "detail" | "pov";
export type ShotCamera = "static" | "pan" | "push" | "follow";
export type SceneTime = "morning" | "noon" | "afternoon" | "evening" | "night";
export type EpisodeMode = "per_shot" | "grid";
export type EpisodeAspect = "9:16" | "16:9";
export type VideoSource = "keyframe" | "references";

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
export interface H3PromptProvenance {
  skill_version: string;
  writer_version: string;
  model: string;
  input_hash: string;
  ref_hashes: string[];
  mode: "I2VA" | "Ref2VA";
  duration_s: number;
}

export interface ShotModelRecord {
  h3_prompt?: H3PromptProvenance;
  provider: ProviderId;
  model: string;
  version: string;
  seed: number;
  prompt: string;
  ref_hashes: string[];
  /** Image only: the landmark picture actually sent (ref_hashes are content hashes, not keys). */
  landmark_ref_key?: string;
  attempts: number;
  cost_usd: number;
}

export interface ShotModelRef {
  image?: ShotModelRecord;
  video?: ShotModelRecord;
}

export interface Shot {
  shot_id?: string; // Immutable identity; legacy rows are normalized on decode.
  no: number;
  scene: string; // Scene.id
  size: ShotSize;
  beat: string;
  caption?: string;
  camera: ShotCamera;
  landmark: string | null; // Landmark.id
  kf_prompt: string;
  motion_prompt: string;
  /**
   * Whether a person is in frame. Only an explicit `false` is stored; absent means visible, so existing
   * episodes behave exactly as before. Set by the script stage; the storyboard editor can flip it (a change clears the shot's products).
   * When false the H3 rewrite is not forced to cite the person reference picture (the picture is still
   * supplied to the video model, which requires two references).
   */
  person_visible?: boolean;
  /**
   * Keyframe-stage override of which landmark reference picture is sent: an index into the landmark's
   * `refs`, or "none" for no landmark picture at all (person reference only). Absent = `refs[0]`, so
   * existing episodes behave exactly as before. A visual *input* choice, not a script field: editing it
   * at kf_review does not send the episode back to script_review; the shot is regenerated instead.
   */
  landmark_ref?: number | "none";
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
  /** 选用的自建穿搭（Persona.outfits[].outfit_id）；缺省或 null = 默认穿搭。 */
  outfit_id?: string | null;
  banned: string[];
}

export interface EpisodeShare {
  enabled: boolean;
  slug: string;
}

export interface EpisodeMusic {
  /** Missing enables legacy automatic selection; explicit false skips music. */
  enabled?: boolean;
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
  /**
   * Keep the clips' own audio (footsteps, ambience) in the final cut, independent of music. Missing
   * = false so recomposing an older episode keeps producing the same silent video; new episodes write true.
   */
  original_audio_enabled?: boolean;
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
  /** Missing on older episodes; they keep the reviewed-keyframe path. */
  video_source?: VideoSource;
  cut_policy?: "fixed_1s" | "beat_aligned" | "long_3_6";
  candidate_count: number;
  script_pending_task_id?: string | null;
  script_action_error?: string | null;
  failure_reason?: string | null;
  final?: FinalArtifact | null;
  final_needs_recompose?: boolean;
  shared_storyboard?: { shots: Shot[]; scenes: Scene[] };
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

// `duration_s` (long_3_6 only, suggested cut length) and `person_visible` are optional: omitted means
// the default (4 s on insert / person visible), and an explicit `person_visible: true` is normalised away.
export type ShotDraft = Pick<Shot, "scene" | "size" | "beat" | "caption" | "camera" | "landmark" | "kf_prompt" | "motion_prompt">
  & Partial<Pick<Shot, "duration_s" | "person_visible">>;
export type StoryboardPatch = Partial<ShotDraft>;
